-- White Room practice engine: SQLite schema.
-- NOT used at runtime yet. The pilot keeps the same data in data/practice.json (no database, no dependencies,
-- as the v3 handoff decided). This file is the agreed migration target if the pilot outgrows JSON files.
-- Load check: node --experimental-sqlite -e "new (require('node:sqlite').DatabaseSync)(':memory:').exec(require('fs').readFileSync('engine/schema.sql','utf8'))"

CREATE TABLE subject (id TEXT PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE topic (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subject(id),
  name TEXT NOT NULL, shared_pure INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE skill (
  id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES topic(id),
  name TEXT NOT NULL, description TEXT
);
CREATE TABLE question (
  id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES topic(id), skill_id TEXT NOT NULL REFERENCES skill(id),
  type TEXT NOT NULL CHECK (type IN ('mcq','structured')),
  source TEXT NOT NULL CHECK (source IN ('past_paper','generated')),
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  stem TEXT NOT NULL, image TEXT, total_marks INTEGER NOT NULL CHECK (total_marks >= 1)
);
CREATE TABLE question_step (            -- structured steps, or the options of an MCQ (kind = 'option')
  question_id TEXT NOT NULL REFERENCES question(id), id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('number','text','sequence','choice','option')),
  prompt TEXT, expected TEXT, variants TEXT, tolerance TEXT, unit TEXT, marks INTEGER NOT NULL DEFAULT 1,
  hint TEXT, mistake TEXT, partial TEXT, trap TEXT, is_correct INTEGER,
  PRIMARY KEY (question_id, id)
);
CREATE TABLE note (topic_id TEXT PRIMARY KEY REFERENCES topic(id), title TEXT NOT NULL, body TEXT NOT NULL);

-- Per student (student ids come from users.json: WR-YYYY-NNNN)
CREATE TABLE topic_mastery (
  student_id TEXT NOT NULL, topic_id TEXT NOT NULL REFERENCES topic(id),
  strength INTEGER NOT NULL DEFAULT 0 CHECK (strength BETWEEN 0 AND 5), last_seen TEXT, next_due TEXT,
  PRIMARY KEY (student_id, topic_id)
);
CREATE TABLE skill_mastery (
  student_id TEXT NOT NULL, skill_id TEXT NOT NULL REFERENCES skill(id),
  strength INTEGER NOT NULL DEFAULT 0 CHECK (strength BETWEEN 0 AND 5), last_seen TEXT, next_due TEXT,
  PRIMARY KEY (student_id, skill_id)
);
CREATE TABLE cleared_question (          -- first scored attempt pays XP; later attempts only train mastery
  student_id TEXT NOT NULL, question_id TEXT NOT NULL REFERENCES question(id),
  first_at TEXT NOT NULL, got INTEGER NOT NULL, total INTEGER NOT NULL, best INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 1,
  via TEXT NOT NULL CHECK (via IN ('typed','photo')),
  PRIMARY KEY (student_id, question_id)
);
CREATE TABLE practice_set (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL, subject_id TEXT NOT NULL REFERENCES subject(id),
  issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, submitted_at TEXT, items TEXT NOT NULL, note_topics TEXT NOT NULL
);
CREATE TABLE practice_photo (            -- the AI draft; the final mark is Head Staff's, stored in submissions
  submission_id TEXT PRIMARY KEY, set_id TEXT NOT NULL REFERENCES practice_set(id), question_id TEXT NOT NULL REFERENCES question(id),
  student_id TEXT NOT NULL, ai_got INTEGER NOT NULL, ai_max INTEGER NOT NULL, correction_md TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting_review','released')), final_total INTEGER, final_comment TEXT, released_at TEXT
);
CREATE TABLE xp_day (student_id TEXT NOT NULL, day TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (student_id, day));
CREATE INDEX idx_question_topic ON question(topic_id);
CREATE INDEX idx_mastery_due ON topic_mastery(student_id, next_due);
