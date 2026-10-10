// Per-student selection logic, ported from ARISE (pickWeakest, gceFrontsByNeed, spacing)
// with the White Room change: strength moves by SCORE, not by +1 every time.
// Pure functions: no files, no clock (today is passed in), so they are easy to test.

export const NEVER = "9999-99-99";

export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const localDay = (d = new Date()) => d.toLocaleDateString("en-CA");   // YYYY-MM-DD in the server's own time zone

export const blankRow = () => ({ strength: 0, last_seen: null, next_due: null });
export const rowOf = (map, id) => (map && map[id]) || blankRow();

// Shared Pure topics are credited to BOTH maths and further-maths: they sit in both subjects' need lists.
export function topicsOfSubject(topics, subject) {
  return topics.filter((t) => t.subject === subject || (t.shared_pure && subject === "further-maths"));
}

// Which subject needs attention most? Ranked like ARISE's gceFrontsByNeed:
// never-touched subject first, then the larger share of unseen topics, then the weakest topic, then the most overdue.
// Only topics that actually have questions count: a topic that cannot be drilled must not keep a subject "needy" forever.
export function subjectsByNeed({ subjects, topics, state, available, today }) {
  const dayNum = Math.floor(Date.parse(today + "T00:00:00Z") / 864e5) || 0;
  const spin = (id) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return (h + dayNum) % 997; };
  const scored = [];
  for (const s of subjects) {
    const rows = topicsOfSubject(topics, s.id).filter((t) => available.has(t.id)).map((t) => ({ t, r: rowOf(state.topics, t.id) }));
    if (!rows.length) continue;
    const unseen = rows.filter((x) => !x.r.last_seen).length;
    const weakest = rows.slice().sort((a, b) => a.r.strength - b.r.strength || String(a.r.next_due || NEVER).localeCompare(String(b.r.next_due || NEVER)))[0];
    scored.push({
      subject: s.id, label: s.label,
      untouched: unseen === rows.length ? 1 : 0,
      unseenFrac: unseen / rows.length,
      strength: weakest.r.strength,
      due: String(weakest.r.next_due || NEVER),
      dueCount: rows.filter((x) => x.r.last_seen && x.r.next_due && x.r.next_due <= today).length,
      topics: rows.length, seen: rows.length - unseen,
      avgStrength: rows.reduce((n, x) => n + x.r.strength, 0) / rows.length,
      spin: spin(s.id),
    });
  }
  scored.sort((a, b) => b.untouched - a.untouched || b.unseenFrac - a.unseenFrac || a.strength - b.strength || a.due.localeCompare(b.due) || a.spin - b.spin);
  return scored;
}

// Weakest first: never-seen topics, then lowest strength, then earliest due. Stable on file order.
export function orderTopicsWeakest(topicList, state) {
  return topicList.map((t, i) => ({ t, i, r: rowOf(state.topics, t.id) }))
    .sort((a, b) => Number(Boolean(a.r.last_seen)) - Number(Boolean(b.r.last_seen)) || a.r.strength - b.r.strength ||
      String(a.r.next_due || NEVER).localeCompare(String(b.r.next_due || NEVER)) || a.i - b.i)
    .map((x) => x.t);
}
export const pickWeakest = (topicList, state) => (orderTopicsWeakest(topicList, state)[0] || null);

// ---- strength by score ----
export function nextStrength(cur, pct, cfg) {
  const { riseAt, fallBelow, max } = cfg.strength;
  if (pct >= riseAt) return Math.min(max, cur + 1);
  if (pct < fallBelow) return Math.max(0, cur - 1);
  return cur;
}
// A rise is only allowed when the topic is due (or brand new): practising early cannot be farmed.
export function settleRow(row, pct, today, cfg) {
  const before = row.strength || 0;
  let s = nextStrength(before, pct, cfg);
  let gated = false;
  if (s > before && cfg.riseOnlyWhenDue && row.last_seen && row.next_due && row.next_due > today) { s = before; gated = true; }
  return {
    row: { strength: s, last_seen: today, next_due: gated ? row.next_due : addDays(today, cfg.spacingDays[s]) },
    from: before, to: s, gated,
  };
}

