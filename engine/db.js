// One storage layer for the whole app.
//   STORAGE=file       (default) JSON files in data/db/, for your computer and for the tests.
//   STORAGE=firestore  Google Firestore, for Cloud Run / Firebase. Credentials come from the environment
//                      (Cloud Run's service account, or GOOGLE_APPLICATION_CREDENTIALS on your computer).
// Both backends offer exactly the same calls, and tests/db.mjs runs the same checks against both.
//
// A document is a plain JSON object. A collection is a name such as "users". Calls:
//   get(col, id) -> doc | null          getMany(col, ids) -> [doc | null]
//   set(col, id, doc)                   create(col, id, doc) -> true | false (false if it already exists)
//   del(col, id)
//   list(col, { where: {field: value}, orderBy, desc, limit }) -> [{ _id, ...doc }]
//   update(col, id, fn)  fn(current | null) -> { doc?, result? }   (one document, read-modify-write, atomic)
//   tx(fn)               fn(t) with t.get / t.set / t.del over several documents, atomic.
//                        Do all the reads first, then the writes. fn may run more than once: keep it free of side effects.
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const stripUndefined = (x) => clone(x);   // Firestore rejects undefined; JSON round-trip drops it, as the file backend does

/* ---------------- file backend ---------------- */
export function createFileDb(dir) {
  const cache = new Map();           // collection -> { id: doc }
  let queue = Promise.resolve();
  const locked = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };
  const fileOf = (col) => path.join(dir, `${col}.json`);
  async function load(col) {
    if (cache.has(col)) return cache.get(col);
    let data = {};
    try { data = JSON.parse(await readFile(fileOf(col), "utf8")); }
    catch (e) { if (e.code !== "ENOENT") throw e; }   // a corrupt file throws; it is never silently replaced
    cache.set(col, data); return data;
  }
  async function save(col) {
    await mkdir(dir, { recursive: true });
    const tmp = fileOf(col) + "." + process.pid + ".tmp";
    await writeFile(tmp, JSON.stringify(cache.get(col)) + "\n");
    await rename(tmp, fileOf(col));
  }
  const out = {
    kind: "file",
    get: (col, id) => locked(async () => clone((await load(col))[id]) ?? null),
    getMany: (col, ids) => locked(async () => { const d = await load(col); return ids.map((i) => clone(d[i]) ?? null); }),
    set: (col, id, doc) => locked(async () => { (await load(col))[id] = clone(doc); await save(col); }),
    create: (col, id, doc) => locked(async () => { const d = await load(col); if (id in d) return false; d[id] = clone(doc); await save(col); return true; }),
    del: (col, id) => locked(async () => { const d = await load(col); if (id in d) { delete d[id]; await save(col); } }),
    list: (col, o = {}) => locked(async () => {
      let rows = Object.entries(await load(col)).map(([_id, v]) => ({ _id, ...clone(v) }));
      for (const [f, v] of Object.entries(o.where || {})) rows = rows.filter((r) => r[f] === v);
      if (o.orderBy) rows.sort((a, b) => (a[o.orderBy] > b[o.orderBy] ? 1 : a[o.orderBy] < b[o.orderBy] ? -1 : 0) * (o.desc ? -1 : 1));
      return o.limit ? rows.slice(0, o.limit) : rows;
    }),
    update: (col, id, fn) => locked(async () => {
      const d = await load(col); const r = (await fn(clone(d[id]) ?? null)) || {};
      if (r.doc !== undefined) { d[id] = clone(r.doc); await save(col); }
      return r.result;
    }),
    tx: (fn) => locked(async () => {
      const writes = [];
      const t = {
        get: async (col, id) => { const w = [...writes].reverse().find((x) => x.col === col && x.id === id); if (w) return w.del ? null : clone(w.doc); return clone((await load(col))[id]) ?? null; },
        set: (col, id, doc) => { writes.push({ col, id, doc: clone(doc) }); },
        del: (col, id) => { writes.push({ col, id, del: true }); },
      };
      const result = await fn(t);
      const touched = new Set();
      for (const w of writes) { const d = await load(w.col); if (w.del) delete d[w.id]; else d[w.id] = w.doc; touched.add(w.col); }
      for (const c of touched) await save(c);
      return result;
    }),
  };
  return out;
}

