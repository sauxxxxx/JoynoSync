# JoynoSync project state

Last updated: `2026-08-05`

## Release posture

JoynoSync is in active hardening. The repository passes its automated release gate, but it should not be called production-ready until the intended Supabase project has every required migration and Edge Function, and live Owner/Manager/Agent UAT passes.

## Current architecture

- Static HTML, CSS, and JavaScript SPA
- Firebase Hosting
- Supabase Auth, Postgres, Realtime, Storage, and Edge Functions
- RingCentral JWT service connection with RingOut and provider-event synchronization
- Node unit tests and Playwright browser smoke tests

## Implemented operational areas

- Authentication, invitations, workspace access, and role-aware navigation
- Dashboard and work management
- Leads, Contacts, Accounts, and Deals
- Cursor-backed Leads pagination, server-side filtering, sorting, ownership, and soft archive
- New-lead import and Lead ID round-trip update import
- Duplicate review, background import jobs, result downloads, and rollback support
- Attendance, breaks, team attendance, and manual adjustments
- Team management, profiles, settings, and notifications
- Internal Messenger and realtime updates
- Calls Live, Scheduler, and Performance views
- RingCentral workspace verification, agent-to-extension mapping, RingOut calls, call synchronization, Last Activity, and required wrap-up
- Localhost-only QA workspace using browser-only data

## Restricted or incomplete areas

- SMS remains in phased rollout and is not a general-release feature.
- Email provider functions remain in the repository, but product access is restricted.
- Facebook Lead Ads, Google Calendar, Google Sheets, and Slack marketplace cards are “Coming soon” only.
- Live RingCentral behavior depends on the RingCentral account, licenses, extension mappings, calling devices, webhook subscription, and feature availability.
- Live attendance smoke tests require dedicated test credentials and are skipped without them.

## Release evidence

The current automated gate covers:

- JavaScript syntax validation
- Lead import/export policy tests
- Lead pagination state tests
- Call workflow policy tests
- Local QA host and storage restrictions
- SPA route rendering
- Integration placement and setup UI
- Lead import UI modes and validation
- Leads next/previous pagination stability

Automated checks do not replace live migration verification, provider validation, accessibility review, performance testing, or role-based UAT.

## Known technical debt

- `public/src/app.js` and several legacy view/CSS files remain oversized and must be split incrementally by feature.
- Some product surfaces still centralize rendering and interaction logic in `app.js`.
- Email and SMS should remain visibly restricted until their provider flows receive separate release approval.
- RingCentral provider capabilities vary by account; unsupported features must degrade without blocking core call synchronization.

## Source-of-truth documents

- Setup, architecture, and deployment: `README.md`
- Release decision: `docs/release-checklist.md`
- Repository ownership map and engineering guidance: `AGENTS.md`
- UI behavior and visual rules: `UI_RULES.md`
