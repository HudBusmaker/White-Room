# White Room Build State — 9 October 2026

## Added: Shared Daily Quest Engine

- New `engine/daily-quests.js` service reuses the validated private question bank and existing deterministic marking logic.
- New `public/daily-quest.js` student UI displays daily quests, summary notes, read/skip choice, answer forms, scores and XP.
- New Staff → Daily Quest Planner lets Head Staff choose General Practice or Exam Preparation, select exam topics per subject, choose 1–5 questions per quest, save the plan, generate today's quests and review published quests.
- Every day, the first student quest request or a staff generation action creates the shared daily quest for each eligible subject. The same published question set is shown to all students offered that subject.
- Quests are available for seven days. Students can see still-active quests from the last seven-day window.
- Every quest includes its associated topic summary notes. Read gives standard XP; Skip gives an extra XP bonus.
- Student answers are marked on the server. A student can submit each daily quest only once. Expected answers and marking rules are not sent to the browser.
- Settings, quest snapshots and attempts persist in `data/daily-quests.json`, outside `public/`.
- API endpoints are documented in `DAILY-QUEST-ENGINE.md`.

## Important current boundary

Daily quests currently rotate through the existing curated question bank. They do not yet ask Gemini to invent brand-new questions daily. The service is designed so an AI question-generation provider can be added later without replacing publication, expiry, submission, marking or XP logic.

## Verification

- `npm run validate` — PASS (bank, lesson content and structured quests).
- `npm run test:engine` — PASS (90 checks).
- `npm run test:smoke` — PASS (71 checks, including daily quest authorization, configuration, publishing, notes, submission and duplicate-submission protection).
- JavaScript syntax checks — PASS.
- Real browser/device visual verification — not performed in this build environment.
