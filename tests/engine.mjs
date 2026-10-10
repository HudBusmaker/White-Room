// Practice-engine tests: no server, no network, no real data. Run:  npm run test:engine
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadBank, validateBank } from '../engine/bank.js';
import { markStep, markQuestion, parseNumber, tokens } from '../engine/mark.js';
import { buildSet, settleRow, subjectsByNeed, topicsOfSubject, addDays, nextStrength } from '../engine/select.js';
import { createStore } from '../engine/store.js';
import { createFileDb } from '../engine/db.js';
import { createPractice } from '../engine/practice.js';
import { buildCorrectionPrompt, parseCorrection } from '../engine/photo.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : '')); cond ? pass++ : fail++; };
const bank = loadBank();
const cfg = bank.config;

// ---------- the bank ----------
const v = validateBank(bank);
ok('bank validates with no errors', v.errors.length === 0, v.errors.slice(0, 2).join(' | '));
const SEEDED = bank.subjects.filter((s) => bank.questions.some((q) => q.subject === s.id));
ok('the five original subjects all have questions', ['computer-science', 'maths', 'further-maths', 'physics', 'chemistry'].every((id) => SEEDED.some((s) => s.id === id)));
ok('every question names a topic and a skill', bank.questions.every((q) => q.topic && q.skill));
ok('both question types are present', bank.questions.some((q) => q.type === 'mcq') && bank.questions.some((q) => q.type === 'structured'));
// the answer key must mark itself fully right, and a blank answer must score zero
let selfOk = true, blankOk = true;
for (const q of bank.questions) {
  const ans = q.type === 'mcq' ? { choice: q.options.find((o) => o.correct).id } : Object.fromEntries(q.steps.map((s) => [s.id, String(s.expected)]));
  const r = markQuestion(q, ans); if (r.awarded !== q.total) { selfOk = false; console.log('  self-mark failed', q.id, r.awarded, q.total); }
  if (markQuestion(q, {}).awarded !== 0) blankOk = false;
}
ok('every answer key scores full marks against itself', selfOk);
ok('a blank answer scores zero everywhere', blankOk);
let trapOk = true;
for (const q of bank.questions.filter((x) => x.type === 'mcq')) for (const o of q.options.filter((x) => !x.correct)) { const r = markQuestion(q, { choice: o.id }); if (r.awarded !== 0 || r.trap !== o.trap) trapOk = false; }
ok('every wrong MCQ option scores 0 and returns its stored trap', trapOk);

// ---------- typed marking ----------
const num = (expected, tol, extra = {}) => ({ id: 'a', kind: 'number', expected, marks: 2, tolerance: tol, ...extra });
ok('number: exact match', markStep(num(20), '20').status === 'correct');
ok('number: unit and spaces are ignored', markStep(num(20, null, { unit: 'm/s' }), ' 20 m/s ').status === 'correct');
ok('number: fraction 1/2 equals 0.5', markStep(num(0.5), '1/2').status === 'correct');
ok('number: decimal comma 0,5 equals 0.5', markStep(num(0.5), '0,5').status === 'correct');
ok('number: 4 096 and 4,096 equal 4096', markStep(num(4096), '4 096').status === 'correct' && markStep(num(4096), '4,096').status === 'correct');
ok('number: scientific notation', markStep(num(0.00588, { rel: 0.01 }), '5.88e-3').status === 'correct' && markStep(num(0.00588, { rel: 0.01 }), '5.88x10^-3').status === 'correct');
ok('number: unicode minus sign', markStep(num(-3), '\u22123').status === 'correct');
ok('number: outside tolerance is wrong, inside is right', markStep(num(4.32, { abs: 0.01 }), '4.34').status === 'wrong' && markStep(num(4.32, { abs: 0.01 }), '4.33').status === 'correct');
ok('number: text is wrong with a "not a number" note', (() => { const r = markStep(num(5), 'five'); return r.status === 'wrong' && /not a number/i.test(r.note); })());
ok('number: a wrong answer reveals the correct one afterwards', markStep(num(20, null, { unit: 'm/s' }), '19').answer === '20 m/s');
const part = num(8, null, { marks: 2, partial: [{ value: 13, marks: 1, note: 'divide by 3' }] });
const pr = markStep(part, '13');
ok('method mark: a known near-miss earns partial credit and a note', pr.status === 'partial' && pr.awarded === 1 && pr.note === 'divide by 3');
ok('method mark can never equal full marks', markStep({ ...part, partial: [{ value: 13, marks: 5, note: 'x' }] }, '13').awarded < 2);
ok('text: case, spaces and 0x prefix are ignored', markStep({ id: 'a', kind: 'text', expected: 'CB', marks: 1 }, ' 0xcb ').status === 'correct');
ok('text: binary with spaces matches', markStep({ id: 'a', kind: 'text', expected: '00101101', marks: 1 }, '0010 1101').status === 'correct');
ok('text: listed variants are accepted', markStep({ id: 'a', kind: 'text', expected: 'XOR', variants: ['exclusive or'], marks: 1 }, 'Exclusive OR').status === 'correct');
ok('sequence: separators do not matter', tokens('2, 5 ,4 1') === tokens('2 5 4 1') && markStep({ id: 'a', kind: 'sequence', expected: '2 5 4 1', marks: 1 }, '2,5,4,1').status === 'correct');
ok('sequence: wrong order is wrong', markStep({ id: 'a', kind: 'sequence', expected: '2 5 4 1', marks: 1 }, '5 2 4 1').status === 'wrong');
ok('parseNumber rejects junk', Number.isNaN(parseNumber('1/0')) && Number.isNaN(parseNumber('--5')) && Number.isNaN(parseNumber('')));

