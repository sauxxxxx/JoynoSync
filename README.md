# JoynoSync

JoynoSync is an internal operations CRM for managing leads, follow-up work, team activity, attendance, and RingCentral-assisted calling.

The repository contains the static web application, Supabase database migrations and Edge Functions, automated tests, and Firebase Hosting configuration.

> Release status: active hardening. Automated checks pass, but production release still requires applied migrations, deployed Edge Functions, and live Owner/Manager/Agent UAT. See [Project_state.md](Project_state.md) and [docs/release-checklist.md](docs/release-checklist.md).

## Current product scope

| Area | Current state |
| --- | --- |
| Authentication and workspace access | Supabase Auth, invitations, role-aware access, and profile setup |
| Work management | Dashboard, My Work, Calendar, Kanban, Table, and Projects |
| CRM | Leads, Contacts, Accounts, Deals, profiles, ownership, filtering, and soft archive |
| Lead import and export | New-lead import, Lead ID round-trip updates, duplicate review, background jobs, result export, and rollback support |
| Attendance | Personal attendance, breaks, manager views, and manual adjustments |
| Team and settings | Team administration, permissions, workspace profile, user profile, appearance, and notification preferences |
| Messenger | Supabase-backed internal conversations and realtime updates |
| Calls | RingCentral-assisted calling, call history, scheduler, performance views, automatic Last Activity, and required wrap-up |
| SMS | Phased rollout; currently restricted in the product |
| Email | Provider code exists, but product access remains restricted while rollout is incomplete |
| Marketplace integrations | Facebook Lead Ads, Google Calendar, Google Sheets, and Slack are UI-only “Coming soon” entries |

## Architecture

- Frontend: static HTML, CSS, and ES modules under `public/`; no frontend build step
- Hosting: Firebase Hosting with SPA rewrites
- Authentication: Supabase Auth
- Database: Supabase Postgres and SQL migrations
- Backend endpoints: Supabase Edge Functions
- Realtime and storage: Supabase Realtime and Storage
- Telephony: RingCentral JWT service connection with RingOut and provider event synchronization
- Tests: Node test runner and Playwright

### RingCentral operating model

JoynoSync does not carry call audio in the browser. An IT-configured RingCentral JWT service connection starts RingOut calls. The assigned agent answers on the RingCentral desktop app, mobile app, desk phone, or forwarding phone before RingCentral connects the lead.

The supported workflow is:

1. IT verifies the workspace service connection.
2. An Owner or Admin maps each JoynoSync agent to a unique RingCentral extension.
3. The agent starts a call from JoynoSync.
4. RingCentral handles the audio on the agent’s configured device.
5. Provider events synchronize call history and Last Activity.
6. JoynoSync requires a call outcome and, for active outcomes, a next task.

## Repository structure

```text
public/                 Static SPA and deployable assets
  src/                  Views, modules, state, and Supabase clients
  styles/               Shared and feature-owned CSS
supabase/
  functions/            Edge Functions and shared server utilities
  migrations/           Ordered Postgres migrations
tests/
  unit/                 Pure policy and state tests
  smoke/                Browser workflow checks
scripts/                Release verification scripts
sample-data/            Synthetic import data for testing
docs/                   Release documentation
firebase.json           Firebase Hosting configuration
```

## Prerequisites

- Node.js 20 or newer
- npm
- Supabase CLI access to the intended project
- Firebase CLI access to the intended Hosting project

## Local development

Install dependencies:

```powershell
npm ci
```

Start the static application:

```powershell
npm run dev
```

Open `http://127.0.0.1:4173/`.

On loopback hosts only, the sign-in screen shows **Open local QA workspace**. This starts a browser-only test session that cannot write to Supabase. The control is unavailable on deployed domains and contains no reusable password.

Signing in with a real workspace account from the local application uses the Supabase project configured in [public/src/supabase/config.js](public/src/supabase/config.js).

## Environment configuration

Frontend configuration uses a Supabase publishable key. Publishable keys are expected to be visible in browser code; authorization must be enforced by Row Level Security and server-side permission checks. Never place a service-role key or provider credential in `public/`.

For local Edge Function work:

```powershell
Copy-Item .env.example .env.supabase.functions
```

Replace the placeholders only in `.env.supabase.functions`. That file is ignored by Git. Production values must be stored with Supabase secrets rather than committed files.

The template separates:

- Supabase runtime values
- optional email-provider values
- RingCentral JWT, caller identity, extension, and webhook values

## Supabase setup

Authenticate and link the intended project:

```powershell
npx supabase login
npx supabase link --project-ref <project-ref>
```

Review pending migrations before applying them:

```powershell
npx supabase migration list
npx supabase db push
```

Do not treat a feature as deployed until its migration succeeds on the actual project.

### Lead import functions

```powershell
npx supabase functions deploy lead-import-jobs
npx supabase functions deploy lead-import-worker
npx supabase functions deploy lead-import-commit
```

### RingCentral functions

```powershell
npx supabase functions deploy ringcentral-agent-mappings
npx supabase functions deploy ringcentral-start-call
npx supabase functions deploy ringcentral-call-control
npx supabase functions deploy ringcentral-answer-call
npx supabase functions deploy ringcentral-decline-call
npx supabase functions deploy ringcentral-subscription
npx supabase functions deploy ringcentral-sync-presence
npx supabase functions deploy ringcentral-sync-queues
npx supabase functions deploy ringcentral-sync-voicemails
npx supabase functions deploy ringcentral-webhook
```

### Access and invitation functions

```powershell
npx supabase functions deploy auth-email-status
npx supabase functions deploy invite-resolve
npx supabase functions deploy invite-upsert
npx supabase functions deploy invite-remove
```

Email-provider functions are optional while Email remains restricted. Their required variables are documented in `.env.example`.

## Automated verification

Run unit tests:

```powershell
npm run test:unit
```

Run browser smoke tests:

```powershell
npm run test:smoke
```

Run the complete Windows release gate:

```powershell
npm run release:check
```

The release gate performs JavaScript syntax checks, unit tests, and Playwright smoke tests. Live attendance tests run only when `JOYNO_SMOKE_ATTENDANCE_EMAIL` and `JOYNO_SMOKE_ATTENDANCE_PASSWORD` are provided.

## Deployment order

1. Run `npm run release:check`.
2. Confirm the intended Supabase project with `npx supabase projects list` and `npx supabase migration list`.
3. Apply migrations with `npx supabase db push`.
4. Deploy only the Edge Functions required by the release.
5. Complete live role-based and provider UAT.
6. Deploy the static application:

```powershell
firebase deploy --only hosting
```

7. Run post-deployment smoke checks against `https://joynosync.web.app`.

## Repository security

The following must never be committed:

- `.env` files containing real values
- `.env.supabase.functions`
- Supabase service-role keys
- RingCentral JWTs or client secrets
- OAuth client secrets or refresh tokens
- Firebase service-account files
- browser recordings, Playwright reports, logs, temporary exports, or dependency folders

The repository `.gitignore` excludes these categories. Run a secret scan and inspect `git status` before every release commit.
