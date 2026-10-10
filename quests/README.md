# Quests (photo-marking tests)

Each file here is one quest. This folder is NOT inside public/, so the browser can never read the marking guide.
Fields: id, title, level, subject, question (HTML), total, guide [{id, marks, text}], rules.
The server asks Gemini to judge each guide line, then plain code clamps every mark and adds the total.
Submissions are appended to data/submissions.jsonl (transcription + draft mark, no photos) for the tutor to review.
Limit: MARK_DAILY_CAP requests per device per day (default 20), set in .env if you want to change it.