// ---------- strength by score (config thresholds) ----------
ok('config thresholds: 80% and above goes up 1', nextStrength(2, 0.8, cfg) === 3 && nextStrength(2, 1, cfg) === 3);
ok('config thresholds: 50-79% stays', nextStrength(2, 0.5, cfg) === 2 && nextStrength(2, 0.79, cfg) === 2);
ok('config thresholds: below 50% goes down 1', nextStrength(2, 0.49, cfg) === 1 && nextStrength(2, 0, cfg) === 1);
ok('strength stays between 0 and 5', nextStrength(5, 1, cfg) === 5 && nextStrength(0, 0, cfg) === 0);
const alt = { ...cfg, strength: { ...cfg.strength, riseAt: 0.9, fallBelow: 0.6 } };
ok('thresholds really are read from config', nextStrength(2, 0.85, alt) === 2 && nextStrength(2, 0.55, alt) === 1);
ok('spacing is [1, 3, 7, 16, 35, 90] days by new strength', JSON.stringify(cfg.spacingDays) === '[1,3,7,16,35,90]');
const T = '2026-10-08';
ok('first success: strength 0 to 1, due in 3 days', (() => { const r = settleRow({ strength: 0, last_seen: null, next_due: null }, 0.9, T, cfg); return r.to === 1 && r.row.next_due === addDays(T, 3); })());
ok('a fall reschedules the topic for tomorrow', (() => { const r = settleRow({ strength: 1, last_seen: '2026-10-01', next_due: '2026-10-04' }, 0.2, T, cfg); return r.to === 0 && r.row.next_due === addDays(T, 1); })());
ok('practising BEFORE the due date cannot raise strength', (() => { const r = settleRow({ strength: 2, last_seen: '2026-10-07', next_due: '2026-10-14' }, 1, T, cfg); return r.to === 2 && r.gated && r.row.next_due === '2026-10-14'; })());
ok('a topic that is due can rise', (() => { const r = settleRow({ strength: 2, last_seen: '2026-10-01', next_due: '2026-10-08' }, 1, T, cfg); return r.to === 3 && !r.gated; })());
ok('a fall is allowed even before the due date', settleRow({ strength: 2, last_seen: '2026-10-07', next_due: '2026-10-14' }, 0.1, T, cfg).to === 1);

