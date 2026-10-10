import crypto from "node:crypto";
import { checkSelection, normaliseLevel, levelLabel } from "./engine/subjects.js";

// Storage: users and admission keys live in the shared storage layer (files locally, Firestore in production).
let db = null;
export function useDb(handle) { db = handle; }

const RANKS = [
  { id: "E", min: 100, title: "Novice" },
  { id: "D", min: 500, title: "Awakened" },
  { id: "C", min: 2500, title: "Hunter" },
  { id: "B", min: 5000, title: "Elite" },
  { id: "A", min: 10000, title: "Master" },
  { id: "S", min: 20000, title: "S-Rank" },
];

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const want = Buffer.from(expected, "hex");
  return want.length === actual.length && crypto.timingSafeEqual(actual, want);
}
function clean(v, n = 120) { return String(v ?? "").trim().slice(0, n); }
function idFor(n) { return `WR-${new Date().getFullYear()}-${String(n).padStart(4, "0")}`; }
function rankFor(xp) { return [...RANKS].reverse().find(r => xp >= r.min) || RANKS[0]; }

export function publicUser(u) {
  if (!u) return null;
  const rank = rankFor(Number(u.xp) || 0);
  return {
    id: u.id, name: u.name, className: u.className, school: u.school, gender: u.gender,
    level: u.level, levelKey: u.levelKey || normaliseLevel(u.level), subjects: Array.isArray(u.subjects) ? u.subjects : [], role: u.role, xp: u.xp || 0, rank: rank.id, rankTitle: rank.title,
    stats: u.stats || { lessons: 0, quests: 0, competitions: 0, marks: 0, maxMarks: 0, streak: 0 },
    achievements: u.achievements || [], completedLessons: u.completedLessons || [], createdAt: u.createdAt,
  };
}

