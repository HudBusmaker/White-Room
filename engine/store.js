// Per-student practice state: one document per student in the "practice" collection.
// (A student's document holds their topic strengths, cleared questions, open sets and recent log; it stays well under
// Firestore's 1 MiB limit because the log and old sets are trimmed.) Updates are atomic read-modify-write.
export const freshStudent = () => ({ topics: {}, skills: {}, cleared: {}, sets: {}, log: [], xpDay: { date: null, xp: 0 }, settled: {} });

export function createStore(db) {
  const shape = (s) => ({ ...freshStudent(), ...(s || {}) });
  return {
    async read(id) { return shape(await db.get("practice", id)); },
    // fn(state) mutates the student's state and returns a result; the state is saved after fn. fn must not call the database.
    update(id, fn) {
      return db.update("practice", id, async (cur) => {
        const st = shape(cur);
        const out = await fn(st);
        return { doc: st, result: out };
      });
    },
  };
}