// ---------- selection ----------
const blank = () => ({ topics: {}, skills: {}, cleared: {} });
const avail = new Set(bank.questions.map((q) => q.topic));
let st = blank();
const need0 = subjectsByNeed({ subjects: bank.subjects, topics: bank.topics, state: st, available: avail, today: T });
ok('new student: every subject that has questions is drillable and untouched', need0.length === SEEDED.length && need0.every((n) => n.untouched === 1));
st.topics = { 'pure-algebra': { strength: 1, last_seen: T, next_due: addDays(T, 3) } };
const need1 = subjectsByNeed({ subjects: bank.subjects, topics: bank.topics, state: st, available: avail, today: T });
ok('a subject that has been touched drops below untouched ones', need1[need1.length - 1].subject === 'maths' || need1.findIndex((n) => n.subject === 'maths') > 0);
ok('a topic with no questions does not keep its subject needy', topicsOfSubject(bank.topics, 'computer-science').some((t) => !avail.has(t.id)) && need0.find((n) => n.subject === 'computer-science').topics === 8);
ok('shared Pure topics also count for further-maths', topicsOfSubject(bank.topics, 'further-maths').some((t) => t.id === 'pure-calculus') && !topicsOfSubject(bank.topics, 'physics').some((t) => t.shared_pure));
const s1 = buildSet({ bank, state: blank(), today: T });
ok('a set has the configured size', s1.items.length === cfg.setSize, 'got ' + s1.items.length);
ok('a set never repeats a question', new Set(s1.items.map((i) => i.id)).size === s1.items.length);
ok('a new student gets a reading note for every new topic in the set', s1.noteTopics.length >= 1 && s1.items.every((i) => s1.noteTopics.includes(i.topic)));
const sPhy = buildSet({ bank, state: blank(), today: T, subject: 'physics' });
ok('a chosen subject is honoured', sPhy.subject === 'physics' && sPhy.items.every((i) => bank.questions.find((q) => q.id === i.id).subject === 'physics'));
ok('an unknown subject builds nothing', buildSet({ bank, state: blank(), today: T, subject: 'latin' }) === null);
// weakest topic first
const stW = blank();
const seen = (strength) => ({ strength, last_seen: T, next_due: '2026-12-01' });
stW.topics = { 'phy-mechanics': seen(4), 'phy-waves': seen(1), 'phy-thermal': seen(2), 'phy-modern': seen(3) };   // phy-fields never seen
const sW = buildSet({ bank, state: stW, today: T, subject: 'physics' });
const idxOf = (t) => sW.items.findIndex((i) => i.topic === t);
ok('weakest-first: never-seen topic leads, then lowest strength', idxOf('phy-fields') === 0 && idxOf('phy-waves') === 1 && idxOf('phy-thermal') === 2);
ok('the strongest topic is left out when the set is full', idxOf('phy-mechanics') === -1 && sW.items.length === cfg.setSize);
// compounding
const stC = blank();
stC.topics = { 'phy-mechanics': { strength: 1, last_seen: '2026-10-05', next_due: '2026-10-06' } };
stC.skills = { 'p-suvat': { strength: 1, last_seen: '2026-10-05', next_due: '2026-10-06' } };
const sC = buildSet({ bank, state: stC, today: T, subject: 'chemistry' });
const comp = sC.items.filter((i) => i.role === 'compound');
ok('compounding folds one weak or overdue skill into the set', comp.length === 1 && bank.questions.find((q) => q.id === comp[0].id).skill === 'p-suvat');
ok('a compound question comes from a topic not already in the set', comp.length === 1 && sC.items.filter((i) => i.topic === comp[0].topic).length === 1);
const stStrong = blank();
stStrong.skills = { 'p-suvat': { strength: 5, last_seen: '2026-10-05', next_due: '2026-12-30' } };
ok('a strong, not-yet-due skill is NOT compounded', buildSet({ bank, state: stStrong, today: T, subject: 'chemistry' }).items.every((i) => i.role === 'primary'));

