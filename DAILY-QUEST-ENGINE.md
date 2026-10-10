# White Room Daily Quest Engine

## Behaviour
- Head Staff chooses **General Practice** or **Exam Preparation** in `Staff → Daily Quest Planner`.
- In exam mode, staff selects the topic IDs to assess for each subject. A subject with no selected exam topic does not get an exam quest until staff selects topics.
- The server creates one shared quest per subject per calendar day from the private `bank/questions/` question bank. Every student offering that subject receives the same daily quest.
- Each quest includes the relevant topic summary notes before its questions. Students choose **Read summary** or **Skip summary**.
- Reading earns the standard XP multiplier; skipping earns a small additional XP bonus. The choice and score are stored with the attempt.
- Each quest remains available for seven days from its daily issue window. The student can see the current quest and still-active quests from the previous six days.
- Each student may submit a given daily quest once. Answers are marked server-side using the existing practice engine's marking function; expected answers and marking rules are never sent to the browser.
- XP is awarded after a valid submission. Existing rank/progression logic consumes that XP.
- Daily generation is lazy: the first daily-quest API access or staff generation action on a date creates that day's shared quests. No background scheduler is required for the server to stay running overnight.

## API
- `GET /api/daily-quests` — authenticated student list.
- `POST /api/daily-quests/submit` — authenticated student attempt.
- `GET /api/staff/daily-quests` — Head Staff settings and published-quest list.
- `POST /api/staff/daily-quests/settings` — set mode, question count and per-subject exam topics.
- `POST /api/staff/daily-quests/generate` — explicitly generate today's quests.

## Current boundary
Daily quest generation currently selects/rotates questions from the validated, curated bank. It does **not** yet call Gemini to invent a new question every day. This keeps answer keys and marking logic private and makes the engine usable before the question-generation service is connected. The AI dataset/question-generation service can later replace the selector while keeping the same publication, seven-day availability, submission and XP flow.

## Data
Settings, published daily quest snapshots and per-student attempts are stored in `data/daily-quests.json`, outside `public/`. Back up this file with the other project data.
