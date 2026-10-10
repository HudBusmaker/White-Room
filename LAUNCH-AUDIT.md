# White Room — Launch audit (9 Oct 2026 evening)

## Critical bug fixed in this pack
**Profile / register showed no subject chips** (“Select at least one subject” with empty grid).

**Cause:** `GET /api/subjects` and `POST /api/me/subjects` lived in `authRoute`, but the main server only dispatched:
`/api/auth/*`, exact `/api/me`, `/api/rankings` — so the subject APIs never ran.

**Fix:**
- Route gate now includes `/api/subjects` and `/api/me*`
- Client embeds a fallback subject catalogue if the API still fails

## What is ready for a 10-user trial
| Area | Status |
|------|--------|
| Login / admission keys / register | Ready |
| Subject pick (register + profile) | **Fixed** |
| Daily Quest (Life Quest) list + submit + KaTeX | Ready |
| Staff Daily Quest Planner (mode + exam topics) | Ready — set **Exam preparation** + tick topics |
| Practice engine + mastery (proficiency) | Ready (strength 0–5 per topic/skill) |
| Record (student + staff) | Ready |
| Chemistry bank from notes | Ready (16 Q) |
| Maths exam topics (limits, continuity, diff, int, circles) | **Topics + seed questions added** |
| Physics topics in engine | Ready (mechanics, waves, fields, thermal, modern) — bank still thin |
| Photo marking + Gemini | Code path exists; needs real `GEMINI_API_KEY` + test |
| Compete / competitions | UI shell only — not primary for exam week |
| French / English / Economics bank | No questions yet |

## Exam week workflow (what you asked for)
1. Head Staff → **Daily Quest Planner**
2. Mode: **Exam preparation**
3. Tick **only** the topics in focus (e.g. pure-limits, pure-circles, phy-mechanics, chem-organic…)
4. Set questions per subject (1–5)
5. **Save** then **Generate today**
6. Students only get quests for subjects they offer; items are drawn from the **question bank**, not lesson resources
7. Practice continues to track **proficiency** (topic/skill strength) automatically on submit

If a ticked topic has **no questions**, that subject’s exam quest is skipped until the bank is filled (or Gemini generation is connected later).

## Difficulty ranking (stars)
Every bank question already has `difficulty`: **1 / 2 / 3**

| Stars | Meaning (your rule) | Field |
|-------|---------------------|--------|
| ★ | Basic from notes | `"difficulty": 1` |
| ★★ | Normal A-level reasoning | `"difficulty": 2` |
| ★★★ | Miscellaneous / stretch | `"difficulty": 3` |

Staff / import JSON should set this on every question. UI star display on cards can be a small follow-up if you want visible stars in Daily Quest.

## Maths topics now in the bank (exam focus)
- `pure-limits` — Limits  
- `pure-continuity` — Continuity  
- `pure-differentiation` — Differentiation  
- `pure-integration` — Integration  
- `pure-circles` — Circle equations & geometry  
(+ existing algebra, trig, explog, stats, umbrella pure-calculus)

Seed questions included so exam-mode generation is not empty for those topics. **Send more JSON** anytime — merge into `bank/questions/maths.json` (and physics) with the same schema; keep `difficulty` 1–3.

## Physics
Topics already exist: `phy-mechanics`, `phy-waves`, `phy-fields`, `phy-thermal`, `phy-modern`.  
Bank is still small (~5 questions). Prefer your JSON dumps next; Gemini only where gaps remain.

## Still incomplete / post-launch
1. **Gemini auto-generate** into the live bank when a topic has zero questions (not wired yet — planner uses curated bank only)
2. **Visible star icons** on Daily Quest / Practice cards
3. **Compete** module
4. **Firebase**: Node API needs Cloud Run (or similar); Hosting alone is static
5. **Persist `data/`** on deploy so trial users/records survive restarts

## Import rule for your upcoming JSON
Each question must include: `id`, `subject`, `topic` (must exist in `engine/topics.json`), `skill` (must exist under that topic), `type` (`mcq`|`structured`), `source` (`generated`|`past_paper`), `difficulty` (1–3), `total`, `stem`, options or steps with `expected`.  
Then: `npm run validate`.

## Files in this fix pack
- `server.js` — route gate
- `public/app.js` — catalogue fallback + profile load order
- `engine/topics.json`, `engine/skills.json`, `bank/notes.json`
- `bank/questions/maths.json` — seed exam questions
- `LAUNCH-AUDIT.md` — this file
