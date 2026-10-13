// Shared daily quest engine.
// One quest per day for every (level, subject) pair that has questions. Every student who offers that subject
// at that level gets the same questions. Questions come from the validated private bank (bank/questions/),
// so deposited questions go live without a restart.
import { markQuestion } from './mark.js';
import { buildCorrectionPrompt, parseCorrection } from './photo.js';
import { LEVELS, DEFAULT_LEVEL, normaliseLevel, subjectLabel, levelLabel } from './subjects.js';

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const defaultSettings = () => ({ mode: 'general', examTopics: {}, questionCount: 3 });
const qLevel = (q) => q.level || DEFAULT_LEVEL;
const topicLevels = (t) => t.levels || [DEFAULT_LEVEL];
const slot = (day, subject, level) => `${day}:${subject}:${level}`;
// dq-2026-10-10-computer-science-a-level-v1  ->  { day, subject, level }
const parseQuestId = (id) => { const m = /^dq-(\d{4}-\d{2}-\d{2})-(.+)-(a-level|form-5)-[^-]+$/.exec(String(id)); return m ? { day: m[1], subject: m[2], level: m[3] } : null; };

export function createDailyQuests({ bank, db, awardStudent, getUser, records, askText = null }) {
  const topicById = () => new Map(bank.topics.map((t) => [t.id, t]));
  const qById = (id) => bank.questions.find((x) => x.id === id);
  const combos = () => LEVELS.flatMap((l) => l.subjects.map((s) => ({ level: l.id, subject: s })));
  const getSettings = async () => ({ ...defaultSettings(), ...((await db.get('dqSettings', 'main')) || {}) });
  const examIds = (settings, level, subject) => settings.examTopics?.[`${level}:${subject}`] ?? (level === DEFAULT_LEVEL ? settings.examTopics?.[subject] : undefined) ?? [];

  // What the student's browser may see: no expected answers, partial-credit rules, hints that give the answer, traps.
  function publicQ(q) {
    const base = { id: q.id, subject: q.subject, topic: q.topic, topicName: topicById().get(q.topic)?.name || q.topic, type: q.type, difficulty: q.difficulty, total: q.total || 1, stem: q.stem, image: q.image || null };
    if (q.type === 'mcq') return { ...base, options: q.options.map((o) => ({ id: o.id, text: o.text })) };
    return { ...base, photoOk: true, steps: q.steps.map((s) => ({ id: s.id, kind: s.kind, prompt: s.prompt, marks: s.marks, unit: s.unit || null, hint: s.hint || null, options: s.kind === 'choice' ? s.options : undefined })) };
  }

  // The model solution. Only ever attached to a result AFTER the student has submitted, so it cannot leak answers early.
  // Uses the answer key already stored with each question: expected value, plus `solution` (or the older `mistake`
  // line) as the working, and an optional question-level `explanation` / `solution` for the whole question.
  function solutionOf(q) {
    if (q.type === 'mcq') {
      const right = q.options.find((o) => o.correct);
      return { type: 'mcq', correctId: right?.id, correctText: right?.text, explanation: q.explanation || q.solution || '', options: q.options.map((o) => ({ id: o.id, text: o.text, correct: Boolean(o.correct), why: o.correct ? undefined : o.trap })) };
    }
    return { type: 'structured', worked: q.solution || q.explanation || '', steps: q.steps.map((s) => ({ id: s.id, prompt: s.prompt, marks: s.marks, answer: String(s.expected) + (s.unit ? ' ' + s.unit : ''), working: s.solution || s.mistake || '' })) };
  }
  const withSolutions = (feedback) => (feedback || []).map((f) => { const q = qById(f.questionId); return q ? { ...f, solution: solutionOf(q) } : f; });

  // Builds (but does not save) the quest for one day, level and subject. Same inputs always give the same quest.
  function buildQuest(settings, subject, level, day) {
    const qs = bank.questions.filter((q) => q.subject === subject && qLevel(q) === level);
    if (!qs.length) return null;
    let eligible = qs;
    if (settings.mode === 'exam') { const ids = examIds(settings, level, subject); eligible = qs.filter((q) => ids.includes(q.topic)); if (!eligible.length) return null; }
    // A date-seeded rotation gives a new selection each day, and every student sees the same one.
    const seed = [...slot(day, subject, level)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
    const sorted = eligible.slice().sort((a, b) => a.id.localeCompare(b.id));
    const count = Math.max(1, Math.min(5, Number(settings.questionCount) || 3));
    const start = seed % sorted.length, items = [];
    for (let i = 0; i < Math.min(count, sorted.length); i++) items.push(sorted[(start + i) % sorted.length].id);
    const created = new Date(`${day}T00:00:00`);
    const revision = settings.updatedAt ? String(Date.parse(settings.updatedAt)) : 'v1';
    return {
      id: `dq-${day}-${subject}-${level}-${revision}`, subject, subjectLabel: subjectLabel(subject), level, levelLabel: levelLabel(level), day, mode: settings.mode,
      topicIds: [...new Set(items.map((id) => qById(id)?.topic).filter(Boolean))], items, createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + 7 * 864e5).toISOString(),
    };
  }
  // Today's quest: reuse the saved one, or build and save it. Two servers doing this at once is harmless: both build the same quest.
  async function ensureQuest(settings, subject, level, day, existing) {
    if (existing) return existing;
    const q = buildQuest(settings, subject, level, day);
    if (!q) return null;
    if (!(await db.create('dqQuests', slot(day, subject, level), q))) return (await db.get('dqQuests', slot(day, subject, level))) || q;
    return q;
  }

  function publicQuest(q, attempt, photoSent = []) {
    const names = topicById();
    const notes = q.topicIds.map((id) => ({ topic: id, ...(bank.notes[id] || {}) })).filter((n) => n.title || n.body);
    return {
      id: q.id, subject: q.subject, subjectLabel: q.subjectLabel, level: q.level, levelLabel: q.levelLabel, day: q.day, mode: q.mode, expiresAt: q.expiresAt,
      topicNames: q.topicIds.map((id) => names.get(id)?.name || id),
      notes: notes.map((n) => ({ topic: n.topic, title: n.title, body: n.body })),
      questions: q.items.map((id) => { const x = qById(id); return x ? publicQ(x) : null; }).filter(Boolean),
      photoSent,
      attempted: Boolean(attempt),
      result: attempt ? { score: attempt.score, max: attempt.max, xp: attempt.xp, summaryChoice: attempt.summaryChoice, submittedAt: attempt.submittedAt, feedback: withSolutions(attempt.feedback) } : null,
    };
  }

  const studentChoice = (user) => ({ level: user.levelKey || normaliseLevel(user.level), subjects: Array.isArray(user.subjects) ? user.subjects : [] });

  async function listForStudent(user) {
    const { level, subjects } = studentChoice(user);
    if (!level || !subjects.length) return { ok: true, needsSubjects: true, quests: [] };
    const settings = await getSettings();
    const today = dayKey();
    const days = Array.from({ length: 7 }, (_, i) => dayKey(plusDays(new Date(), -i)));      // today and the six days before
    const slots = subjects.flatMap((s) => days.map((d) => ({ subject: s, day: d })));
    const found = await db.getMany('dqQuests', slots.map((x) => slot(x.day, x.subject, level)));
    const quests = [];
    for (let i = 0; i < slots.length; i++) {
      const q = slots[i].day === today ? await ensureQuest(settings, slots[i].subject, level, slots[i].day, found[i]) : found[i];   // only today's quest is ever created
      if (q && q.level === level && subjects.includes(q.subject) && q.day <= today && Date.parse(q.expiresAt) > Date.now()) quests.push(q);
    }
    quests.sort((a, b) => b.day.localeCompare(a.day) || a.subject.localeCompare(b.subject));
    const attempts = await db.getMany('dqAttempts', quests.map((q) => `${user.id}__${q.id}`));
    const photoKeys = quests.flatMap((q) => q.items.filter((id) => qById(id)?.type === 'structured').map((id) => ({ q: q.id, id })));
    const photoDocs = await db.getMany('dqPhotos', photoKeys.map((k) => `${user.id}__${k.q}__${k.id}`));
    const sent = new Map(); photoKeys.forEach((k, i) => { if (photoDocs[i]) (sent.get(k.q) || sent.set(k.q, []).get(k.q)).push(k.id); });
    const have = new Set(quests.map((q) => q.subject));
    return { ok: true, mode: settings.mode, level, levelLabel: levelLabel(level), subjects: subjects.map((id) => ({ id, label: subjectLabel(id), hasQuest: have.has(id) })), quests: quests.map((q, i) => publicQuest(q, attempts[i], sent.get(q.id) || [])) };
  }

  const settingsView = () => LEVELS.flatMap((l) => l.subjects.map((s) => ({
    id: s, level: l.id, levelLabel: l.label, label: subjectLabel(s) + ' (' + l.label + ')', key: `${l.id}:${s}`,
    topics: bank.topics.filter((t) => t.subject === s && topicLevels(t).includes(l.id)).map((t) => ({ id: t.id, name: t.name, hasQuestions: bank.questions.some((q) => q.topic === t.id && qLevel(q) === l.id) })),
    questions: bank.questions.filter((q) => q.subject === s && qLevel(q) === l.id).length,
  })));

  async function settings() { return { ok: true, settings: await getSettings(), subjects: settingsView() }; }

  async function updateSettings(input) {
    const mode = input.mode === 'exam' ? 'exam' : 'general'; const examTopics = {};
    for (const v of settingsView()) {
      const raw = input.examTopics?.[v.key]; const valid = new Set(v.topics.map((t) => t.id));
      examTopics[v.key] = Array.isArray(raw) ? raw.filter((id) => valid.has(id)) : [];
    }
    const next = { mode, examTopics, questionCount: Math.max(1, Math.min(5, Number(input.questionCount) || 3)), updatedAt: new Date().toISOString() };
    await db.set('dqSettings', 'main', next);
    const today = dayKey();
    for (const c of combos()) await db.del('dqQuests', slot(today, c.subject, c.level));   // today's quests are rebuilt from the new plan
    return { ok: true, settings: next };
  }

  // The quest must exist and belong to the student's own level and subjects.
  async function eligible(studentId, questId) {
    const where = parseQuestId(questId);
    const q = where ? await db.get('dqQuests', slot(where.day, where.subject, where.level)) : null;
    if (!q || q.id !== questId) return { problem: 'Daily quest not found or expired.' };
    const user = await getUser(studentId);
    const { level, subjects } = studentChoice(user || {});
    if (!user || level !== q.level || !subjects.includes(q.subject)) return { problem: 'This quest is not in your level and subjects. Update them on your Profile.' };
    return { q, user };
  }

  async function submit(studentId, questId, answers, summaryChoice) {
    const ctx = await eligible(studentId, questId);
    if (ctx.problem) return ctx;
    const { q, user } = ctx;
    if (Date.parse(q.expiresAt) <= Date.now()) return { problem: 'This daily quest has expired.' };
    const attemptId = `${studentId}__${questId}`;
    const prior = await db.get('dqAttempts', attemptId);
    if (prior) return { problem: 'You have already submitted this daily quest.', result: { ...prior, feedback: withSolutions(prior.feedback) } };
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return { problem: 'Answers are required.' };
    const photos = await db.getMany('dqPhotos', q.items.map((id) => `${studentId}__${questId}__${id}`));
    let score = 0, max = 0, attempted = 0; const feedback = [];
    for (const [pos, id] of q.items.entries()) {
      const question = qById(id); if (!question) continue;
      const ans = answers[id] || {};
      max += question.total || 1;
      const ph = photos[pos] && photos[pos].status === 'done' ? photos[pos] : null;
      if (ph) {   // a photographed answer replaces the typed one for that question
        attempted++;
        const got = Math.max(0, Math.min(question.total || 1, Number(ph.got) || 0)); score += got;
        feedback.push({ questionId: id, score: got, max: question.total || 1, correct: got === (question.total || 1), photo: true, correctionMd: String(ph.md || '').slice(0, 12000), flags: ph.flags || [] });
        continue;
      }
      if (!Object.values(ans).some((v) => String(v ?? '').trim())) { feedback.push({ questionId: id, score: 0, max: question.total || 1, blank: true, correct: false }); continue; }
      attempted++;
      const r = markQuestion(question, ans); score += r.awarded;
      feedback.push({ questionId: id, score: r.awarded, max: r.total, correct: r.status === 'correct', chosen: r.chosen, steps: (r.steps || []).map((s) => ({ id: s.id, given: String(ans[s.id] ?? '').slice(0, 80), awarded: s.awarded, max: s.max, status: s.status, note: s.status === 'correct' ? undefined : s.note })) });
    }
    if (!attempted) return { problem: 'Answer at least one question before submitting.' };
    const choice = summaryChoice === 'read' ? 'read' : 'skip';
    const xp = Math.max(0, Math.round(score * 2) + (choice === 'skip' ? 5 : 0));
    const result = { studentId, questId, score, max, xp, summaryChoice: choice, submittedAt: new Date().toISOString(), feedback };
    // create() succeeds for the first submission only, so a double-click or a second device cannot be paid twice
    if (!(await db.create('dqAttempts', attemptId, result))) return { problem: 'You have already submitted this daily quest.', result: await (async () => { const a = await db.get('dqAttempts', attemptId); return a && { ...a, feedback: withSolutions(a.feedback) }; })() };
    try { await awardStudent(studentId, { xp, achievement: { id: `daily-${q.day}-${q.subject}-${q.level}`, title: 'Daily Quest Complete', description: `Completed the ${q.subjectLabel} (${q.levelLabel}) daily quest.` } }); }
    catch (e) { console.warn('[daily-quest] XP award failed:', e.message); }
    if (records) {
      try { await records.add({ key: `dq:${studentId}:${questId}`, studentId, studentName: user.name, kind: 'daily-quest', title: `${q.subjectLabel} daily quest · ${q.day}`, subject: q.subject, level: q.level, score, max, xp, at: result.submittedAt }); }
      catch (e) { console.warn('[daily-quest] record failed:', e.message); }
    }
    return { ok: true, result: { ...result, feedback: withSolutions(result.feedback) } };
  }

  // ---- a photo of handwritten working: marked by the AI at once, counted when the quest is submitted ----
  async function markPhoto(studentId, questId, qid, images) {
    if (!askText) return { problem: 'Photo marking is not available right now.' };
    const ctx = await eligible(studentId, questId);
    if (ctx.problem) return ctx;
    const { q } = ctx;
    if (Date.parse(q.expiresAt) <= Date.now()) return { problem: 'This daily quest has expired.' };
    if (!q.items.includes(qid)) return { problem: 'That question is not in this quest.' };
    const question = qById(qid);
    if (!question || question.type !== 'structured') return { problem: 'Photos are for structured questions only.' };
    if (await db.get('dqAttempts', `${studentId}__${questId}`)) return { problem: 'You have already submitted this daily quest.' };
    const pid = `${studentId}__${questId}__${qid}`;
    const old = await db.get('dqPhotos', pid);
    if (old && old.status === 'pending' && Date.now() - Date.parse(old.at) > 3 * 60 * 1000) await db.del('dqPhotos', pid);   // a crashed attempt does not lock the question
    if (!(await db.create('dqPhotos', pid, { studentId, questId, questionId: qid, status: 'pending', at: new Date().toISOString() }))) return { problem: 'A photo for this question has already been sent.' };
    const giveUp = async (problem) => { await db.del('dqPhotos', pid).catch(() => {}); return { problem }; };
    try {
      const out = await askText(buildCorrectionPrompt(question), images);
      if (out.problem) return giveUp(out.problem);
      const parsed = parseCorrection(out.text, question.total);
      if (!parsed.ok) return giveUp(parsed.problem + ' Please try again with a clearer photo.');
      await db.set('dqPhotos', pid, { studentId, questId, questionId: qid, status: 'done', got: parsed.got, max: parsed.max, md: parsed.md, flags: parsed.flags || [], model: out.model || '', at: new Date().toISOString() });
      return { ok: true };
    } catch (e) { return giveUp('Could not mark the photo: ' + e.message); }
  }

  // ---- the ranking of everyone who took one quest (shown only to a student who has taken it too) ----
  async function ranking(studentId, questId) {
    const ctx = await eligible(studentId, questId);
    if (ctx.problem) return ctx;
    if (!(await db.get('dqAttempts', `${studentId}__${questId}`))) return { problem: 'Submit this quest to see the ranking.' };
    const rows = (await db.list('dqAttempts', { where: { questId }, limit: 1000 }))
      .sort((a, b) => b.score - a.score || String(a.submittedAt).localeCompare(String(b.submittedAt)));
    const users = await db.getMany('users', rows.map((r) => r.studentId));
    const all = rows.map((r, i) => ({ rank: i + 1, name: users[i]?.name || 'Student', score: r.score, max: r.max, at: r.submittedAt, me: r.studentId === studentId }));
    return { ok: true, total: all.length, top: all.slice(0, 50), me: all.find((x) => x.me) || null };
  }

  // ---- Head Staff can see the photo marks and change a mark the AI got wrong ----
  async function staffPhotos() {
    const rows = (await db.list('dqPhotos', { orderBy: 'at', desc: true, limit: 100 })).filter((r) => r.status === 'done');
    const users = await db.getMany('users', rows.map((r) => r.studentId));
    const attempts = await db.getMany('dqAttempts', rows.map((r) => `${r.studentId}__${r.questId}`));
    return { ok: true, photos: rows.map((r, i) => {
      const fb = attempts[i]?.feedback?.find((f) => f.questionId === r.questionId);
      const w = parseQuestId(r.questId);
      return { studentId: r.studentId, studentName: users[i]?.name || '', questId: r.questId, questionId: r.questionId, subject: w?.subject || '', day: w?.day || '', got: fb ? fb.score : r.got, max: r.max, aiGot: r.got, submitted: Boolean(attempts[i]), adjusted: Boolean(fb?.adjustedBy), correctionMd: r.md, flags: r.flags || [] };
    }) };
  }
  async function adjustPhoto({ studentId, questId, questionId, score, by }) {
    const n = Math.round(Number(score));
    if (!Number.isFinite(n) || n < 0) return { problem: 'Enter a whole number of marks.' };
    const attemptId = `${studentId}__${questId}`;
    const out = await db.update('dqAttempts', attemptId, (cur) => {
      if (!cur) return { result: { problem: 'That student has not submitted this quest yet.' } };
      const fb = (cur.feedback || []).find((f) => f.questionId === questionId && f.photo);
      if (!fb) return { result: { problem: 'No photo-marked answer found for that question.' } };
      if (n > fb.max) return { result: { problem: `The most this question can score is ${fb.max}.` } };
      fb.score = n; fb.correct = n === fb.max; fb.adjustedBy = by || 'staff'; fb.adjustedAt = new Date().toISOString();
      cur.score = cur.feedback.reduce((t, f) => t + (Number(f.score) || 0), 0);
      return { doc: cur, result: { ok: true, score: cur.score, max: cur.max } };
    });
    if (out.ok && records) await records.setScore(`dq:${studentId}:${questId}`, out.score).catch((e) => console.warn('[daily-quest] record update failed:', e.message));
    return out;
  }

  async function staffList() {
    const names = topicById();
    const rows = await db.list('dqQuests', { orderBy: 'day', desc: true, limit: 140 });
    return {
      ok: true, settings: await getSettings(), subjects: settingsView(),
      quests: rows.sort((a, b) => b.day.localeCompare(a.day) || a.subject.localeCompare(b.subject)).slice(0, 60).map((q) => ({ id: q.id, subject: q.subject, subjectLabel: q.subjectLabel, level: q.level, levelLabel: q.levelLabel, day: q.day, mode: q.mode, expiresAt: q.expiresAt, questions: q.items.length, topicNames: q.topicIds.map((id) => names.get(id)?.name || id) })),
    };
  }

  async function generateToday() {
    const settings = await getSettings(); const day = dayKey();
    const existing = await db.getMany('dqQuests', combos().map((c) => slot(day, c.subject, c.level)));
    const created = [];
    for (let i = 0; i < combos().length; i++) {
      const c = combos()[i]; const q = await ensureQuest(settings, c.subject, c.level, day, existing[i]);
      if (q && !existing[i]) created.push({ id: q.id, subject: q.subject, level: q.level, day: q.day });
    }
    return { ok: true, created };
  }

  return { listForStudent, settings, updateSettings, submit, markPhoto, ranking, staffPhotos, adjustPhoto, staffList, generateToday };
}
