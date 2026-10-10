// Storage-layer contract tests: the SAME checks run against the file backend and the (fake) Firestore backend.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFileDb, createFirestoreDb, parseServiceAccount } from '../engine/db.js';
import { createTokens } from '../engine/tokens.js';
import { FakeFirestore } from './fake-firestore.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : '')); cond ? pass++ : fail++; };
const dir = mkdtempSync(path.join(tmpdir(), 'wr-db-'));

// Service-account parsing is local-only: no Google connection is created.
{
  const parsed = parseServiceAccount(JSON.stringify({
    type: 'service_account', project_id: 'wr-test-project',
    client_email: 'white-room@example.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
  }));
  ok('[firestore config] reads project_id and service-account credentials', parsed.projectId === 'wr-test-project' && parsed.credentials.client_email === 'white-room@example.iam.gserviceaccount.com');
  ok('[firestore config] converts escaped private-key newlines', parsed.credentials.private_key.includes('\n') && !parsed.credentials.private_key.includes('\\n'));
  let malformed = false;
  try { parseServiceAccount('{not json'); } catch (e) { malformed = /FIREBASE_SERVICE_ACCOUNT/.test(e.message) && !e.message.includes('not json'); }
  ok('[firestore config] malformed JSON gives a clear non-secret error', malformed);
  let incomplete = false;
  try { parseServiceAccount(JSON.stringify({ project_id: 'x' })); } catch (e) { incomplete = /client_email and private_key/.test(e.message); }
  ok('[firestore config] rejects missing required credential fields', incomplete);
}

async function contract(label, db) {
  const T = (n, c, x) => ok(`[${label}] ${n}`, c, x);
  await db.set('t', 'a', { n: 1, deep: { k: [1, 2] } });
  T('set then get returns an equal copy', JSON.stringify(await db.get('t', 'a')) === '{"n":1,"deep":{"k":[1,2]}}');
  T('a missing document is null', (await db.get('t', 'nope')) === null);
  const g = await db.get('t', 'a'); g.n = 99;
  T('the caller cannot change stored data by editing what it got', (await db.get('t', 'a')).n === 1);
  T('create makes a new document once', (await db.create('t', 'b', { n: 2 })) === true && (await db.create('t', 'b', { n: 3 })) === false && (await db.get('t', 'b')).n === 2);
  T('getMany keeps order and gives null for missing', JSON.stringify((await db.getMany('t', ['b', 'zz', 'a'])).map((x) => x && x.n)) === '[2,null,1]' && (await db.getMany('t', [])).length === 0);
  T('undefined fields are dropped, not stored', (await db.set('t', 'u', { a: 1, b: undefined }), JSON.stringify(await db.get('t', 'u')) === '{"a":1}'));
  for (let i = 0; i < 5; i++) await db.set('r', 'r' + i, { student: i % 2 ? 'x' : 'y', at: '2026-10-0' + (i + 1) });
  const mine = await db.list('r', { where: { student: 'x' } });
  T('list filters with where', mine.length === 2 && mine.every((r) => r.student === 'x' && r._id));
  const latest = await db.list('r', { orderBy: 'at', desc: true, limit: 2 });
  T('list orders and limits', latest.map((r) => r._id).join() === 'r4,r3');
  const r = await db.update('t', 'a', (cur) => ({ doc: { ...cur, n: cur.n + 1 }, result: 'done' }));
  T('update is a read-modify-write that returns its result', r === 'done' && (await db.get('t', 'a')).n === 2);
  await db.update('t', 'a', () => ({ result: 1 }));
  T('update with no doc leaves the document alone', (await db.get('t', 'a')).n === 2);
  await db.update('t', 'fresh', (cur) => ({ doc: { first: cur === null } }));
  T('update on a missing document starts from null', (await db.get('t', 'fresh')).first === true);
  await Promise.all(Array.from({ length: 20 }, () => db.update('c', 'counter', (cur) => ({ doc: { n: (cur?.n || 0) + 1 } }))));
  T('20 simultaneous updates are all counted (no lost writes)', (await db.get('c', 'counter')).n === 20);
  const claim = () => db.tx(async (t) => { const k = await t.get('keys', 'K1'); if (!k || k.used) return false; const c = await t.get('meta', 'n'); t.set('keys', 'K1', { used: true }); t.set('meta', 'n', { n: (c?.n || 0) + 1 }); t.set('users', 'U' + ((c?.n || 0) + 1), { ok: 1 }); return true; });
  await db.set('keys', 'K1', { used: false });
  const wins = (await Promise.all([claim(), claim(), claim()])).filter(Boolean).length;
  T('a one-time key can be claimed only once, even by 3 racing requests', wins === 1 && (await db.get('meta', 'n')).n === 1 && (await db.list('users')).length === 1);
  let threw = false; try { await db.tx(async (t) => { t.set('x', 'y', { v: 1 }); throw new Error('boom'); }); } catch { threw = true; }
  T('a failing transaction writes nothing', threw && (await db.get('x', 'y')) === null);
  await db.del('t', 'b'); T('del removes a document', (await db.get('t', 'b')) === null);
  await db.del('t', 'never-existed'); T('deleting a missing document is fine', true);
}

await contract('file', createFileDb(path.join(dir, 'a')));
const fake = new FakeFirestore();
await contract('firestore', createFirestoreDb(fake));
// the file backend survives a restart
{ const d1 = createFileDb(path.join(dir, 'b')); await d1.set('p', 'x', { v: 7 }); const d2 = createFileDb(path.join(dir, 'b')); ok('[file] data is still there after a restart', (await d2.get('p', 'x')).v === 7); }
// the fake enforces the real service's rules, so a violation shows up here and not in production
{ const fs = new FakeFirestore(); let e1 = '', e2 = '', e3 = '';
  try { await fs.collection('a').doc('b').set({ x: undefined }); } catch (e) { e1 = e.message; }
  try { await fs.runTransaction(async (t) => { t.set(fs.collection('a').doc('b'), { x: 1 }); await t.get(fs.collection('a').doc('b')); }); } catch (e) { e2 = e.message; }
  try { fs.collection('a').doc('__bad__'); } catch (e) { e3 = e.message; }
  ok('the fake refuses undefined, read-after-write and reserved ids like the real service', /undefined/.test(e1) && /reads to be executed before/.test(e2) && /bad document id/.test(e3)); }

// ---- signed tokens ----
{ let t = 1000; const tok = createTokens({ secret: 'x'.repeat(32), now: () => t });
  const a = tok.issue({ id: 'WR-1', role: 'student' }, 5000);
  ok('a token verifies and carries the user', tok.verify(a)?.id === 'WR-1');
  ok('a token from another instance with the same secret verifies', createTokens({ secret: 'x'.repeat(32), now: () => t }).verify(a)?.role === 'student');
  ok('a token signed with a different secret is refused', createTokens({ secret: 'y'.repeat(32), now: () => t }).verify(a) === null);
  const [body, sig] = a.split('.'); const forged = Buffer.from(JSON.stringify({ u: { id: 'HEAD-001', role: 'head_staff' }, exp: 9e12 })).toString('base64url');
  ok('a forged payload is refused', tok.verify(forged + '.' + sig) === null && tok.verify(body + '.AAAA') === null);
  t = 7000; ok('an expired token is refused', tok.verify(a) === null);
  ok('garbage is refused', tok.verify('') === null && tok.verify(undefined) === null && tok.verify('a.b.c') === null && tok.verify('x'.repeat(5000)) === null);
  let short = false; try { createTokens({ secret: 'short' }); } catch { short = true; } ok('a short secret is refused', short); }

rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
