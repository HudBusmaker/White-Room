# White Room build state: v5, phase 1 (10 October 2026)

## What now works
- **Level and subjects.** Registration has a level choice and a subject checklist that follows the level. Profile has "My level and subjects" (Save). The Daily Quest page asks existing students (no subjects yet) to choose before showing quests.
- **Daily quests** are per (level, subject). A student sees only their own. Submit is refused for a quest outside the student's level and subjects. Maths and chemistry notation is typeset (KaTeX). After submitting, the student sees marks per question and the "what went wrong" note for wrong steps (never the answer). Subjects with no questions at that level show "no quest yet".
- **Exam mode** topics are now set per level and subject in the planner (14 groups). A group with no topics ticked gets no quest in exam mode.
- **JSON Deposit** (Head Staff → JSON Deposit): coverage table; choose level, subject, topic, count; **Generate with Gemini** or **Build the prompt only**; paste or upload JSON; **Check** shows each question typeset with its answer key and traps; tick the box and **Deposit**. Live at once, no restart. Each deposit is its own file `bank/questions/deposit-<batch>.json`; **Withdraw** removes a single deposited question. The curated bank cannot be withdrawn from here.
- **Checks the server runs on every deposit:** valid JSON (code fences and chatter tolerated), the bank validator, the answer key marks itself full, wrong MCQ options score 0 and carry a trap, topic belongs to the level, subject offered at that level, reading note present. Safe repairs are reported (missing level or total; a colliding id is renamed).
- **Record.** Student: Record tab with totals, average, by-subject summary, filters. Head Staff: Records with search, type, subject and level filters, and CSV download. Written when a daily quest is submitted, a practice set is submitted, a practice photo mark is released, a lesson is first completed, or a marked quest is released. Daily-quest results already in `data/daily-quests.json` are back-filled at start.
- **Practice** shows only the level and subjects the student chose.

## Files
New: `engine/subjects.js`, `engine/subjects.json`, `engine/records.js`, `engine/deposit.js`, `public/subjects.js`, `public/record.js`, `public/deposit.js`, `GEMINI-QUEST-PROMPT.md`, `OBJECTIVE-V5.md`, `BUILD-STATE-V5.md`, `bank/deposit-samples/form5-maths-sample.json`, `tests/v5.mjs`.
Edited: `auth.js`, `server.js`, `engine/bank.js`, `engine/daily-quests.js`, `engine/practice.js`, `engine/routes.js`, `engine/topics.json`, `engine/skills.json`, `public/index.html`, `public/app.js`, `public/daily-quest.js`, `public/lessons.js`, `public/style.css`, `package.json`, `tests/engine.mjs`, `tests/smoke.mjs`.

## Bugs found and fixed on the way
- `public/lessons.js` threw on every page change (it wrote to the old quest card that the Daily Quest engine replaced, and read marks of a lesson not yet done). That stopped the Daily Quest page from loading when you navigated to it.
- Daily quest `max` now counts every question in the quest, so skipping a question lowers the score.

## Honest limits
- **Gemini was never called for real** (no key or network here). The prompt, the call path and the checks are tested with a stub. Your first real Generate is the live test.
- **Your chemistry OCR set (129 candidates) is not in the live bank.** It has no answer keys and the source photos are not in the archive. Phase 2 turns it into questions.
- The live bank is still small: A Level 30 questions, **Form 5 and ICT none** except the 5-question maths sample in `bank/deposit-samples/` (deposit it to see Form 5 live). Use Generate for the rest (phase 3).
- A student who has not chosen subjects yet sees everything in Practice until they choose.
- No real phone; checked in Chromium at 390 px.

## Do before going live
1. Replace the Gemini key, `HEAD_STAFF_CODE` and `TEACHER_PIN` (they were in earlier archives), and retire old admission keys.
2. Delete `public/index.html.pre-anime2` and `public/style.css.pre-anime2` (they are served to browsers).
3. After the update, existing students choose their subjects once (Daily Quest page or Profile).

## Commands
`npm run validate` · `npm run test:engine` · `npm run test:v5` · `npm run test:smoke`

# Phase 2 (10 October 2026): ready for Firestore deploy (Cloud Run + Firestore)

## What changed
- **One storage layer** (`engine/db.js`): the same calls over JSON files (`STORAGE=file`, default, `data/db/`) or Firestore (`STORAGE=firestore`). Users, admission keys, daily quests and attempts, practice state, marking submissions, Record, **and deposited questions and notes** all go through it.
- **Signed login tokens** (`engine/tokens.js`) replace the in-memory sessions, so any Cloud Run copy accepts any login. Needs `SESSION_SECRET`. Logout now just forgets the token in the browser.
- **Race safety:** registering claims the admission key, the student number and the user in one transaction; a daily quest can only be submitted once (database `create`); XP awards cannot lose updates.
- **Deposited questions live in Firestore** and are loaded into each running copy (checked about every 15 s).
- `migrate.mjs` (`npm run migrate`) copies the old `data/` files into Firestore, safely repeatable. On your computer the first start imports old data files into `data/db/` automatically.
- Deploy kit: `Dockerfile`, `.dockerignore`, `firebase.json`, `firestore.rules` (deny all browsers), `firestore.indexes.json`, `.firebaserc`, `DEPLOY-FIREBASE.md`.

## Tests
`npm run test:all`: db contract on both backends + tokens (41), accounts on fake Firestore (5), engine (90), v5 on both backends (60), smoke with a real server incl. restart (114).

## Honest limits
- The real `@google-cloud/firestore` library and the real Firestore were **not** run here (no network to install it). The Firestore adapter was tested against a faithful in-memory stand-in. **Run step 5 of `DEPLOY-FIREBASE.md` first.**
- Login-attempt limits are per running copy.
- Staff Records page reads up to 5,000 documents per open (free quota 50,000/day).
- Docker build was not run here.

## Next (phase 3, your weekly exam workflow)
You give the topics and notes for the week's exam and a few past papers; I generate strategic question forms (the teacher chooses the topics), plus summary notes, through Generate and Deposit. Needs: the topics list per subject, the notes text, the past papers (photos or text).
