// JSON Deposit: staff paste (or upload) question JSON, the server CHECKS it, and only valid questions go live.
// Nothing here is reachable by students. Deposited questions are saved in bank/questions/deposit-<batch>.json
// (the bank loader already reads every .json file in that folder) and are added to the running bank, so the
// daily quests and Practice can use them at once, with no restart.
import { readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { validateBank } from "./bank.js";
import { markQuestion } from "./mark.js";
import { LEVELS, LEVEL_IDS, DEFAULT_LEVEL, subjectLabel, levelLabel, subjectsFor } from "./subjects.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, "..");
const MAX_BYTES = 600 * 1024, MAX_QUESTIONS = 100;
const STYLE = {
  maths: "Mathematics: structured questions with numeric steps (use `tolerance` when rounding), or MCQ. Show the method in successive steps (e.g. discriminant, then roots). Use `partial` for the common method-mark slips.",
  science: "Sciences: numeric steps with units in the prompt, MCQ with traps drawn from real misconceptions. For chemistry write formulae with `\\\\mathrm{}`; give relative atomic masses in the stem when needed. Text steps must be one term or one formula, with `variants` (e.g. both `NaCl` and `sodium chloride`).",
  computing: "Computing/ICT: number-system conversions, logic, trace tables, SQL and spreadsheet formulas as short `text` steps (give `variants`), plus MCQ on concepts. Code goes inside the stem as plain text, no markdown fences.",
  languages: "Languages (French, English): MCQ and short `text` steps with ONE correct answer (a verb form, a word, a translation of a short phrase). Always list `variants`, including the accent-free spelling for French (e.g. `été` and `ete`). Questions in French use French; instructions may be English or French as in the exam. No free writing.",
  economics: "Economics: MCQ, definitions as a one-term `text` step with `variants`, and small calculations (elasticity, GDP, cost, percentage change) as `number` steps with units in the prompt.",
};
const FAMILY = { maths: "maths", "further-maths": "maths", "additional-maths": "maths", physics: "science", chemistry: "science", "computer-science": "computing", ict: "computing", french: "languages", english: "languages", economics: "economics" };

export function createDeposit({ bank, db, ask, refresh = () => {}, root = projectRoot, now = () => new Date() }) {
  let seenVersion = null, lastCheck = 0;
  const depositedNotes = new Set();   // topics whose reading note came from a deposit (so a sync can replace them)
  const qLevel = (q) => q.level || DEFAULT_LEVEL;

  // ---- reading what staff pasted ----
  function parse(text) {
    const raw = String(text ?? "").replace(/^﻿/, "").trim();
    if (!raw) return { problem: "Paste the JSON first." };
    if (Buffer.byteLength(raw) > MAX_BYTES) return { problem: "That is too large. Deposit up to about 100 questions at a time." };
    let s = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    let j;
    try { j = JSON.parse(s); }
    catch (e) {
      const a = s.indexOf("{"), b = s.lastIndexOf("}");   // Gemini sometimes adds a sentence before or after the JSON
      try { if (a >= 0 && b > a) j = JSON.parse(s.slice(a, b + 1)); else throw e; }
      catch { return { problem: "That is not valid JSON (" + e.message + "). Ask Gemini to return only the JSON object, or fix the highlighted spot." }; }
    }
    const questions = Array.isArray(j) ? j : j?.questions;
    const notes = !Array.isArray(j) && j?.notes && typeof j.notes === "object" ? j.notes : {};
    if (!Array.isArray(questions) || !questions.length) return { problem: 'The JSON needs a "questions" list (or be a list of questions).' };
    if (questions.length > MAX_QUESTIONS) return { problem: `Deposit at most ${MAX_QUESTIONS} questions at a time.` };
    return { questions, notes };
  }

  // Safe, deterministic repairs only. Anything else is left for the validator to flag.
  function normalise(q, defaults) {
    const fixes = [];
    const o = { ...q };
    if (!o.level) { o.level = defaults.level; fixes.push(`level set to ${defaults.level}`); }
    if (!o.subject && defaults.subject) { o.subject = defaults.subject; fixes.push(`subject set to ${defaults.subject}`); }
    if (!o.source) o.source = "generated";
    if (o.source !== "past_paper") o.source = "generated";
    if (o.image === undefined) o.image = null;
    if (o.type === "mcq" && o.total == null) { o.total = 1; fixes.push("total set to 1"); }
    if (o.type === "structured" && Array.isArray(o.steps) && o.steps.every((s) => Number.isInteger(s?.marks))) {
      const sum = o.steps.reduce((n, s) => n + s.marks, 0);
      if (o.total !== sum) { fixes.push(`total changed from ${o.total ?? "missing"} to ${sum}`); o.total = sum; }
    }
    if (typeof o.difficulty === "string" && /^[123]$/.test(o.difficulty)) o.difficulty = Number(o.difficulty);
    return { q: o, fixes };
  }

  function freeId(base, taken) {
    const stem = String(base || "q").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+$/g, "").replace(/-\d+$/, "").replace(/-g\d+$/, "") || "q";
    for (let n = 1; n < 10000; n++) { const id = `${stem}-d${String(n).padStart(3, "0")}`; if (!taken.has(id)) return id; }
    return `${stem}-${crypto.randomBytes(3).toString("hex")}`;
  }

  // The answer key must score full marks against itself, and every wrong MCQ option must score zero.
  function selfCheck(q) {
    const errs = [];
    try {
      if (q.type === "mcq") {
        const right = q.options.find((o) => o.correct);
        if (right && markQuestion(q, { choice: right.id }).awarded !== 1) errs.push("the marked-correct option does not score full marks");
        for (const o of q.options.filter((x) => !x.correct)) if (markQuestion(q, { choice: o.id }).awarded !== 0) errs.push(`wrong option ${o.id} scores marks`);
      } else if (q.type === "structured") {
        const ans = Object.fromEntries(q.steps.map((s) => [s.id, String(s.expected)]));
        const r = markQuestion(q, ans);
        if (r.awarded !== q.total) errs.push(`the answer key scores ${r.awarded}/${q.total} against itself (an expected value cannot be read by the marker)`);
        if (markQuestion(q, {}).awarded !== 0) errs.push("a blank answer scores marks");
      }
    } catch (e) { errs.push("could not be marked: " + e.message); }
    return errs;
  }

  function check(text, opts = {}) {
    const parsed = parse(text);
    if (parsed.problem) return { ok: false, problem: parsed.problem };
    const defaults = { level: LEVEL_IDS.includes(opts.defaultLevel) ? opts.defaultLevel : DEFAULT_LEVEL, subject: opts.defaultSubject || null };
    const existing = new Set(bank.questions.map((q) => q.id));
    const taken = new Set(existing), seenInBatch = new Set();
    const items = []; const prepared = [];
    parsed.questions.forEach((raw, i) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) { items.push({ index: i, id: "(not an object)", ok: false, errors: ["each question must be a JSON object"], fixes: [] }); return; }
      const { q, fixes } = normalise(raw, defaults);
      const item = { index: i, id: typeof q.id === "string" ? q.id : `(question ${i + 1})`, ok: true, errors: [], fixes, q };
      if (typeof q.id === "string" && (existing.has(q.id) || seenInBatch.has(q.id))) {
        const nid = freeId(q.topic ? q.topic : q.id, taken); item.fixes.push(`id ${q.id} was already used, renamed to ${nid}`); q.id = nid; item.id = nid;
      }
      if (typeof q.id === "string") { seenInBatch.add(q.id); taken.add(q.id); }
      items.push(item); prepared.push(item);
    });
    // notes the batch brings (only used for topics that have none yet)
    const topicIds = new Set(bank.topics.map((t) => t.id));
    const newNotes = {}; const noteProblems = [];
    for (const [tid, n] of Object.entries(parsed.notes)) {
      if (!topicIds.has(tid)) { noteProblems.push(`note for unknown topic ${tid} was ignored`); continue; }
      if (bank.notes[tid]) { noteProblems.push(`topic ${tid} already has a note, so the new one was ignored`); continue; }
      if (!n || typeof n.title !== "string" || typeof n.body !== "string" || !n.title.trim() || !n.body.trim()) { noteProblems.push(`note for ${tid} needs a title and a body`); continue; }
      newNotes[tid] = { title: n.title.trim().slice(0, 120), body: n.body.trim().slice(0, 4000) };
    }
    // the real validator, run over the batch as if it were already in the bank
    const probe = { ...bank, questions: prepared.map((x) => ({ ...x.q, _file: "deposit" })), notes: { ...bank.notes, ...newNotes } };
    const v = validateBank(probe);
    for (const e of v.errors) {
      const id = (e.match(/^question ([^\s]+)/) || [])[1];
      const hit = items.find((x) => x.q && x.q.id === id);
      if (hit) hit.errors.push(e.replace(/^question [^\s]+ \[[^\]]*\]: /, "")); else noteProblems.push(e);
    }
    for (const it of prepared) {
      if (it.errors.length) continue;
      const allowed = subjectsFor(qLevel(it.q));
      if (!allowed.includes(it.q.subject)) it.errors.push(`${subjectLabel(it.q.subject)} is not offered at ${levelLabel(qLevel(it.q))}`);
      it.errors.push(...selfCheck(it.q));
    }
    const out = items.map((it) => ({ index: it.index, id: it.id, ok: it.errors.length === 0, errors: it.errors, fixes: it.fixes, subject: it.q?.subject || null, level: it.q?.level || null, topic: it.q?.topic || null, question: it.q || null }));
    const good = out.filter((x) => x.ok);
    return { ok: true, total: out.length, valid: good.length, invalid: out.length - good.length, questions: out, notes: newNotes, noteProblems, _prepared: good.map((x) => x.question) };
  }

  async function commit(text, opts = {}) {
    const c = check(text, opts);
    if (!c.ok) return c;
    if (!c.valid) return { ok: false, problem: "None of the questions passed the check. Nothing was deposited.", ...strip(c) };
    const when = now(); const stamp = when.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const batchId = `${stamp}-${crypto.randomBytes(2).toString("hex")}`;
    const questions = c._prepared.map((q) => ({ ...q, deposit: { batch: batchId, at: when.toISOString(), by: opts.by || "head_staff" } }));
    const newNotes = c.notes;
    // One transaction: ids must still be free, then the questions, the notes and a new "bank version" are written together.
    const done = await db.tx(async (t) => {
      for (const q of questions) if (await t.get("bankQuestions", q.id)) return { clash: q.id };
      const ver = (await t.get("meta", "bankVersion")) || { v: 0 };
      for (const q of questions) t.set("bankQuestions", q.id, q);
      for (const [topic, n] of Object.entries(newNotes)) t.set("bankNotes", topic, { ...n, at: when.toISOString() });
      t.set("meta", "bankVersion", { v: ver.v + 1, at: when.toISOString() });
      return { v: ver.v + 1 };
    });
    if (done.clash) { await sync({ force: true }); return { ok: false, problem: `Another deposit just used the id ${done.clash}. Press Check, then Deposit again.` }; }
    for (const q of questions) bank.questions.push({ ...q, _file: "deposit-" + batchId });
    for (const [topic, n] of Object.entries(newNotes)) { bank.notes[topic] = n; depositedNotes.add(topic); }
    seenVersion = done.v; refresh();
    return { ok: true, batch: batchId, deposited: questions.length, skipped: c.invalid, ids: questions.map((q) => q.id), ...strip(c) };
  }
  const strip = (c) => { const { _prepared, ...rest } = c; return rest; };

  // ---- what is in the bank, and what was deposited ----
  function overview() {
    const coverage = [];
    for (const l of LEVELS) for (const s of l.subjects) {
      const qs = bank.questions.filter((q) => q.subject === s && qLevel(q) === l.id);
      coverage.push({ level: l.id, levelLabel: l.label, subject: s, subjectLabel: subjectLabel(s), questions: qs.length, topics: new Set(qs.map((q) => q.topic)).size, topicsTotal: bank.topics.filter((t) => t.subject === s && (t.levels || [DEFAULT_LEVEL]).includes(l.id)).length, topicList: bank.topics.filter((t) => t.subject === s && (t.levels || [DEFAULT_LEVEL]).includes(l.id)).map((t) => ({ id: t.id, name: t.name, questions: qs.filter((q) => q.topic === t.id).length, hasNote: Boolean(bank.notes[t.id]) })) });
    }
    const batches = {};
    for (const q of bank.questions) if (q.deposit) { const b = (batches[q.deposit.batch] ||= { batch: q.deposit.batch, at: q.deposit.at, by: q.deposit.by, questions: [] }); b.questions.push({ id: q.id, subject: q.subject, level: qLevel(q), topic: q.topic, type: q.type, stem: q.stem.slice(0, 120) }); }
    return { ok: true, coverage, batches: Object.values(batches).sort((a, b) => b.at.localeCompare(a.at)) };
  }

  async function withdraw(id) {
    const q = bank.questions.find((x) => x.id === id);
    if (!q || !q.deposit) return { ok: false, problem: "Only deposited questions can be withdrawn here." };
    const v = await db.tx(async (t) => {
      const ver = (await t.get("meta", "bankVersion")) || { v: 0 };
      t.del("bankQuestions", id); t.set("meta", "bankVersion", { v: ver.v + 1, at: now().toISOString() });
      return ver.v + 1;
    });
    bank.questions.splice(bank.questions.indexOf(q), 1);
    seenVersion = v; refresh();
    return { ok: true, withdrawn: id };
  }

  // ---- keep every running copy of the server in step with the deposits ----
  // Deposited questions and notes live in the database. Each server copy loads them at start, and re-loads when the
  // "bank version" counter changes (checked at most every 15 seconds, one cheap read).
  async function sync({ force = false } = {}) {
    lastCheck = Date.now();
    const ver = (await db.get("meta", "bankVersion")) || { v: 0 };
    if (!force && ver.v === seenVersion) return false;
    const [qs, ns] = await Promise.all([db.list("bankQuestions"), db.list("bankNotes")]);
    for (let i = bank.questions.length - 1; i >= 0; i--) if (bank.questions[i].deposit) bank.questions.splice(i, 1);
    for (const { _id, ...q } of qs) if (!bank.questions.some((x) => x.id === q.id)) bank.questions.push({ ...q, _file: "deposit-" + (q.deposit?.batch || "x") });
    for (const t of depositedNotes) delete bank.notes[t];
    depositedNotes.clear();
    for (const { _id, at, ...n } of ns) if (!bank.notes[_id]) { bank.notes[_id] = n; depositedNotes.add(_id); }
    seenVersion = ver.v; refresh();
    return true;
  }
  const syncSoon = async () => { if (Date.now() - lastCheck > 15000) { try { await sync(); } catch (e) { console.warn("[bank] sync failed:", e.message); } } };

  // ---- the Gemini prompt ----
  function template() {
    const md = readFileSync(path.join(root, "GEMINI-QUEST-PROMPT.md"), "utf8");
    const parts = md.split(/^---PROMPT---[ \t]*$/m);   // the marker alone on its own line
    return (parts.length > 1 ? parts[parts.length - 1] : md).trim();
  }
  function buildPrompt({ level, subject, topic, count = 5, difficulty = "a mix of 1, 2 and 3" } = {}) {
    if (!LEVEL_IDS.includes(level)) return { problem: "Choose a level." };
    if (!subjectsFor(level).includes(subject)) return { problem: "That subject is not offered at that level." };
    const n = Math.max(1, Math.min(20, Number(count) || 5));
    let topics = bank.topics.filter((t) => t.subject === subject && (t.levels || [DEFAULT_LEVEL]).includes(level));
    if (topic) { topics = topics.filter((t) => t.id === topic); if (!topics.length) return { problem: "That topic is not part of this subject and level." }; }
    if (!topics.length) return { problem: "This subject has no topics at this level yet." };
    const block = topics.map((t) => {
      const skills = bank.skills.filter((s) => s.topic === t.id).map((s) => `\`${s.id}\` (${s.name})`).join(", ") || "(no skill yet)";
      return `- topic \`${t.id}\`: ${t.name}\n  skills: ${skills}\n  existing reading note: ${bank.notes[t.id] ? "yes" : "NO, you must write one"}`;
    }).join("\n");
    const need = topics.filter((t) => !bank.notes[t.id]).map((t) => t.id);
    const notesStatus = need.length ? `You MUST include a note in "notes" for each of these topics (and only these): ${need.map((x) => "`" + x + "`").join(", ")}.` : `Leave "notes" as an empty object {}: every topic here already has a note.`;
    const prompt = template()
      .replaceAll("{{LEVEL_LABEL}}", levelLabel(level)).replaceAll("{{LEVEL_ID}}", level)
      .replaceAll("{{SUBJECT_LABEL}}", subjectLabel(subject)).replaceAll("{{SUBJECT_ID}}", subject)
      .replaceAll("{{COUNT}}", String(n)).replaceAll("{{DIFFICULTY}}", String(difficulty).slice(0, 80))
      .replaceAll("{{TOPICS}}", block).replaceAll("{{NOTES_STATUS}}", notesStatus).replaceAll("{{STYLE_GUIDE}}", STYLE[FAMILY[subject]] || STYLE.science);
    return { ok: true, prompt, topics: topics.map((t) => t.id) };
  }
  async function generate(opts) {
    const p = buildPrompt(opts);
    if (!p.ok) return p;
    if (!ask) return { ok: false, problem: "No AI service is connected." };
    const r = await ask(p.prompt);
    if (r?.problem) return { ok: false, problem: r.problem, detail: r.detail };
    return { ok: true, text: String(r.text || ""), model: r.model, provider: r.provider, tokensIn: r.tokensIn, tokensOut: r.tokensOut };
  }

  return { check: (t, o) => strip(check(t, o)), commit, overview, withdraw, buildPrompt, generate, sync, syncSoon };
}
