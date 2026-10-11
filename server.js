import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { useDb as useMarkingDb, listQuests, publicQuest, allow, transcribe, mark, listSubmissions, releaseSubmission, getSubmission, askText, addPhotoSubmission } from "./marking.js";
import { loadBank, validateBank } from "./engine/bank.js";
import { createStore } from "./engine/store.js";
import { openDb } from "./engine/db.js";
import { createTokens, secretFromEnv } from "./engine/tokens.js";
import { importLegacy } from "./engine/legacy-import.js";
import { createPractice } from "./engine/practice.js";
import { makePracticeRoute } from "./engine/routes.js";
import { createDailyQuests } from "./engine/daily-quests.js";
import { useDb as useAuthDb, registerStudent, loginStudent, loginStaff, publicUser, getUser, awardStudent, listStudents, rankings, publicRankings, createAdmissionKeys, admissionStats, updateStudentSubjects } from "./auth.js";
import { createRecords } from "./engine/records.js";
import { createDeposit } from "./engine/deposit.js";
import { publicCatalog, guessSubject, normaliseLevel } from "./engine/subjects.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "public");
const PORT = Number(process.env.PORT || 3000);
const MAX_PORT = 3100;
const MODEL = "claude-haiku-4-5-20251001";
const DATA_DIR = process.env.DATA_DIR || path.join(here, "data");
const SESSION_MS = 7 * 24 * 60 * 60 * 1000, TEACHER_MS = 8 * 60 * 60 * 1000;
let tokens = null;   // signed tokens: nothing is kept in memory, so every Cloud Run instance accepts them

/* ---------- login attempt limits (in memory; resets when the server restarts) ---------- */
const fails = new Map();
const WINDOW = 15 * 60 * 1000;
function waitMinutes(key, max) {
  const f = fails.get(key);
  if (!f) return 0;
  if (Date.now() - f.first > WINDOW) { fails.delete(key); return 0; }
  return f.n >= max ? Math.max(1, Math.ceil((WINDOW - (Date.now() - f.first)) / 60000)) : 0;
}
function noteFail(key) {
  if (fails.size > 5000) fails.clear();
  const f = fails.get(key);
  if (!f || Date.now() - f.first > WINDOW) fails.set(key, { n: 1, first: Date.now() });
  else f.n++;
}
const ipOf = (req) => req.socket.remoteAddress || "local";
const tooMany = (res, m) => json(res, 429, { ok: false, problem: "Too many attempts. Try again in " + m + " minute" + (m === 1 ? "" : "s") + "." });

// ---- Lessons: short notes that expire LESSON_LIFE_DAYS after their release ----
const LESSON_LIFE_DAYS = 10;
const DAY_MS = 86400000;
const lessonDir = () => path.join(root, "content", "lessons");
async function readManifest() {
  try { return JSON.parse(await readFile(path.join(lessonDir(), "index.json"), "utf8")); }
  catch { return { lessons: [] }; }
}
// upcoming = not released yet, open = readable now, expired = past its 10 days.
// An entry with no (valid) release date is treated as always open.
function lessonWindow(entry, now = Date.now()) {
  const rel = Date.parse(entry && entry.release);
  if (!Number.isFinite(rel)) return { state: "open", release: null, expires: null };
  const expires = rel + LESSON_LIFE_DAYS * DAY_MS;
  return { state: now < rel ? "upcoming" : now >= expires ? "expired" : "open", release: rel, expires };
}
// Marks a lesson pays out: the notes only. Exercises are practice and carry no XP.
function lessonMarks(L) {
  const sum = (tasks) => (tasks || []).reduce((x, t) => x + (Number(t.m) || 1), 0);
  if (Array.isArray(L.notes)) return L.notes.reduce((a, n) => a + sum(n.tasks), 0);
  if (Array.isArray(L.blocks)) return L.blocks.reduce((a, b) => a + sum(b.tasks), 0);
  return 0;
}
// The server, not the browser, decides how many marks a lesson is worth, and whether it is still open.
async function lessonMax(id) {
  try {
    const man = await readManifest();
    const entry = man.lessons.find((l) => l.id === id);
    if (!entry) return { max: 0 };
    if (lessonWindow(entry).state === "expired") return { max: 0, problem: "This lesson has expired." };
    if (lessonWindow(entry).state === "upcoming") return { max: 0, problem: "This lesson is not open yet." };
    const L = JSON.parse(await readFile(path.join(lessonDir(), path.basename(entry.file)), "utf8"));
    return { max: lessonMarks(L) };
  } catch { return { max: 0 }; }
}

