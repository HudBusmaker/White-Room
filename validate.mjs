// White Room content validator. No API calls and no secrets required.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicLessons = path.join(here, "public", "content", "lessons");
const questsDir = path.join(here, "quests");
const errors = [], warnings = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }
function isNum(x) { return typeof x === "number" && Number.isFinite(x); }

let manifest = [];
try {
  manifest = JSON.parse(await readFile(path.join(publicLessons, "index.json"), "utf8"));
  if (!Array.isArray(manifest.lessons)) fail("public/content/lessons/index.json", "manifest.lessons must be an array");
  else manifest = manifest.lessons;
} catch (e) {
  fail("public/content/lessons/index.json", "cannot read valid JSON");
}

const lessonFiles = new Set((await readdir(publicLessons)).filter(f => f.endsWith(".json") && f !== "index.json"));
const figureDir = path.join(here, "public", "assets", "lesson-figures");
const figureFiles = new Set((await readdir(figureDir)).filter(f => f.endsWith(".svg")));
for (const entry of manifest) {
  const name = "public/content/lessons/index.json";
  if (!isObj(entry)) { fail(name, "manifest entry is not an object"); continue; }
  for (const k of ["id","file","title","subject","level"]) if (typeof entry[k] !== "string" || !entry[k]) fail(name, `entry ${entry.id || "?"} missing ${k}`);
  if (typeof entry.file === "string") {
    if (!lessonFiles.has(entry.file)) fail(name, `${entry.id || "?"} points to missing ${entry.file}`);
    if (entry.file.includes("/") || entry.file.includes("\\") || entry.file.includes("..")) fail(name, `${entry.id || "?"} has unsafe file name`);
  }
}
// Load the very same engine the browser uses, so what passes here is what students get.
const engineSrc = await readFile(path.join(here, "public", "lesson-engine.js"), "utf8");
const WR = new Function(engineSrc + "\nreturn WRLesson;")();
const SAMPLES = 300;
const seenLessonIds = new Set();
const wordCount = (h) => String(h || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

// Build the note/exercise many times: every build must succeed, leave no {braces}, and give distinct options.
function stress(spec, label) {
  const tasksOf = (x) => x.tasks || [x];
  const positions = {}; let built = 0;
  for (let i = 0; i < SAMPLES; i++) {
    let x;
    try { x = WR.instantiate(spec); } catch (e) { fail(label, e.message); return; }
    built++;
    for (const str of collectStrings(x)) if (/[{}]/.test(str)) { fail(label, "unfilled {…} left in: " + str.slice(0, 60)); return; }
    tasksOf(x).forEach((t, ti) => {
      if (t.t === "num") t.f.forEach((f) => { if (!Number.isFinite(f.v)) fail(label, "non-finite answer"); });
      if (t.t === "mc") {
        const set = new Set(t.o.map(WR.plain));
        if (set.size !== t.o.length) fail(label, "duplicate option text");
        // shuffle like the browser does and make sure the right answer really moves
        const order = WR.shuffle(t.o.map((_, k) => k));
        const pos = order.indexOf(t.a);
        (positions[ti] ||= new Set()).add(pos);
      }
    });
  }
  for (const [ti, set] of Object.entries(positions)) if (set.size < 2 && built > 20) fail(label, `task ${+ti + 1}: correct answer never moves`);
}
function collectStrings(x, out = []) {
  if (typeof x === "string") out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => collectStrings(y, out));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (k !== "_vars") { out.push(k); collectStrings(v, out); } }
  return out;
}
function validateSectionDocument(doc, file) {
  const failDoc = (where, message) => fail(`lessons/${file} ${where}`, message);
  const idPattern = /^[a-z0-9-]+$/;
  const ids = new Set();
  const addId = (id, where) => {
    if (typeof id !== "string" || !idPattern.test(id)) failDoc(where, "id must be lowercase letters, numbers and hyphens");
    else if (ids.has(id)) failDoc(where, `duplicate id ${id}`);
    else ids.add(id);
  };
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  if (!["organic", "physical"].includes(doc.subject)) failDoc("", 'subject must be "organic" or "physical"');
  if (!text(doc.title)) failDoc("", "title must be text");
  if (doc.version !== 1) failDoc("", "version must be 1");
  if (doc.status !== "COMPLETE") failDoc("", 'status must be "COMPLETE" before publishing');
  if (!Array.isArray(doc.sections) || !doc.sections.length) {
    failDoc("", "sections must be a non-empty array");
    return;
  }
  doc.sections.forEach((section, si) => {
    const where = `section ${si + 1}`;
    if (!isObj(section)) { failDoc(where, "section must be an object"); return; }
    addId(section.id, where);
    if (!Number.isInteger(section.number) || section.number < 0) failDoc(where, "number must be a non-negative integer");
    if (!text(section.title)) failDoc(where, "title must be text");
    if (!Array.isArray(section.tags) || !section.tags.length || !section.tags.every(text)) failDoc(where, "tags must be a non-empty array of text");
    if (!Array.isArray(section.blocks) || !section.blocks.length) { failDoc(where, "blocks must be a non-empty array"); return; }
    section.blocks.forEach((block, bi) => {
      const label = `${where} block ${bi + 1}`;
      if (!isObj(block) || typeof block.type !== "string") { failDoc(label, "block must have a type"); return; }
      const lines = (xs) => Array.isArray(xs) && xs.length > 0 && xs.every(text);
      switch (block.type) {
        case "paragraph":
          if (!text(block.text)) failDoc(label, "paragraph text must not be empty");
          break;
        case "bullets":
        case "numbered":
          if (!lines(block.items)) failDoc(label, "items must be a non-empty array of text");
          break;
        case "definition":
          if (!text(block.term) || !text(block.text)) failDoc(label, "definition needs a term and text");
          break;
        case "rule":
          if (!text(block.title) || !lines(block.lines)) failDoc(label, "rule needs a title and lines");
          break;
        case "tip":
        case "flag":
          if (!lines(block.lines)) failDoc(label, `${block.type} needs non-empty lines`);
          break;
        case "table":
          if (!lines(block.columns) || !Array.isArray(block.rows) || !block.rows.length) {
            failDoc(label, "table needs columns and rows");
          } else block.rows.forEach((row, ri) => {
            if (!Array.isArray(row) || row.length !== block.columns.length || !row.every(text)) {
              failDoc(`${label} row ${ri + 1}`, "cells must be non-empty text and match the column count");
            }
          });
          break;
        case "worked_example":
          addId(block.id, label);
          if (!text(block.title) || !lines(block.lines)) failDoc(label, "worked example needs a title and lines");
          break;
        case "hands_on":
          addId(block.id, label);
          if (!text(block.title) || !text(block.task) || !lines(block.steps) || !text(block.answer)) failDoc(label, "hands-on example needs a title, task, steps and answer");
          if (!["very_likely", "normal"].includes(block.exam_likelihood)) failDoc(label, "exam_likelihood must be very_likely or normal");
          if (block.reveal_mode !== "step_by_step") failDoc(label, 'reveal_mode must be "step_by_step"');
          if (block.try_it !== undefined && (!isObj(block.try_it) || !text(block.try_it.question) || !text(block.try_it.answer))) failDoc(label, "try_it needs a question and answer");
          break;
        case "qa":
          addId(block.id, label);
          if (!text(block.question) || !text(block.answer)) failDoc(label, "Q&A needs a question and answer");
          if (block.reveal_mode !== "tap_to_show") failDoc(label, 'reveal_mode must be "tap_to_show"');
          break;
        case "figure":
          if (!text(block.src) || !/^[A-Za-z0-9._-]+\.svg$/i.test(block.src)) failDoc(label, "figure src must be a safe SVG filename");
          else if (!figureFiles.has(block.src)) failDoc(label, `missing figure asset ${block.src}`);
          if (!text(block.caption) || !text(block.alt)) failDoc(label, "figure needs a caption and alt text");
          break;
        default:
          failDoc(label, `unsupported block type "${block.type}"`);
      }
    });
  });
}
function checkTask(t, q) {
  if (!isObj(t)) { fail(q, "task must be an object"); return; }
  if (!["mc", "num"].includes(t.t)) fail(q, "t must be mc or num");
  if (!isNum(t.m) || t.m < 1) fail(q, "m must be a positive number");
  if (typeof t.q !== "string") fail(q, "q must be a string");
  if (t.t === "mc") {
    if (!Array.isArray(t.o) || t.o.length < 2) fail(q, "mc options must have at least 2 items");
    if (!Number.isInteger(t.a) || t.a < 0 || t.a >= (t.o?.length || 0)) fail(q, "mc correct answer index is invalid");
    if (!Array.isArray(t.why) || t.why.length !== (t.o?.length || 0)) fail(q, "mc why must match option count");
  }
  if (t.t === "num") {
    if (!Array.isArray(t.f) || !t.f.length) fail(q, "number task needs fields");
    else if (!t.f.every((x) => isObj(x) && typeof x.l === "string" && (isNum(x.v) || typeof x.v === "string"))) fail(q, "number fields need a label and a numeric or expression value");
    if (t.fb !== undefined && !isObj(t.fb)) fail(q, "fb must be an object");
  }
}
for (const file of lessonFiles) {
  const full = path.join(publicLessons, file);
  let l;
  try { l = JSON.parse(await readFile(full, "utf8")); } catch { fail(`lessons/${file}`, "invalid JSON"); continue; }
  if (!isObj(l)) { fail(`lessons/${file}`, "root must be an object"); continue; }
  if (Array.isArray(l.sections)) {
    validateSectionDocument(l, file);
    const entry = manifest.find((m) => isObj(m) && m.file === file);
    if (!entry) { fail(`lessons/${file}`, "section document is missing from the lesson manifest"); continue; }
    if (entry.format !== "section-document") fail("public/content/lessons/index.json", `${entry.id}: section document format must be section-document`);
    if (!entry.release || !Number.isFinite(Date.parse(entry.release))) fail("public/content/lessons/index.json", `${entry.id}: release must be an ISO date-time`);
    if (seenLessonIds.has(entry.id)) fail(`lessons/${file}`, `duplicate lesson id ${entry.id}`);
    seenLessonIds.add(entry.id);
    continue;
  }
  for (const k of ["id", "title", "level", "subject", "topic", "summary", "notes"]) if (!(k in l)) fail(`lessons/${file}`, `missing ${k}`);
  if ("question" in l || "blocks" in l) fail(`lessons/${file}`, "old format: use summary + notes (see HOW-TO-ADD-A-LESSON.md)");
  if (typeof l.id !== "string" || !/^[a-z0-9-]+$/.test(l.id)) fail(`lessons/${file}`, "id must be lowercase letters/numbers/hyphens");
  if (seenLessonIds.has(l.id)) fail(`lessons/${file}`, `duplicate lesson id ${l.id}`);
  seenLessonIds.add(l.id);
  if (typeof l.summary !== "string" || !l.summary.trim()) fail(`lessons/${file}`, "summary must be text");
  else if (/\?\s*$/.test(l.summary.replace(/<[^>]+>/g, "").trim())) fail(`lessons/${file}`, "summary must read as a summary, not a question");
  if (!Array.isArray(l.notes)) { fail(`lessons/${file}`, "notes must be an array"); continue; }
  if (l.notes.length < 1 || l.notes.length > 6) fail(`lessons/${file}`, "notes must contain 1 to 6 notes");
  l.notes.forEach((n, ni) => {
    const p = `lessons/${file} note ${ni + 1}`;
    if (!isObj(n)) { fail(p, "note must be an object"); return; }
    for (const k of ["title", "text", "tasks", "working"]) if (!(k in n)) fail(p, `missing ${k}`);
    const words = wordCount(n.text);
    if (words > 90) warn(p, `text is ${words} words; notes should be short (aim for 70 or fewer)`);
    if (!Array.isArray(n.tasks) || n.tasks.length < 1 || n.tasks.length > 2) fail(p, "tasks must contain 1 or 2 items");
    else n.tasks.forEach((t, ti) => checkTask(t, `${p} task ${ti + 1}`));
    stress(n, p);
  });
  if (Array.isArray(l.exercises)) l.exercises.forEach((t, i) => { const q = `lessons/${file} exercise ${i + 1}`; checkTask(t, q); stress(t, q); });
  const entry = manifest.find((m) => isObj(m) && m.id === l.id);
  if (entry) {
    if (!entry.release || !Number.isFinite(Date.parse(entry.release))) fail("public/content/lessons/index.json", `${l.id}: release must be an ISO date-time, e.g. 2026-10-06T17:00:00+01:00`);
  }
}

