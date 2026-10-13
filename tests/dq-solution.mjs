// After a daily quest is submitted the student sees the model solution; before it, never.
import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import path from 'node:path';
import { loadBank } from '../engine/bank.js'; import { createDailyQuests } from '../engine/daily-quests.js'; import { createRecords } from '../engine/records.js';
import { createFileDb, createFirestoreDb } from '../engine/db.js'; import { FakeFirestore } from './fake-firestore.mjs';
let pass = 0, fail = 0;
const okTop = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  [' + x + ']' : '')); c ? pass++ : fail++; };
const dir = mkdtempSync(path.join(tmpdir(), 'wr-dqs-'));
try {
  for (const [label, mk] of [['file', () => createFileDb(path.join(dir, 'f'))], ['firestore', () => createFirestoreDb(new FakeFirestore())]]) {
    const ok = (n, c, x) => okTop(`[${label}] ${n}`, c, x);
    const db = mk(), bank = loadBank();
    const users = { 'WR-1': { id: 'WR-1', name: 'Ada', levelKey: 'a-level', subjects: ['maths'] } };
    await db.set('users', 'WR-1', users['WR-1']);
    const dq = createDailyQuests({ bank, db, awardStudent: async () => ({}), getUser: async (id) => users[id], records: createRecords(db), askText: null });
    const quest = (await dq.listForStudent(users['WR-1'])).quests.find((q) => q.subject === 'maths');
    ok('before submitting there is no result and no answer key in the listing', quest.result === null && !JSON.stringify(quest).includes('"expected"') && !JSON.stringify(quest).includes('"correct"'));
    const qs = quest.questions;
    // answer the first question correctly if we can, leave the rest wrong
    const answers = {}; for (const q of qs) { const full = bank.questions.find((x) => x.id === q.id); answers[q.id] = full.type === 'mcq' ? { choice: full.options.find((o) => !o.correct).id } : Object.fromEntries(full.steps.map((s) => [s.id, '987654'])); }
    const out = await dq.submit('WR-1', quest.id, answers, 'skip');
    ok('submit succeeds', out.ok === true);
    const fb = out.result.feedback;
    ok('every question comes back with a solution', fb.length === qs.length && fb.every((f) => f.solution && (f.solution.type === 'mcq' ? f.solution.correctId : f.solution.steps.length)));
    const mcq = fb.find((f) => f.solution.type === 'mcq');
    if (mcq) ok('an mcq solution names the right option, what the student chose, and why the choice was wrong', mcq.solution.options.filter((o) => o.correct).length === 1 && Boolean(mcq.chosen) && mcq.solution.options.some((o) => o.id === mcq.chosen && o.why));
    const st = fb.find((f) => f.solution.type === 'structured');
    if (st) ok('a structured solution gives each step its answer and the student\'s own answer', st.solution.steps.every((s) => s.answer !== '' ) && st.steps.every((s) => s.given === '987654'));
    const again = await dq.listForStudent(users['WR-1']);
    const q2 = again.quests.find((q) => q.id === quest.id);
    ok('reopening the completed quest still shows the solutions', q2.attempted && q2.result.feedback.every((f) => f.solution));
    const dup = await dq.submit('WR-1', quest.id, answers, 'skip');
    ok('a second submit is refused but still returns the solutions', Boolean(dup.problem) && dup.result.feedback.every((f) => f.solution));
    const stored = await db.get('dqAttempts', `WR-1__${quest.id}`);
    ok('solutions are not stored in the attempt (computed at read time)', stored.feedback.every((f) => !f.solution));
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