// Manifest the browser sees: expired lessons are hidden, upcoming ones have no file link.
async function publicManifest(now = Date.now()) {
  const man = await readManifest(); const out = []; let expiredCount = 0;
  for (const l of man.lessons || []) {
    const w = lessonWindow(l, now);
    if (w.state === "expired") { expiredCount++; continue; }
    const e = { ...l, expires: w.expires ? new Date(w.expires).toISOString() : null, locked: w.state === "upcoming" };
    if (e.locked) delete e.file;
    out.push(e);
  }
  return { now, lessons: out, expiredCount };
}
// Returns true if it answered the request.
async function lessonFileRoute(req, res, url) {
  if (req.method !== "GET" || !url.pathname.startsWith("/content/lessons/")) return false;
  const name = path.basename(url.pathname);
  const noStore = { "Cache-Control": "no-store" };
  if (name === "index.json") { send(res, 200, JSON.stringify(await publicManifest()), types[".json"], noStore); return true; }
  const man = await readManifest();
  // Only files the manifest lists are served from this folder. Compared case-insensitively so
  // that case-insensitive file systems (Windows, macOS) cannot be used to dodge the expiry check.
  const entry = (man.lessons || []).find((l) => path.basename(l.file || "").toLowerCase() === name.toLowerCase());
  if (!entry) { send(res, 404, "Not found"); return true; }
  const w = lessonWindow(entry);
  if (w.state === "expired") { json(res, 410, { ok: false, problem: "This note has expired." }); return true; }
  if (w.state === "upcoming") { json(res, 403, { ok: false, problem: "This note has not opened yet." }); return true; }
  try { send(res, 200, await readFile(path.join(lessonDir(), path.basename(entry.file))), types[".json"], noStore); }
  catch { send(res, 404, "Not found"); }
  return true;
}


function issueSession(user) { return tokens.issue(user, SESSION_MS); }
function sessionUser(req) { return tokens.verify(req.headers["x-wr-token"]); }
function requireStudent(req, res) {
  const user = sessionUser(req);
  if (!user || user.role !== "student") { json(res, 401, { ok:false, problem:"Student login required." }); return null; }
  return user;
}
function requireHead(req, res) {
  const user = sessionUser(req);
  if (!user || user.role !== "head_staff") { json(res, 401, { ok:false, problem:"Head staff access required." }); return null; }
  return user;
}

function teacherOk(req) {
  const pin = process.env.TEACHER_PIN;
  const supplied = req.headers["x-teacher-pin"];
  if (!pin || typeof supplied !== "string") return false;
  const a = Buffer.from(supplied), b = Buffer.from(pin);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function issueTeacherToken() { return tokens.issue({ role: "teacher" }, TEACHER_MS); }
function tokenOk(req) { const u = tokens.verify(req.headers["x-teacher-token"]); return Boolean(u && u.role === "teacher"); }

// Read the secret key from the .env file (it never goes to the browser)
try {
  for (const line of readFileSync(path.join(here, ".env"), "utf8").split(
    /\r?\n/,
  )) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function send(res, code, body, type = "text/plain; charset=utf-8", extra = {}) {
  res.writeHead(code, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", ...extra });
  res.end(body);
}
const json = (res, code, obj) =>
  send(res, code, JSON.stringify(obj), types[".json"]);

function explain(status, detail) {
  if (status === 401 || (status === 400 && /api key/i.test(detail)))
    return "The key was rejected. Check it was copied completely, with no spaces or quotes.";
  if (status === 400 && /credit/i.test(detail))
    return "The key is valid, but the account has no credit. Add credit in the console.";
  if (status === 403)
    return "Access denied. The key may not be allowed here, or the free tier may not be available in your country (billing may be needed).";
  if (status === 404) return "That model name was not found for your key.";
  if (status === 429)
    return "Quota or rate limit reached. Wait a minute and try again.";
  return "The API returned an error.";
}

async function callGemini(key) {
  // Try the newest model first, then older ones if a name is not found
  const models = [
    process.env.GEMINI_MODEL,
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
  ].filter(Boolean);
  let last;
  for (const model of models) {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        model +
        ":generateContent",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            { parts: [{ text: "Reply with the single word: ready" }] },
          ],
          generationConfig: { maxOutputTokens: 200 },
        }),
      },
    );
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) {
      last = { status: 404, detail: j?.error?.message || "" };
      continue;
    }
    if (!r.ok)
      return { error: { status: r.status, detail: j?.error?.message || "" } };
    return {
      provider: "Gemini",
      model,
      reply:
        j.candidates?.[0]?.content?.parts
          ?.map((p) => p.text)
          .join("")
          .trim() || "(empty reply, but the key works)",
      tokensIn: j.usageMetadata?.promptTokenCount,
      tokensOut: j.usageMetadata?.candidatesTokenCount,
    };
  }
  return { error: last };
}

