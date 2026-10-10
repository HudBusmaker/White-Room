// The Record: one line for every task a student completes, with the score beside it.
// Stored in the "records" collection. A record has a `key`; its document id is made from the key, so writing
// the same task twice (or importing old results again) never creates a duplicate.
import crypto from "node:crypto";
import { subjectLabel, levelLabel } from "./subjects.js";

export const KINDS = { "daily-quest": "Daily quest", practice: "Practice set", lesson: "Lesson", quest: "Marked quest" };
const FETCH_LIMIT = 5000;   // staff pages filter the newest 5000 records in memory

export function createRecords(db) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  function shape(r) {
    const kind = KINDS[r.kind] ? r.kind : "quest";
    return {
      id: crypto.randomBytes(6).toString("hex"), key: String(r.key || ""), studentId: String(r.studentId || ""),
      studentName: String(r.studentName || "").slice(0, 100), kind, title: String(r.title || KINDS[kind]).slice(0, 160),
      subject: r.subject ? String(r.subject) : null, level: r.level ? String(r.level) : null,
      score: num(r.score), max: num(r.max), xp: num(r.xp), at: r.at || new Date().toISOString(),
    };
  }
  const docId = (r) => (r.key ? crypto.createHash("sha1").update(r.key).digest("hex") : r.id);
  async function addMany(list) {
    let added = 0;
    for (const r of list) {
      const rec = shape(r);
      if (!rec.studentId) continue;
      if (await db.create("records", docId(rec), rec)) added++;
    }
    return added;
  }
  const add = (r) => addMany([r]);
  const decorate = (r) => ({ ...r, kindLabel: KINDS[r.kind], subjectLabel: r.subject ? subjectLabel(r.subject) : "", levelLabel: r.level ? levelLabel(r.level) : "", pct: r.max ? Math.round((r.score / r.max) * 100) : null });
  function filterRows(rows, f = {}) {
    return rows.filter((r) => (!f.subject || r.subject === f.subject) && (!f.kind || r.kind === f.kind) && (!f.level || r.level === f.level) && (!f.studentId || r.studentId === f.studentId)
      && (!f.q || (r.studentName + " " + r.studentId + " " + r.title).toLowerCase().includes(String(f.q).toLowerCase())));
  }
  function summarise(rows) {
    const by = {};
    let score = 0, max = 0, xp = 0;
    for (const r of rows) {
      score += r.score; max += r.max; xp += r.xp;
      const k = r.subject || "other"; const b = (by[k] ||= { subject: k, label: r.subject ? subjectLabel(r.subject) : "Other", tasks: 0, score: 0, max: 0 });
      b.tasks++; b.score += r.score; b.max += r.max;
    }
    return { tasks: rows.length, score, max, pct: max ? Math.round((score / max) * 100) : null, xp, bySubject: Object.values(by).map((b) => ({ ...b, pct: b.max ? Math.round((b.score / b.max) * 100) : null })).sort((a, b) => b.tasks - a.tasks) };
  }
  async function forStudent(studentId, f = {}) {
    const rows = filterRows(await db.list("records", { where: { studentId } }), f).sort((a, b) => b.at.localeCompare(a.at));
    return { ok: true, summary: summarise(rows), records: rows.slice(0, 500).map(decorate) };
  }
  async function all(f = {}) {
    const rows = filterRows(await db.list("records", { orderBy: "at", desc: true, limit: FETCH_LIMIT }), f).sort((a, b) => b.at.localeCompare(a.at));
    return { ok: true, total: rows.length, summary: summarise(rows), records: rows.slice(0, 1000).map(decorate) };
  }
  const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  async function csv(f = {}) {
    const rows = filterRows(await db.list("records", { orderBy: "at", desc: true, limit: FETCH_LIMIT }), f).sort((a, b) => b.at.localeCompare(a.at)).map(decorate);
    const head = ["Date", "Student ID", "Student", "Level", "Subject", "Type", "Task", "Score", "Out of", "Percent", "XP"];
    return [head.join(","), ...rows.map((r) => [r.at.slice(0, 16).replace("T", " "), r.studentId, r.studentName, r.levelLabel, r.subjectLabel, r.kindLabel, r.title, r.score, r.max, r.pct ?? "", r.xp].map(cell).join(","))].join("\n") + "\n";
  }
  return { add, addMany, forStudent, all, csv };
}
