// Safe smoke test: copies the project to a temp folder with fake secrets, starts a throwaway server,
// checks the account, privacy, XP and login-limit rules, then deletes everything. It never touches
// your real data/ folder or .env. Run:  npm run test:smoke
import { cpSync, rmSync, mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'wr-test-'));
const SKIP = new Set(['node_modules', '.env', 'data', 'backups', '.git']);
cpSync(src, tmp, { recursive: true, filter: (p) => !SKIP.has(path.basename(p)) });
// Fixture lessons with release dates relative to now, so expiry tests never go stale.
{
  const dir = path.join(tmp, 'public', 'content', 'lessons');
  const day = 86400000, now = Date.now();
  const mk = (id) => ({ id, title: id, level: 'Test', subject: 'Test', topic: 't', summary: 'A summary.', notes: [{ title: 'n', text: 't', working: ['w'], tasks: [{ t: 'num', m: 4, q: 'q', f: [{ l: 'x', v: 1 }] }] }], exercises: [] });
  const rel = (d) => new Date(now + d * day).toISOString();
  const fx = [['t-open', -1], ['t-old', -10], ['t-future', 2]];
  for (const [id] of fx) writeFileSync(path.join(dir, id + '.json'), JSON.stringify(mk(id)));
  writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ lessons: fx.map(([id, d]) => ({ id, file: id + '.json', title: id, subject: 'Test', level: 'Test', release: rel(d) })) }));
}
writeFileSync(path.join(tmp, '.env'), 'HEAD_STAFF_CODE=test-head-code-123\nTEACHER_PIN=4321\n');
const PORT = 3400 + Math.floor(Math.random() * 400);
const B = 'http://localhost:' + PORT;
const startServer = () => spawn(process.execPath, ['server.js'], { cwd: tmp, env: { ...process.env, PORT: String(PORT), GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', SESSION_SECRET: 'smoke-test-secret-0123456789abcdef' }, stdio: 'ignore' });
let server = startServer();
const waitUp = async () => { for (let i = 0; i < 60; i++) { try { if ((await call('GET', '/api/health')).s === 200) return true; } catch {} await new Promise((r) => setTimeout(r, 150)); } return false; };

const call = async (m, p, body, tok, extra = {}) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { 'x-wr-token': tok } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
};
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : '')); cond ? pass++ : fail++; };

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await call('GET', '/api/health')).s === 200) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }
  ok('server starts and /api/health answers', (await call('GET', '/api/health')).s === 200);
  const publisherPage = await call('GET', '/');
  ok('lesson publisher staff view is included in the app', publisherPage.s === 200 && publisherPage.j.includes('id="staff-lessons"'));
  ok('lesson publisher module is served', (await call('GET', '/lesson-publisher.js')).s === 200);
  ok('section lesson reader is served', (await call('GET', '/section-lesson.js')).s === 200);
  ok('ZIP library is served locally', (await call('GET', '/vendor/jszip.min.js')).s === 200);

  const st = await call('POST', '/api/auth/login', { type: 'staff', code: 'test-head-code-123' });
  const H = st.j.token; ok('head staff can log in', st.s === 200 && !!H);
  const qb = await call('GET', '/api/staff/question-bank', null, H);
  ok('question bank review queue is Head Staff protected and lists staged records', qb.s === 200 && qb.j.ok && qb.j.total === 129 && qb.j.questions.length > 0, 'records ' + (qb.j.total || 0));
  ok('question bank review interface and script are served', (await call('GET', '/')).j.includes('staff-question-bank') && (await call('GET', '/question-bank-review.js')).s === 200);
  const q0 = qb.j.questions[0];
  const img = await fetch(B + '/api/staff/question-bank/image?' + new URLSearchParams({set:q0.source.set, filename:q0.source.filename}), {headers:{'x-wr-token':H}});
  if (existsSync(path.join(tmp, 'bank', 'source-import', q0.source.set, 'images'))) ok('review tool can display the original source photo', img.status === 200 && (img.headers.get('content-type') || '').includes('image/jpeg'));
  else console.log('SKIP review tool source photo (the photo folders are not in this copy of the project)');
  const saved = await call('POST', '/api/staff/question-bank/save', {id:q0.id, stem:q0.stem, topic:q0.topic, options:Array.isArray(q0.options)?q0.options:[], answer_key:'', mark_scheme:'', review_status:'pending', review_flags:q0.review_flags||[]}, H);
  ok('review edits save back to the staged topic JSON', saved.s === 200 && saved.j.ok && saved.j.question.id === q0.id);
  ok('question bank endpoints reject unauthenticated access', (await call('GET', '/api/staff/question-bank')).s === 401);
  const kr = await call('POST', '/api/staff/admissions', { count: 3 }, H);
  const raw = kr.j.keys || kr.j.admissions || kr.j.created || [];
  const K = raw.map((x) => (typeof x === 'string' ? x : x.key || x.code));
  ok('staff can issue admission keys', (kr.s === 200 || kr.s === 201) && K.length === 3 && K.every(Boolean), 'got ' + K.length);

  const reg = (key, name) => call('POST', '/api/auth/register', { admissionKey: key, name, password: 'secret1', gender: 'Male', className: 'uppersixth', school: 'Test School', level: 'A level', subjects: ['maths', 'physics'] });
  const r1 = await reg(K[0], 'Ada One'); const T1 = r1.j.token; const ID1 = r1.j.user?.id;
  ok('registered student can log in with the right password', (await call('POST', '/api/auth/login', { id: ID1, password: 'secret1' })).s === 200);
  ok('student registers with a key', r1.s === 200 || r1.s === 201, 'status ' + r1.s);
  const [a, b] = await Promise.all([reg(K[1], 'Race Alpha'), reg(K[1], 'Race Beta')]);
  const wins = [a, b].filter((x) => x.s === 200 || x.s === 201).length;
  ok('one key cannot register two students at once', wins === 1, 'accepted ' + wins);
  ok('a used key is rejected afterwards', ![200, 201].includes((await reg(K[1], 'Late Comer')).s));
  const r3 = await reg(K[2], 'Cee Three'); const T2 = r3.j.token;
  const users = Object.values(JSON.parse(readFileSync(path.join(tmp, 'data', 'db', 'users.json'), 'utf8')));
  ok('the users file is intact and has exactly 3 students', users.filter((u) => u.role !== 'staff').length === 3, 'found ' + users.length);

  const noLogin = await call('GET', '/api/rankings');
  ok('rankings need a login', noLogin.s === 401, 'status ' + noLogin.s);
  const rk = await call('GET', '/api/rankings', null, T1);
  const row = (rk.j.rankings || []).find((x) => x.me) || {};
  ok('rankings show name, rank, xp and who "me" is', rk.s === 200 && row.name && row.rank && 'xp' in row && (rk.j.rankings || []).length === 3);
  const leaked = ['id', 'school', 'gender', 'className', 'level', 'password', 'passwordHash'].filter((k) => (rk.j.rankings || []).some((r) => k in r));
  ok('rankings do not expose id, school, gender, class or level', leaked.length === 0, leaked.join(',') || 'clean');
  ok('rankings show first name + initial only', row.name === 'Ada O.', row.name);

  const fake = await call('POST', '/api/activity/lesson', { lessonId: 'made-up', marks: 1, max: 1 }, T1);
  ok('a made-up lesson earns nothing', fake.s === 400, 'status ' + fake.s);
  const real = await call('POST', '/api/activity/lesson', { lessonId: 't-open', marks: 9999, max: 1 }, T1);
  const xp1 = real.j.user?.xp;
  ok('real lesson pays at most the lesson maximum (marks clamped)', real.s === 200 && xp1 === 100, 'xp ' + xp1);
  const again = await call('POST', '/api/activity/lesson', { lessonId: 't-open', marks: 4, max: 4 }, T1);
  ok('the same lesson cannot pay twice', again.j.user?.xp === xp1, 'xp ' + again.j.user?.xp);

  // ---- lessons expire 10 days after release ----
  const man = await call('GET', '/content/lessons/index.json');
  const ids = (man.j.lessons || []).map((l) => l.id);
  ok('manifest lists open and upcoming notes but hides expired ones', ids.includes('t-open') && ids.includes('t-future') && !ids.includes('t-old'), ids.join(','));
  ok('manifest reports how many expired', man.j.expiredCount === 1 && typeof man.j.now === 'number');
  const fut = (man.j.lessons || []).find((l) => l.id === 't-future') || {};
  ok('upcoming note is locked and its file name is not revealed', fut.locked === true && !('file' in fut));
  ok('open note file is served', (await call('GET', '/content/lessons/t-open.json')).s === 200);
  ok('expired note file is gone (410)', (await call('GET', '/content/lessons/t-old.json')).s === 410);
  ok('upcoming note file is refused (403)', (await call('GET', '/content/lessons/t-future.json')).s === 403);
  ok('expired note cannot be fetched by changing letter case', (await call('GET', '/content/lessons/T-OLD.json')).s !== 200);
  const oldXp = await call('POST', '/api/activity/lesson', { lessonId: 't-old', marks: 4, max: 4 }, T1);
  ok('an expired note cannot earn XP', oldXp.s === 410 && oldXp.j.user === undefined, 'status ' + oldXp.s);
  const futXp = await call('POST', '/api/activity/lesson', { lessonId: 't-future', marks: 4, max: 4 }, T1);
  ok('a not-yet-open note cannot earn XP', futXp.s === 410 && futXp.j.user === undefined, 'status ' + futXp.s);

  // ---- shared daily quest engine ----
  ok('daily quests require a student login', (await call('GET', '/api/daily-quests')).s === 401);
  const dqNoStaff = await call('GET', '/api/staff/daily-quests', null, T1);
  ok('students cannot access the daily quest planner', dqNoStaff.s === 401);
  const dqStaff = await call('GET', '/api/staff/daily-quests', null, H);
  ok('Head Staff can view daily quest settings and subjects', dqStaff.s === 200 && dqStaff.j.subjects?.length >= 4);
  const dqGen = await call('POST', '/api/staff/daily-quests/generate', {}, H);
  ok("Head Staff can generate today's shared subject quests", dqGen.s === 200 && dqGen.j.ok);
  const dqStudent = await call('GET', '/api/daily-quests', null, T1);
  const dq = (dqStudent.j.quests || []).find(x => x.subject === 'maths');
  ok('student receives shared daily quests with summary notes', dqStudent.s === 200 && !!dq && dq.questions.length > 0 && dq.notes.length > 0);
  const dqAnswers = {};
  for (const question of dq.questions) dqAnswers[question.id] = question.type === 'mcq' ? { choice: question.options[0]?.id || '' } : Object.fromEntries((question.steps || []).map(step => [step.id, '1']));
  const dqSubmit = await call('POST', '/api/daily-quests/submit', { questId: dq.id, answers: dqAnswers, summaryChoice: 'skip' }, T1);
  ok('student can submit a daily quest and receive a score/XP result', dqSubmit.s === 200 && dqSubmit.j.result && typeof dqSubmit.j.result.xp === 'number');
  const dqRepeat = await call('POST', '/api/daily-quests/submit', { questId: dq.id, answers: dqAnswers, summaryChoice: 'skip' }, T1);
  ok('daily quest submission cannot be replayed for more XP', dqRepeat.s === 400);
  const dqPlan = await call('POST', '/api/staff/daily-quests/settings', { mode: 'exam', questionCount: 2, examTopics: { 'a-level:maths': ['pure-algebra'] } }, H);
  ok('Head Staff can configure exam mode and selected topics', dqPlan.s === 200 && dqPlan.j.settings.mode === 'exam' && dqPlan.j.settings.examTopics['a-level:maths'].includes('pure-algebra'));


  // ---- v5: level + subject selection, JSON deposit, Record ----
  const cat = await call('GET', '/api/catalog');
  ok('public catalog lists A Level (6 subjects) and Form 5 (8 subjects)', cat.s === 200 && cat.j.levels.find((l) => l.id === 'a-level')?.subjects.length === 6 && cat.j.levels.find((l) => l.id === 'form-5')?.subjects.length === 8);
  ok('A Level offers ICT and Further Maths but not French', (() => { const a = cat.j.levels.find((l) => l.id === 'a-level').subjects.map((x) => x.id); return a.includes('ict') && a.includes('further-maths') && !a.includes('french'); })());
  ok('Form 5 offers Additional Maths, French, English, Economics', (() => { const f = cat.j.levels.find((l) => l.id === 'form-5').subjects.map((x) => x.id); return ['additional-maths', 'french', 'english', 'economics'].every((x) => f.includes(x)); })());
  const spare = await call('POST', '/api/staff/admissions', { count: 2 }, H); const SK = (spare.j.keys || []).map((x) => x.key);
  const noSubj = await call('POST', '/api/auth/register', { admissionKey: SK[0], name: 'No Subjects', password: 'secret1', gender: 'Male', className: 'F5', school: 'S', level: 'Form 5', subjects: [] });
  ok('registration without a subject is refused', noSubj.s === 400, 'status ' + noSubj.s);
  const wrongSubj = await call('POST', '/api/auth/register', { admissionKey: SK[0], name: 'Wrong Subject', password: 'secret1', gender: 'Male', className: 'F5', school: 'S', level: 'Form 5', subjects: ['further-maths'] });
  ok('a subject the level does not offer is refused', wrongSubj.s === 400 && /not offered/.test(wrongSubj.j.problem || ''), wrongSubj.j.problem);
  const f5 = await call('POST', '/api/auth/register', { admissionKey: SK[0], name: 'Form Five Student', password: 'secret1', gender: 'Female', className: 'Form 5', school: 'S', level: 'Form 5', subjects: ['maths', 'french'] });
  ok('a Form 5 student registers with level and subjects', (f5.s === 200 || f5.s === 201) && f5.j.user.levelKey === 'form-5' && f5.j.user.subjects.join() === 'maths,french');
  const TF = f5.j.token;
  const myq = await call('GET', '/api/daily-quests', null, T1);
  ok('an A Level student sees only the subjects they chose', myq.j.quests.length > 0 && myq.j.quests.every((x) => ['maths', 'physics'].includes(x.subject) && x.level === 'a-level'), (myq.j.quests || []).map((x) => x.subject).join());
  const f5q0 = await call('GET', '/api/daily-quests', null, TF);
  ok('a Form 5 student has no quests until Form 5 questions exist, and is told which subjects wait', f5q0.s === 200 && f5q0.j.quests.length === 0 && f5q0.j.subjects.every((x) => !x.hasQuest));
  const badUpd = await call('POST', '/api/me/subjects', { level: 'a-level', subjects: ['french'] }, T1);
  ok('a student cannot pick a subject their level does not offer', badUpd.s === 400);
  const f5pr = await call('GET', '/api/practice/overview', null, TF);
  ok('Form 5 practice is scoped to Form 5 (no A Level questions leak in)', f5pr.s === 200 && f5pr.j.subjects.every((x) => ['maths', 'french'].includes(x.id)) && f5pr.j.subjects.every((x) => x.topics.every((t) => t.questions === 0)));

  const sample = readFileSync(path.join(src, 'bank', 'deposit-samples', 'form5-maths-sample.json'), 'utf8');
  ok('students cannot use the JSON deposit', (await call('POST', '/api/staff/deposit/check', { json: sample }, T1)).s === 401);
  const dpOv = await call('GET', '/api/staff/deposit', null, H);
  ok('deposit overview shows coverage for every level and subject', dpOv.s === 200 && dpOv.j.coverage.length === 14, 'rows ' + (dpOv.j.coverage || []).length);
  const bad = JSON.parse(sample); bad.questions[1].options[0].correct = true; bad.questions[0].steps[0].expected = 'twenty one';
  const chkBad = await call('POST', '/api/staff/deposit/check', { json: JSON.stringify(bad) }, H);
  ok('check rejects an MCQ with two correct answers and a non-numeric number answer', chkBad.j.invalid >= 2 && chkBad.j.valid === 3, JSON.stringify([chkBad.j.valid, chkBad.j.invalid]));
  ok('check gives staff the reasons', (chkBad.j.questions || []).filter((x) => !x.ok).every((x) => x.errors.length));
  ok('check rejects text that is not JSON', (await call('POST', '/api/staff/deposit/check', { json: 'hello' }, H)).s === 400);
  const chk = await call('POST', '/api/staff/deposit/check', { json: sample }, H);
  ok('check passes the Form 5 sample and writes nothing', chk.j.valid === 5 && chk.j.invalid === 0 && !existsSync(path.join(tmp, 'bank', 'questions', 'deposit-x')));
  const cm = await call('POST', '/api/staff/deposit/commit', { json: sample }, H);
  ok('commit deposits 5 questions and their notes', cm.s === 200 && cm.j.deposited === 5, JSON.stringify(cm.j).slice(0, 120));
  const cm2 = await call('POST', '/api/staff/deposit/commit', { json: sample }, H);
  ok('depositing the same JSON again renames the ids instead of colliding', cm2.s === 200 && cm2.j.deposited === 5 && cm2.j.ids.every((id) => /-d\d{3}$/.test(id)), (cm2.j.ids || []).join());
  const depQs = Object.values(JSON.parse(readFileSync(path.join(tmp, 'data', 'db', 'bankQuestions.json'), 'utf8')));
  ok('both deposits are saved in the database, and the bank folder is untouched', depQs.length === 10 && new Set(depQs.map((q) => q.deposit.batch)).size === 2 && !readdirSync(path.join(tmp, 'bank', 'questions')).some((f) => f.startsWith('deposit-')));
  const examOnly = await call('GET', '/api/daily-quests', null, TF);
  ok('in exam mode a level with no chosen topics gets no quest (staff choose topics first)', examOnly.j.quests.length === 0);
  await call('POST', '/api/staff/daily-quests/settings', { mode: 'exam', questionCount: 3, examTopics: { 'form-5:maths': ['f5-m-algebra', 'f5-m-number'] } }, H);
  const f5q1 = await call('GET', '/api/daily-quests', null, TF);
  const fq = (f5q1.j.quests || []).find((x) => x.subject === 'maths');
  ok('the Form 5 student now gets a live Form 5 Maths quest, with no restart', !!fq && fq.level === 'form-5' && fq.questions.length > 0 && fq.notes.length > 0);
  ok('the quest sent to the browser has no answers, traps or expected values', !/expected|trap|"correct"/.test(JSON.stringify(fq)));
  const a1 = await call('GET', '/api/daily-quests', null, T1);
  ok('A Level students never see Form 5 quests', a1.j.quests.every((x) => x.level === 'a-level'));
  const key = JSON.parse(sample).questions; const answers = {};
  for (const qq of fq.questions) { const src0 = [...key].find((k) => qq.stem === k.stem) || bankQuestion(qq.id); answers[qq.id] = qq.type === 'mcq' ? { choice: src0.options.find((o) => o.correct).id } : Object.fromEntries(src0.steps.map((st) => [st.id, String(st.expected)])); }
  function bankQuestion(id) { const q = JSON.parse(readFileSync(path.join(tmp, 'data', 'db', 'bankQuestions.json'), 'utf8'))[id]; if (q) return q; throw new Error('no ' + id); }
  const sq = fq.questions.find((x) => x.type === 'structured');
  const ph = await call('POST', '/api/daily-quests/photo', { questId: fq.id, questionId: sq.id, images: ['data:image/jpeg;base64,AAAA'] }, TF);
  ok('a quest photo with no AI key is refused cleanly (no crash) and can be retried', ph.s === 400 && /key|AI|mark/i.test(ph.j.problem || ''), ph.j.problem);
  ok('a quest photo with a non-image is refused', (await call('POST', '/api/daily-quests/photo', { questId: fq.id, questionId: sq.id, images: ['hello'] }, TF)).s === 400);
  ok('quest photos need a student login', (await call('POST', '/api/daily-quests/photo', { questId: fq.id, questionId: sq.id, images: ['data:image/jpeg;base64,AAAA'] })).s === 401);
  ok('the ranking is closed until the student submits', (await call('GET', '/api/daily-quests/ranking?questId=' + encodeURIComponent(fq.id), null, TF)).s === 400);
  const fSub = await call('POST', '/api/daily-quests/submit', { questId: fq.id, answers, summaryChoice: 'read' }, TF);
  ok('correct answers earn full marks on the deposited quest', fSub.s === 200 && fSub.j.result.score === fSub.j.result.max && fSub.j.result.max > 0, JSON.stringify(fSub.j.result && [fSub.j.result.score, fSub.j.result.max]));
  const qrank = await call('GET', '/api/daily-quests/ranking?questId=' + encodeURIComponent(fq.id), null, TF);
  ok('after submitting, the student sees the ranking with their own name', qrank.s === 200 && qrank.j.total === 1 && qrank.j.top[0].me === true && qrank.j.top[0].name.length > 1);
  ok('the ranking needs a login', (await call('GET', '/api/daily-quests/ranking?questId=' + encodeURIComponent(fq.id))).s === 401);
  ok('Head Staff can list photo-marked answers; students cannot', (await call('GET', '/api/staff/daily-quests/photos', null, H)).s === 200 && (await call('GET', '/api/staff/daily-quests/photos', null, T1)).s === 401);
  const a1sub = await call('POST', '/api/daily-quests/submit', { questId: fq.id, answers, summaryChoice: 'read' }, T1);
  ok('an A Level student cannot submit a Form 5 quest', a1sub.s === 400);
  const rec = await call('GET', '/api/records', null, TF);
  ok('the Record shows the completed quest with its score beside it', rec.s === 200 && rec.j.records.length === 1 && rec.j.records[0].score === rec.j.records[0].max && rec.j.records[0].kind === 'daily-quest' && rec.j.records[0].level === 'form-5');
  ok('a student sees only their own Record', (await call('GET', '/api/records', null, T1)).j.records.every((r) => r.studentId !== f5.j.user.id));
  ok('the Record needs a login', (await call('GET', '/api/records')).s === 401);
  const srec = await call('GET', '/api/staff/records', null, H);
  ok('Head Staff see every student in the Records', srec.s === 200 && srec.j.records.some((r) => r.studentId === f5.j.user.id) && srec.j.records.some((r) => r.studentId !== f5.j.user.id), String(srec.j.total));
  ok('Records can be filtered by subject and level', (await call('GET', '/api/staff/records?subject=maths&level=form-5', null, H)).j.records.every((r) => r.subject === 'maths' && r.level === 'form-5'));
  const csv = await fetch(B + '/api/staff/records.csv', { headers: { 'x-wr-token': H } });
  ok('Records download as CSV', csv.status === 200 && (csv.headers.get('content-type') || '').includes('text/csv') && (await csv.text()).startsWith('Date,Student ID'));
  ok('students cannot read all Records', (await call('GET', '/api/staff/records', null, T1)).s === 401);
  const gen = await call('POST', '/api/staff/deposit/generate', { level: 'form-5', subject: 'french', count: 3 }, H);
  ok('Generate with Gemini reports a clear problem when no key is set (no crash)', gen.s === 400 && /key/i.test(gen.j.problem || ''), gen.j.problem);
  const pr = await call('POST', '/api/staff/deposit/prompt', { level: 'form-5', subject: 'french', count: 4 }, H);
  ok('the prompt builder names the level, subject, topic ids and schema', pr.j.ok && /Form 5/.test(pr.j.prompt) && /fr-grammar/.test(pr.j.prompt) && /trap/.test(pr.j.prompt) && !/\{\{/.test(pr.j.prompt));
  ok('the prompt builder refuses a subject the level does not offer', (await call('POST', '/api/staff/deposit/prompt', { level: 'a-level', subject: 'french' }, H)).s === 400);
  const wd = await call('POST', '/api/staff/deposit/withdraw', { id: 'f5-m-algebra-g001' }, H);
  ok('a deposited question can be withdrawn', wd.s === 200 && wd.j.ok);
  ok('only deposited questions can be withdrawn (the curated bank is protected)', (await call('POST', '/api/staff/deposit/withdraw', { id: 'pure-algebra-001' }, H)).s === 400);
  const upd = await call('POST', '/api/me/subjects', { level: 'form-5', subjects: ['maths', 'french', 'english'] }, TF);
  ok('a student can change their subjects on the Profile', upd.s === 200 && upd.j.user.subjects.length === 3);

  const ql = await call('GET', '/api/quests', null, T1);
  const qid = (ql.j.quests || [])[0]?.id;
  const q = await call('GET', '/api/quest?id=' + qid, null, T1);
  const guideKeys = Object.keys(q.j).filter((k) => /guide|rule|slip|scheme|answer|criteria/i.test(k));
  ok('quest sent to students has no marking guide', q.s === 200 && guideKeys.length === 0, guideKeys.join(',') || 'clean');

  for (const p of ['/.env', '/data/users.json', '/server.js', '/auth.js', '/quests/quadratic-basic.json', '/../auth.js'])
    ok('not downloadable: ' + p, [403, 404].includes((await call('GET', p)).s));
  ok('student cannot use staff routes', [401, 403].includes((await call('GET', '/api/staff/students', null, T1)).s));
  ok('no login cannot use staff routes', [401, 403].includes((await call('GET', '/api/staff/overview')).s));
  const big = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":"' + 'a'.repeat(40000) + '"}' }).then((r) => r.status, () => 'closed');
  ok('oversize request is refused', big === 'closed' || big >= 400, String(big));
  const hdr = (await fetch(B + '/')).headers;
  ok('security headers are sent', hdr.get('x-content-type-options') === 'nosniff' && hdr.get('x-frame-options') === 'DENY');

  // ---- practice engine (question bank) ----
  ok('practice needs a login', (await call('GET', '/api/practice/overview')).s === 401 && (await call('POST', '/api/practice/set', { subject: 'physics' })).s === 401);
  ok('head staff cannot use the student practice routes', [401, 403].includes((await call('GET', '/api/practice/overview', null, H)).s));
  const ov = await call('GET', '/api/practice/overview', null, T1);
  ok('practice overview lists only the subjects the student chose', ov.s === 200 && ov.j.subjects?.length === 2 && ov.j.subjects.every((x) => ['maths', 'physics'].includes(x.id)) && !!ov.j.recommended);
  const ps = await call('POST', '/api/practice/set', { subject: 'physics' }, T1);
  const set = ps.j.set;
  ok('a student can start a practice set', ps.s === 200 && set?.questions?.length >= 3);
  ok('the set sent to the browser has no answers, traps or marking notes', !/"expected"|"correct"|"trap"|"partial"|"mistake"|"variants"/.test(JSON.stringify(ps.j)));
  ok('the same set can be reloaded by its owner only', (await call('GET', '/api/practice/set?id=' + set.id, null, T1)).s === 200 && (await call('GET', '/api/practice/set?id=' + set.id, null, T2)).s === 404);
  ok('an empty submission is refused', (await call('POST', '/api/practice/submit', { setId: set.id, answers: {} }, T1)).s === 400);
  const q1 = set.questions[0];
  const wrong = q1.type === 'mcq' ? { choice: 'A' } : Object.fromEntries(q1.steps.map((x) => [x.id, '0.123456']));
  const sub = await call('POST', '/api/practice/submit', { setId: set.id, answers: { [q1.id]: wrong } }, T1);
  ok('a typed set is marked by the server', sub.s === 200 && sub.j.results?.length === set.questions.length && typeof sub.j.summary?.got === 'number');
  ok('a wrong answer reveals the correct one only after submitting', sub.j.results[0].steps ? sub.j.results[0].steps.some((x) => x.answer !== undefined) : sub.j.results[0].correctId !== undefined);
  ok('a set cannot be submitted twice', (await call('POST', '/api/practice/submit', { setId: set.id, answers: { [q1.id]: wrong } }, T1)).s === 400);
  ok('a photo without an AI key is refused cleanly and can be retried', (await call('POST', '/api/practice/photo', { setId: set.id, questionId: q1.id, images: ['data:image/jpeg;base64,AAAA'] }, T1)).s >= 400);
  ok('a photo with a non-image is refused', (await call('POST', '/api/practice/photo', { setId: set.id, questionId: q1.id, images: ['hello'] }, T1)).s === 400);
  // a seeded AI draft for a practice question: hidden from the student until Head Staff release it
  const sid = 'a'.repeat(32);
  server.kill(); await new Promise((r) => server.once('exit', r));   // the file store keeps its data in memory while running: stop, seed the file, start again
  const subsFile = path.join(tmp, 'data', 'db', 'submissions.json'); const subsNow = existsSync(subsFile) ? JSON.parse(readFileSync(subsFile, 'utf8')) : {};
  subsNow[sid] = ({ time: new Date().toISOString(), questId: 'practice:cs-os-001', kind: 'practice-photo', setId: 'x', studentId: ID1, transcription: '', correctionMd: '# CS\n\n## (c) Average **1 / 2**\n\nNext: divide by 3.', result: { criteria: [], total: 3, max: 6, lines: [], missing: [], confidence: 'medium', flags: [], status: 'awaiting tutor review' }, status: 'awaiting_review' });
  delete subsNow[sid].id; writeFileSync(subsFile, JSON.stringify(subsNow) + '\n');
  server = startServer(); ok('the server restarts on the same data and still accepts earlier logins (signed tokens)', (await waitUp()) && (await call('GET', '/api/me', null, T1)).s === 200);
  const pend = await call('GET', '/api/practice/photos', null, T1);
  ok('a practice photo draft shows as awaiting review with no correction or mark', pend.j.photos?.length === 1 && pend.j.photos[0].status === 'awaiting_review' && !('correctionMd' in pend.j.photos[0]) && !('final' in pend.j.photos[0]));
  const staffList = await call('GET', '/api/staff/submissions', null, H);
  ok('Head Staff see the draft with its correction in the review queue', staffList.j.submissions?.some((x) => x.id === sid && x.correctionMd.includes('Next:')));
  const xpBefore = (await call('GET', '/api/me', null, T1)).j.user.xp;
  const rel = await call('POST', '/api/staff/release', { id: sid, total: 4, comment: 'Well done' }, H);
  ok('Head Staff can release a practice photo mark', rel.s === 200 && rel.j.total === 4);
  const done = await call('GET', '/api/practice/photos', null, T1);
  ok('after release the student sees the final mark and correction', done.j.photos[0].status === 'released' && done.j.photos[0].final.total === 4 && done.j.photos[0].correctionMd.includes('Next:'));
  const xpAfter = (await call('GET', '/api/me', null, T1)).j.user.xp;
  ok('release pays practice XP (1 per mark), not the generic quest award', xpAfter - xpBefore === 4, 'gained ' + (xpAfter - xpBefore));
  ok('practice state is stored in data/db, outside public/', existsSync(path.join(tmp, 'data', 'db', 'practice.json')) && (await call('GET', '/data/practice.json')).s !== 200 && (await call('GET', '/bank/questions/physics.json')).s !== 200 && (await call('GET', '/engine/config.json')).s !== 200);
  ok('katex font files are served as woff2', (await fetch(B + '/vendor/fonts/KaTeX_Main-Regular.woff2')).headers.get('content-type') === 'font/woff2');

  // legacy teacher door and login limits last, because they lock things out on purpose
  const t = await call('POST', '/api/teacher/login', { pin: '4321' });
  ok('teacher PIN still works (legacy review screen)', t.s === 200, 'status ' + t.s);
  let codes = [];
  for (let i = 0; i < 8; i++) codes.push((await call('POST', '/api/auth/login', { id: ID1, password: 'wrong' + i })).s);
  ok('student account locks after 8 wrong passwords', codes.slice(0, 8).every((s) => s === 401) && (await call('POST', '/api/auth/login', { id: ID1, password: 'wrong9' })).s === 429, [...new Set(codes)].join(','));
  ok('even the right password waits while locked', (await call('POST', '/api/auth/login', { id: ID1, password: 'secret1' })).s === 429);
  codes = [];
  for (let i = 0; i < 7; i++) codes.push((await call('POST', '/api/auth/login', { type: 'staff', code: 'wrong' + i })).s);
  ok('staff code locks after 6 wrong tries', codes.slice(0, 6).every((s) => s === 401) && codes[6] === 429, codes.join(','));
  codes = [];
  for (let i = 0; i < 7; i++) codes.push((await call('POST', '/api/teacher/login', { pin: '000' + i })).s);
  ok('teacher PIN locks after 6 wrong tries', codes[6] === 429, codes.join(','));
}

try { await main(); } catch (e) { console.log('FAIL test crashed: ' + e.message); fail++; }
server.kill();
await new Promise((r) => setTimeout(r, 300));
try { rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
