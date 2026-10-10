// One-time import of the OLD data files (data/users.json, admission-keys.json, daily-quests.json, practice.json,
// submissions.jsonl, records.json, and deposited bank/questions/deposit-*.json) into the storage layer.
// Safe to run again: documents that already exist are skipped, never overwritten.
//   - On your computer (STORAGE=file) it runs automatically the first time the new version starts.
//   - For Firestore, run it once from your computer:  STORAGE=firestore npm run migrate
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRecords } from "./records.js";
import { DEFAULT_LEVEL } from "./subjects.js";

const readJson = async (f) => { try { return JSON.parse(await readFile(f, "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
const stableLegacyId = (record, index) => crypto.createHash("sha256").update((record.time || "") + "|" + (record.questId || "") + "|" + (record.transcription || "") + "|" + index).digest("hex").slice(0, 20);

// The old submissions.jsonl was an event log (a submission, then later a "release" event). Fold it into one document each.
export function foldSubmissionEvents(text) {
  const map = new Map();
  String(text || "").split(/\r?\n/).filter(Boolean).forEach((line, index) => {
    let v; try { v = JSON.parse(line); } catch { return; }
    if (v.type === "release") {
      const old = map.get(v.id);
      if (old) old.status = "released", old.final = { total: Number.isFinite(Number(v.total)) ? Number(v.total) : old.result.total, max: old.result.max, comment: String(v.comment || "").slice(0, 1000), releasedAt: v.time };
      return;
    }
    if (!v.questId || !v.result) return;
    const id = v.id || stableLegacyId(v, index);
    map.set(id, { ...v, id, studentId: String(v.studentId || ""), status: v.status === "released" ? "released" : "awaiting_review", final: v.final || null });
  });
  return [...map.values()];
}

export async function importLegacy(db, { dataDir, root, force = false, log = () => {} }) {
  if (!force && (await db.get("meta", "legacyImport"))) return { skipped: true };
  const n = { users: 0, admissionKeys: 0, quests: 0, attempts: 0, practice: 0, submissions: 0, records: 0, bankQuestions: 0 };

  const users = await readJson(path.join(dataDir, "users.json"));
  for (const u of Array.isArray(users) ? users : []) if (u?.id && (await db.create("users", u.id, u))) n.users++;
  const allUsers = await db.list("users");
  const top = allUsers.reduce((m, u) => Math.max(m, Number(String(u._id).split("-").pop()) || 0), 0);
  await db.create("meta", "studentCounter", { n: Math.max(top, allUsers.filter((u) => u.role === "student").length) });

  const keys = await readJson(path.join(dataDir, "admission-keys.json"));
  for (const k of Array.isArray(keys) ? keys : []) if (k?.key && (await db.create("admissionKeys", k.key, k))) n.admissionKeys++;

  const dq = await readJson(path.join(dataDir, "daily-quests.json"));
  if (dq) {
    if (dq.settings) await db.create("dqSettings", "main", dq.settings);
    for (const q of Object.values(dq.quests || {})) {
      const level = q.level || DEFAULT_LEVEL;       // before v5 every quest was A Level
      if (await db.create("dqQuests", `${q.day}:${q.subject}:${level}`, { ...q, level, levelLabel: q.levelLabel || (level === "form-5" ? "Form 5" : "A Level") })) n.quests++;
    }
    for (const [sid, mine] of Object.entries(dq.attempts || {}))
      for (const [qid, a] of Object.entries(mine || {})) if (await db.create("dqAttempts", `${sid}__${qid}`, { ...a, studentId: sid, questId: qid })) n.attempts++;
  }

  const pr = await readJson(path.join(dataDir, "practice.json"));
  for (const [sid, st] of Object.entries(pr?.students || {})) if (await db.create("practice", sid, st)) n.practice++;

  try {
    const subs = foldSubmissionEvents(await readFile(path.join(dataDir, "submissions.jsonl"), "utf8"));
    for (const s of subs) if (await db.create("submissions", s.id, s)) n.submissions++;
  } catch (e) { if (e.code !== "ENOENT") throw e; }

  const rec = await readJson(path.join(dataDir, "records.json"));
  if (rec?.records?.length) n.records = await createRecords(db).addMany(rec.records);

  const qdir = path.join(root, "bank", "questions");
  try {
    for (const f of (await readdir(qdir)).filter((x) => /^deposit-.*\.json$/.test(x))) {
      const j = await readJson(path.join(qdir, f));
      for (const q of j?.questions || []) if (q?.id && (await db.create("bankQuestions", q.id, q))) n.bankQuestions++;
    }
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (n.bankQuestions) { const v = (await db.get("meta", "bankVersion")) || { v: 0 }; await db.set("meta", "bankVersion", { v: v.v + 1, at: new Date().toISOString() }); }

  await db.set("meta", "legacyImport", { at: new Date().toISOString(), ...n });
  log(`[import] users ${n.users}, keys ${n.admissionKeys}, quests ${n.quests}, attempts ${n.attempts}, practice ${n.practice}, submissions ${n.submissions}, records ${n.records}, deposited questions ${n.bankQuestions}`);
  return n;
}
