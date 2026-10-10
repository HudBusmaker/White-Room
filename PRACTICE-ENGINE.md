# Practice engine (White Room pack, integrated)

Students open **Practice**, get a short set built for them, type answers step by step, and the server marks it
in code. Strength per topic and per skill moves with their score and decides what comes next.
Everything is plain Node with no new server dependencies. KaTeX and marked are vendored in `public/vendor/`
and only download when a student opens Practice.

## Where things are
| Path | What |
|---|---|
| `bank/questions/<subject>.json` | The question bank (answers live here, never in `public/`) |
| `bank/notes.json` | One short reading note per topic |
| `bank/objectives/*.md` | The pack's subject objectives. Their "Marking" section is added to photo-marking prompts |
| `bank/reference/` | `sample-correction.md` (target format of AI corrections) and `pool.json` (ARISE daily templates, **not used**) |
| `engine/topics.json` `skills.json` | 29 syllabus topics (from `gce.json`) and the recurring skills the bank drills |
| `engine/config.json` | All thresholds (see below) |
| `engine/select.js` | Which subject/topic/question next; spacing; compounding |
| `engine/mark.js` | Typed marking with method marks |
| `engine/practice.js` `routes.js` | Sets, submit, XP, photo flow, HTTP routes |
| `engine/photo.js` | Photo-marking prompt and strict `SCORE: x/y` parser |
| `engine/schema.sql` | SQLite schema, **documented target only** (data is in `data/practice.json`) |
| `public/drill.js` `drill.css` `mathmd.js` | The Practice screen |

## The rules (from the pack)
- **Selection** (ported from ARISE): the subject with the most never-touched topics goes first, then the weakest; inside a
  subject, never-seen topics, then lowest strength, then earliest due. Ties rotate by day. Shared Pure topics count for
  both Maths and Further Maths. Only topics that have questions count, so a subject is not "needy" for topics that cannot be drilled yet.
- **Compounding**: each set folds in one weak or overdue skill the student has already met, from a topic not already in the set.
- **Strength by score** (`config.json`): set score >= `riseAt` (80%) goes up 1; below `fallBelow` (50%) goes down 1; otherwise unchanged.
- **Spacing**: next due = today + `[1, 3, 7, 16, 35, 90]` days by the new strength.
- **Reading note first** when a topic in the set is at strength 0.
- **Cleared only by a submission.** There is no "done" button. A question left completely blank is not an attempt.
- **Method marks**: a step can list `partial` answers (a known near-miss) that earn some marks and show a note.
- **Photo marking**: an AI drafts a Markdown correction whose first line is `SCORE: x/y`. No parseable score means "unmarked, retry".
  The draft goes to Head Staff in **Marking Review**. The student sees nothing until Head Staff release it, and mastery and XP
  move only from the **released** mark.

## Choices I made that you may want to change
1. **Storage is JSON** (`data/practice.json`), not SQLite, because the v3 handoff says "no database, no dependencies". The same
   shape is in `engine/schema.sql`. Say the word and I will switch the store (it is one small file, `engine/store.js`).
2. **XP**: 1 per mark, paid **once per question per student**, max 60 a day (`xpPerMark`, `dailyXpCap`; set `xpPerMark` to 0 to switch it off).
   Repeats still train mastery but pay nothing. This is a placeholder for the Phase 3 earning rules, which are still yours to decide.
3. **A rise in strength needs the topic to be due** (`riseOnlyWhenDue`), so repeating a topic the same day cannot farm strength.
4. **Set size is 4** (3 + 1 compound). The pack's example used more; 4 suits a phone and a short sitting.
5. Typed answers ignore units (a number with the wrong unit still gets the marks); wrong units are not checked.

## Adding questions
Read `QUESTION-GENERATOR-PROMPT.md`, put the new questions in `bank/questions/<subject>.json`, then run `npm run validate`.
The validator refuses a question with no topic or skill, a wrong total, an MCQ wrong option without its trap, an unmatched `$`, and more.
At server start, invalid questions are not served and a warning is printed.
Each topic needs a note in `bank/notes.json`. Two topics have no questions yet: **cs-db** and **cs-prog**.

## Commands
`npm run validate` (bank + lessons + quests) · `npm run test:engine` (90 checks, no server) · `npm run test:smoke` (59 checks, real server in a throwaway copy)
