# Question Bank Extraction Report — 2026-10-09

## Input and output
- Source image sets processed: 2
- Source page photos: 66 (33 per set)
- OCR text captured for all 66 images.
- Staging JSON contains 129 candidate records, split where numbered OCR markers appeared sufficiently clear; pages without enough reliable markers remain page-level candidates.
- Candidate records are grouped into 13 provisional topic JSON files, plus `index.json` and a README, under `bank/source-import/extracted-json/`.

## Safety and data-quality status
These are **staging candidates, not verified live questions**. The source photos include angled pages and two-page spreads. OCR can mix columns, omit diagrams, misread numbers/formulae, and fail to preserve exact question boundaries. Topic classification is keyword-based and provisional. No answer keys, mark schemes, exam board, level, year, paper, or question numbers are asserted unless a question number was detected by OCR (and even that requires verification).

Before importing any record into `bank/questions/*.json`:
1. Compare its text with the original image.
2. Separate each actual question and sub-question, including options and diagrams.
3. Correct chemical formulae, units, symbols, and numerical values.
4. Confirm topic and exam-source metadata from the printed page.
5. Add a verified answer/mark scheme and test the marking representation.

## Topic files
Each topic file is a JSON object with `status: staging_not_live_practice_bank`, `questions` candidate records, source image references, and review flags. Existing live question-bank files were not overwritten.

## Review interface added

A Head Staff-only Question Bank Review Tool is available from the staff sidebar. It displays the original image beside editable OCR text, supports topic reassignment and review notes/status, saves only to the staging JSON files, and exports approved candidates separately. Approval does not publish records to students. See `QUESTION-BANK-REVIEW-TOOL.md`.