/* ---------------- Firestore backend ----------------
   `fs` is a @google-cloud/firestore Firestore instance (or anything with the same calls: the tests pass a fake). */
export function createFirestoreDb(fs) {
  const ref = (col, id) => fs.collection(col).doc(id);
  const ALREADY_EXISTS = (e) => e && (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message)));
  return {
    kind: "firestore",
    async get(col, id) { const s = await ref(col, id).get(); return s.exists ? s.data() : null; },
    async getMany(col, ids) {
      if (!ids.length) return [];
      const snaps = await fs.getAll(...ids.map((i) => ref(col, i)));
      return snaps.map((s) => (s.exists ? s.data() : null));
    },
    async set(col, id, doc) { await ref(col, id).set(stripUndefined(doc)); },
    async create(col, id, doc) {
      try { await ref(col, id).create(stripUndefined(doc)); return true; }
      catch (e) { if (ALREADY_EXISTS(e)) return false; throw e; }
    },
    async del(col, id) { await ref(col, id).delete(); },
    async list(col, o = {}) {
      let q = fs.collection(col);
      for (const [f, v] of Object.entries(o.where || {})) q = q.where(f, "==", v);
      if (o.orderBy) q = q.orderBy(o.orderBy, o.desc ? "desc" : "asc");
      if (o.limit) q = q.limit(o.limit);
      const snap = await q.get();
      return snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
    },
    update(col, id, fn) {
      return fs.runTransaction(async (t) => {
        const s = await t.get(ref(col, id));
        const r = (await fn(s.exists ? s.data() : null)) || {};
        if (r.doc !== undefined) t.set(ref(col, id), stripUndefined(r.doc));
        return r.result;
      });
    },
    tx(fn) {
      return fs.runTransaction(async (t) => {
        const writes = [];
        const api = {
          get: async (col, id) => { const w = [...writes].reverse().find((x) => x.col === col && x.id === id); if (w) return w.del ? null : w.doc; const s = await t.get(ref(col, id)); return s.exists ? s.data() : null; },
          set: (col, id, doc) => { writes.push({ col, id, doc: stripUndefined(doc) }); },
          del: (col, id) => { writes.push({ col, id, del: true }); },
        };
        const result = await fn(api);
        for (const w of writes) { if (w.del) t.delete(ref(w.col, w.id)); else t.set(ref(w.col, w.id), w.doc); }
        return result;
      });
    },
  };
}

/* ---------------- choose the backend ---------------- */
// Parse a service-account JSON value without ever logging its contents. Exported so
// malformed input and escaped private-key newlines can be tested without network access.
export function parseServiceAccount(raw) {
  let account;
  try {
    account = JSON.parse(String(raw));
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the complete service-account JSON as one environment-variable value.');
  }
  if (!account || typeof account !== "object" || Array.isArray(account) ||
      typeof account.client_email !== "string" || !account.client_email.trim() ||
      typeof account.private_key !== "string" || !account.private_key.trim()) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT JSON must contain non-empty client_email and private_key fields.');
  }
  return {
    projectId: typeof account.project_id === "string" && account.project_id.trim() ? account.project_id.trim() : undefined,
    credentials: {
      client_email: account.client_email.trim(),
      private_key: account.private_key.replace(/\\n/g, "\n").replace(/\r?\n/g, "\n"),
    },
  };
}

export async function openDb({ env = process.env, dataDir } = {}) {
  const which = String(env.STORAGE || "file").toLowerCase();
  if (which === "firestore") {
    let Firestore;
    try { ({ Firestore } = await import("@google-cloud/firestore")); }
    catch { throw new Error('STORAGE=firestore needs the Firestore library. Run: npm install @google-cloud/firestore'); }
    const opts = { ignoreUndefinedProperties: true };
    if (env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
      opts.projectId = env.FIRESTORE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || serviceAccount.projectId;
      opts.credentials = serviceAccount.credentials;
    } else if (env.FIRESTORE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT) {
      opts.projectId = env.FIRESTORE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT;
    }
    if (env.FIRESTORE_DATABASE_ID) opts.databaseId = env.FIRESTORE_DATABASE_ID;
    return createFirestoreDb(new Firestore(opts));
  }
  if (which !== "file") throw new Error(`Unknown STORAGE "${which}". Use "file" or "firestore".`);
  return createFileDb(path.join(dataDir, "db"));
}
