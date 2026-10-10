// v5 engine tests (no server, no network, throwaway folders). Run:  npm run test:v5
import { mkdtempSync, rmSync, cpSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseLevel, checkSelection, subjectsFor, guessSubject } from '../engine/subjects.js';
import { createRecords } from '../engine/records.js';
import { createFileDb, createFirestoreDb } from '../engine/db.js';
import { FakeFirestore } from './fake-firestore.mjs';
import { loadBank, validateBank } from '../engine/bank.js';
import { createDeposit } from '../engine/deposit.js';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const okTop = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : '')); cond ? pass++ : fail++; };
const ok = okTop;

// ---- levels and subjects ----
ok('level names are understood', normaliseLevel('A level') === 'a-level' && normaliseLevel('Upper Sixth') === 'a-level' && normaliseLevel('O-Level') === 'form-5' && normaliseLevel('Form 5') === 'form-5' && normaliseLevel('Primary') === null);
ok('A Level subjects are exactly the six agreed', subjectsFor('a-level').sort().join() === ['chemistry', 'computer-science', 'further-maths', 'ict', 'maths', 'physics'].sort().join());
ok('Form 5 subjects are exactly the eight agreed', subjectsFor('form-5').sort().join() === ['additional-maths', 'chemistry', 'computer-science', 'economics', 'english', 'french', 'maths', 'physics'].sort().join());
ok('a selection must name at least one subject of the level', checkSelection('a-level', []).problem && checkSelection('a-level', ['french']).problem && !checkSelection('a-level', ['maths', 'ict']).problem);
ok('duplicates collapse and an unknown level is refused', checkSelection('form-5', ['maths', 'maths']).subjects.length === 1 && checkSelection('nonsense', ['maths']).problem);
ok('free-text lesson subjects map to subject ids', guessSubject('Pure Mathematics') === 'maths' && guessSubject('Further Maths') === 'further-maths' && guessSubject('Organic Chemistry') === 'chemistry' && guessSubject('xyz') === null);

// ---- the bank still validates with the new subjects and topics ----
const bank = loadBank();
const v = validateBank(bank);
ok('bank validates with 10 subjects', v.errors.length === 0 && bank.subjects.length === 10, v.errors.slice(0, 2).join(' | '));
ok('every topic has a skill, so any topic can receive deposited questions', bank.topics.every((t) => bank.skills.some((s) => s.topic === t.id)));
ok('Form 5 topics are marked form-5 and A Level topics are not', bank.topics.filter((t) => t.id.startsWith('f5-')).every((t) => t.levels?.join() === 'form-5') && bank.topics.filter((t) => t.id.startsWith('pure-')).every((t) => !t.levels));
const bad = [{ ...bank.questions[0], id: 'zz-level-test', level: 'form-5' }];
ok('a Form 5 question on an A Level-only topic is rejected', validateBank({ ...bank, questions: bad }).errors.some((e) => /not taught at form-5/.test(e)));

