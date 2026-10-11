// Daily quest photo marking and the per-quest ranking, on both storage backends (stubbed AI, no network).
import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import path from 'node:path';
import { loadBank } from '../engine/bank.js'; import { createDailyQuests } from '../engine/daily-quests.js'; import { createRecords } from '../engine/records.js';
import { createFileDb, createFirestoreDb } from '../engine/db.js'; import { FakeFirestore } from './fake-firestore.mjs';
let pass = 0, fail = 0;
const okTop = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  [' + x + ']' : '')); c ? pass++ : fail++; };
const dir = mkdtempSync(path.join(tmpdir(), 'wr-dqp-'));
try {
  for (const [label, mk] of [['file', () => createFileDb(path.join(dir, 'f'))], ['firestore', () => createFirestoreDb(new FakeFirestore())]]) {
    const ok = (n, c, x) => okTop(`[${label}] ${n}`, c, x);
    const db = mk(), bank = loadBank();
    const users = {}; for (const [i, n] of ['Ada', 'Bo', 'Cy', 'Di'].entries()) users['WR-' + (i + 1)] = { id: 'WR-' + (i + 1), name: n, levelKey: 'a-level', subjects: ['maths'] };
    users['WR-9'] = { id: 'WR-9', name: 'Other', levelKey: 'a-level', subjects: ['physics'] };
    for (const u of Object.values(users)) await db.set('users', u.id, u);
    let calls = 0; const mark = { text: 'SCORE: 2/3\n\n# Quadratics\n\n## (a)\nYou lost a mark in step b.\n\nNext: check the sign.' };
    const askText = async () => { calls++; return { ...mark, model: 'stub' }; };
    const dq = createDailyQuests({ bank, db, awardStudent: async () => ({}), getUser: async (id) => users[id], records: createRecords(db), askText });
    const list = await dq.listForStudent(users['WR-1']); const quest = list.quests.find((q) => q.subject === 'maths');
    const qs = quest.questions; const structured = qs.find((q) => q.type === 'structured');
    ok('a quest has a structured question that offers a photo', Boolean(structured) && structured.photoOk === true);
    const img = ['data:image/jpeg;base64,AAAA'];
    const total = structured.total; mark.text = `SCORE: ${Math.max(0, total - 1)}/${total}\n\n# Working\n\n## (a)\nYou lost a mark in step b.\n\nNext: check the sign.`;
    const r1 = await dq.markPhoto('WR-1', quest.id, structured.id, img);
    ok('a photo is marked and the AI is called once', r1.ok && calls === 1);
    ok('a second photo for the same question is refused', (await dq.markPhoto('WR-1', quest.id, structured.id, img)).problem && calls === 1);
    ok('the listing now says the photo was sent', (await dq.listForStudent(users['WR-1'])).quests.find((q) => q.id === quest.id).photoSent.includes(structured.id));
    ok('a student of another subject cannot send a photo to this quest', Boolean((await dq.markPhoto('WR-9', quest.id, structured.id, img)).problem));
    ok('a question not in the quest is refused', Boolean((await dq.markPhoto('WR-1', quest.id, 'nope', img)).problem));
    mark.text = 'no score line here'; const r3 = await dq.markPhoto('WR-2', quest.id, structured.id, img);
    ok('an unreadable AI reply is refused and does not lock the question', Boolean(r3.problem) && !(await db.get('dqPhotos', `WR-2__${quest.id}__${structured.id}`)));
    // submit: the photo mark replaces typed answers for that question
    const typed = Object.fromEntries(qs.map((q) => [q.id, q.type === 'mcq' ? { choice: 'A' } : Object.fromEntries(q.steps.map((s) => [s.id, '0']))]));
    const s1 = await dq.submit('WR-1', quest.id, typed, 'skip');
    const fb = s1.result.feedback.find((f) => f.questionId === structured.id);
    ok('the photo mark counts and carries its correction', s1.ok && fb.photo === true && fb.score === Math.max(0, total - 1) && /Next:/.test(fb.correctionMd));
    // others submit with different scores
    const best = Object.fromEntries(qs.map((q) => [q.id, q.type === 'mcq' ? { choice: 'A' } : Object.fromEntries(q.steps.map((s) => [s.id, '0']))]));
    await dq.submit('WR-2', quest.id, best, 'skip'); await dq.submit('WR-3', quest.id, best, 'read');
    const rk = await dq.ranking('WR-1', quest.id);
    ok('the ranking lists everyone who took the quest, best first, with names', rk.ok && rk.total === 3 && rk.top.every((x, i, a) => i === 0 || a[i - 1].score >= x.score) && rk.top.some((x) => x.name === 'Bo') && rk.me?.name === 'Ada', JSON.stringify(rk).slice(0,300));
    ok('a student who has not taken the quest cannot see the ranking', /Submit/.test((await dq.ranking('WR-4', quest.id)).problem || ''));
    ok('a student outside the level and subject cannot see it either', Boolean((await dq.ranking('WR-9', quest.id)).problem));
    // photo after submit is refused
    ok('a photo after submitting is refused', Boolean((await dq.markPhoto('WR-1', quest.id, structured.id, img)).problem));
    // staff view and adjust
    const sp = await dq.staffPhotos();
    ok('staff see the photo mark with the student name', sp.photos.length === 1 && sp.photos[0].studentName === 'Ada' && sp.photos[0].submitted, JSON.stringify(sp).slice(0,300));
    const before = (await dq.ranking('WR-1', quest.id)).me;
    const adj = await dq.adjustPhoto({ studentId: 'WR-1', questId: quest.id, questionId: structured.id, score: total, by: 'HEAD' });
    ok('staff can raise a photo mark; the quest score and ranking update', adj.ok && adj.score === before.score + 1 && (await dq.ranking('WR-1', quest.id)).me.score === adj.score);
    ok('the adjustment is shown to the student', (await db.get('dqAttempts', `WR-1__${quest.id}`)).feedback.find((f) => f.photo).adjustedBy === 'HEAD');
    ok('a mark above the question total is refused', Boolean((await dq.adjustPhoto({ studentId: 'WR-1', questId: quest.id, questionId: structured.id, score: total + 5 })).problem));
    const rec = (await db.list('records', { where: { studentId: 'WR-1' } }))[0];
    ok('the Record line follows the adjusted score', rec && rec.score === adj.score);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
