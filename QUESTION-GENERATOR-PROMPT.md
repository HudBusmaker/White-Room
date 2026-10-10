# Prompt: write practice questions for White Room

Paste everything below the line into an AI session, with the topic list (`engine/topics.json`) and skill list (`engine/skills.json`).
Then paste its output into `bank/questions/<subject>.json` and run `npm run validate`. **Check every answer by hand** before it goes live.

---

You are writing exam-style practice questions for GCE A-Level students in Cameroon (Computer Science 0795, Maths, Further Maths, Physics, Chemistry).

Return ONLY JSON: an array of question objects. Rules:

1. Every question has `topic` (a topic id) and `skill` (a skill id whose `topic` is the same). Do not invent ids. If a skill is missing, say so instead.
2. `id` = `<topic>-NNN`, lowercase, digits and hyphens only. `source` = "generated". `difficulty` = 1, 2 or 3. `image` = null.
3. Text uses plain words with LaTeX in `$...$` for ALL maths (units too: `$2.5\ \mathrm{m\,s^{-2}}$`). Use `**bold**` sparingly. Every `$` must be matched.
4. **MCQ**: `type` "mcq", `total` 1, four `options` `{id:"A"..."D", text, correct:true|false, trap}`. Exactly one correct. EVERY wrong option needs a `trap`: the specific mistake that makes it tempting.
5. **Structured**: `type` "structured", `steps` of `{id:"a", kind, prompt, expected, marks}` and `total` = sum of step marks. Lead each prompt with an instruction word (State, Calculate, Write, Name). Ask for **one short value per step**.
   - `kind` "number": `expected` is a number. Add `tolerance: {abs:0.01}` or `{rel:0.01}` when rounding is asked for, and say the rounding in the prompt. Optional `unit`.
   - `kind` "text": `expected` string; add `variants: [...]` for other accepted spellings. Binary/hex are compared ignoring spaces and case.
   - `kind` "sequence": a list such as an array after a sort pass, `expected` "2 5 4 1".
   - `kind` "choice": give `options: [{id,text}]` and `expected` = an option id.
   - Optional per step: `hint` (never give the answer away), `mistake` (shown after a wrong answer: name the error), `partial: [{value, marks, note}]` for a known near-miss that earns method marks (marks must be less than the step's marks; the note says what is missing).
6. Use the pack's style: numbers change but the SKILL repeats. Past-paper-style wording, full working expected, method marks for multi-mark steps.
7. Make the numbers different from the existing bank, and **work every answer out twice**. A wrong answer key does more harm than a missing question.