// ---- records ----
const dir = mkdtempSync(path.join(tmpdir(), 'wr-v5-'));
const backends = [['file', () => createFileDb(path.join(dir, 'filedb'))], ['firestore', () => createFirestoreDb(new FakeFirestore())]];
try { for (const [label, mk] of backends) {
  const db = mk();
  const ok = (n, c, x) => okTop(`[${label}] ${n}`, c, x);
  const rec = createRecords(db);
  const base = { studentId: 'WR-1', studentName: 'Ada', kind: 'daily-quest', title: 'Maths daily quest', subject: 'maths', level: 'a-level', score: 3, max: 4, xp: 6 };
  ok('a record is written once per key', (await rec.add({ ...base, key: 'k1' })) === 1 && (await rec.add({ ...base, key: 'k1' })) === 0);
  await rec.add({ ...base, key: 'k2', title: '=HYPERLINK("x")', score: 1, max: 4, studentId: 'WR-2', studentName: 'Bo' });
  const mine = await rec.forStudent('WR-1');
  ok('a student gets only their own records, with a percent', mine.records.length === 1 && mine.records[0].pct === 75 && mine.summary.tasks === 1);
  const all = await rec.all({});
  ok('staff totals add up across students', all.total === 2 && all.summary.score === 4 && all.summary.max === 8 && all.summary.pct === 50);
  ok('filters work', (await rec.all({ q: 'bo' })).total === 1 && (await rec.all({ subject: 'physics' })).total === 0);
  const csv = await rec.csv({});
  ok('CSV has a header and neutralises formulas', csv.startsWith('Date,Student ID') && csv.includes("'=HYPERLINK") && !/,=HYPERLINK/.test(csv));

  // ---- deposit, on a throwaway copy of the bank so nothing real is touched ----
  const root = path.join(dir, 'proj');
  cpSync(path.join(src, 'bank'), path.join(root, 'bank'), { recursive: true, filter: (p) => !p.includes('source-import') });
  cpSync(path.join(src, 'GEMINI-QUEST-PROMPT.md'), path.join(root, 'GEMINI-QUEST-PROMPT.md'));
  const b2 = loadBank(); // topics/skills come from the real engine folder; questions are re-read from the copy below
  const b3 = { ...b2, questions: [...b2.questions], notes: { ...b2.notes } };
  let refreshed = 0;
  const dep = createDeposit({ bank: b3, db, root, refresh: () => { refreshed++; } });
  const sample = readFileSync(path.join(src, 'bank', 'deposit-samples', 'form5-maths-sample.json'), 'utf8');
  const c1 = dep.check(sample);
  ok('the Form 5 sample passes the check', c1.ok && c1.valid === 5 && c1.invalid === 0 && Object.keys(c1.notes).length === 3);
  const lvl = JSON.parse(sample); delete lvl.questions[0].level; delete lvl.questions[0].total;
  const c2 = dep.check(JSON.stringify(lvl), { defaultLevel: 'form-5' });
  ok('a missing level and total are repaired and reported', c2.valid === 5 && c2.questions[0].fixes.length === 2, c2.questions[0].fixes.join('; '));
  const wrongKey = JSON.parse(sample); wrongKey.questions[0].steps[0].expected = 'x';
  ok('an unreadable answer key is rejected', dep.check(JSON.stringify(wrongKey)).questions[0].ok === false);
  const noTrap = JSON.parse(sample); delete noTrap.questions[1].options[0].trap;
  ok('a wrong MCQ option with no trap is rejected', dep.check(JSON.stringify(noTrap)).questions[1].ok === false);
  const noNote = JSON.parse(sample); noNote.notes = {};
  ok('a topic with no reading note is rejected', dep.check(JSON.stringify(noNote)).valid === 0);
  ok('A Level subject questions cannot be filed under a subject the level lacks', (() => { const x = JSON.parse(sample); x.questions[0].subject = 'french'; x.questions[0].level = 'a-level'; return dep.check(JSON.stringify(x)).questions[0].ok === false; })());
  ok('fenced JSON with chatter around it is accepted', dep.check('Here you go:\n```json\n' + sample + '\n```\nEnjoy!').valid === 5);
  ok('empty and invalid input is refused with a message', dep.check('').problem && dep.check('{nope').problem && dep.check('{"questions": []}').problem);
  const before = b3.questions.length;
  const done = await dep.commit(sample, { by: 'test' });
  ok('commit adds the questions to the running bank and refreshes', done.ok && b3.questions.length === before + 5 && refreshed === 1 && Boolean(b3.notes['f5-m-algebra']));
  ok('the batch is saved in the database with who and when', (await db.list('bankQuestions')).length === 5 && (await db.list('bankQuestions')).every((q) => q.deposit?.by === 'test'));
  ok('the deposited notes are saved in the database', (await db.list('bankNotes')).length === 3);
  // a second running copy of the server picks the deposit up from the database
  const other = { ...b2, questions: [...b2.questions], notes: { ...b2.notes } };
  const depB = createDeposit({ bank: other, db, root });
  await depB.sync({ force: true });
  ok('another server copy sees the deposit after it syncs', other.questions.length === before + 5 && Boolean(other.notes['f5-m-algebra']));
  const again = await dep.commit(sample);
  ok('a second deposit of the same file gets new ids', again.ok && again.ids.every((id) => /-d\d{3}$/.test(id)) && new Set(b3.questions.map((q) => q.id)).size === b3.questions.length);
  const ov = dep.overview();
  ok('overview counts deposited Form 5 Maths questions', ov.coverage.find((c) => c.level === 'form-5' && c.subject === 'maths').questions === 10 && ov.batches.length === 2);
  const w = await dep.withdraw(done.ids[0]);
  ok('withdrawing removes the question from the bank and the database', w.ok && !b3.questions.some((q) => q.id === done.ids[0]) && (await db.get('bankQuestions', done.ids[0])) === null);
  await depB.sync();
  ok('the other server copy drops the withdrawn question too', !other.questions.some((q) => q.id === done.ids[0]));
  ok('curated questions cannot be withdrawn', (await dep.withdraw('pure-algebra-001')).ok === false);
  const p = dep.buildPrompt({ level: 'a-level', subject: 'ict', topic: 'ict-databases', count: 3 });
  ok('the prompt for one ICT topic lists only that topic and asks for its note', p.ok && /ict-databases/.test(p.prompt) && !/ict-networks/.test(p.prompt) && /MUST include a note/.test(p.prompt));
  const stubbed = createDeposit({ bank: b3, db, root, ask: async () => ({ text: sample, model: 'stub', provider: 'Stub' }) });
  const g = await stubbed.generate({ level: 'form-5', subject: 'maths', count: 2 });
  ok('generate hands the model reply back for checking (stubbed model)', g.ok && stubbed.check(g.text).valid === 5 && g.model === 'stub');
  const failing = createDeposit({ bank: b3, db, root, ask: async () => ({ problem: 'No API key found in .env.' }) });
  ok('generate reports an AI problem cleanly', (await failing.generate({ level: 'form-5', subject: 'maths' })).ok === false);
} } finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
