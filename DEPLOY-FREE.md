# White Room: free deployment (Firebase Spark + Render)

This guide uses the existing Node.js server and keeps all marking and answer keys on the server. The browser must never connect directly to Firestore. The intended trial setup is Firebase Firestore on the no-cost Spark plan plus Render's free Web Service.

## Important free-tier limits

Render's official free-tier documentation (checked 10 October 2026) says free web services spin down after 15 minutes without incoming traffic and usually take about a minute to start again. The local filesystem is ephemeral, so do not use local files for persistent production data. Render provides 750 free instance hours per workspace per calendar month; bandwidth and build-pipeline limits also apply. These free services are intended for testing/hobby projects, not production-grade uptime. Review [Render's current free-tier documentation](https://render.com/docs/free) before launch because terms can change.

Firebase Spark does not require enabling Google Cloud billing. Do not enable Blaze or add a billing account for this setup.

## 1. Prepare the Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/) and choose **Add project**.
2. Create the project without enabling Google Analytics if you do not need it. Record the exact **Project ID** (not the display name).
3. Open **Build → Firestore Database → Create database**.
4. Choose **Native mode** and a nearby supported European location such as `eur3` or `europe-west1`. The database location cannot be changed later.
5. Keep the project on the **Spark** plan. Do not enable billing.

## 2. Lock down Firestore rules

On Windows PowerShell, install the Firebase CLI if needed:

```powershell
npm install -g firebase-tools
firebase login
```

In PowerShell, change to the project folder. Open `.firebaserc` in your editor and replace `YOUR-PROJECT-ID` with the exact Firebase Project ID. Then deploy only the Firestore rules:

```powershell
firebase use YOUR-PROJECT-ID
firebase deploy --only firestore
```

The rules deny all direct browser reads and writes. The server authenticates with its service-account credentials and uses the Firestore server SDK, which bypasses client security rules. Never loosen the rules to make the browser connect directly.

## 3. Create a server service-account key

1. In Firebase Console, open **Project settings** (gear icon) → **Service accounts**.
2. Select **Generate new private key**, confirm, and download the JSON file.
3. Keep the file private. Never commit it to GitHub, put it in `public/`, or send it in a chat. `.gitignore` excludes common service-account JSON filenames.
4. You will paste its entire contents into Render's `FIREBASE_SERVICE_ACCOUNT` environment variable later. Do not paste it into source code or this guide.

## 4. Check the project before deployment

Use Node.js 22. From PowerShell in the project folder:

```powershell
node --version
npm install
npm run test:all
```

Do not deploy unless the tests pass. Keep `data/` and any existing local database backed up. If you have existing local data that must be preserved, migrate it once before directing students to the new deployment (see step 7).

## 5. Put the project in a private GitHub repository

1. Create a **private** repository on [GitHub](https://github.com/).
2. From the project folder, make sure `.env`, `data/`, `backups/`, `node_modules/`, and service-account JSON files are not staged.
3. Commit and push the project files, including `render.yaml`, `firestore.rules`, `firebase.json`, and `DEPLOY-FREE.md`.
4. Do not upload the downloaded service-account JSON file.

## 6. Create the Render Web Service

1. Open [Render](https://render.com/) and sign in.
2. Choose **New → Web Service**, connect the private GitHub repository, and select the repository.
3. Use the settings in `render.yaml` if Render detects them. Confirm **Free** instance type, Node runtime, build command `npm install --omit=dev`, start command `node server.js`, region Frankfurt, and health check path `/api/health`.
4. In **Environment**, add the following variables. For secrets, use Render's dashboard field; do not commit their values.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `STORAGE` | `firestore` |
| `FIREBASE_SERVICE_ACCOUNT` | Entire downloaded service-account JSON, pasted as one line/value. PowerShell conversion example below. |
| `GOOGLE_CLOUD_PROJECT` | Exact Firebase Project ID |
| `SESSION_SECRET` | At least 24 random characters; use a long unique value. |
| `HEAD_STAFF_CODE` | A strong private code for Head Staff |
| `TEACHER_PIN` | A private teacher PIN, if teacher access is used |
| `GEMINI_API_KEY` | Server-side Gemini key if the server-side Gemini features are used |
| `TRIAL_ENDS` | Set only if the app's existing feature uses this setting |

To copy the JSON to the clipboard as one line in PowerShell (replace the path with the downloaded file's path):

```powershell
(Get-Content "$HOME\Downloads\your-service-account.json" -Raw | ConvertFrom-Json | ConvertTo-Json -Compress) | Set-Clipboard
```

Paste the clipboard contents into `FIREBASE_SERVICE_ACCOUNT`. The JSON is sensitive; never paste it into a public issue or terminal transcript. The server parses `project_id`, `client_email`, and `private_key` from it and supports escaped newlines in `private_key`.

Generate a session secret locally in PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy the output into Render's `SESSION_SECRET`. Do not share it. The server refuses to start in production if `SESSION_SECRET` or `HEAD_STAFF_CODE` is missing.

## 7. Migrate existing local data only if needed

If the project already has local records or deposited content, make an external backup first. Then, from a trusted local PowerShell session with Node dependencies installed, set the Firestore environment variables and run the migration once. Do not run this against a blank local data folder and assume it has migrated student data.

```powershell
$env:STORAGE = "firestore"
$env:GOOGLE_CLOUD_PROJECT = "YOUR-PROJECT-ID"
$env:FIREBASE_SERVICE_ACCOUNT = Get-Content "$HOME\Downloads\your-service-account.json" -Raw
npm run migrate
```

This requires the downloaded JSON to remain private on your own computer. The migration is intended to leave existing Firestore documents intact. Confirm the migration output and inspect the resulting data before inviting students. If no existing data needs to be retained, skip this step.

## 8. First-run checklist

- [ ] Render deployment completes successfully.
- [ ] `https://YOUR-SERVICE.onrender.com/api/health` returns `{"ok":true}` after any cold start.
- [ ] Server logs contain no credential values or private keys.
- [ ] Student registration with an admission key works and assigns a unique `WR-YYYY-NNNN` identity.
- [ ] Two simultaneous registrations cannot both consume the same admission key.
- [ ] Log in, restart/wake the service, and confirm the same signed token still works (requires the same `SESSION_SECRET`).
- [ ] Daily quests, Record, JSON Deposit, and server-side marking work.
- [ ] Confirm answer keys, trap explanations, and partial-credit rules are not returned to student-facing responses.
- [ ] Confirm Firestore's browser rules deny direct reads and writes.

## 9. Troubleshooting

| Problem | Check |
|---|---|
| `permission denied` / Firestore permission error | Confirm the service-account JSON is from the same project, Firestore is created, and `GOOGLE_CLOUD_PROJECT` matches the JSON `project_id`. Do not fix this by opening browser rules. |
| Wrong project ID | Compare Firebase Project settings → General → Project ID with `GOOGLE_CLOUD_PROJECT` and the service-account JSON. |
| First page visit is slow | Render's free instance may have slept after 15 minutes idle; allow about a minute for it to wake. |
| `SESSION_SECRET` missing/too short | Set a private value of at least 24 characters in Render and redeploy/restart. Changing it logs existing users out. |
| `FIREBASE_SERVICE_ACCOUNT` malformed | Paste the complete JSON value, including braces and quotes, as a single environment variable. Do not add extra quotation marks around the whole JSON. |
| Health check fails | Check Render logs for startup errors, missing environment variables, or build failures. Confirm the service listens on `process.env.PORT` and `/api/health` is reachable. |
| Data seems to disappear | Confirm `STORAGE=firestore`. Render's local filesystem is ephemeral and must not be used as the persistent production database. |

## 10. Updating and rotating secrets

To update the app, commit and push the code to the connected private GitHub branch; Render will redeploy it. After deployment, check `/api/health` and test key flows.

If a service-account key or other secret is exposed, replace it immediately: create a new key in Firebase/Google Cloud, update Render's environment variable, redeploy/restart, verify the service, then delete/revoke the old key. Rotate `SESSION_SECRET` deliberately because all existing sessions will be invalidated. Never store secrets in Git history.

## Test and verification status

`npm run test:all` and an actual Firestore/emulator end-to-end registration race test must be run against the complete project before this deployment guide can be considered fully verified. Do not claim the app was tested against real Firestore unless that test was actually completed.