export async function createAdmissionKeys(count = 1, issuedBy = "HEAD") {
  const out = [];
  for (let i = 0; i < Math.min(25, Math.max(1, Number(count) || 1)); i++) {
    for (let tries = 0; tries < 5; tries++) {
      const key = `WRK-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
      const item = { key, issuedBy, used: false, issuedAt: new Date().toISOString(), usedBy: null };
      if (await db.create("admissionKeys", key, item)) { out.push(item); break; }
    }
  }
  return out;
}

// Student numbers come from a counter document, so two registrations can never get the same ID.
async function ensureCounter() {
  if (await db.get("meta", "studentCounter")) return;
  const users = await db.list("users");
  const top = users.reduce((n, u) => Math.max(n, Number(String(u._id).split("-").pop()) || 0), 0);
  await db.create("meta", "studentCounter", { n: Math.max(top, users.filter((u) => u.role === "student").length) });
}

export async function registerStudent(input) {
  const key = clean(input.admissionKey, 40).toUpperCase();
  const invite = key ? await db.get("admissionKeys", key) : null;
  if (!invite || invite.used) return { problem: "That admission key is invalid or has already been used." };
  const name = clean(input.name, 100), password = String(input.password || "");
  if (name.length < 2) return { problem: "Enter the student's full name." };
  if (password.length < 6) return { problem: "Password must be at least 6 characters." };
  const allowedGender = ["Male", "Female", "Other", "Prefer not to say"];
  if (!allowedGender.includes(input.gender)) return { problem: "Choose a valid gender option." };
  const pick = checkSelection(input.levelKey || input.level, input.subjects);
  if (pick.problem) return { problem: pick.problem };
  const passwordHash = hashPassword(password);
  await ensureCounter();
  // One transaction: claim the key, take the next number, create the student. Two people racing for one key: one wins.
  const out = await db.tx(async (t) => {
    const k = await t.get("admissionKeys", key);
    if (!k || k.used) return { problem: "That admission key is invalid or has already been used." };
    const counter = (await t.get("meta", "studentCounter")) || { n: 0 };
    const n = counter.n + 1, id = idFor(n);
    const user = {
      id, role: "student", name, passwordHash,
      className: clean(input.className, 50), school: clean(input.school, 120),
      gender: input.gender, level: levelLabel(pick.level), levelKey: pick.level, subjects: pick.subjects, xp: 0,
      stats: { lessons: 0, quests: 0, competitions: 0, marks: 0, maxMarks: 0, streak: 0 },
      completedLessons: [],
      achievements: [{ id: "arrival", title: "The Awakening", description: "Joined White Room.", at: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
    };
    t.set("admissionKeys", key, { ...k, used: true, usedBy: id, usedAt: new Date().toISOString() });
    t.set("meta", "studentCounter", { n });
    t.set("users", id, user);
    return { user };
  });
  return out.problem ? out : { user: publicUser(out.user) };
}

export async function loginStudent(id, password) {
  const u = await db.get("users", clean(id, 40).toUpperCase());
  if (!u || u.role !== "student" || !verifyPassword(password, u.passwordHash)) return { problem: "Student ID or password is incorrect." };
  return publicUser(u);
}

// A student changes the level and subjects they are offering (Profile page, or the Daily Quest picker).
export async function updateStudentSubjects(id, input) {
  const pick = checkSelection(input.levelKey || input.level, input.subjects);
  if (pick.problem) return { problem: pick.problem };
  const out = await db.update("users", id, (u) => {
    if (!u || u.role !== "student") return { result: { problem: "Account not found." } };
    const next = { ...u, levelKey: pick.level, level: levelLabel(pick.level), subjects: pick.subjects, subjectsUpdatedAt: new Date().toISOString() };
    return { doc: next, result: { user: publicUser(next) } };
  });
  return out;
}

export async function loginStaff(code) {
  const expected = process.env.HEAD_STAFF_CODE;
  const a = Buffer.from(String(code || "")); const b = Buffer.from(String(expected || ""));
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { id: "HEAD-001", name: "Head Staff", role: "head_staff" };
}

export async function getUser(id) {
  return id ? await db.get("users", String(id)) : null;
}

export async function awardStudent(id, patch = {}) {
  return db.update("users", id, (cur) => {
    if (!cur) return { result: null };
    const u = { ...cur, completedLessons: [...(cur.completedLessons || [])], achievements: [...(cur.achievements || [])] };
    // Each lesson or quest pays out once. The achievement id is the "already paid" marker.
    if (patch.lessonId && u.completedLessons.includes(patch.lessonId)) return { result: publicUser(u) };
    if (patch.achievement && u.achievements.some((a) => a.id === patch.achievement.id)) return { result: publicUser(u) };
    u.xp = Math.max(0, (Number(u.xp) || 0) + (Number(patch.xp) || 0));
    u.stats = { lessons: 0, quests: 0, competitions: 0, marks: 0, maxMarks: 0, streak: 0, ...(u.stats || {}) };
    if (patch.lessonId) u.completedLessons.push(patch.lessonId);
    for (const k of ["lessons", "quests", "competitions", "marks", "maxMarks"]) if (patch[k] != null) u.stats[k] += Number(patch[k]) || 0;
    if (patch.streak != null) u.stats.streak = Math.max(u.stats.streak, Number(patch.streak) || 0);
    if (patch.achievement) u.achievements.push({ ...patch.achievement, at: new Date().toISOString() });
    return { doc: u, result: publicUser(u) };
  });
}

export async function admissionStats() {
  const keys = await db.list("admissionKeys");
  const total = keys.length;
  const used = keys.filter(x => x.used).length;
  return { total, used, available: Math.max(0, total - used) };
}

export async function listStudents() {
  const users = await db.list("users");
  return users.filter(x => x.role === "student").map(({ _id, ...u }) => publicUser(u));
}

export async function rankings() {
  const students = await listStudents();
  return students.sort((a,b) => b.xp - a.xp || b.stats.marks - a.stats.marks || a.name.localeCompare(b.name)).map((u,i) => ({ ...u, position: i + 1 }));
}

// What other students may see: first name and last initial, rank, XP. No ID, school, gender or class.
function shortName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Student";
  return parts[0] + " " + parts[parts.length - 1][0].toUpperCase() + ".";
}
export async function publicRankings(meId) {
  const all = await rankings();
  return all.map((u) => ({ position: u.position, name: shortName(u.name), rank: u.rank, rankTitle: u.rankTitle, xp: u.xp, me: u.id === meId }));
}

export { RANKS, rankFor };
