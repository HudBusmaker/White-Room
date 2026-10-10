# White Room handoff: v4 addendum (9 October 2026)

Adds to v3 (8 October). Everything in v3 section 7 ("Decisions to preserve") still holds.

## What changed
The **white-room-pack** (ARISE engine excerpts, topic list, objectives, sample correction) is now built into the project as a **Practice** module.
See `PRACTICE-ENGINE.md`. New: `engine/`, `bank/`, `public/drill.js` + `drill.css` + `mathmd.js`, `public/vendor/` (KaTeX, marked),
`tests/engine.mjs`. Small edits to `server.js`, `marking.js`, `app.js`, `staff.js`, `index.html`, `validate.mjs`, `package.json`.

| Area | State | Evidence |
|---|---|---|
| Question bank (30 questions, 27 reading notes, 5 subjects) | TESTED | validator PASS; every answer key re-computed independently and marks itself full; wrong MCQ options each store their trap |
| Selection, strength by score, spacing, compounding | TESTED | `npm run test:engine`: 90 checks including the threshold boundaries |
| Typed marking with method marks | TESTED | engine tests + 17 real-browser checks |
| Server routes and Head Staff release hook | TESTED | `npm run test:smoke`: 59 checks (was 40) |
| Phone layout of Practice | PARTLY | Chromium at 360 px: no horizontal overflow, set and results readable. No real Android phone |
| Photo marking by AI | NOT TESTED WITH A REAL MODEL | prompt, parser, queueing and release are tested with a stub. The real Gemini call was never run (no key, no network in the build sandbox) |

## Open items (new)
1. **Bank is small**: 30 questions, 1 to 2 per topic. `cs-db` and `cs-prog` have none. Use `QUESTION-GENERATOR-PROMPT.md`, then hand-check.
2. **XP economy** for practice is a placeholder (1 per mark, once per question, 60 a day). Decide in Phase 3.
3. Typed answers do not check units.
4. Storage is JSON; `engine/schema.sql` is the migration target if you want SQLite.
5. `bank/reference/pool.json` (ARISE daily-quest templates) is kept for reference but not used.
6. **Secrets**: the RAR you shared again contained `.env` and `data/`. Replace the Gemini key, Head Staff code and teacher PIN, and retire old admission keys, before anything else.
