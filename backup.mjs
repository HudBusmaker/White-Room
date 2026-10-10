// Copies data/ (accounts, admission keys, submissions) into backups/<date-time>/ and keeps the newest 14.
// Run:  npm run backup      Do this before every session and after every change to accounts.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(root, 'data');
const out = path.join(root, 'backups');
if (!existsSync(data)) { console.log('No data folder yet. Nothing to back up.'); process.exit(0); }
mkdirSync(out, { recursive: true });
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const name = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes());
cpSync(data, path.join(out, name), { recursive: true });
const all = readdirSync(out).filter((x) => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(x)).sort();
for (const old of all.slice(0, Math.max(0, all.length - 14))) rmSync(path.join(out, old), { recursive: true, force: true });
console.log('Backed up data/ to backups/' + name + ' (' + Math.min(all.length, 14) + ' kept).');
console.log('Keep a copy somewhere other than this PC, for example a USB drive. Backups contain student data and password hashes: never share them.');