// ---- building a set ----
function orderQuestionsFor(topic, qs, state) {
  const tRow = rowOf(state.topics, topic.id);
  const lowTopic = tRow.strength <= 2;
  return qs.slice().sort((a, b) =>
    rowOf(state.skills, a.skill).strength - rowOf(state.skills, b.skill).strength ||
    Number(Boolean(state.cleared?.[a.id])) - Number(Boolean(state.cleared?.[b.id])) ||
    String(state.cleared?.[a.id]?.at || "").localeCompare(String(state.cleared?.[b.id]?.at || "")) ||
    (lowTopic ? a.difficulty - b.difficulty : b.difficulty - a.difficulty) || a.id.localeCompare(b.id));
}

// Compounding: fold ONE weak or overdue skill the student has already met into the new set.
function pickCompound({ bank, state, today, subject, inSet, topicIds }) {
  const cands = bank.skills.map((sk) => ({ sk, r: rowOf(state.skills, sk.id) }))
    .filter((x) => x.r.last_seen && (x.r.strength <= 2 || (x.r.next_due && x.r.next_due <= today)) && !topicIds.has(x.sk.topic))
    .sort((a, b) => Number(b.sk.subject === subject) - Number(a.sk.subject === subject) || a.r.strength - b.r.strength ||
      String(a.r.next_due || NEVER).localeCompare(String(b.r.next_due || NEVER)) || a.sk.id.localeCompare(b.sk.id));
  for (const { sk } of cands) {
    const q = bank.questions.filter((x) => x.skill === sk.id && !inSet.has(x.id));
    if (q.length) return orderQuestionsFor({ id: sk.topic }, q, state)[0];
  }
  return null;
}

// -> { subject, items: [{ id, role: 'primary'|'compound', topic }], noteTopics: [...] }
export function buildSet({ bank, state, today, subject, perTopic = 2 }) {
  const cfg = bank.config;
  const byTopic = new Map();
  for (const q of bank.questions) { if (!byTopic.has(q.topic)) byTopic.set(q.topic, []); byTopic.get(q.topic).push(q); }
  const available = new Set(byTopic.keys());
  const need = subjectsByNeed({ subjects: bank.subjects, topics: bank.topics, state, available, today });
  if (!need.length) return null;
  const chosen = subject ? need.find((n) => n.subject === subject) : need[0];
  if (!chosen) return null;
  const topicList = orderTopicsWeakest(topicsOfSubject(bank.topics, chosen.subject).filter((t) => available.has(t.id)), state);
  const primarySlots = Math.max(1, cfg.setSize - cfg.compoundSlots);
  const items = [], inSet = new Set(), topicIds = new Set();
  for (const t of topicList) {
    if (items.length >= primarySlots) break;
    for (const q of orderQuestionsFor(t, byTopic.get(t.id), state).slice(0, perTopic)) {
      if (items.length >= primarySlots) break;
      items.push({ id: q.id, role: "primary", topic: t.id }); inSet.add(q.id); topicIds.add(t.id);
    }
  }
  const compounds = [];
  for (let i = 0; i < cfg.compoundSlots; i++) {
    const q = pickCompound({ bank, state, today, subject: chosen.subject, inSet, topicIds });
    if (q) { items.push({ id: q.id, role: "compound", topic: q.topic }); inSet.add(q.id); topicIds.add(q.topic); compounds.push(q.id); }
  }
  // No compound candidate (new student): use the slot for one more question from the weakest topics.
  for (const t of topicList) {
    if (items.length >= cfg.setSize) break;
    for (const q of orderQuestionsFor(t, byTopic.get(t.id), state)) {
      if (items.length >= cfg.setSize) break;
      if (!inSet.has(q.id)) { items.push({ id: q.id, role: "primary", topic: t.id }); inSet.add(q.id); }
    }
  }
  const noteTopics = [...new Set(items.map((i) => i.topic))].filter((id) => rowOf(state.topics, id).strength === 0 && bank.notes[id]);
  return { subject: chosen.subject, items, noteTopics, need };
}
