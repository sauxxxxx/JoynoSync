# Joynosync Starter

SPA CRM scaffold using:

- Frontend: `HTML + CSS + Vanilla JS`
- Hosting: `Firebase Hosting`
- Auth + backend services: `Supabase`

## Project Structure

```txt
.
|-- public/
|   |-- index.html
|   |-- styles/
|   `-- src/
|       |-- app.js
|       |-- routes.js
|       |-- data/
|       |-- supabase/
|       `-- views/
|-- supabase/
|   |-- config.toml
|   |-- functions/
|   `-- migrations/
|-- firebase.json
|-- .firebaserc
|-- Project_state.md
`-- README.md
```

## Architecture

- Firebase only serves the static SPA from `public/`
- Supabase handles:
  - auth
  - workspace/team membership
  - invite link resolution
  - Gmail OAuth + send
  - backend activity/communication logging
- Calls now launch RingCentral externally from the browser
- SMS now opens the device/app SMS composer and logs the thread locally in the CRM UI

## Supabase Setup

1. Configure frontend values in `public/src/supabase/config.js`.
2. Apply the SQL migrations in order:
   - `supabase/migrations/202603120900_invite_gmail_backend.sql`
   - `supabase/migrations/202603130001_workspace_access_hardening.sql`
   - `supabase/migrations/202603130002_crm_core.sql`
   - `supabase/migrations/202603130003_attendance.sql`
   - `supabase/migrations/202603130004_work_core.sql`
3. Deploy the Edge Functions in `supabase/functions`.
4. Set these secrets in Supabase:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GOOGLE_OAUTH_REDIRECT_URI`
   - `GOOGLE_OAUTH_SCOPES`
   - `EMAIL_STATE_SECRET`
   - `EMAIL_TOKEN_ENCRYPTION_KEY`
   - `PUBLIC_BASE_URL`
   - optional: `EMAIL_DEFAULT_RETURN_URL`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_OAUTH_SENDER_EMAIL`, `CORS_ORIGIN`

Recommended deploy commands:

```bash
supabase db push
supabase functions deploy auth-email-status
supabase functions deploy invite-resolve
supabase functions deploy invite-upsert
supabase functions deploy invite-remove
supabase functions deploy email-google-auth-start
supabase functions deploy email-google-auth-callback
supabase functions deploy email-integration-status
supabase functions deploy send-email-via-gmail
supabase functions deploy lead-import-commit
```

## Firebase Hosting Setup

1. Install Firebase CLI and authenticate.
2. Keep `firebase.json` as Hosting-only config.
3. Deploy hosting:

```bash
firebase deploy --only hosting
```

## Release Gates

Install the lightweight Phase 8 release tooling:

```bash
npm install
```

Run the automated release checks:

```bash
npm run release:check
```

This includes JS syntax checks and Playwright shell smoke tests. The manual release checklist lives in `docs/release-checklist.md`.

## Invite + Gmail Functions

Supabase Edge Functions now provide:

- `invite-resolve`
- `invite-upsert`
- `invite-remove`
- `email-google-auth-start`
- `email-google-auth-callback`
- `email-integration-status`
- `send-email-via-gmail`
- `lead-import-commit`

These replace the old Firebase Function rewrites and Firestore-backed invite/Gmail storage.

## Notes

- The old Firebase Functions backend has been removed from the repo. Firebase is Hosting-only now.
- Core CRM records (`accounts`, `contacts`, `leads`, `deals`) now load from Supabase in configured environments.
- Attendance now loads and mutates through Supabase RPCs in configured environments.
- Tasks, projects, comments, checklist items, and task attachments now load and mutate through Supabase RPCs and Supabase Storage in configured environments.
- Lead CSV/XLSX import is reviewed in-browser, then committed server-side through the `lead-import-commit` Edge Function.
