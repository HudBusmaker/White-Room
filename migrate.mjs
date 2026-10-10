// Copy the data files from your computer (data/*.json, data/submissions.jsonl, deposited questions) into Firestore.
// Safe to run again: anything already in Firestore is left alone.
//   STORAGE=firestore GOOGLE_CLOUD_PROJECT=your-project-id node migrate.mjs
// (Windows PowerShell:  $env:STORAGE="firestore"; $env:GOOGLE_CLOUD_PROJECT="your-project-id"; node migrate.mjs)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./engine/db.js";
import { importLegacy } from "./engine/legacy-import.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, "data");
if (String(process.env.STORAGE || "").toLowerCase() !== "firestore") {
  console.error('Set STORAGE=firestore first (and GOOGLE_CLOUD_PROJECT=<your project id>). Nothing was changed.');
  process.exit(1);
}
const db = await openDb({ dataDir });
const force = process.argv.includes("--force");
const r = await importLegacy(db, { dataDir, root: here, force, log: console.log });
if (r.skipped) console.log("Already imported earlier. Run with --force to check again (existing documents are never overwritten).");
else console.log("Done.");
