# How to add a lesson (notes) to White Room

A lesson is a **summary** plus a few **short, hands-on notes**. Each note has a worked example and one or two
tasks. Numbers are random every time a student opens a note, answers are computed from them, and
multiple-choice options are shuffled, so the right answer is never always first.

Lessons **expire 10 days after their `release` time**. After that they disappear from the list, the file
returns "410 expired", and no XP can be earned. The server enforces this (not just the screen).

## 1. Add the file
Make `public/content/lessons/my-notes.json` (copy `locus-circle.json`).

## 2. Register it in `public/content/lessons/index.json`

    { "id": "my-notes", "file": "my-notes.json", "title": "Quadratics", "subject": "Pure Mathematics",
      "level": "Form 5", "release": "2026-10-09T17:00:00+01:00", "daily": "2026-10-09" }

- `release` (required): when it opens. Before it: shown as Scheduled, file locked.
  Open for 10 days, then expired. To keep a note longer, move `release` later.
- `daily` (optional, YYYY-MM-DD): makes it that day's Daily Quest.
- Refresh the browser. No restart.
- Run `npm run validate` and `npm run test:smoke` before sharing.

## 3. The lesson file

    { "id", "title", "level", "subject", "topic", "source",
      "summary": "2 to 4 sentences summarising the topic (statement, not a question)",
      "notes":     [ 3 to 5 notes ],
      "exercises": [ optional practice tasks, no XP ] }

## A note

    { "title": "Complete the square",
      "text":  "Short explanation (70 words or fewer) ending with an Example using the numbers below.",
      "points": [ "optional short bullet" ],
      "hint":  "Shown by the Hint button",
      "gen":   { "a": [2, 9], "b": [1, 5] },          // random whole numbers (inclusive range)
      "calc":  { "c": "a*a + b" },                     // derived values, evaluated in order
      "where": "a != b",                               // keep only combinations where this is true
      "tasks": [ 1 or 2 tasks ],
      "working": [ "lines written into the solution panel after the note" ] }

Everything in `{…}` is filled in: `{a}` a number, `{c}` a computed value, `{b|s}` a signed number ("+ 3" or "− 3").
Allowed in expressions: `+ - * / %`, comparisons (`==, !=, <, >`), and `floor ceil round abs sqrt min max pow gcd mod inv sgn`.
`where` is true when non-zero; multiply conditions: `(a!=0)*(b>a)`. Negative numbers print with a proper minus sign.

## A task
Multiple choice (put the right answer FIRST in the file; the app shuffles it):

    { "t": "mc", "m": 1, "q": "Question using {a}",
      "o": [ "{c}", "{c+1}", "{a}", "{2*c}" ],   // options must differ for every random draw
      "a": 0,                                    // index of the right one in this list
      "why": [ "why 1st is right", "why 2nd is wrong", "...", "..." ] }   // one line per option

Number entry (`v` is an expression, not text with braces):

    { "t": "num", "m": 1, "q": "Find x for {a}x = {c}.",
      "f": [ { "l": "x", "v": "c/a" } ],
      "fb": { "{a}": "Specific feedback if they type {a}" },   // keys are the wrong answers, joined with commas
      "ex": "Shown when they are right." }

## Rules the validator checks (300 random builds per note)
- No `{ }` left unfilled; every number finite; options never repeat; the right answer really moves around.
- `summary` must not end in a question mark; old `question`/`blocks` files are rejected.
- Notes over about 90 words give a warning. Keep them short.

## Colours inside note text
`<span class="note-formula">…</span>` green, `<span class="note-definition">…</span>` yellow highlight,
`<span class="note-topic">…</span>` red. Wrap maths in `<span class="eq">…</span>`.

AI-assisted authoring: use [LESSON-GENERATOR-PROMPT.md](./LESSON-GENERATOR-PROMPT.md).

## Prepare a staff deployment ZIP

The staff **Lesson Publisher** accepts either of these ZIP layouts:

    new-lessons.zip
      index.json
      alkenes.json
      benzene.json

For the standard notes format, `index.json` must have a `lessons` array with one manifest entry per new file. The manifest should contain only the new entries, not a copy of the existing live lessons. A containing folder inside the ZIP is fine.

Section-based revision documents can instead be uploaded directly, with the SVG files they reference:

    chemistry-notes.zip
      organic_exam_notes.json
      physical_exam_notes.json
      benzene-hydrogenation-energy-levels.svg
      born-haber-cycle-nacl.svg
      ...

For this layout, `index.json` is inferred from each complete document. Set the release date and time in the staff page before preparing the patch. The lesson viewer supports the section/block format in the schema-specific JSON files.

The browser checks the manifest or section documents, referenced figure files, lesson fields, and generated tasks, then reads the live lesson index and merges the new entries into it. IDs and file names must not already exist. It downloads a patch ZIP containing the merged `public/content/lessons/index.json`, lesson files, and any referenced SVG figures. ZIP uploads are limited to 15 MB, 100 files, 2 MB per file, and 10 MB expanded content.

This is a **manual deployment workflow**: the page does not call Gemini, modify Firebase, or publish files. Extract the downloaded patch into the project root, run `npm run validate`, and deploy through the project's existing Firebase process. The staff check is an early validation only; the repository validator is the final check.