async function callClaude(key) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 20,
      messages: [
        { role: "user", content: "Reply with the single word: ready" },
      ],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok)
    return { error: { status: r.status, detail: j?.error?.message || "" } };
  return {
    provider: "Claude",
    model: j.model,
    reply: j.content?.[0]?.text,
    tokensIn: j.usage?.input_tokens,
    tokensOut: j.usage?.output_tokens,
  };
}

let lastTest = 0;
async function testKey(res) {
  if (Date.now() - lastTest < 3000)
    return json(res, 429, {
      ok: false,
      problem: "Wait a few seconds between tests.",
    });
  lastTest = Date.now();
  const gemini = process.env.GEMINI_API_KEY;
  const claude = process.env.ANTHROPIC_API_KEY;
  const key = gemini || claude;
  if (!key) {
    return json(res, 200, {
      ok: false,
      problem:
        "No key found. Create a file named .env in the project folder with one line: GEMINI_API_KEY=your-key-here. Then stop the server (Ctrl+C) and run npm start again.",
    });
  }
  try {
    const out = gemini ? await callGemini(key) : await callClaude(key);
    if (out.error) {
      return json(res, 200, {
        ok: false,
        status: out.error.status,
        problem: explain(out.error.status, out.error.detail),
        detail: out.error.detail,
      });
    }
    return json(res, 200, {
      ok: true,
      message: "Your " + out.provider + " key works.",
      ...out,
      keyEndsWith: key.slice(-4),
    });
  } catch (e) {
    return json(res, 200, {
      ok: false,
      problem: "Could not reach the API: " + e.message,
    });
  }
}


// Read a JSON request body (max ~6 MB, enough for 3 resized phone photos)
function readBody(req, limit = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too big"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function markRoute(req, res) {
  const user = requireStudent(req, res); if (!user) return;
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { ok: false, problem: "The upload was too large or not valid. Try a smaller photo." });
  }
  const wait = allow(user.id);
  if (wait) return json(res, 429, { ok: false, problem: wait });
  if (body.step === "transcribe") {
    const imgs = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
    const okImg = (x) =>
      typeof x === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(x) && x.length < 4_000_000;
    if (!imgs.length || !imgs.every(okImg))
      return json(res, 400, { ok: false, problem: "Add one to three photos (JPEG, PNG or WebP)." });
    const out = await transcribe(imgs);
    return json(res, 200, out.problem ? { ok: false, ...out } : { ok: true, ...out });
  }
  if (body.step === "mark") {
    const out = await mark(String(body.questId || ""), body.transcription, user.id);
    return json(res, 200, out.problem ? { ok: false, ...out } : { ok: true, ...out });
  }
  return json(res, 400, { ok: false, problem: "Unknown step." });
}

async function authRoute(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    let body={}; try { body=await readBody(req, 32*1024); } catch { return json(res,400,{ok:false,problem:"Invalid registration request."}); }
    const rKey = "register:" + ipOf(req);
const rWait = waitMinutes(rKey, 10); if (rWait) return tooMany(res, rWait);
const out=await registerStudent(body);
if(out.problem) { noteFail(rKey); return json(res,400,{ok:false,...out}); }
    const token=issueSession({id:out.user.id,role:"student"});
    return json(res,201,{ok:true,token,user:out.user});
  }
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    let body={}; try { body=await readBody(req, 16*1024); } catch { return json(res,400,{ok:false,problem:"Invalid login request."}); }
    if(body.type === "staff") {
const sKeys = ["staff:" + ipOf(req), "staff:all"];
const sWait = Math.max(waitMinutes(sKeys[0], 6), waitMinutes(sKeys[1], 20)); if (sWait) return tooMany(res, sWait);
const staff=await loginStaff(body.code); if(!staff) { sKeys.forEach(noteFail); return json(res,401,{ok:false,problem:"Staff code is incorrect."}); }
return json(res,200,{ok:true,token:issueSession(staff),user:staff});
}
const sid = String(body.id || "").trim().toUpperCase().slice(0, 40);
const uKeys = ["student:" + sid, "studentip:" + ipOf(req)];
const uWait = Math.max(waitMinutes(uKeys[0], 8), waitMinutes(uKeys[1], 60)); if (uWait) return tooMany(res, uWait);
const user=await loginStudent(body.id,body.password); if(user?.problem) { uKeys.forEach(noteFail); return json(res,401,{ok:false,...user}); }
return json(res,200,{ok:true,token:issueSession({id:user.id,role:"student"}),user});
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") { const token=req.headers["x-wr-token"]; void token; return json(res,200,{ok:true}); }
  if (req.method === "GET" && url.pathname === "/api/me") {
    const s=sessionUser(req); if(!s) return json(res,401,{ok:false,problem:"Login required."});
    if(s.role !== "student") return json(res,200,{ok:true,user:s});
    const u=await getUser(s.id); return u ? json(res,200,{ok:true,user:publicUser(u)}) : json(res,401,{ok:false,problem:"Account not found."});
  }
  if (req.method === "GET" && url.pathname === "/api/rankings") { const s=sessionUser(req); if(!s) return json(res,401,{ok:false,problem:"Login required."}); return json(res,200,{ok:true,rankings:await publicRankings(s.id)}); }
  return null;
}

