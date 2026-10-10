// Levels and the subjects each level offers. One place, used by sign-up, the profile, daily quests,
// the JSON deposit and the records page, so they can never disagree about what "Form 5 Physics" means.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(path.join(here, "subjects.json"), "utf8"));
const topics = JSON.parse(readFileSync(path.join(here, "topics.json"), "utf8"));

export const LEVELS = catalog.levels.map((l) => ({ id: l.id, label: l.label, subjects: l.subjects.slice() }));
export const LEVEL_IDS = LEVELS.map((l) => l.id);
export const DEFAULT_LEVEL = "a-level";
const labelOf = new Map(topics.subjects.map((s) => [s.id, s.label]));

export const subjectLabel = (id) => labelOf.get(id) || id;
export const levelLabel = (id) => LEVELS.find((l) => l.id === id)?.label || id;
export const isLevel = (id) => LEVEL_IDS.includes(id);
export const subjectsFor = (level) => (LEVELS.find((l) => l.id === level)?.subjects || []).slice();

// "A level", "Upper Sixth", "O-Level", "Form 5" ... -> a level id, or null if it is not recognised.
export function normaliseLevel(text) {
  const t = String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  for (const l of catalog.levels) if (l.id === t || l.label.toLowerCase() === t || l.aliases.includes(t)) return l.id;
  if (/sixth|a[\s-]?level/.test(t)) return "a-level";
  if (/form\s*(5|five)|o[\s-]?level/.test(t)) return "form-5";
  return null;
}

// What the browser needs to draw the pickers.
export function publicCatalog() {
  return { levels: LEVELS.map((l) => ({ id: l.id, label: l.label, subjects: l.subjects.map((id) => ({ id, label: subjectLabel(id) })) })) };
}

// Checks a student's choice. Returns { level, subjects } or { problem }.
export function checkSelection(level, subjects, { max = 8 } = {}) {
  const lv = isLevel(level) ? level : normaliseLevel(level);
  if (!lv) return { problem: "Choose your level (A Level or Form 5)." };
  const allowed = new Set(subjectsFor(lv));
  const list = [...new Set((Array.isArray(subjects) ? subjects : []).map((x) => String(x)))];
  if (!list.length) return { problem: "Choose at least one subject you are offering." };
  const bad = list.find((s) => !allowed.has(s));
  if (bad) return { problem: `${subjectLabel(bad)} is not offered at ${levelLabel(lv)}.` };
  if (list.length > max) return { problem: `Choose at most ${max} subjects.` };
  return { level: lv, subjects: list.filter((s) => allowed.has(s)) };
}

// Free-text subject names (lesson manifest, old records) -> a subject id, or null.
export function guessSubject(text) {
  const t = String(text ?? "").toLowerCase();
  if (/additional\s*math/.test(t)) return "additional-maths";
  if (/further/.test(t)) return "further-maths";
  if (/math|algebra|calculus|statistic|pure|trig/.test(t)) return "maths";
  if (/chem/.test(t)) return "chemistry";
  if (/phys/.test(t)) return "physics";
  if (/\bict\b|information (and|&) comm/.test(t)) return "ict";
  if (/comput/.test(t)) return "computer-science";
  if (/french|fran[cç]ais/.test(t)) return "french";
  if (/english/.test(t)) return "english";
  if (/econom/.test(t)) return "economics";
  return null;
}
