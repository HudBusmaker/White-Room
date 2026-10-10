// The practice service: builds sets, marks typed answers in code, tracks mastery per student,
// and settles AI-drafted photo marks once Head Staff release them.
import crypto from "node:crypto";
import { markQuestion } from "./mark.js";
import { buildSet, settleRow, rowOf, subjectsByNeed, topicsOfSubject, localDay } from "./select.js";
import { buildCorrectionPrompt, parseCorrection } from "./photo.js";

const PHOTO_PREFIX = "practice:";

export function createPractice({ bank, store, awardStudent, listSubmissions, addPhotoSubmission, askText, records = null, getUser = null, now = () => new Date() }) {
  const cfg = bank.config;
  const qById = new Map(bank.questions.map((q) => [q.id, q]));
  const topicById = new Map(bank.topics.map((t) => [t.id, t]));
  const skillById = new Map(bank.skills.map((s) => [s.id, s]));
  const subjectLabel = (id) => bank.subjects.find((s) => s.id === id)?.label || id;
  const available = new Set(bank.questions.map((q) => q.topic));
  const today = () => localDay(now());
  // Called after staff deposit new questions, so sets and subjects see them without a restart.
  function refresh() { qById.clear(); available.clear(); for (const q of bank.questions) { qById.set(q.id, q); available.add(q.topic); } }
  async function record(studentId, rec) {
    if (!records) return;
    try { const u = getUser ? await getUser(studentId) : null; await records.add({ studentId, studentName: u?.name || "", kind: "practice", ...rec }); }
    catch (e) { console.warn("[practice] record failed:", e.message); }
  }

  // ---- what the browser may see: never expected answers, partial-credit rules, mistakes or traps ----
  function publicQuestion(q, role) {
    const base = {
      id: q.id, subject: q.subject, topic: q.topic, topicName: topicById.get(q.topic)?.name || q.topic,
      skill: q.skill, skillName: skillById.get(q.skill)?.name || q.skill,
      type: q.type, difficulty: q.difficulty, total: q.total, stem: q.stem, image: q.image || null, role: role || "primary",
    };
    if (q.type === "mcq") return { ...base, options: q.options.map((o) => ({ id: o.id, text: o.text })) };
    return {
      ...base,
      steps: q.steps.map((s) => ({
        id: s.id, kind: s.kind, prompt: s.prompt, marks: s.marks, unit: s.unit || null, hint: s.hint || null,
        ...(s.kind === "choice" ? { options: s.options } : {}),
      })),
    };
  }
  function publicSet(set) {
    return {
      id: set.id, subject: set.subject, subjectLabel: subjectLabel(set.subject), expiresAt: set.expiresAt,
      notes: set.noteTopics.filter((t) => bank.notes[t]).map((t) => ({ topic: t, topicName: topicById.get(t)?.name, title: bank.notes[t].title, body: bank.notes[t].body })),
      questions: set.items.map((it) => ({ ...publicQuestion(qById.get(it.id), it.role), photoSent: Boolean(set.photos?.[it.id]) })),
    };
  }
  const isOpen = (set, at) => set && !set.submitted && Date.parse(set.expiresAt) > at.getTime();
  function prune(st, at) {
    for (const [id, s] of Object.entries(st.sets)) {
      const age = at.getTime() - Date.parse(s.issuedAt);
      if (age > 3 * 864e5) delete st.sets[id];   // keep three days so a late photo or result still finds its set
    }
    if (st.log.length > 300) st.log = st.log.slice(-300);
  }

  // A student sees only the level and subjects they chose. who = { level, subjects[] }, or null for everything.
  function scoped(who) {
    if (!who) return { view: bank, avail: available };
    const lv = (q) => q.level || "a-level";
    const view = { ...bank, subjects: bank.subjects.filter((s) => who.subjects.includes(s.id)), topics: bank.topics.filter((t) => (t.levels || ["a-level"]).includes(who.level)), questions: bank.questions.filter((q) => lv(q) === who.level) };
    return { view, avail: new Set(view.questions.map((q) => q.topic)) };
  }

  // ---- overview ----
  async function overview(studentId, who = null) {
    const st = await store.read(studentId);
    const t = today();
    const { view, avail } = scoped(who);
    const need = subjectsByNeed({ subjects: view.subjects, topics: view.topics, state: st, available: avail, today: t });
    const needIds = need.map((n) => n.subject);
    const subjects = view.subjects.map((s) => {
      const info = need.find((n) => n.subject === s.id);
      const topics = topicsOfSubject(view.topics, s.id).map((tp) => {
        const r = rowOf(st.topics, tp.id);
        return { id: tp.id, name: tp.name, strength: r.strength, lastSeen: r.last_seen, nextDue: r.next_due, due: Boolean(r.last_seen && r.next_due && r.next_due <= t), questions: view.questions.filter((q) => q.topic === tp.id).length };
      });
      return { id: s.id, label: s.label, drillable: Boolean(info), avgStrength: info ? Math.round(info.avgStrength * 10) / 10 : 0, dueCount: info ? info.dueCount : 0, topics };
    });
    const used = st.xpDay.date === t ? st.xpDay.xp : 0;
    return { ok: true, recommended: needIds[0] || null, order: needIds, subjects, xp: { today: used, cap: cfg.dailyXpCap, perMark: cfg.xpPerMark }, cleared: Object.keys(st.cleared).length };
  }

  // ---- sets ----
  async function newSet(studentId, subject, who = null) {
    const { view } = scoped(who);
    if (subject != null && !view.subjects.some((s) => s.id === subject)) return { problem: who ? "That subject is not one of the subjects you chose. Change them on your Profile." : "Unknown subject." };
    const at = now(), t = localDay(at);
    return store.update(studentId, (st) => {
      prune(st, at);
      const built = buildSet({ bank: view, state: st, today: t, subject: subject || undefined });
      if (!built) return { problem: "There are no practice questions for that subject yet." };
      const open = Object.values(st.sets).find((s) => isOpen(s, at) && s.subject === built.subject);
      if (open) return { ok: true, reused: true, set: publicSet(open) };
      const live = Object.values(st.sets).filter((s) => isOpen(s, at)).sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
      while (live.length >= cfg.maxOpenSets) delete st.sets[live.shift().id];
      const set = {
        id: crypto.randomBytes(9).toString("hex"), subject: built.subject, items: built.items, noteTopics: built.noteTopics,
        issuedAt: at.toISOString(), expiresAt: new Date(at.getTime() + cfg.setLifeHours * 3600e3).toISOString(), submitted: false, photos: {},
      };
      st.sets[set.id] = set;
      return { ok: true, reused: false, set: publicSet(set) };
    });
  }
  async function getSet(studentId, setId) {
    const st = await store.read(studentId);
    const set = st.sets[String(setId)];
    if (!set) return { problem: "Set not found." };
    if (set.submitted) return { problem: "This set has already been submitted.", submitted: true };
    if (!isOpen(set, now())) return { problem: "This set has expired. Start a new one." };
    return { ok: true, set: publicSet(set) };
  }

  // ---- mastery + XP, shared by the typed and the photo paths ----
  function settleMastery(st, scored, t) {
    // scored: [{ q, got, total }]. Strength moves by the SCORE of this attempt, per topic and per skill.
    const groups = (key) => {
      const m = new Map();
      for (const s of scored) { const k = key(s.q); const g = m.get(k) || { got: 0, total: 0 }; g.got += s.got; g.total += s.total; m.set(k, g); }
      return m;
    };
    const changes = [];
    for (const [id, g] of groups((q) => q.topic)) {
      const r = settleRow(rowOf(st.topics, id), g.total ? g.got / g.total : 0, t, cfg);
      st.topics[id] = r.row;
      changes.push({ topic: id, name: topicById.get(id)?.name || id, from: r.from, to: r.to, gated: r.gated, nextDue: r.row.next_due });
    }
    for (const [id, g] of groups((q) => q.skill)) st.skills[id] = settleRow(rowOf(st.skills, id), g.total ? g.got / g.total : 0, t, cfg).row;
    return changes;
  }
  function xpFor(st, t, wanted) {
    if (st.xpDay.date !== t) st.xpDay = { date: t, xp: 0 };
    const grant = Math.max(0, Math.min(wanted, cfg.dailyXpCap - st.xpDay.xp));
    st.xpDay.xp += grant;
    return grant;
  }

  // ---- submit a set of typed answers ----
  async function submitSet(studentId, setId, answers) {
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) return { problem: "No answers were sent." };
    const at = now(), t = localDay(at);
    const done = await store.update(studentId, (st) => {
      const set = st.sets[String(setId)];
      if (!set) return { problem: "Set not found." };
      if (set.submitted) return { problem: "This set has already been submitted." };
      if (!isOpen(set, at)) return { problem: "This set has expired. Start a new one." };
      const ids = new Set(set.items.map((i) => i.id));
      for (const k of Object.keys(answers)) if (!ids.has(k)) return { problem: "An answer was for a question that is not in this set." };
      let any = false;
      const clean = {};
      for (const it of set.items) {
        const q = qById.get(it.id), a = answers[it.id];
        if (a == null) { clean[it.id] = {}; continue; }
        if (typeof a !== "object" || Array.isArray(a)) return { problem: "Answers were not in the expected shape." };
        const ok = new Set(q.type === "mcq" ? ["choice"] : q.steps.map((s) => s.id));
        const c = {};
        for (const [k, v] of Object.entries(a)) {
          if (!ok.has(k)) return { problem: "An answer was for a step that does not exist." };
          c[k] = String(v ?? "").slice(0, 80);
          if (c[k].trim()) any = true;
        }
        clean[it.id] = c;
      }
      if (!any) return { problem: "Answer at least one question before submitting." };
      const results = set.items.map((it) => markQuestion(qById.get(it.id), clean[it.id]));
      // A question left completely blank is not an attempt: it earns nothing, and it does not mark its topic as "seen",
      // so skipped topics keep their priority and come back first.
      const attempted = set.items.map((it) => Object.values(clean[it.id]).some((v) => String(v).trim()));
      const scored = results.map((r, i) => ({ q: qById.get(set.items[i].id), got: r.awarded, total: r.total })).filter((_, i) => attempted[i]);
      const mastery = settleMastery(st, scored, t);
      // Each question pays XP once per student, capped per day. Repeats still train mastery but pay nothing.
      let wantXp = 0, newMarks = 0, newMax = 0;
      results.forEach((r, i) => {
        r.attempted = attempted[i];
        if (!attempted[i]) return;
        const q = qById.get(set.items[i].id), c = st.cleared[q.id];
        if (!c) { st.cleared[q.id] = { at: at.toISOString(), got: r.awarded, total: r.total, best: r.awarded, via: "typed" }; wantXp += r.awarded * cfg.xpPerMark; newMarks += r.awarded; newMax += r.total; }
        else { c.attempts = (c.attempts || 1) + 1; c.best = Math.max(c.best || 0, r.awarded); }
        r.firstTime = !c;
      });
      const xp = xpFor(st, t, wantXp);
      set.submitted = true; set.submittedAt = at.toISOString();
      const got = results.reduce((n, r) => n + r.awarded, 0), total = results.reduce((n, r) => n + r.total, 0);
      st.log.push({ at: at.toISOString(), set: set.id, subject: set.subject, got, total });
      return { ok: true, results, summary: { got, total, pct: total ? Math.round((got / total) * 100) : 0, xp, xpCapped: xp < wantXp }, mastery, _award: { xp, newMarks, newMax }, _rec: { setId: set.id, subject: set.subject, level: qById.get(set.items[0].id)?.level || "a-level", at: at.toISOString() } };
    });
    if (done.ok) {
      const a = done._award; delete done._award;
      const rc = done._rec; delete done._rec;
      if (rc) await record(studentId, { key: `practice:${studentId}:${rc.setId}`, title: `${subjectLabel(rc.subject)} practice set`, subject: rc.subject, level: rc.level, score: done.summary.got, max: done.summary.total, xp: a.xp, at: rc.at });
      if (a.newMax > 0) { try { await awardStudent(studentId, { xp: a.xp, marks: a.newMarks, maxMarks: a.newMax }); } catch (e) { console.warn("[practice] award failed:", e.message); } }
    }
    return done;
  }

  // ---- photo path: AI drafts, Head Staff release ----
  async function reservePhoto(studentId, setId, qid) {
    const at = now();
    return store.update(studentId, (st) => {
      const set = st.sets[String(setId)];
      if (!set) return { problem: "Set not found." };
      if (!set.items.some((i) => i.id === qid)) return { problem: "That question is not in this set." };
      const q = qById.get(qid);
      if (q.type !== "structured") return { problem: "Photos are for structured questions only." };
      if (Date.parse(set.expiresAt) + 2 * 864e5 < at.getTime()) return { problem: "This set is too old. Start a new one." };
      if (set.photos?.[qid]) return { problem: "A photo for this question has already been sent." };
      (set.photos ||= {})[qid] = "pending";
      return { ok: true, q };
    });
  }
  async function releasePhotoReservation(studentId, setId, qid) {
    await store.update(studentId, (st) => { const s = st.sets[String(setId)]; if (s?.photos?.[qid] === "pending") delete s.photos[qid]; });
  }
  async function markPhoto(studentId, setId, qid, images) {
    const r = await reservePhoto(studentId, setId, qid);
    if (r.problem) return r;
    try {
      const out = await askText(buildCorrectionPrompt(r.q), images);
      if (out.problem) { await releasePhotoReservation(studentId, setId, qid); return { problem: out.problem }; }
      const parsed = parseCorrection(out.text, r.q.total);
      if (!parsed.ok) { await releasePhotoReservation(studentId, setId, qid); return { problem: parsed.problem + " Please try again with a clearer photo." }; }
      const id = await addPhotoSubmission({ studentId, questionId: qid, setId, got: parsed.got, max: parsed.max, md: parsed.md, flags: parsed.flags, model: out.model, tokensIn: out.tokensIn, tokensOut: out.tokensOut });
      await store.update(studentId, (st) => { const s = st.sets[String(setId)]; if (s) (s.photos ||= {})[qid] = id; });
      return { ok: true, submissionId: id };
    } catch (e) {
      await releasePhotoReservation(studentId, setId, qid).catch(() => {});
      return { problem: "Could not mark the photo: " + e.message };
    }
  }
  const isPhotoItem = (item) => typeof item?.questId === "string" && item.questId.startsWith(PHOTO_PREFIX);

  // Called when Head Staff release a practice photo: only now does mastery move and XP pay.
  async function onPhotoReleased(item) {
    const qid = item.questId.slice(PHOTO_PREFIX.length);
    const q = qById.get(qid);
    if (!q || !item.studentId || !item.final) return { skipped: true };
    const at = now(), t = localDay(at);
    const out = await store.update(item.studentId, (st) => {
      if (st.settled[item.id]) return { skipped: true };
      st.settled[item.id] = at.toISOString();
      const got = Math.max(0, Math.min(item.final.max, item.final.total));
      const mastery = settleMastery(st, [{ q, got, total: item.final.max }], t);
      let xp = 0, firstTime = false;
      const c = st.cleared[qid];
      if (!c) { firstTime = true; st.cleared[qid] = { at: at.toISOString(), got, total: item.final.max, best: got, via: "photo" }; xp = xpFor(st, t, got * cfg.xpPerMark); }
      else { c.best = Math.max(c.best || 0, got); c.attempts = (c.attempts || 1) + 1; }
      return { ok: true, mastery, xp, firstTime, got, max: item.final.max };
    });
    if (out.ok) await record(item.studentId, { key: `photo:${item.id}`, title: `${subjectLabel(q.subject)} photo-marked question`, subject: q.subject, level: q.level || "a-level", score: out.got, max: out.max, xp: out.xp || 0 });
    if (out.ok && out.firstTime) { try { await awardStudent(item.studentId, { xp: out.xp, marks: out.got, maxMarks: out.max }); } catch (e) { console.warn("[practice] award failed:", e.message); } }
    return out;
  }
  // The student's own photo submissions. The correction and mark are shown only once released.
  async function photoList(studentId) {
    const rows = (await listSubmissions()).filter((x) => x.studentId === studentId && isPhotoItem(x));
    return rows.map((x) => {
      const q = qById.get(x.questId.slice(PHOTO_PREFIX.length));
      const base = { id: x.id, time: x.time, questionId: q?.id, topicName: q ? topicById.get(q.topic)?.name : "", status: x.status === "released" ? "released" : "awaiting_review" };
      if (x.status !== "released") return base;
      return { ...base, final: x.final, correctionMd: x.correctionMd || "" };
    });
  }

  return { overview, newSet, getSet, submitSet, markPhoto, onPhotoReleased, photoList, isPhotoItem, publicQuestion, refresh, PHOTO_PREFIX };
}
