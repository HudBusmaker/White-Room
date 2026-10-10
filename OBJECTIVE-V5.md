# White Room v5: objective

**Goal.** Every student picks a level and the subjects they offer. Daily quests, Practice and the Record follow that choice. Head Staff can feed the bank with Gemini-written questions through a checked JSON Deposit. Every completed task, with its score, is kept in a Record.

## Levels and subjects (single source: `engine/subjects.json`)
- **A Level:** Chemistry, Mathematics, Further Maths, Computer Science, ICT, Physics.
- **Form 5:** Chemistry, Mathematics, Additional Mathematics, French, Physics, Computer Science, English Language, Economics.

## Rules to preserve
1. Students never receive answers, traps, partial-credit rules or marking notes. Marking stays on the server.
2. Nothing Gemini writes reaches students until Head Staff press Deposit. The server refuses any question whose answer key does not mark itself fully right.
3. One daily quest per (level, subject) per day, shared by every student who offers it. One submission per student per quest.
4. Questions without a `level` are A Level. Form 5 questions carry `"level": "form-5"` and use Form 5 topics (`engine/topics.json`, `levels`).
5. Never ship or share `.env`, `data/`, `backups/`.

## Phases (one at a time, to save credit)
| Phase | Scope | State |
|---|---|---|
| 1 | Subject catalog and pickers; daily quest per level and subject with maths rendering; JSON Deposit with Gemini prompt/generate; Record (student + staff + CSV); Practice scoped to level and subjects | **DONE, tested** |
| 2 | **Gemini forge for your OCR chemistry set:** a button in Question Bank Review that sends a staff-approved candidate (and its photo) to Gemini, gets structured JSON with an answer key, and drops it into the Deposit check. Needs the `gce-photos*` folders back in the project | next |
| 3 | Fill the gaps with Generate: ICT, Form 5 (all eight subjects), Further Maths, Computer topics `cs-db`, `cs-prog`. Staff read every preview. Review the reading notes Gemini writes | after 2 |
| 4 | AI daily quests: generate and deposit new questions on a schedule, with a daily cost cap and a staff approval switch | after 3 |
| 5 | Record upgrades: per-student drill-down, charts, back-fill of old practice and lesson history, XP economy decision | after 4 |

## Done when (phase 1)
Verified: `npm run validate`, `npm run test:engine` (90), `npm run test:v5` (33), `npm run test:smoke` (113), plus a real Chromium run through registration, quests, Record, Deposit, planner, Question Bank Review and a 390 px phone view.