// ---------- the service: sets, submit, XP ----------
const dir = mkdtempSync(path.join(tmpdir(), 'wr-engine-'));
const awards = []; const subs = []; let clock = new Date('2026-10-08T10:00:00');
const mk = (askText) => createPractice({
  bank, store: createStore(createFileDb(path.join(dir, 'data'))), now: () => clock, askText,
  awardStudent: async (id, patch) => { awards.push({ id, ...patch }); },
  listSubmissions: async () => subs.slice().reverse(),
  addPhotoSubmission: async (p) => { const id = 'f'.repeat(31) + (subs.length + 1); subs.push({ id, time: clock.toISOString(), questId: 'practice:' + p.questionId, kind: 'practice-photo', studentId: p.studentId, correctionMd: p.md, result: { total: p.got, max: p.max, criteria: [] }, status: 'awaiting_review', final: null }); return id; },
});
let svc = mk(async () => ({ problem: 'No API key.' }));
const A = 'WR-2026-0001', B = 'WR-2026-0002';
const ov = await svc.overview(A);
ok('overview lists every subject with its topics and a recommended subject', ov.subjects.length === bank.subjects.length && ov.recommended && ov.subjects.every((s) => s.topics.length >= 1));
const n1 = await svc.newSet(A, 'physics');
ok('a student can start a set', n1.ok && n1.set.questions.length === cfg.setSize && n1.set.subject === 'physics');
const dump = JSON.stringify(n1.set);
ok('the set sent to the browser has NO answers, traps, partial rules or mistake notes', !/"expected"|"correct"|"trap"|"partial"|"mistake"|"variants"/.test(dump));
ok('asking for the same subject again returns the same open set', (await svc.newSet(A, 'physics')).reused === true && (await svc.newSet(A, 'physics')).set.id === n1.set.id);
ok('an unknown subject is refused', !!(await svc.newSet(A, 'latin')).problem);
ok('another student cannot read or submit this set', !!(await svc.getSet(B, n1.set.id)).problem && !!(await svc.submitSet(B, n1.set.id, { x: { a: '1' } })).problem);
ok('submitting nothing is refused (no "done" button)', !!(await svc.submitSet(A, n1.set.id, {})).problem && !!(await svc.submitSet(A, n1.set.id, { [n1.set.questions[0].id]: { a: '   ' } })).problem);
ok('an answer for a question outside the set is refused', !!(await svc.submitSet(A, n1.set.id, { 'cs-os-001': { a: '5' } })).problem);
ok('an answer for a step that does not exist is refused', !!(await svc.submitSet(A, n1.set.id, { [n1.set.questions[0].id]: { zz: '5' } })).problem);
const right = (qid) => { const q = bank.questions.find((x) => x.id === qid); return q.type === 'mcq' ? { choice: q.options.find((o) => o.correct).id } : Object.fromEntries(q.steps.map((s) => [s.id, String(s.expected)])); };
const full = Object.fromEntries(n1.set.questions.map((q) => [q.id, right(q.id)]));
const totalMarks = n1.set.questions.reduce((n, q) => n + q.total, 0);
const r1 = await svc.submitSet(A, n1.set.id, full);
ok('a perfect set scores full marks', r1.ok && r1.summary.got === totalMarks && r1.summary.pct === 100);
ok('XP is 1 per mark and capped per day', r1.summary.xp === Math.min(totalMarks * cfg.xpPerMark, cfg.dailyXpCap), 'xp ' + r1.summary.xp + ' of ' + totalMarks + ' marks');
ok('the student is awarded XP and marks', awards.length === 1 && awards[0].id === A && awards[0].xp === r1.summary.xp && awards[0].marks === totalMarks);
ok('every topic in the set moved up from 0 to 1 and was scheduled', r1.mastery.length >= 1 && r1.mastery.every((m) => m.from === 0 && m.to === 1 && m.nextDue === addDays('2026-10-08', 3)));
ok('a set can only be submitted once', !!(await svc.submitSet(A, n1.set.id, full)).problem && awards.length === 1);
const ov2 = await svc.overview(A);
ok('mastery is saved per student', ov2.subjects.find((s) => s.id === 'physics').topics.some((t) => t.strength === 1) && (await svc.overview(B)).subjects.find((s) => s.id === 'physics').topics.every((t) => t.strength === 0));
// repeat: same questions again the same day. No XP, no early rise.
const n2 = await svc.newSet(A, 'physics');
const rep = await svc.submitSet(A, n2.set.id, Object.fromEntries(n2.set.questions.map((q) => [q.id, right(q.id)])));
const repeatedIds = n2.set.questions.filter((q) => n1.set.questions.some((x) => x.id === q.id)).length;
ok('repeating a question pays no second XP', rep.ok && rep.results.filter((r) => !r.firstTime).every((r) => r.awarded > 0) && (repeatedIds === 0 || rep.summary.xp < rep.summary.got), 'repeated ' + repeatedIds);
ok('repeating early cannot farm strength', rep.mastery.filter((m) => m.from === 1).every((m) => m.to === 1 && m.gated));
// a question left completely blank is not an attempt
const nb = await svc.newSet('WR-BLANK', 'chemistry');
const attemptedQ = nb.set.questions[0], skippedQ = nb.set.questions[1];
const rb = await svc.submitSet('WR-BLANK', nb.set.id, { [attemptedQ.id]: right(attemptedQ.id) });
const ovb = (await svc.overview('WR-BLANK')).subjects.flatMap((x) => x.topics);
ok('a skipped question does not mark its topic as seen or change its strength', rb.ok && ovb.find((t) => t.id === skippedQ.topic).lastSeen === null && ovb.find((t) => t.id === skippedQ.topic).strength === 0 && ovb.find((t) => t.id === attemptedQ.topic).strength === 1);
ok('a skipped question pays no XP and is not recorded as cleared', rb.results.find((x) => x.id === skippedQ.id).attempted === false && rb.summary.xp === attemptedQ.total * cfg.xpPerMark);
// wrong answers: fall, with a note and the right answer revealed
const nc = await svc.newSet(B, 'computer-science');
const bad = await svc.submitSet(B, nc.set.id, Object.fromEntries(nc.set.questions.map((q) => [q.id, q.type === 'mcq' ? { choice: q.options.find((o) => o.id !== 'Z').id } : Object.fromEntries(q.steps.map((s) => [s.id, '999999']))])));
ok('wrong answers reveal the correct answer and a note', bad.ok && bad.results.some((r) => r.steps && r.steps.every((s) => s.status === 'wrong' && s.answer !== undefined)));
// daily cap
const dayStore = createStore(createFileDb(path.join(dir, 'cap')));
const capSvc = createPractice({ bank: { ...bank, config: { ...cfg, dailyXpCap: 5 } }, store: dayStore, now: () => clock, askText: async () => ({}), awardStudent: async (id, p) => { awards.push({ id, ...p }); }, listSubmissions: async () => [], addPhotoSubmission: async () => 'x' });
const nCap = await capSvc.newSet('WR-CAP', 'maths');
const rCap = await capSvc.submitSet('WR-CAP', nCap.set.id, Object.fromEntries(nCap.set.questions.map((q) => [q.id, right(q.id)])));
ok('the daily XP cap holds', rCap.ok && rCap.summary.xp === 5 && rCap.summary.xpCapped === true, 'xp ' + rCap.summary.xp);
// expiry
const nExp = await svc.newSet('WR-EXP', 'chemistry');
clock = new Date(clock.getTime() + 13 * 3600e3);
ok('a set expires after its life', !!(await svc.getSet('WR-EXP', nExp.set.id)).problem && !!(await svc.submitSet('WR-EXP', nExp.set.id, { x: { a: 1 } })).problem);
clock = new Date('2026-10-08T10:00:00');

