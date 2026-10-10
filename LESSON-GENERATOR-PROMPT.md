# Lesson-notes generator prompt (AI-assisted authoring)

Copy this into Gemini (or any assistant). Replace the bracketed request. Save each reply as a `.json` lesson file. To prepare a staff upload, ZIP the new lesson files together with an `index.json` containing their manifest entries, then use the staff **Lesson Publisher** to check and download a deployment patch. Extract the patch into the project, run `npm run validate`, then deploy with the existing Firebase workflow. See HOW-TO-ADD-A-LESSON.md for the ZIP structure and details. The repository validator rebuilds every note 300 times with random numbers and catches mistakes.

```text
You are writing short hands-on revision notes for White Room. Topic, level and any source material:

[INSERT TOPIC, CURRICULUM LEVEL, AND ANY SOURCE QUESTION OR NOTES]

Return only valid JSON for one lesson file (no Markdown fences, no comments, no trailing commas).

WHAT A LESSON IS
- A SUMMARY of the topic (2 to 4 sentences, plain statements, never a question) followed by 3 to 5 SHORT NOTES.
- Each note: a title, a short explanation (70 words or fewer) that ends with a worked Example, then 1 or 2 tasks.
- Notes are simple and practical. One idea per note. No long theory.

EXAMPLES MUST BE RANDOM, NOT STATIC
- Never hard-code the numbers of an example or task. Declare them in "gen" and write {name} where they appear.
- Compute every answer from the variables. Never type an answer you worked out yourself.
- The worked example in "text" and the student's task must use DIFFERENT variables, so the example never gives away the task.
- Multiple-choice options are shuffled by the app, so put the right answer first in the file ("a": 0). Every option must stay different for every random draw; use "where" to forbid collisions.

SCHEMA
{
  "id": "short-kebab-case-id", "title": "...", "level": "...", "subject": "...", "topic": "...", "source": "Practice notes",
  "summary": "Statement summary of the topic. HTML allowed.",
  "notes": [
    {
      "title": "Short note title",
      "text": "Explanation with <span class=\"note-formula\">formula</span>. Example: with {a} and {b} ... gives {a+b}.",
      "hint": "One useful nudge",
      "gen":   { "a": [2, 9], "b": [1, 5], "c": [2, 9] },
      "calc":  { "s": "a + b", "t": "c + b" },
      "where": "(a != c)",
      "tasks": [
        { "t": "mc", "m": 1, "q": "Question using {c}", "o": ["{t}", "{t+1}", "{c}", "{2*t}"], "a": 0,
          "why": ["Why right", "Why wrong", "Why wrong", "Why wrong"] },
        { "t": "num", "m": 1, "q": "Find x ...", "f": [ { "l": "x", "v": "t" } ],
          "fb": { "{c}": "Feedback if they enter {c}" }, "ex": "Correct working using {c}, {b}, {t}." }
      ],
      "working": [ "Short lines shown after the note, using the same variables" ]
    }
  ],
  "exercises": [ optional extra tasks in the same task format, each with its own gen/calc/where ]
}

TEMPLATE RULES
- {expr} prints a number; {expr|s} prints a signed number ("+ 3" or "− 3") so you can write  x {b|s}  correctly for negative b.
- Expressions allow + - * / %  comparisons (== != < > <= >=)  and floor ceil round abs sqrt min max pow gcd mod inv sgn.
- "where" is true when non-zero. Combine with multiplication: (a != 0)*(b > a). It rejects bad random draws.
- "v" in number tasks is an expression string such as "a*b" (no braces). In "fb", keys are wrong answers joined with commas, written with braces, e.g. "{p},{-q}".
- All answers must come out as whole numbers or simple decimals (2 d.p. at most). Avoid divisions that do not come out exact unless "where" forces exactness.

STYLE
- Accurate maths for the stated level, correct terminology, no incorrect shortcuts. Give feedback for EVERY multiple-choice option and target plausible mistakes without shaming.
- Colour classes, used for meaning only: <span class="note-formula"> green for formulas, <span class="note-definition"> yellow for definitions, <span class="note-topic"> red for topic names or key ideas. Variables as <i>x</i>, powers with <sup>2</sup> or ², key equations in <span class="eq">...</span>.
- Escape quotation marks inside JSON strings. Do not invent references.
- Before you answer, check your own maths by substituting two different random draws into every task.
```
