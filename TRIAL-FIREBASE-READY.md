# White Room — Trial of 10 + Firebase

## What this pack includes
1. **Chemistry test bank** expanded from your Organic + Physical exam notes (16 questions; was 3).
2. **10 one-time admission keys** in `data/TRIAL-10-KEYS.txt` (also stored unused in `data/admission-keys.json`).
3. Richer chemistry **reading notes** for Daily Quest summaries.
4. Extra chemistry **skills** so Practice can target Markovnikov, benzene, extraction, equilibrium, etc.

## Chemistry coverage (from your notes)
| Area | Question ids (examples) |
|------|-------------------------|
| Definitions / unsaturation | chem-organic-002, 003, 007 |
| Markovnikov / peroxide | chem-organic-004, 005 |
| Benzene substitution | chem-organic-006 |
| Naming (existing) | chem-organic-001 |
| Moles (existing + new) | chem-physical-001, 008 |
| Enthalpy / delocalisation | chem-physical-002 |
| Born–Haber / lattice | chem-physical-003 |
| Solvent extraction (K=4) | chem-physical-004 |
| Dynamic equilibrium | chem-physical-005 |
| Azeotropes | chem-physical-006 |
| Water phase diagram | chem-physical-007 |
| Halide test (existing) | chem-inorganic-001 |

`npm run validate` on this bank: **0 errors**.

## Trial of 10 — checklist before students arrive
1. Merge **all** prior slice RARs + this pack into one project folder.
2. Set a **new** `.env` (never reuse keys from shared RARs):
   ```
   HEAD_STAFF_CODE=choose-a-long-private-code
   TEACHER_PIN=optional-pin
   PORT=3000
   # Gemini key only if you use photo marking
   GEMINI_API_KEY=
   ```
3. `npm install` then `npm start` (or deploy — see Firebase below).
4. Log in as Head Staff → confirm **Daily Quest Planner** can generate chemistry.
5. Optionally generate today’s quests once.
6. Hand out the 10 keys from `data/TRIAL-10-KEYS.txt` (one each).
7. Students: New student → pick **A Level** or **Form 5** → select **Chemistry** (+ others) → register with key.
8. Smoke test one account: Daily Quest, Practice (Chemistry), Record, Profile subjects.

## Firebase hosting (important)
White Room is a **Node.js server** with private JSON under `data/` and `bank/`.  
**Firebase Hosting alone only serves static files** — it cannot run `server.js` as-is.

### Recommended pattern
| Piece | Where |
|-------|--------|
| Static UI (`public/`) | Firebase Hosting |
| API + marking + JSON data | **Cloud Run** (Docker) or **Cloud Functions (2nd gen)** or any Node host (Render, Railway, Fly.io) |

### Practical path for a 10-user trial (fastest)
1. Deploy the **full Node app** to **Cloud Run** (or Render free tier) with a persistent disk or Cloud Storage for `data/`.
2. Point a custom domain or use the Cloud Run URL.
3. Optionally put Firebase Hosting in front as a CDN that rewrites `/**` to Cloud Run.

### Minimal Cloud Run idea
- Dockerfile: `node` image, `npm ci --omit=dev`, `CMD ["node","server.js"]`
- Env vars: `HEAD_STAFF_CODE`, `PORT=8080` (Cloud Run sets PORT)
- Mount a volume or write `data/` to a bucket if the container filesystem is ephemeral

### Data you must not lose between deploys
- `data/users.json`
- `data/admission-keys.json`
- `data/records.json`
- `data/daily-quests.json`
- `data/practice.json`
- `data/submissions.jsonl`

### Security before any public URL
- Rotate `HEAD_STAFF_CODE` and any Gemini key.
- Delete or retire old admission keys from earlier shared archives.
- Keep `bank/` and `data/` **outside** any public static bucket.

## After the trial week
- Export `data/records.json` for scores.
- Head Staff → Records filter by student ID.
- Grow the bank with the Form 5 Gemini prompt when ready.

## Files in this pack
- `bank/questions/chemistry.json`
- `engine/skills.json`
- `bank/notes.json`
- `data/admission-keys.json`
- `data/TRIAL-10-KEYS.txt`
- `TRIAL-FIREBASE-READY.md` (this file)
