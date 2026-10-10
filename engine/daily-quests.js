// Shared daily quest engine.
// One quest per day for every (level, subject) pair that has questions. Every student who offers that subject
// at that level gets the same questions. Questions come from the validated private bank (bank/questions/),
// so deposited questions go live without a restart.
import { markQuestion } from './mark.js';
import { LEVELS, DEFAULT_LEVEL, normaliseLevel, subjectLabel, levelLabel } from './subjects.js';

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const defaultSettings = () => ({ mode: 'general', examTopics: {}, questionCount: 3 });
const qLevel = (q) => q.level || DEFAULT_LEVEL;
const topicLevels = (t) => t.levels || [DEFAULT_LEVEL];
const slot = (day, subject, level) => `${day}:${subject}:${level}`;
// dq-2026-10-10-computer-science-a-level-v1  ->  { day, subject, level }
const parseQuestId = (id) => { const m = /^dq-(\d{4}-\d{2}-\d{2})-(.+)-(a-level|form-5)-[^-]+$/.exec(String(id)); return m ? { day: m[1], subject: m[2], level: m[3] } : null; };

export function createDailyQuests({ bank, db, awardStudent, getUser, records }) {
  const topicById = () => new Map(bank.topics.map((t) => [t.id, t]));
  const qById = (id) => bank.questions.find((x) => x.id === id);
  const combos = () => LEVELS.flatMap((l) => l.subjects.map((s) => ({ level: l.id, subject: s })));
  const getSettings = async () => ({ ...defaultSettings(), ...((await db.get('dqSettings', 'main')) || {}) });
  const examIds = (settings, level, subject) => settings.examTopics?.[`${level}:${subject}`] ?? (level === DEFAULT_LEVEL ? settings.examTopics?.[subject] : undefined) ?? [];

  // What the student's browser may see: no expected answers, partial-credit rules, hints that give the answer, traps.
  function publicQ(q) {
    const base = { id: q.id, subject: q.subject, topic: q.topic, topicName: topicById().get(q.topic)?.name || q.topic, type: q.type, difficulty: q.difficulty, total: q.total || 1, stem: q.stem, image: q.image || null };
    if (q.type === 'mcq') return { ...base, options: q.options.map((o) => ({ id: o.id, text: o.text })) };
    return { ...base, steps: q.steps.map((s) => ({ id: s.id, kind: s.kind, prompt: s.prompt, marks: s.marks, unit: s.unit || null, hint: s.hint || null, options: s.kind === 'choice' ? s.options : undefined })) };
  }

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

  function publicQuest(q, attempt) {
    const names = topicById();
    const notes = q.topicIds.map((id) => ({ topic: id, ...(bank.notes[id] || {}) })).filter((n) => n.title || n.body);
    return {
      id: q.id, subject: q.subject, subjectLabel: q.subjectLabel, level: q.level, levelLabel: q.levelLabel, day: q.day, mode: q.mode, expiresAt: q.expiresAt,
      topicNames: q.topicIds.map((id) => names.get(id)?.name || id),
      notes: notes.map((n) => ({ topic: n.topic, title: n.title, body: n.body })),
      questions: q.items.map((id) => { const x = qById(id); return x ? publicQ(x) : null; }).filter(Boolean),
      attempted: Boolean(attempt),
      result: attempt ? { score: attempt.score, max: attempt.max, xp: attempt.xp, summaryChoice: attempt.summaryChoice, submittedAt: attempt.submittedAt, feedback: attempt.feedback } : null,
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
    const have = new Set(quests.map((q) => q.subject));
    return { ok: true, mode: settings.mode, level, levelLabel: levelLabel(level), subjects: subjects.map((id) => ({ id, label: subjectLabel(id), hasQuest: have.has(id) })), quests: quests.map((q, i) => publicQuest(q, attempts[i])) };
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

  async function submit(studentId, questId, answers, summaryChoice) {
    const where = parseQuestId(questId);
    const q = where ? await db.get('dqQuests', slot(where.day, where.subject, where.level)) : null;
    if (!q || q.id !== questId) return { problem: 'Daily quest not found or expired.' };
    if (Date.parse(q.expiresAt) <= Date.now()) return { problem: 'This daily quest has expired.' };
    const user = await getUser(studentId);
    const { level, subjects } = studentChoice(user || {});
    if (!user || level !== q.level || !subjects.includes(q.subject)) return { problem: 'This quest is not in your level and subjects. Update them on your Profile.' };
    const attemptId = `${studentId}__${questId}`;
    const prior = await db.get('dqAttempts', attemptId);
    if (prior) return { problem: 'You have already submitted this daily quest.', result: prior };
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return { problem: 'Answers are required.' };
    let score = 0, max = 0, attempted = 0; const feedback = [];
    for (const id of q.items) {
      const question = qById(id); if (!question) continue;
      const ans = answers[id] || {};
      max += question.total || 1;
      if (!Object.values(ans).some((v) => String(v ?? '').trim())) { feedback.push({ questionId: id, score: 0, max: question.total || 1, blank: true, correct: false }); continue; }
      attempted++;
      const r = markQuestion(question, ans); score += r.awarded;
      feedback.push({ questionId: id, score: r.awarded, max: r.total, correct: r.status === 'correct', steps: (r.steps || []).map((s) => ({ id: s.id, awarded: s.awarded, max: s.max, status: s.status, note: s.status === 'correct' ? undefined : s.note })) });
    }
    if (!attempted) return { problem: 'Answer at least one question before submitting.' };
    const choice = summaryChoice === 'read' ? 'read' : 'skip';
    const xp = Math.max(0, Math.round(score * 2) + (choice === 'skip' ? 5 : 0));
    const result = { studentId, questId, score, max, xp, summaryChoice: choice, submittedAt: new Date().toISOString(), feedback };
    // create() succeeds for the first submission only, so a double-click or a second device cannot be paid twice
    if (!(await db.create('dqAttempts', attemptId, result))) return { problem: 'You have already submitted this daily quest.', result: await db.get('dqAttempts', attemptId) };
    try { await awardStudent(studentId, { xp, achievement: { id: `daily-${q.day}-${q.subject}-${q.level}`, title: 'Daily Quest Complete', description: `Completed the ${q.subjectLabel} (${q.levelLabel}) daily quest.` } }); }
    catch (e) { console.warn('[daily-quest] XP award failed:', e.message); }
    if (records) {
      try { await records.add({ key: `dq:${studentId}:${questId}`, studentId, studentName: user.name, kind: 'daily-quest', title: `${q.subjectLabel} daily quest · ${q.day}`, subject: q.subject, level: q.level, score, max, xp, at: result.submittedAt }); }
      catch (e) { console.warn('[daily-quest] record failed:', e.message); }
    }
    return { ok: true, result };
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

  return { listForStudent, settings, updateSettings, submit, staffList, generateToday };
}
