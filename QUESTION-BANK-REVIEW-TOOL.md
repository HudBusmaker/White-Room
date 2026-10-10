# Question Bank Review Tool

The Head Staff navigation now includes **Question Bank Review**. It works against `bank/source-import/extracted-json/*.json` and the original staged source photos.

## Review flow

1. Sign in with the Head Staff account.
2. Open **Question Bank Review** from the staff sidebar.
3. Filter by topic/status or search by question text, record ID, or filename.
4. Select a candidate. The left pane loads its source photo; the right pane contains editable OCR text, topic, options, answer key, mark scheme, review status, and review flags.
5. Save changes. If the topic is changed, the record is moved to that topic's staging JSON file.
6. Approved records can be exported as `white-room-approved-question-candidates.json`.

## Safety rules

- Review APIs require a valid Head Staff session.
- Original source images are served through an authenticated endpoint; arbitrary file paths are not accepted.
- All edited records remain in the staging area. Setting status to `approved` is a review decision, **not publication**.
- Exported records are not copied into `bank/questions/*.json` and do not become student-facing automatically.
- Verify the original page, answer options, diagrams, chemical notation, source metadata, answer key and marking scheme before any separate live-bank import.

## Test coverage

`npm run validate`, `npm run test:engine`, and `npm run test:smoke` include the existing app checks. Smoke tests also check review queue authentication, queue listing, source image access, and saving a staged record.
