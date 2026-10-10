# Deploying White Room: Cloud Run + Firestore

Plain Node app on **Cloud Run** (serves the site and the API), data in **Firestore**. The question bank you deposit
(Gemini or pasted JSON) is stored in Firestore too, so it survives restarts and deploys. Firebase Hosting is not used.

> **Be honest about what was tested.** Everything here was tested against a built-in stand-in for Firestore and against
> JSON files. The real Firestore library could not be installed in my workspace, so **do step 5 (a local run against
> real Firestore) before telling students**. If something is off it will show there, on your computer, not in front of students.

## What you need
- A Google account, a **Google Cloud project with billing on** (Cloud Run needs it; at this size the cost is cents).
- Installed on your computer: Node 22, the **Google Cloud CLI** (`gcloud`), and the **Firebase CLI** (`npm i -g firebase-tools`).

## 1. Create the project and the database
1. Open [Firebase Console](https://console.firebase.google.com/) and select the project with ID `white-room-std`.
2. **Build → Firestore Database → Create database → Native mode**. Choose a region near your students (for Morocco: `eur3` or `europe-west1`). The region cannot be changed later.
3. In this folder put your project ID in `.firebaserc` (currently `white-room-std`).

## 2. Lock the database
```
firebase login
firebase deploy --only firestore
```
This publishes `firestore.rules`: browsers may not touch the database at all. Only your server can.

## 3. Secrets (never put these in the code or the image)
`.env` is **not** sent to Cloud Run. Create each secret once (Secret Manager):
```
gcloud config set project white-room-std
gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
printf '%s' "$(openssl rand -hex 32)"   | gcloud secrets create SESSION_SECRET --data-file=-
printf '%s' 'choose-a-long-head-code'    | gcloud secrets create HEAD_STAFF_CODE --data-file=-
printf '%s' 'choose-a-pin'               | gcloud secrets create TEACHER_PIN --data-file=-
printf '%s' 'your-gemini-key'            | gcloud secrets create GEMINI_API_KEY --data-file=-
```
Use **new** values, not the ones from earlier zips. Let Cloud Run read them:
```
PROJECT_NUMBER=$(gcloud projects describe white-room-std --format='value(projectNumber)')
for s in SESSION_SECRET HEAD_STAFF_CODE TEACHER_PIN GEMINI_API_KEY; do
  gcloud secrets add-iam-policy-binding $s --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
done
```
`SESSION_SECRET` signs every login. Changing it logs everybody out. Keep it the same across deploys.

## 4. Copy your current data in (once)
Skip this if you are starting fresh. This copies `data/users.json`, admission keys, daily quests, practice state, submissions and the Record into Firestore. It never overwrites anything already there, so it is safe to repeat.
```
gcloud auth application-default login
npm install
STORAGE=firestore GOOGLE_CLOUD_PROJECT=white-room-std npm run migrate
```
(PowerShell: `$env:STORAGE="firestore"; $env:GOOGLE_CLOUD_PROJECT="white-room-std"; npm run migrate`)

## 5. Try it on your computer against real Firestore (do this before deploying)
```
STORAGE=firestore GOOGLE_CLOUD_PROJECT=white-room-std SESSION_SECRET=any-24-or-more-characters HEAD_STAFF_CODE=test npm start
```
Open http://localhost:3000. Check, in this order: staff login → make admission keys → register a student with a level and subjects → Daily Quest shows a quest → submit it → Record shows it → JSON Deposit: deposit `bank/deposit-samples/form5-maths-sample.json` → in the Firebase console you should see collections `users`, `bankQuestions`, `records`. Stop the server, start it again: the deposited questions are still there.
(To try without touching real data, use the emulator: `firebase emulators:start --only firestore`, then add `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` to the command above.)

## 6. Deploy
```
gcloud run deploy white-room --source . --region europe-west1 --allow-unauthenticated \
  --timeout 300 --max-instances 3 \
  --set-env-vars STORAGE=firestore,NODE_ENV=production \
  --set-secrets SESSION_SECRET=SESSION_SECRET:latest,HEAD_STAFF_CODE=HEAD_STAFF_CODE:latest,TEACHER_PIN=TEACHER_PIN:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest
```
It prints the service URL. Open it and repeat the checklist in step 5. To update later, run the same command again.
Use the same region as step 1 if you can (`europe-west1` suits `eur3`).

## How it behaves in production
- **Several copies at once are fine.** Logins are signed (no memory), keys and student numbers use transactions, one-submission-per-quest is enforced by the database, and a deposit made on one copy reaches the others within about 15 seconds.
- **Question bank:** the built-in bank (`bank/questions/*.json`) ships inside the image. Everything deposited lives in Firestore (`bankQuestions`, `bankNotes`). Withdraw works from the Deposit page.
- **Login limits** (too many wrong codes) are counted per running copy and reset when it restarts. That is acceptable for a school; do not rely on it against a determined attacker.
- **Gemini Generate** can take up to a minute; `--timeout 300` allows for it.
- **Backups:** `npm run backup` only handles local files. For Firestore use `gcloud firestore export gs://YOUR-BUCKET/backup-$(date +%F)` (needs a bucket), or schedule it.
- **Cost watch:** Firestore's free allowance is 50,000 reads a day. Opening the staff **Records** page reads up to 5,000 records each time. Fine for a demo; if staff use it all day with many records, tell me and I will add running totals.
