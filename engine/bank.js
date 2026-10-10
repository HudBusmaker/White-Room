// White Room practice engine: loads and validates the question bank.
// Everything here lives OUTSIDE public/, so answers, traps and marking notes never reach a browser.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEVEL_IDS } from "./subjects.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, "..");
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

export const STEP_KINDS = ["number", "text", "sequence", "choice"];

export function loadBank(root = projectRoot) {
  const config = readJson(path.join(root, "engine", "config.json"));
  const tfile = readJson(path.join(root, "engine", "topics.json"));
  const skills = readJson(path.join(root, "engine", "skills.json")).skills;
  const notes = readJson(path.join(root, "bank", "notes.json")).notes;
  const qdir = path.join(root, "bank", "questions");
  const questions = [];
  if (existsSync(qdir))
    for (const f of readdirSync(qdir).filter((x) => x.endsWith(".json")).sort()) {
      const j = readJson(path.join(qdir, f));
      for (const q of j.questions || []) questions.push({ ...q, _file: f });
    }
  return { config, subjects: tfile.subjects, topics: tfile.topics, skills, notes, questions };
}

// Returns { errors, warnings }. Used by `npm run validate` and at server start.
export function validateBank(bank) {
  const errors = [], warnings = [];
  const E = (where, msg) => errors.push(`${where}: ${msg}`);
  const subjectIds = new Set(bank.subjects.map((s) => s.id));
  const topicById = new Map(bank.topics.map((t) => [t.id, t]));
  const skillById = new Map(bank.skills.map((s) => [s.id, s]));
  for (const t of bank.topics) if (!subjectIds.has(t.subject)) E(`topic ${t.id}`, `unknown subject ${t.subject}`);
  for (const s of bank.skills) {
    if (!topicById.has(s.topic)) E(`skill ${s.id}`, `unknown topic ${s.topic}`);
    else if (topicById.get(s.topic).subject !== s.subject) E(`skill ${s.id}`, "subject does not match its topic");
  }
  const c = bank.config;
  if (!(c.strength && c.strength.riseAt > c.strength.fallBelow && c.strength.fallBelow >= 0 && c.strength.riseAt <= 1)) E("config", "strength thresholds must satisfy 0 <= fallBelow < riseAt <= 1");
  if (!Array.isArray(c.spacingDays) || c.spacingDays.length !== c.strength.max + 1) E("config", `spacingDays needs ${c.strength.max + 1} entries (one per strength 0..${c.strength.max})`);
  if (!(c.setSize >= 1 && c.compoundSlots >= 0 && c.compoundSlots < c.setSize)) E("config", "setSize / compoundSlots invalid");

  const dollars = (s) => (String(s).replace(/\\\$/g, "").match(/\$/g) || []).length % 2 === 0;
  const seen = new Set();
  const topicsWithQ = new Set();
  for (const q of bank.questions) {
    const w = `question ${q.id || "(no id)"} [${q._file}]`;
    if (typeof q.id !== "string" || !/^[a-z0-9-]+$/.test(q.id)) { E(w, "id must be lowercase letters, numbers and hyphens"); continue; }
    if (seen.has(q.id)) E(w, "duplicate id");
    seen.add(q.id);
    if (!subjectIds.has(q.subject)) E(w, `unknown subject ${q.subject}`);
    const topic = topicById.get(q.topic);
    if (!topic) E(w, `unknown topic ${q.topic}`);
    else {
      topicsWithQ.add(q.topic);
      if (topic.subject !== q.subject) E(w, `topic ${q.topic} belongs to ${topic.subject}, not ${q.subject}`);
      if (!bank.notes[q.topic]) E(w, `topic ${q.topic} has no reading note in bank/notes.json`);
    }
    const skill = skillById.get(q.skill);
    if (!skill) E(w, `unknown skill ${q.skill} (every question must name a recurring skill)`);
    else if (skill.topic !== q.topic) E(w, `skill ${q.skill} belongs to topic ${skill.topic}, not ${q.topic}`);
    if (q.level != null && !LEVEL_IDS.includes(q.level)) E(w, `level must be one of ${LEVEL_IDS.join(", ")} (or left out for a-level)`);
    else if (topic && !(topic.levels || ["a-level"]).includes(q.level || "a-level")) E(w, `topic ${q.topic} is not taught at ${q.level || "a-level"}`);
    if (!["mcq", "structured"].includes(q.type)) E(w, "type must be mcq or structured");
    if (!["past_paper", "generated"].includes(q.source)) E(w, "source must be past_paper or generated");
    if (![1, 2, 3].includes(q.difficulty)) E(w, "difficulty must be 1, 2 or 3");
    if (typeof q.stem !== "string" || !q.stem.trim()) E(w, "missing stem");
    else if (!dollars(q.stem)) E(w, "stem has an unmatched $");
    if (q.image != null && !(typeof q.image === "string" && /^\/(content|assets)\/[\w./-]+$/.test(q.image) && !q.image.includes(".."))) E(w, "image must be null or a path under /content/ or /assets/");

    if (q.type === "mcq") {
      const o = q.options;
      if (!Array.isArray(o) || o.length < 3) { E(w, "mcq needs at least 3 options"); continue; }
      const ids = new Set(o.map((x) => x.id));
      if (ids.size !== o.length) E(w, "duplicate option ids");
      const right = o.filter((x) => x.correct === true);
      if (right.length !== 1) E(w, `mcq needs exactly one correct option (has ${right.length})`);
      for (const x of o) {
        if (typeof x.text !== "string" || !x.text.trim()) E(w, `option ${x.id} has no text`);
        else if (!dollars(x.text)) E(w, `option ${x.id} has an unmatched $`);
        if (x.correct !== true && !(typeof x.trap === "string" && x.trap.trim())) E(w, `wrong option ${x.id} must store the trap behind it`);
      }
      if (q.total !== 1) E(w, "mcq total must be 1");
      if (q.steps) E(w, "mcq must not have steps");
    } else if (q.type === "structured") {
      if (!Array.isArray(q.steps) || !q.steps.length) { E(w, "structured question needs steps"); continue; }
      const ids = new Set(); let sum = 0;
      for (const s of q.steps) {
        const sw = `${w} step ${s.id}`;
        if (typeof s.id !== "string" || !/^[a-z0-9]+$/.test(s.id)) E(sw, "step id must be lowercase letters or numbers");
        if (ids.has(s.id)) E(sw, "duplicate step id");
        ids.add(s.id);
        if (!STEP_KINDS.includes(s.kind)) E(sw, `kind must be one of ${STEP_KINDS.join(", ")}`);
        if (typeof s.prompt !== "string" || !s.prompt.trim()) E(sw, "missing prompt");
        else if (!dollars(s.prompt)) E(sw, "prompt has an unmatched $");
        if (!Number.isInteger(s.marks) || s.marks < 1) E(sw, "marks must be a positive whole number");
        sum += Number.isInteger(s.marks) ? s.marks : 0;
        if (s.kind === "number") {
          if (!Number.isFinite(s.expected)) E(sw, "number step needs a numeric expected");
          if (s.tolerance && !(typeof s.tolerance === "object" && ["abs", "rel"].every((k) => s.tolerance[k] == null || (Number.isFinite(s.tolerance[k]) && s.tolerance[k] >= 0)))) E(sw, "tolerance must be { abs, rel } with non-negative numbers");
        } else if (s.kind === "text" || s.kind === "sequence") {
          if (typeof s.expected !== "string" || !s.expected.trim()) E(sw, "needs an expected string");
        } else if (s.kind === "choice") {
          if (!Array.isArray(s.options) || s.options.length < 2) E(sw, "choice step needs options");
          else if (!s.options.some((x) => x.id === s.expected)) E(sw, "expected must be one of the option ids");
        }
        for (const p of s.partial || []) {
          if (!(Number.isInteger(p.marks) && p.marks >= 1 && p.marks < s.marks)) E(sw, "partial marks must be a whole number between 1 and (step marks - 1)");
          if (p.value == null || (s.kind === "number" && !Number.isFinite(p.value))) E(sw, "partial needs a value (a number for number steps)");
          if (typeof p.note !== "string" || !p.note.trim()) E(sw, "partial needs a note explaining the missing method");
        }
      }
      if (q.total !== sum) E(w, `total ${q.total} does not equal the step marks (${sum})`);
    }
  }
  for (const t of bank.topics) if (!topicsWithQ.has(t.id)) warnings.push(`topic ${t.id} has no questions yet (it cannot be drilled)`);
  for (const k of Object.keys(bank.notes)) if (!topicById.has(k)) E(`note ${k}`, "unknown topic");
  for (const [k, n] of Object.entries(bank.notes)) if (!dollars(n.body)) E(`note ${k}`, "unmatched $");
  return { errors, warnings, topicsWithQuestions: topicsWithQ.size };
}
