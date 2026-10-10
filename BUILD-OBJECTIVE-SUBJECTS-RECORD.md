# Build Objective — Subjects + Life Quest + Record (9–10 Oct 2026)

## Goal
Wire **Life Quest** (shared Daily Quests) so each student only receives quests for the subjects they offer, add a durable **Record** of every completed task with scores, and keep changes small and reviewable.

## Scope of this build (Task slice 1)
1. **Subject catalogue by level**
   - A Level: Chemistry, Maths, Further Maths, Computer, ICT, Physics
   - Form 5: Chemistry, Maths, Additional Maths, French, Physics, Computer, English, Economics
2. **Student subjects field** — chosen at registration (multi-select). Stored on the user. Editable later from Profile if needed.
3. **Life Quest filter** — `listForStudent` only returns daily quests whose subject is in the student’s `subjects[]`.
4. **Record store** — `data/records.json` holds every completed task (daily quest, practice set, lesson, photo quest) with score, max, XP, subject, day, source.
5. **Record UI** — student nav item **Record**: list of completed tasks with scores at the side.
6. **Deposit path** — on daily-quest submit (and later practice), append a record entry (functional JSON deposit).

## Out of scope for this slice (later tasks)
- Gemini inventing brand-new daily questions (keep curated bank selector).
- Full Form 5 / language question banks (French, English, Economics).
- SQLite migration.
- Editing subjects after register (can be Task 2 if needed).

## Subject ID map (canonical → bank)
| UI label           | level     | id                 | bank file              |
|--------------------|-----------|--------------------|------------------------|
| Chemistry          | both      | chemistry          | chemistry.json         |
| Maths              | both      | maths              | maths.json             |
| Further Maths      | A Level   | further-maths      | further-maths.json     |
| Additional Maths   | Form 5    | additional-maths   | (alias → further-maths until bank exists) |
| Computer           | both      | computer-science   | computer-science.json  |
| ICT                | A Level   | ict                | (alias → computer-science) |
| Physics            | both      | physics            | physics.json           |
| French             | Form 5    | french             | none yet               |
| English            | Form 5    | english            | none yet               |
| Economics          | Form 5    | economics          | none yet               |

Students may select subjects with no bank yet; Life Quest simply has nothing for those until questions exist.

## Files touched (this slice)
- `auth.js` — subjects on register + publicUser
- `engine/subjects.js` — **new** catalogue + helpers
- `engine/daily-quests.js` — filter by student subjects; deposit record on submit
- `engine/records.js` — **new** JSON deposit store
- `server.js` — `/api/records`, subject list endpoint, wire deposit
- `public/index.html` — subject multi-select on register; Record view + nav
- `public/app.js` — send subjects on register; show subjects on profile
- `public/record.js` — **new** Record page
- `public/daily-quest.js` — minor if needed
- `data/records.json` — initial empty store
- `BUILD-STATE-SUBJECTS-RECORD.md` — this build’s state
- `BUILD-OBJECTIVE-SUBJECTS-RECORD.md` — this file

## Success checks
- Register with level + 2–3 subjects → user.subjects populated.
- Life Quest list only shows those subjects’ daily quests.
- Submit a daily quest → entry appears in `data/records.json` and on Record page with score.
- Staff daily planner unchanged.
- `npm run validate` / smoke still pass for existing paths.
