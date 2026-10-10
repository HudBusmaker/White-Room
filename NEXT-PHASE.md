# White Room — Controlled Platform Phase

This build changes White Room from a mostly public revision site into a controlled multi-user learning platform.

## Account model

- The public entry screen has three paths: Student login, New student, and Staff.
- Students cannot self-admit without an admission key.
- Head staff authenticate with `HEAD_STAFF_CODE` in `.env`.
- Head staff issue one-time admission keys from the Staff Room.
- Registration creates a unique student ID such as `WR-2026-0001`.
- A student profile stores name, class, school, gender, level/grading, XP, rank, statistics and achievements.
- Student passwords are stored as scrypt password hashes, not plain text.
- Sessions are short-lived server-side tokens held in memory and in the browser session.

## Rank system

XP determines rank:

- E — 0 XP
- D — 100 XP
- C — 250 XP
- B — 500 XP
- A — 900 XP
- S — 1500 XP

The ranking page sorts students primarily by XP and then by earned marks.

## Student half

The old home page is now the authenticated Student Dashboard. It contains:

- welcome/profile identity
- rank and XP
- progress to the next rank
- lesson count
- marks percentage
- streak
- achievements
- White Room news
- Daily Quest
- Lessons
- Compete
- Rankings
- Profile
- AI marking quest

`Compete` is deliberately visible in both the primary navigation and the dashboard because it is a major future activity, not a hidden utility.

## Staff half

Head staff have a separate Staff Room containing:

- admission-key issuance
- student list and rank overview
- AI marking queue
- final mark release
- tutor comments

The marking guide remains server-side. Students only see the public question and their own released result.

## Activity → progression

Lesson completion is now reported to the server. The first recorded completion of a lesson can award XP, update lesson/mark statistics and add a lesson achievement.

Released AI marking quests can award XP and mark statistics. A submission cannot be released twice.

## Environment

The archive intentionally does not contain `.env`.

Set at least:

```text
HEAD_STAFF_CODE=your-private-head-staff-code
```

and the existing AI key required by the marker, then run `npm start`.

## Validation

`npm run validate` checks the structured lesson and quest content.

The account layer was also tested with a temporary head-staff code: issue key → student registration → login → activity update → ranking.