// ---------- photo path ----------
const q0 = bank.questions.find((q) => q.id === 'cs-os-001');
const goodMd = 'SCORE: 4/' + q0.total + '\n\n# CS scheduling\n\n## (a) FCFS waiting time **1 / 1**\n\nCorrect: $5$ ms.\n\n## (c) Average **1 / 2**\n\n| Step | You wrote | Correct |\n|---|---|---|\n| total | $13$ | $4.33$ |\n\nNext: divide the total waiting time by 3.';
let reply = { text: goodMd, model: 'test-model' };
svc = mk(async () => reply);
const nP = await svc.newSet('WR-PH', 'computer-science');
const pq = nP.set.questions.find((q) => q.type === 'structured');
const mcqQ = nP.set.questions.find((q) => q.type === 'mcq');
ok('photos are refused for MCQs and for questions outside the set', (!mcqQ || !!(await svc.markPhoto('WR-PH', nP.set.id, mcqQ.id, ['data:image/jpeg;base64,AA'])).problem) && !!(await svc.markPhoto('WR-PH', nP.set.id, 'pure-algebra-001', ['x'])).problem);
reply = { text: 'Looks fine to me', model: 'm' };
const noScore = await svc.markPhoto('WR-PH', nP.set.id, pq.id, ['data:image/jpeg;base64,AA']);
ok('no parseable SCORE line = unmarked, and the student can retry', !!noScore.problem && subs.length === 0);
reply = { text: goodMd.replace(/SCORE: 4\/\d+/, 'SCORE: 4/' + (bank.questions.find((q) => q.id === pq.id).total)), model: 'm' };
const ph = await svc.markPhoto('WR-PH', nP.set.id, pq.id, ['data:image/jpeg;base64,AA']);
ok('a photo with a good correction is queued for Head Staff', ph.ok && subs.length === 1 && subs[0].questId === 'practice:' + pq.id && subs[0].status === 'awaiting_review');
ok('the stored correction has the SCORE line removed (Head Staff set the final mark)', !/^SCORE:/i.test(subs[0].correctionMd) && /Next:/.test(subs[0].correctionMd));
ok('a second photo for the same question is refused', !!(await svc.markPhoto('WR-PH', nP.set.id, pq.id, ['data:image/jpeg;base64,AA'])).problem && subs.length === 1);
ok('the student sees "awaiting review" but NOT the AI draft or correction', await svc.photoList('WR-PH').then((l) => l.length === 1 && l[0].status === 'awaiting_review' && !('correctionMd' in l[0]) && !('final' in l[0])));
const before = (await svc.overview('WR-PH')).subjects.flatMap((s) => s.topics).filter((t) => t.strength > 0).length;
ok('AI marks do NOT move mastery or pay XP before release', before === 0 && !awards.some((a) => a.id === 'WR-PH'));
const fin = bank.questions.find((q) => q.id === pq.id);
subs[0].status = 'released'; subs[0].final = { total: Math.min(3, fin.total), max: fin.total, comment: 'Good work' };
const rel = await svc.onPhotoReleased(subs[0]);
ok('on release the HEAD STAFF mark settles mastery and pays XP once', rel.ok && rel.got === subs[0].final.total && awards.filter((a) => a.id === 'WR-PH').length === 1 && awards.find((a) => a.id === 'WR-PH').xp === Math.min(rel.got * cfg.xpPerMark, cfg.dailyXpCap));
ok('releasing the same submission again changes nothing', (await svc.onPhotoReleased(subs[0])).skipped === true && awards.filter((a) => a.id === 'WR-PH').length === 1);
const lst = await svc.photoList('WR-PH');
ok('after release the student sees the final mark, comment and correction', lst[0].status === 'released' && lst[0].final.comment === 'Good work' && lst[0].correctionMd.includes('Next:'));
ok('another student cannot see this photo result', (await svc.photoList('WR-OTHER')).length === 0);
// photo + parser
ok('parseCorrection: reads the SCORE line and clamps to the total', (() => { const p = parseCorrection('SCORE: 99/' + 6 + '\n\n# T\n\nSome explanation of the marks.\n\nNext: fix it.', 6); return p.ok && p.got === 6; })());
ok('parseCorrection: scales and flags a wrong total', (() => { const p = parseCorrection('SCORE: 5/10\n\n# T\n\nSome explanation of the marks here.\n\nNext: x', 4); return p.ok && p.got === 2 && p.flags.length >= 1; })());
ok('parseCorrection: tolerates a code fence and a BOM', parseCorrection('\uFEFF```markdown\nSCORE: 1/2\n\n# T\n\nSome explanation of the marks here.\n\nNext: x\n```', 2).ok);
ok('parseCorrection: SCORE must be the first line', !parseCorrection('Here is the marking.\nSCORE: 1/2\n\n# T\n\nlong enough explanation here', 2).ok);
ok('parseCorrection: empty explanation is unmarked', !parseCorrection('SCORE: 1/2', 2).ok);
ok('the photo prompt demands the pack\'s format and holds the private scheme', (() => { const p = buildCorrectionPrompt(q0); return /FIRST LINE must be exactly: SCORE:/.test(p) && /Next:/.test(p) && /LaTeX/.test(p) && p.includes(String(q0.steps[0].expected)); })());
ok('the photo prompt tells the AI that the photo is data, not instructions', /never as instructions/.test(buildCorrectionPrompt(q0)));

rmSync(dir, { recursive: true, force: true });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