const manifestIds = new Set(manifest.filter(isObj).map(x=>x.id));
for (const id of seenLessonIds) if (!manifestIds.has(id)) warn("lesson manifest",`${id}.json exists but is not in index.json`);
for (const id of manifestIds) if (!seenLessonIds.has(id)) {
  const e=manifest.find(x=>x.id===id); fail("lesson manifest",`${id} has no readable lesson file (${e?.file || "?"})`);
}

const questFiles = (await readdir(questsDir)).filter(f=>f.endsWith(".json"));
const questIds = new Set();
for (const file of questFiles) {
  let q;
  try { q=JSON.parse(await readFile(path.join(questsDir,file),"utf8")); } catch { fail(`quests/${file}`,"invalid JSON"); continue; }
  if (!isObj(q)) { fail(`quests/${file}`,"root must be an object"); continue; }
  for (const k of ["id","title","level","subject","question","total","guide","rules"]) if (!(k in q)) fail(`quests/${file}`,`missing ${k}`);
  if (typeof q.id !== "string" || !/^[a-z0-9-]+$/.test(q.id)) fail(`quests/${file}`,"id must be lowercase letters/numbers/hyphens");
  if (q.id !== file.slice(0,-5)) fail(`quests/${file}`,`filename must be ${q.id}.json`);
  if (questIds.has(q.id)) fail(`quests/${file}`,`duplicate quest id ${q.id}`);
  questIds.add(q.id);
  if (!isNum(q.total) || q.total < 1) fail(`quests/${file}`,"total must be positive");
  if (!Array.isArray(q.guide) || !q.guide.length) fail(`quests/${file}`,"guide must be a non-empty array");
  else {
    const gids=new Set();
    let sum=0;
    q.guide.forEach((g,i)=>{
      const p=`quests/${file} guide ${i+1}`;
      if (!isObj(g)) { fail(p,"guide line must be an object"); return; }
      if (typeof g.id!=="string" || !g.id) fail(p,"missing id");
      if (gids.has(g.id)) fail(p,`duplicate criterion ${g.id}`);
      gids.add(g.id);
      if (!isNum(g.marks) || g.marks < 0) fail(p,"marks must be a non-negative number");
      if (typeof g.text!=="string" || !g.text.trim()) fail(p,"missing text");
      sum += Number(g.marks)||0;
    });
    if (sum !== q.total) fail(`quests/${file}`,`guide marks total ${sum} does not equal total ${q.total}`);
  }
}
// ---- practice question bank (bank/, engine/) ----
{
  const { loadBank, validateBank } = await import("./engine/bank.js");
  const bank = loadBank(); const v = validateBank(bank);
  for (const e of v.errors) fail("bank", e);
  for (const w of v.warnings) warnings.push("bank: " + w);
  console.log(`Practice bank: ${bank.questions.length} questions, ${v.topicsWithQuestions} of ${bank.topics.length} topics covered, ${Object.keys(bank.notes).length} reading notes`);
}
console.log(`White Room validator: ${errors.length ? "FAIL" : "PASS"}`);
console.log(`Lessons: ${lessonFiles.size} files, ${seenLessonIds.size} unique IDs, each note/exercise built ${SAMPLES}× with random numbers`);
console.log(`Quests: ${questFiles.length} files, ${questIds.size} unique IDs`);
for (const x of warnings) console.log("WARN:",x);
for (const x of errors) console.error("ERROR:",x);
process.exitCode = errors.length ? 1 : 0;