async function staffRoute(req,res,url) {
  const head=requireHead(req,res); if(!head) return true;
  // Question Bank Review Tool: all OCR candidates stay in staging until explicitly exported.
  const qbDir = path.join(here, "bank", "source-import", "extracted-json");
  const qbTopicFiles = ["acids-bases-and-titration.json","atomic-structure-and-periodicity.json","bonding-and-structure.json","chemical-industry-and-metals.json","energetics.json","gases-and-gas-laws.json","moles-and-stoichiometry.json","organic-chemistry.json","qualitative-analysis-and-salts.json","rates-and-equilibrium.json","redox-and-electrochemistry.json","solutions-and-concentration.json","unclassified.json"];
  if (req.method === "GET" && url.pathname === "/api/staff/question-bank") {
    const records=[]; const topics=[];
    for (const name of qbTopicFiles) { try { const doc=JSON.parse(await readFile(path.join(qbDir,name),"utf8")); topics.push({id:doc.topic,label:doc.topic.replaceAll("-"," ").replace(/\b\w/g,c=>c.toUpperCase()),file:name}); for (const q of doc.questions||[]) records.push({...q,_file:name}); } catch {} }
    const status=url.searchParams.get("status")||"all"; const topic=url.searchParams.get("topic")||"all"; const search=(url.searchParams.get("q")||"").toLowerCase();
    const filtered=records.filter(q=>(status==="all" || (q.review_status||"pending")==status) && (topic==="all" || q.topic===topic) && (!search || [q.id,q.stem,q.source?.filename,q.source?.question_number_ocr].some(v=>String(v||"").toLowerCase().includes(search))));
    return json(res,200,{ok:true,topics,total:records.length,counts:{pending:records.filter(q=>(q.review_status||"pending")==="pending").length,approved:records.filter(q=>q.review_status==="approved").length,rejected:records.filter(q=>q.review_status==="rejected").length},questions:filtered.map(({_file,...q})=>q)});
  }
  if (req.method === "GET" && url.pathname === "/api/staff/question-bank/image") {
    const set=String(url.searchParams.get("set")||""); const filename=String(url.searchParams.get("filename")||"");
    if (!/^gce-photos(?:-set-02)?$/.test(set) || !/^PXL_[A-Za-z0-9_.-]+\.jpg$/i.test(filename)) return json(res,400,{ok:false,problem:"Invalid source image reference."});
    try { const bytes=await readFile(path.join(here,"bank","source-import",set,"images",filename)); res.writeHead(200,{"Content-Type":"image/jpeg","Cache-Control":"private, max-age=300","X-Content-Type-Options":"nosniff"}); res.end(bytes); return true; } catch { return json(res,404,{ok:false,problem:"Source image not found."}); }
  }
  if (req.method === "POST" && url.pathname === "/api/staff/question-bank/save") {
    let body={}; try { body=await readBody(req,128*1024); } catch { return json(res,400,{ok:false,problem:"Invalid question update."}); }
    const id=String(body.id||""); if(!id || typeof body.stem!=="string") return json(res,400,{ok:false,problem:"Question ID and text are required."});
    let found=false; let saved=null;
    for (const name of qbTopicFiles) {
      const file=path.join(qbDir,name); let doc; try { doc=JSON.parse(await readFile(file,"utf8")); } catch { continue; }
      const i=(doc.questions||[]).findIndex(q=>q.id===id); if(i<0) continue;
      const old=doc.questions[i]; const allowedTopics=new Set(qbTopicFiles.map(x=>x.replace(/\.json$/,"")));
      const topic=String(body.topic||old.topic); if(!allowedTopics.has(topic)) return json(res,400,{ok:false,problem:"Unknown topic."});
      const reviewStatus=["pending","approved","rejected"].includes(body.review_status)?body.review_status:"pending";
      const updated={...old,stem:body.stem.slice(0,30000),topic,topic_classification:"staff_reviewed",options:Array.isArray(body.options)?body.options.slice(0,12).map(x=>String(x).slice(0,2000)):old.options,answer_key:typeof body.answer_key==="string"?body.answer_key.slice(0,5000):old.answer_key,mark_scheme:typeof body.mark_scheme==="string"?body.mark_scheme.slice(0,12000):old.mark_scheme,review_status:reviewStatus,reviewed_at:new Date().toISOString(),reviewed_by:head.id||"head_staff",publishable:false,review_flags:Array.isArray(body.review_flags)?body.review_flags.slice(0,20).map(x=>String(x).slice(0,300)):old.review_flags};
      doc.questions.splice(i,1); doc.record_count=doc.questions.length; await writeFile(file,JSON.stringify(doc,null,2)+"\n");
      if(topic!==doc.topic) { const dest=path.join(qbDir,topic+".json"); let target; try {target=JSON.parse(await readFile(dest,"utf8"));} catch {return json(res,500,{ok:false,problem:"Topic destination could not be loaded."});} target.questions.push(updated); target.record_count=target.questions.length; await writeFile(dest,JSON.stringify(target,null,2)+"\n"); }
      else { doc.questions.splice(Math.min(i,doc.questions.length),0,updated); doc.record_count=doc.questions.length; await writeFile(file,JSON.stringify(doc,null,2)+"\n"); }
      found=true; saved=updated; break;
    }
    return found?json(res,200,{ok:true,question:saved}):json(res,404,{ok:false,problem:"Question record not found."});
  }
  if (req.method === "GET" && url.pathname === "/api/staff/question-bank/export-approved") {
    const questions=[]; for(const name of qbTopicFiles){try{const d=JSON.parse(await readFile(path.join(qbDir,name),"utf8")); for(const q of d.questions||[]) if(q.review_status==="approved") questions.push(q);}catch{}}
    return json(res,200,{ok:true,count:questions.length,questions,notice:"Export only. These records have not been copied into the live practice bank."});
  }
  // ---- JSON Deposit (staff only): check, publish live, withdraw, Gemini prompt/generate ----
  if (url.pathname.startsWith("/api/staff/deposit")) {
    const sub = url.pathname.slice("/api/staff/deposit".length);
    if (req.method === "GET" && sub === "") return json(res,200,deposit.overview());
    if (req.method !== "POST") return json(res,404,{ok:false,problem:"Not found."});
    let body={}; try { body=await readBody(req,700*1024); } catch { return json(res,400,{ok:false,problem:"That request was too large or not valid."}); }
    const opts={defaultLevel:String(body.defaultLevel||""),defaultSubject:body.defaultSubject?String(body.defaultSubject):null,by:head.id||"head_staff"};
    if (sub === "/check") { const out=deposit.check(String(body.json??""),opts); return json(res,out.ok?200:400,out); }
    if (sub === "/commit") { const out=await deposit.commit(String(body.json??""),opts); return json(res,out.ok?200:400,out); }
    if (sub === "/withdraw") { const out=await deposit.withdraw(String(body.id||"")); return json(res,out.ok?200:400,out); }
    if (sub === "/prompt") { const out=deposit.buildPrompt({level:String(body.level||""),subject:String(body.subject||""),topic:body.topic?String(body.topic):"",count:body.count,difficulty:body.difficulty||undefined}); return json(res,out.ok?200:400,out); }
    if (sub === "/generate") {
      const wait=allow("deposit:"+head.id); if(wait) return json(res,429,{ok:false,problem:wait});
      const out=await deposit.generate({level:String(body.level||""),subject:String(body.subject||""),topic:body.topic?String(body.topic):"",count:body.count,difficulty:body.difficulty||undefined});
      return json(res,out.ok?200:400,out);
    }
    return json(res,404,{ok:false,problem:"Not found."});
  }
  if (req.method === "GET" && url.pathname === "/api/staff/records") { const q=Object.fromEntries(url.searchParams); return json(res,200,await records.all({subject:q.subject||"",kind:q.kind||"",level:q.level||"",studentId:q.studentId||"",q:q.q||""})); }
  if (req.method === "GET" && url.pathname === "/api/staff/records.csv") { const q=Object.fromEntries(url.searchParams); const body=await records.csv({subject:q.subject||"",kind:q.kind||"",level:q.level||"",studentId:q.studentId||"",q:q.q||""}); res.writeHead(200,{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="white-room-records.csv"',"X-Content-Type-Options":"nosniff"}); return res.end(body); }
  if(req.method === "GET" && url.pathname === "/api/staff/daily-quests") return json(res,200,await dailyQuests.staffList());
  if(req.method === "POST" && url.pathname === "/api/staff/daily-quests/settings") { let body={}; try { body=await readBody(req,32*1024); } catch { return json(res,400,{ok:false,problem:"Invalid quest settings."}); } return json(res,200,await dailyQuests.updateSettings(body)); }
  if(req.method === "GET" && url.pathname === "/api/staff/daily-quests/photos") return json(res,200,await dailyQuests.staffPhotos());
  if(req.method === "POST" && url.pathname === "/api/staff/daily-quests/adjust") { let body={}; try { body=await readBody(req,16*1024); } catch { return json(res,400,{ok:false,problem:"Invalid request."}); } const out=await dailyQuests.adjustPhoto({studentId:String(body.studentId||""),questId:String(body.questId||""),questionId:String(body.questionId||""),score:body.score,by:head.id||"head_staff"}); return json(res,out.problem?400:200,out.problem?{ok:false,...out}:out); }
  if(req.method === "POST" && url.pathname === "/api/staff/daily-quests/generate") return json(res,200,await dailyQuests.generateToday());
  if(req.method === "POST" && url.pathname === "/api/staff/admissions") {
    let body={}; try { body=await readBody(req,16*1024); } catch { return json(res,400,{ok:false,problem:"Invalid request."}); }
    return json(res,201,{ok:true,keys:await createAdmissionKeys(body.count,head.id)});
  }
  if(req.method === "GET" && url.pathname === "/api/staff/overview") {
    const students = await listStudents();
    const submissions = await listSubmissions();
    const admissions = await admissionStats();
    const awaiting = submissions.filter(x => x.status !== "released").length;
    const released = submissions.filter(x => x.status === "released").length;
    const marks = students.reduce((n,s) => n + Number(s.stats?.marks || 0), 0);
    const maxMarks = students.reduce((n,s) => n + Number(s.stats?.maxMarks || 0), 0);
    const active = students.filter(s => Number(s.stats?.lessons || 0) + Number(s.stats?.quests || 0) + Number(s.stats?.competitions || 0) > 0).length;
    const rankCounts = Object.fromEntries(["S","A","B","C","D","E"].map(r => [r, students.filter(s => s.rank === r).length]));
    return json(res,200,{ok:true,metrics:{totalStudents:students.length,activeStudents:active,pendingAdmissions:admissions.available,awaitingMarking:awaiting,releasedMarking:released,averagePerformance:maxMarks?Math.round(marks/maxMarks*100):0,rankCounts},recentStudents:students.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,6),recentSubmissions:submissions.slice(0,8)});
  }
  if(req.method === "GET" && url.pathname === "/api/staff/students") return json(res,200,{ok:true,students:await listStudents()});
  if(req.method === "GET" && url.pathname === "/api/staff/submissions") return json(res,200,{ok:true,submissions:await listSubmissions()});
  if(req.method === "POST" && url.pathname === "/api/staff/release") {
    let body={}; try { body=await readBody(req,64*1024); } catch { return json(res,400,{ok:false,problem:"Invalid request."}); }
    const out=await releaseSubmission(String(body.id||""),body.total,body.comment);
    if(!out.problem) { const item=(await listSubmissions()).find(x=>x.id===out.id); if(item && practice.isPhotoItem(item)) { try { await practice.onPhotoReleased(item); } catch(e) { console.warn("[practice] release settle failed:", e.message); } } else if(item?.studentId) { const pct=item.result.max ? out.total/item.result.max : 0; await awardStudent(item.studentId,{xp:25+Math.round(pct*75),marks:out.total,maxMarks:item.result.max,achievement:{id:`quest-${item.questId}`,title:"Quest Cleared",description:`Completed ${item.questId}.`}}); await recordQuest(item,out.total,25+Math.round(pct*75)); } }
    return json(res,out.problem?400:200,out.problem?{ok:false,...out}:{ok:true,...out});
  }
  return json(res,404,{ok:false,problem:"Not found."});
}

async function teacherRoute(req, res) {
  if (req.method === "POST" && req.url === "/api/teacher/login") {
    let body={}; try { body=await readBody(req, 16*1024); } catch { return json(res,400,{ok:false,problem:"Invalid request."}); }
    const tKey = "teacher:" + ipOf(req);
const tWait = waitMinutes(tKey, 6); if (tWait) return tooMany(res, tWait);
if (!teacherOk({headers:{"x-teacher-pin":String(body.pin||"")}})) { noteFail(tKey); return json(res,401,{ok:false,problem:"Incorrect teacher PIN."}); }
    return json(res,200,{ok:true,token:issueTeacherToken()});
  }
  if (!tokenOk(req)) return json(res,401,{ok:false,problem:"Tutor login required."});
  if (req.method === "GET" && new URL(req.url,"http://localhost").pathname === "/api/teacher/submissions")
    return json(res,200,{ok:true,submissions:await listSubmissions()});
  if (req.method === "POST" && new URL(req.url,"http://localhost").pathname === "/api/teacher/release") {
    let body={}; try { body=await readBody(req, 64*1024); } catch { return json(res,400,{ok:false,problem:"Invalid request."}); }
    const out=await releaseSubmission(String(body.id||""),body.total,body.comment);
    if(!out.problem) {
      const all=await listSubmissions(); const item=all.find(x=>x.id===out.id);
      if(item?.studentId) {
        const pct=item.result.max ? out.total/item.result.max : 0;
        const xp=25 + Math.round(pct*75);
        await awardStudent(item.studentId,{xp,marks:out.total,maxMarks:item.result.max,achievement:{id:`quest-${item.questId}`,title:"Quest Cleared",description:`Completed ${item.questId}.`}});
        await recordQuest(item,out.total,xp);
      }
    }
    return json(res,out.problem?400:200,out.problem?{ok:false,...out}:{ok:true,...out});
  }
  return json(res,404,{ok:false,problem:"Not found."});
}
async function studentSubmissionRoute(req,res,url) {
  if (req.method !== "GET") return false;
  if (url.pathname !== "/api/submission") return false;
  const user=sessionUser(req); if(!user || user.role !== "student") { json(res,401,{ok:false,problem:"Student login required."}); return true; }
  const item=await getSubmission(url.searchParams.get("id")||"");
  if (!item || item.studentId !== user.id) { json(res,404,{ok:false,problem:"Submission not found."}); return true; }
  json(res,200,{ok:true,id:item.id,status:item.status,final:item.final,
    draft:{total:item.result.total,max:item.result.max}});
  return true;
}
// ---- practice engine (question bank, per-student mastery, typed + photo marking) ----
const bank = loadBank();
{ const v = validateBank(bank); for (const e of v.errors) console.warn("[bank] ERROR", e); if (v.errors.length) { console.warn("[bank] Fix these with: npm run validate. Invalid questions are NOT served."); const bad = new Set(v.errors.map((e) => (e.match(/question ([a-z0-9-]+)/) || [])[1]).filter(Boolean)); bank.questions = bank.questions.filter((q) => !bad.has(q.id)); } }
tokens = createTokens({ secret: secretFromEnv() });
const db = await openDb({ dataDir: DATA_DIR });
useAuthDb(db); useMarkingDb(db);
if (db.kind === "file") { try { const r = await importLegacy(db, { dataDir: DATA_DIR, root, log: console.log }); if (!r.skipped) console.log("[db] imported earlier data files into data/db"); } catch (e) { console.warn("[db] legacy import failed:", e.message); } }
console.log("[db] storage: " + db.kind);
const records = createRecords(db);
const practice = createPractice({ bank, store: createStore(db), awardStudent, listSubmissions, addPhotoSubmission, askText, records, getUser });
const practiceRoute = makePracticeRoute({ practice, requireStudent, readBody, json, allow, maxImages: bank.config.photoMaxImages, getUser });
const dailyQuests = createDailyQuests({ bank, db, awardStudent, getUser, records, askText });
const deposit = createDeposit({ bank, db, ask: askText, refresh: () => practice.refresh(), root: here });
await deposit.sync({ force: true });

// A released marking quest goes into the Record (one line per submission).
async function recordQuest(item, total, xp) {
  try { const u = await getUser(item.studentId); await records.add({ key: `quest:${item.id}`, studentId: item.studentId, studentName: u?.name || "", kind: "quest", title: `Marked quest: ${item.questId}`, subject: guessSubject(item.questId.replace(/-/g, " ")) || "maths", level: u?.levelKey || normaliseLevel(u?.level) || null, score: total, max: item.result?.max || 0, xp }); }
  catch (e) { console.warn("[records] quest record failed:", e.message); }
}

function startServer(port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname.startsWith("/api/")) await deposit.syncSoon();
    if (req.method === "GET" && url.pathname === "/api/health")
      return json(res, 200, { ok: true });
    if (url.pathname.startsWith("/api/auth/" ) || url.pathname === "/api/me" || url.pathname === "/api/rankings") { const handled = await authRoute(req,res,url); if (handled !== null) return handled; }
    if (url.pathname.startsWith("/api/staff/")) return staffRoute(req,res,url);
    if (url.pathname.startsWith("/api/teacher/")) return teacherRoute(req, res);
    if (req.method === "GET" && url.pathname === "/api/catalog") return json(res, 200, { ok: true, ...publicCatalog() });
    if (req.method === "POST" && url.pathname === "/api/me/subjects") {
      const user = requireStudent(req, res); if (!user) return;
      let body = {}; try { body = await readBody(req, 8 * 1024); } catch { return json(res, 400, { ok: false, problem: "Invalid request." }); }
      const out = await updateStudentSubjects(user.id, body);
      return json(res, out.problem ? 400 : 200, out.problem ? { ok: false, ...out } : { ok: true, user: out.user });
    }
    if (req.method === "GET" && url.pathname === "/api/records") {
      const user = requireStudent(req, res); if (!user) return;
      return json(res, 200, await records.forStudent(user.id, { subject: url.searchParams.get("subject") || "", kind: url.searchParams.get("kind") || "" }));
    }
    if (url.pathname.startsWith("/api/practice/")) return practiceRoute(req, res, url);
    if (url.pathname.startsWith("/api/daily-quests")) {
      const user=requireStudent(req,res); if(!user) return;
      if(req.method === "GET" && url.pathname === "/api/daily-quests") return json(res,200,await dailyQuests.listForStudent(await getUser(user.id) || user));
      if(req.method === "POST" && url.pathname === "/api/daily-quests/submit") { let body={}; try { body=await readBody(req,32*1024); } catch { return json(res,400,{ok:false,problem:"Invalid quest submission."}); } const out=await dailyQuests.submit(user.id,String(body.questId||""),body.answers,body.summaryChoice); return json(res,out.problem?400:200,out.problem?{ok:false,...out}:out); }
      if(req.method === "GET" && url.pathname === "/api/daily-quests/ranking") { const out=await dailyQuests.ranking(user.id,String(url.searchParams.get("questId")||"")); return json(res,out.problem?400:200,out.problem?{ok:false,...out}:out); }
      if(req.method === "POST" && url.pathname === "/api/daily-quests/photo") {
        let body={}; try { body=await readBody(req); } catch { return json(res,400,{ok:false,problem:"The upload was too large or not valid. Try a smaller photo."}); }
        const imgs=Array.isArray(body.images)?body.images.slice(0,bank.config.photoMaxImages):[];
        if(!imgs.length || !imgs.every((x)=>typeof x==="string" && /^data:image\/(jpeg|png|webp);base64,/.test(x) && x.length<4_000_000)) return json(res,400,{ok:false,problem:"Add one to three photos (JPEG, PNG or WebP)."});
        const wait=allow(user.id); if(wait) return json(res,429,{ok:false,problem:wait});
        const out=await dailyQuests.markPhoto(user.id,String(body.questId||""),String(body.questionId||""),imgs);
        return json(res,out.problem?400:200,out.problem?{ok:false,...out}:{ok:true,message:"Photo marked. Your mark and correction appear when you submit the quest."});
      }
      return json(res,404,{ok:false,problem:"Not found."});
    }
    if (await studentSubmissionRoute(req, res, url)) return;
    if (req.method === "POST" && url.pathname === "/api/activity/lesson") {
const user=requireStudent(req,res); if(!user) return;
let body={}; try { body=await readBody(req,16*1024); } catch { return json(res,400,{ok:false,problem:"Invalid activity."}); }
const lessonId=String(body.lessonId||"");
const { max, problem: lessonProblem }=await lessonMax(lessonId);
if(!max) return json(res,lessonProblem?410:400,{ok:false,problem:lessonProblem||"Unknown lesson."});
const marks=Math.max(0,Math.min(max,Math.round(Number(body.marks)||0)));
const before=await getUser(user.id); const firstTime=!(before?.completedLessons||[]).includes(lessonId);
const updated=await awardStudent(user.id,{lessonId,xp:50+Math.round((marks/max)*50),lessons:1,marks,maxMarks:max,achievement:{id:`lesson-${lessonId}`,title:"Lesson Cleared",description:"Completed a White Room lesson."}});
if(firstTime){ try { const entry=((await readManifest()).lessons||[]).find((l)=>l.id===lessonId)||{}; await records.add({key:`lesson:${user.id}:${lessonId}`,studentId:user.id,studentName:before?.name||"",kind:"lesson",title:`Lesson: ${entry.title||lessonId}`,subject:guessSubject(entry.subject||lessonId),level:normaliseLevel(entry.level)||before?.levelKey||null,score:marks,max,xp:50+Math.round((marks/max)*50)}); } catch(e) { console.warn("[records] lesson record failed:",e.message); } }
return json(res,200,{ok:true,user:updated});
}
    if (req.method === "POST" && url.pathname === "/api/test") { const head=requireHead(req,res); if(!head) return; return testKey(res); }
    if (req.method === "POST" && url.pathname === "/api/mark")
      return markRoute(req, res);
    if (req.method === "GET" && url.pathname === "/api/quests") { const user=requireStudent(req,res); if(!user) return; return json(res, 200, { quests: await listQuests() }); }
    if (req.method === "GET" && url.pathname === "/api/quest") {
      const user=requireStudent(req,res); if(!user) return;
      const q = await publicQuest(url.searchParams.get("id"));
      return q ? json(res, 200, q) : json(res, 404, { problem: "Quest not found." });
    }
    if (req.method !== "GET") return send(res, 404, "Not found");
    if (await lessonFileRoute(req, res, url)) return;

    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.normalize(path.join(root, rel));
    if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, "Forbidden");

    try {
      const data = await readFile(file);
      send(
        res,
        200,
        data,
        types[path.extname(file)] || "application/octet-stream",
      );
    } catch {
      if (!res.headersSent) send(res, 404, "Not found");
    }
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && port < MAX_PORT) {
      console.warn(`Port ${port} is in use. Retrying on ${port + 1}...`);
      startServer(port + 1);
      return;
    }
    throw err;
  });

  server.listen(port, () => {
    process.env.PORT = String(port);
    console.log("White Room running at http://localhost:" + port);
  });
}

startServer(PORT);
