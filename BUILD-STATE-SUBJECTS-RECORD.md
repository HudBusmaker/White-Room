# Build State — Subjects + Life Quest filter + Record (10 Oct 2026)

## Done in this slice

### Subject selection
- New `engine/subjects.js` — catalogue for **A Level** and **Form 5** with bank id mapping (ICT → computer-science, Additional Maths → further-maths).
- Registration form: level is a select (`A level` / `Form 5`); multi-select subject chips load from `GET /api/subjects` for that level.
- `auth.js` stores `subjects[]` on the user; requires at least one subject. `publicUser` exposes `subjects` + `subjectLabels`.
- Existing demo student backfilled with A-level subjects.

### Life Quest (Daily Quest) wiring
- `listForStudent` maps student subject ids → bank ids via `bankSubjectsFor`, then filters published quests.
- Daily generator also covers **further-maths**.
- On successful submit, a row is deposited into the Record store.

### Record (functional JSON deposit)
- New `engine/records.js` + `data/records.json`.
- `GET /api/records` — authenticated student list (newest first, scores at the side).
- Student nav **Record** + `public/record.js` UI.
- Source labels: Life Quest / Practice / Lesson / Photo Quest (practice/lesson deposit can be wired in a later slice).

## Files changed / added
| Path | Change |
|------|--------|
| `engine/subjects.js` | **new** |
| `engine/records.js` | **new** |
| `data/records.json` | **new** |
| `data/users.json` | subjects backfill |
| `auth.js` | subjects on register + publicUser |
| `engine/daily-quests.js` | bankSubjectsFor filter + deposit on submit + further-maths |
| `server.js` | `/api/subjects`, `/api/records` |
| `public/index.html` | reg subjects, Record nav + section, record.js script |
| `public/app.js` | VIEWS, reg body subjects, profile subjects, catalogue loader |
| `public/record.js` | **new** |
| `public/style.css` | subject chips + record rows |
| `BUILD-OBJECTIVE-SUBJECTS-RECORD.md` | objective |
| `BUILD-STATE-SUBJECTS-RECORD.md` | this file |

## Verification
- Module load + `node --check` on touched JS: PASS.
- `depositRecord` / `listForStudent` smoke: PASS.
- Full `npm run test:smoke` / browser visual: not run in this environment (run on your machine).

## Next recommended slices (do one at a time)
1. **Practice deposit** — on practice set submit, also call `depositRecord`.
2. **Profile subject editor** — allow changing subjects after login.
3. **Gemini quest prompt** — use `QUESTION-GENERATOR-PROMPT.md` to grow the bank for Form 5 languages / economics (no bank yet).
4. **Question render check** — open Question Bank Review + Practice for chemistry questions you added and confirm KaTeX + steps mark correctly.
5. **Staff Record view** — list all students’ records for Head Staff.

## Mighty Gemini prompt (when you want new quest questions)
Use the existing `QUESTION-GENERATOR-PROMPT.md` as the base. Add:

```
Target subjects and levels for this batch:
- Form 5: Additional Maths, French, English, Economics (create bank files if missing)
- A Level: ICT (can share computer-science topics), any thin topics in chemistry/physics/maths

Output ONLY valid JSON matching the live bank schema in bank/questions/*.json
(structured or mcq with expected answers, marks, traps, units). Do not invent topics
outside engine/topics.json unless you also propose a topic id and name.
```

Hand-check every question before merging into `bank/questions/`.
