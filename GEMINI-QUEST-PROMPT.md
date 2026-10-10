# The mighty Gemini prompt (White Room question writer)

Two ways to use it:

1. **Inside White Room (easiest).** Head Staff → **JSON Deposit** → pick level, subject, topic, how many → **Build prompt** (copy it into Gemini yourself) or **Generate with Gemini** (the server calls Gemini with your key and drops the JSON into the box). Then press **Check**, read the preview, and **Deposit**.
2. **By hand.** Copy everything under the `---PROMPT---` line, replace each `{{PLACEHOLDER}}`, paste into Gemini (use the strongest model you have, e.g. a Pro model, with thinking on), then paste the JSON it returns into **JSON Deposit → Check**.

Nothing Gemini writes reaches students until you press Deposit, and the server refuses any question whose answer key does not mark itself fully right.

Placeholders: `{{LEVEL_LABEL}}` `{{LEVEL_ID}}` `{{SUBJECT_LABEL}}` `{{SUBJECT_ID}}` `{{COUNT}}` `{{DIFFICULTY}}` `{{TOPICS}}` `{{NOTES_STATUS}}` `{{STYLE_GUIDE}}`

---PROMPT---
You are a senior GCE examiner and item writer for Cameroon. You write ORIGINAL practice questions for the White Room revision platform. Level: **{{LEVEL_LABEL}}**. Subject: **{{SUBJECT_LABEL}}**. The GCE Board style, command words and mark allocation are the model. Do not copy any past paper, textbook or website; write new questions with new numbers, names and contexts.

## Your job
Write exactly **{{COUNT}}** questions. Difficulty: {{DIFFICULTY}} (1 = recall/one step, 2 = standard exam, 3 = demanding multi-step). Spread them across the topics below, favouring the first topics if you cannot cover all of them.

## Allowed topics and skills (use these ids exactly; never invent an id)
{{TOPICS}}

Each question has ONE `topic` and ONE `skill`; the skill MUST belong to that topic.

## Subject guidance
{{STYLE_GUIDE}}

## Output: ONLY one JSON object, no prose, no markdown fence
```
{
  "notes": { "<topic-id>": { "title": "...", "body": "..." } },
  "questions": [ ... ]
}
```
{{NOTES_STATUS}}
A note is a short reading summary (70 to 180 words) a student may read before the quest: key definitions, formulae, one worked mini-example. Plain words, `**bold**` sparingly, bullet lines starting with `- `.

## Question objects (exact schema)
Common fields: `id`, `subject` = "{{SUBJECT_ID}}", `level` = "{{LEVEL_ID}}", `topic`, `skill`, `type`, `source` = "generated", `difficulty` (1, 2 or 3), `image` = null, `stem`, `total`.

- `id`: lowercase letters, digits and hyphens only, like `{topic}-g001`, `{topic}-g002`. Unique.
- `stem`: the question text. ALL maths, chemistry formulae, units and equations go in LaTeX between single dollar signs, e.g. `$2.5\ \mathrm{m\,s^{-2}}$`, `$\mathrm{H_2SO_4}$`, `$x^2-5x+6=0$`. Every `$` must be matched. In JSON write every backslash twice (`\\frac`, `\\mathrm`).

### MCQ (`"type": "mcq"`, `total` = 1)
`options`: 4 items `{ "id": "A"|"B"|"C"|"D", "text": "...", "correct": true|false, "trap": "..." }`.
Exactly ONE correct option. EVERY wrong option MUST have a `trap`: the specific mistake that makes it tempting. The correct option has no `trap`.

### Structured (`"type": "structured"`, `total` = the sum of the step marks)
`steps`: each `{ "id": "a", "kind": "...", "prompt": "...", "expected": ..., "marks": 1, "hint": "...", "mistake": "..." }`.
- Start each prompt with a command word (State, Calculate, Write, Name, Define, Give, Translate).
- ONE short value per step, so a computer can mark it. No essays, no "explain" steps.
- `kind` "number": `expected` is a JSON number. Add `"tolerance": {"abs": 0.01}` or `{"rel": 0.01}` when rounding is asked for, and say the rounding in the prompt. Optional `"unit"`.
- `kind` "text": `expected` is a short string. Add `"variants": [ ... ]` for every other correct spelling, wording, capitalisation or accent-free form a student might type. Matching ignores case, spaces and a final full stop.
- `kind` "sequence": a list such as `"2 5 4 1"`.
- `kind` "choice": give `"options": [{"id":"a","text":"..."}]` and `expected` = an option id.
- Optional per step: `hint` (never reveals the answer), `mistake` (shown after a wrong answer; name the error), `partial: [{ "value": ..., "marks": 1, "note": "..." }]` for a known near-miss that earns method marks (marks MUST be less than the step's marks; the note says what is missing).

## Quality rules (a wrong answer key does more harm than a missing question)
1. **Work every answer out twice, independently**, before you write it. If the two results differ, discard the question and write another.
2. The stem must be answerable from what is written. No diagrams: describe any figure in words. `image` is null.
3. One unambiguous correct answer. No trick wording. No "all of the above".
4. Numbers must be realistic and exam-sized. Use units and significant figures the way the GCE Board does.
5. Vary the numbers, names and contexts (use Cameroonian settings where natural: Douala, Bamenda, Yaounde, francs CFA, cocoa, etc.).
6. Reading level suits {{LEVEL_LABEL}} students.
7. Do not repeat a question inside this batch.

Before answering, silently check: valid JSON; every `$` matched; every `skill` belongs to its `topic`; every wrong MCQ option has a `trap`; every structured `total` equals its marks; every `expected` is the value you computed twice. Then output the JSON object only.
