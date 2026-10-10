WHITE ROOM SECURITY PATCH (7 October 2026)

STEP 0 (most important, do this first)
  The project archive you shared contained .env and the data folder. Treat those secrets as exposed:
  1. Create a NEW Gemini key in AI Studio, delete the old one, and put the new one in .env.
  2. Change HEAD_STAFF_CODE and TEACHER_PIN in .env to new values.
  3. Do not zip or share .env, data/ or backups/ ever again.
  4. After applying the patch, issue new admission keys from Head Staff and stop using any unused old ones.

STEP 1: copy these files into your project (replace when asked)
  server.js
  auth.js
  public/app.js
  backup.mjs            (new)
  tests/smoke.mjs       (new folder and file)

STEP 2: package.json -> add two lines inside "scripts" (keep the existing ones):
  "test:smoke": "node tests/smoke.mjs",
  "backup": "node backup.mjs"

STEP 3: .gitignore -> add a line:  backups/

STEP 4: delete these files if they exist (old backups that were being served to the browser):
  public/index.html.pre-anime2
  public/style.css.pre-anime2

STEP 5: run, in the project folder
  npm run validate
  npm run test:smoke      (expect: 31 passed, 0 failed. It uses a throwaway copy and never touches your data)
  npm run backup
  npm start

WHAT CHANGED
  - Rankings now need a login and show only first name + last initial, rank and XP (no ID, school, gender, class).
  - Lessons pay XP only if the lesson exists; the server decides the maximum marks; each lesson or quest pays once.
  - One admission key can no longer register two students at the same time; data files are written safely.
  - Login limits: 8 wrong passwords lock a student ID for 15 minutes; 6 wrong staff codes or teacher PINs lock that login.
  - Teacher PIN compare is constant-time. Marking limits are per student, not per IP.
  - Security headers added; safer static path check.

IF YOU OR COPILOT CHANGED server.js OR auth.js AFTER THE 6-7 OCTOBER ARCHIVE, this patch will overwrite those changes.
Send the newer files and the fixes can be re-applied.
