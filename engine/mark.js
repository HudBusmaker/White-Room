// Typed-answer marking. Plain code, no AI. Exact / numeric tolerance / known variants,
// with method marks (partial credit) per step.

const MINUS = /[\u2212\u2013\u2014]/g;

export function normText(s) {
  return String(s ?? "").normalize("NFKC").toLowerCase().replace(MINUS, "-")
    .replace(/\s+/g, "").replace(/^0[xb](?=[0-9a-f])/, "").replace(/[.;,]+$/, "");
}
export function tokens(s) {
  return String(s ?? "").normalize("NFKC").toLowerCase().replace(MINUS, "-")
    .split(/[^0-9a-z.\-]+/).filter(Boolean).join(",");
}
// Understands 12, -3.5, 1/2, 1,5 (decimal comma), 4 096, 5.88e-3, 5.88x10^-3 and a trailing unit.
export function parseNumber(raw) {
  let s = String(raw ?? "").normalize("NFKC").trim().replace(MINUS, "-").replace(/\s+/g, "");
  if (!s) return NaN;
  s = s.replace(/[×*]10\^?/gi, "e").replace(/x10\^?/gi, "e");
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?/.test(s)) s = s.replace(/,/g, "");
  else if (/^[-+]?\d+,\d{1,2}(?!\d)/.test(s)) s = s.replace(",", ".");
  let m = s.match(/^([-+]?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[2]) === 0 ? NaN : Number(m[1]) / Number(m[2]);
  m = s.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(?:[a-z\u00b0\u03a9\u00b5\u03bc%][a-z0-9\u00b0\u03a9\u00b5\u03bc%/^.\-]*)?$/i);
  if (!m) return NaN;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : NaN;
}
export function numClose(got, want, tol) {
  const abs = Math.max(tol?.abs ?? 0, (tol?.rel ?? 0) * Math.abs(want), 1e-9 * Math.max(1, Math.abs(want)));
  return Math.abs(got - want) <= abs;
}

function matches(step, raw, target) {
  if (step.kind === "number") { const v = parseNumber(raw); return Number.isFinite(v) && numClose(v, Number(target), step.tolerance); }
  if (step.kind === "sequence") return tokens(raw) === tokens(target);
  if (step.kind === "choice") return String(raw) === String(target);
  return normText(raw) === normText(target);
}
const show = (step) => String(step.expected) + (step.unit ? " " + step.unit : "");

export function markStep(step, raw) {
  const max = step.marks;
  const given = String(raw ?? "").trim().slice(0, 80);
  if (!given) return { id: step.id, status: "blank", awarded: 0, max, answer: show(step), note: "No answer given." };
  if (matches(step, given, step.expected) || (step.variants || []).some((v) => matches(step, given, v)))
    return { id: step.id, status: "correct", awarded: max, max };
  for (const p of step.partial || [])
    if (matches(step, given, p.value)) return { id: step.id, status: "partial", awarded: Math.min(p.marks, max - 1), max, answer: show(step), note: p.note };
  let note = step.mistake || "";
  if (step.kind === "number" && !Number.isFinite(parseNumber(given))) note = "That is not a number. " + note;
  return { id: step.id, status: "wrong", awarded: 0, max, answer: show(step), note: note.trim() };
}

// answer: for structured { [stepId]: string }, for mcq { choice: "B" }.
export function markQuestion(q, answer = {}) {
  if (q.type === "mcq") {
    const pick = String(answer.choice ?? "");
    const right = q.options.find((o) => o.correct);
    const chosen = q.options.find((o) => o.id === pick);
    if (!chosen) return { id: q.id, type: "mcq", awarded: 0, total: 1, status: "blank", correctId: right.id };
    return { id: q.id, type: "mcq", awarded: chosen.correct ? 1 : 0, total: 1, status: chosen.correct ? "correct" : "wrong", chosen: chosen.id, correctId: right.id, ...(chosen.correct ? {} : { trap: chosen.trap }) };
  }
  const steps = q.steps.map((s) => markStep(s, answer?.[s.id]));
  return { id: q.id, type: "structured", awarded: steps.reduce((n, s) => n + s.awarded, 0), total: q.total, steps };
}
