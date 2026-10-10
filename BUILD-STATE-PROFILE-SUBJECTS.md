# Build State — Slice 3: Profile subject editor (10 Oct 2026)

## Done
Students can change **level** and **subjects** from Profile after login.

### API
- `POST /api/me/subjects` — body `{ level?, subjects: string[] }`
- Validates with `cleanSubjects` / `normalizeLevel` from `engine/subjects.js`
- Requires at least one subject
- Returns updated `publicUser`

### UI
- Profile panel: level select + subject chips (same catalogue as registration)
- **Save subjects** → updates account; Life Quest uses the new list on next load
- Facts summary still shows current subjects

### Files touched
| Path | Change |
|------|--------|
| `auth.js` | `updateStudentSubjects` |
| `server.js` | `POST /api/me/subjects` |
| `public/index.html` | Profile subjects panel |
| `public/app.js` | fill/save profile subjects |
| `public/style.css` | profile subjects spacing |
| `BUILD-STATE-PROFILE-SUBJECTS.md` | this file |

## Depends on
Slice 1 (`engine/subjects.js`, subject catalogue, Record nav).

## Verify
1. Log in → Profile → change subjects → Save.
2. Confirm facts line updates.
3. Open Daily Quest — only subjects you selected appear.
4. Switch Form 5 ↔ A Level, pick valid subjects, save.

## Next recommended
1. Lesson completion → Record deposit
2. Staff Record view
3. Bank growth (Form 5 Gemini)
