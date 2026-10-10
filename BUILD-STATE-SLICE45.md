# Build State — Slice 4+5: Lesson Record + Staff Records + Bank check (10 Oct 2026)

## Slice 4 — Question bank structure / render check
- Automated structural validation of all `bank/questions/*.json`
- Result: **30 questions, 0 structural issues** (see `QUESTION-BANK-RENDER-CHECK.md`)
- Still do a quick visual pass in the browser (KaTeX + marking) when you can

## Slice 5 — Staff Record view + Lesson → Record
### Lesson deposit
- `POST /api/activity/lesson` deposits into Record on **first** completion only
- `source: "lesson"`, title `Lesson — <id>`, score/max/XP

### Staff Records
- `GET /api/staff/records?studentId=&limit=` (Head Staff only)
- Nav **Records** + dashboard link
- Filter by student ID, limit, score column

## Files touched
| Path | Change |
|------|--------|
| `server.js` | lesson deposit, `/api/staff/records`, depositRecord import |
| `public/index.html` | staff-records section + nav |
| `public/app.js` | VIEWS includes staff-records |
| `public/staff.js` | loadStaffRecords UI |
| `QUESTION-BANK-RENDER-CHECK.md` | validation report |
| `BUILD-STATE-SLICE45.md` | this file |

## Depends on
Slices 1–3 (records engine, subjects, practice deposit, profile editor).

## Verify
1. Complete a lesson once → student **Record** shows a Lesson row.
2. Complete same lesson again → no duplicate deposit (XP already guarded).
3. Head Staff → **Records** → see all students' tasks; filter by ID.
4. Optional: open Practice for chemistry and confirm KaTeX renders.

## Still open
- Form 5 bank growth (Gemini prompt already provided)
- Empty bank shells for French / English / Economics if you want those subjects to get quests
