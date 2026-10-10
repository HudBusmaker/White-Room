// A small in-memory stand-in for @google-cloud/firestore, with the same call shapes the app uses and the same
// rules that bite in real life: undefined values are refused, a transaction must read before it writes,
// create() fails with code 6 if the document exists, ids that look like __x__ are reserved, and ids cannot hold "/".
// It is NOT the real service: use it for logic tests only, and do one run against the real emulator before launch.
export class FakeFirestore {
  constructor() { this.data = new Map(); this.ver = new Map(); this.reads = 0; this.writes = 0; }
  bump(key) { this.ver.set(key, (this.ver.get(key) || 0) + 1); }
  collection(name) { return new Col(this, name); }
  async getAll(...refs) { return refs.map((r) => r._snap()); }
  // the real server library locks documents pessimistically, so contenders wait their turn: model that with a queue
  runTransaction(fn) { const run = (this.q || Promise.resolve()).then(() => this._run(fn), () => this._run(fn)); this.q = run.catch(() => {}); return run; }
  async _run(fn) {
    // like the real service: if a document this transaction read was changed by someone else, run it again
    for (let attempt = 0; attempt < 10; attempt++) {
      const t = new Tx(this); const out = await fn(t);
      if (t._commit()) return out;
    }
    throw new Error("transaction kept conflicting");
  }
}
const checkId = (id) => { if (typeof id !== "string" || !id || id.includes("/") || /^__.*__$/.test(id) || id === "." || id === "..") throw new Error("bad document id: " + id); };
const checkData = (x, where = "") => {
  if (x === undefined) throw new Error("Cannot use undefined as a Firestore value at " + where);
  if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (k === "") throw new Error("empty field name at " + where); checkData(v, where + "." + k); }
};
class Col {
  constructor(fs, name) { this.fs = fs; this.name = name; this.f = []; this.o = null; this.l = 0; }
  doc(id) { checkId(id); return new Ref(this.fs, this.name, id); }
  where(f, op, v) { if (op !== "==") throw new Error("fake supports == only"); const c = this._copy(); c.f.push([f, v]); return c; }
  orderBy(f, dir = "asc") { const c = this._copy(); c.o = [f, dir]; return c; }
  limit(n) { const c = this._copy(); c.l = n; return c; }
  _copy() { const c = new Col(this.fs, this.name); c.f = [...this.f]; c.o = this.o; c.l = this.l; return c; }
  async get() {
    this.fs.reads++;
    let rows = [...this.fs.data.entries()].filter(([k]) => k.startsWith(this.name + "/")).map(([k, v]) => ({ id: k.slice(this.name.length + 1), v }));
    for (const [f, v] of this.f) rows = rows.filter((r) => r.v[f] === v);
    if (this.o) { const [f, d] = this.o; rows.sort((a, b) => (a.v[f] > b.v[f] ? 1 : a.v[f] < b.v[f] ? -1 : 0) * (d === "desc" ? -1 : 1)); }
    if (this.l) rows = rows.slice(0, this.l);
    return { docs: rows.map((r) => ({ id: r.id, data: () => JSON.parse(JSON.stringify(r.v)) })) };
  }
}
class Ref {
  constructor(fs, col, id) { this.fs = fs; this.col = col; this.id = id; this.key = col + "/" + id; }
  _snap() { this.fs.reads++; const v = this.fs.data.get(this.key); return { exists: v !== undefined, id: this.id, data: () => JSON.parse(JSON.stringify(v)) }; }
  async get() { return this._snap(); }
  async set(d) { checkData(d, this.key); this.fs.writes++; this.fs.data.set(this.key, JSON.parse(JSON.stringify(d))); this.fs.bump(this.key); }
  async create(d) { if (this.fs.data.has(this.key)) { const e = new Error("6 ALREADY_EXISTS: Document already exists: " + this.key); e.code = 6; throw e; } return this.set(d); }
  async delete() { this.fs.writes++; this.fs.data.delete(this.key); this.fs.bump(this.key); }
}
class Tx {
  constructor(fs) { this.fs = fs; this.ops = []; this.seen = new Map(); }
  async get(ref) { if (this.ops.length) throw new Error("Firestore transactions require all reads to be executed before all writes."); this.seen.set(ref.key, this.fs.ver.get(ref.key) || 0); return ref._snap(); }
  set(ref, d) { checkData(d, ref.key); this.ops.push(["set", ref, d]); return this; }
  delete(ref) { this.ops.push(["del", ref]); return this; }
  _commit() {
    for (const [key, v] of this.seen) if ((this.fs.ver.get(key) || 0) !== v) return false;
    for (const [k, ref, d] of this.ops) { this.fs.writes++; if (k === "set") this.fs.data.set(ref.key, JSON.parse(JSON.stringify(d))); else this.fs.data.delete(ref.key); this.fs.bump(ref.key); }
    return true;
  }
}
