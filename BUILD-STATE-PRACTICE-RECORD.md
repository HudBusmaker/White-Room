# Build State — Slice 2: Practice → Record deposit (10 Oct 2026)

## Done
- `engine/practice.js` imports `depositRecord`.
- **Typed practice set submit** (`submitSet`): after a successful submit, deposits one Record row:
  - `source: "practice"`
  - subject, title (`Practice set — <Subject>`), refId = set id
  - score / max from summary, XP awarded for this submit
- **Photo mark release** (`onPhotoReleased`): when Head Staff release a practice photo, deposits:
  - `source: "photo-quest"`
  - title from topic name, score/max/xp from released mark

Failures to deposit are logged and do not block marking or XP.

## Files touched
| Path | Change |
|------|--------|
| `engine/practice.js` | deposit on submitSet + onPhotoReleased |
| `BUILD-STATE-PRACTICE-RECORD.md` | this file |

## Not in this slice
- Lesson completion → Record (still optional next)
- Staff Record view
- Profile subject editor

## How to verify
1. Log in as student → Practice → complete a set → submit.
2. Open **Record** — a "Practice set — …" row with score should appear.
3. (Optional) Photo path: submit photo → staff release → Record shows "Photo mark — …".

## Next recommended
1. Profile subject editor
2. Lesson completion deposit
3. Bank growth / Gemini Form 5 questions
4. Staff Record view
