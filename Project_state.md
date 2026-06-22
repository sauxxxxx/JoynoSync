**Project State**

Last updated: `2026-04-07`

**Architecture**
- Hosting: `Firebase Hosting`
- Backend: `Supabase`
- Frontend: `Vanilla JS + HTML + CSS`
- Auth: `Supabase Auth`
- Database: `Supabase Postgres`
- Storage: `Supabase Storage`
- Server endpoints: `Supabase Edge Functions`
- Telephony: `RingCentral` via Supabase Edge Functions

The app is no longer a demo shell. It is a cloud-backed operations product with real auth, workspace access, CRM data, work/tasks, attendance, dashboard aggregation, and partially hardened comms.

**Current Product Reality**
- Main app is live at `joynosync.web.app`.
- Core CRM, Work, Attendance, Dashboard, Team, Settings/Profile, and major parts of Calls/Comms are Supabase-backed.
- The product is in a `hardening / release-candidate` stage for the main operational flows.
- The frontend has moved toward a speed-first architecture for key CRM routes, especially `Leads`.

**Major Backend Surface In Repo**
- Workspace and access:
  - `202603120900_invite_gmail_backend.sql`
  - `202603130001_workspace_access_hardening.sql`
  - `202603160007_team_member_security_hardening.sql`
  - `202603160008_backend_permission_hardening.sql`
- CRM:
  - `202603130002_crm_core.sql`
  - `202603130006_deal_value_nullable.sql`
  - `202603250002_leads_source_default_not_set.sql`
  - `202603260001_lead_status_events.sql`
  - `202604010001_lead_phone_timezone_bucket.sql`
- Attendance:
  - `202603130003_attendance.sql`
  - `202603250001_attendance_overnight_support.sql`
  - `202604010002_attendance_manual_entry_upsert.sql`
- Work / tasks / projects:
  - `202603130004_work_core.sql`
  - `202603130005_work_rpc_context_alias_fix.sql`
  - `202603160006_work_activity_realtime.sql`
  - `202603160009_task_rbac_hardening.sql`
  - `202603160010_task_call_foundation.sql`
  - `202603180003_task_create_idempotency.sql`
- Messenger / dashboard / notifications:
  - `202603130008_messenger_core.sql`
  - `202603160004_messenger_realtime_publication.sql`
  - `202603160005_dashboard_snapshot.sql`
  - `202603180001_dashboard_rbac_hardening.sql`
  - `202603180002_dashboard_rbac_actor_member_fix.sql`
  - `202603310001_notifications.sql`
- Calls:
  - `202603130007_calls_core.sql`
  - `202603270001_call_wrapup_dismiss.sql`
- Profiles and assets:
  - `202603160001_workspace_profile_fields.sql`
  - `202603160002_team_member_profile_fields.sql`
  - `202603160003_profile_images_storage.sql`
- Lead import jobs:
  - `202603170001_lead_import_jobs.sql`

**Edge Functions In Repo**
- Invite / auth helpers:
  - `invite-resolve`
  - `invite-upsert`
  - `invite-remove`
  - `auth-email-status`
- Gmail / email:
  - `email-google-auth-start`
  - `email-google-auth-callback`
  - `email-integration-status`
  - `gmail-mailbox`
  - `send-email-via-gmail`
- Lead import:
  - `lead-import-commit`
  - `lead-import-jobs`
  - `lead-import-worker`
- Calls / call logs:
  - `ringcentral-start-call`
  - `ringcentral-call-control`
  - `ringcentral-answer-call`
  - `ringcentral-decline-call`
  - `ringcentral-sync-presence`
  - `ringcentral-sync-queues`
  - `ringcentral-sync-voicemails`
  - `ringcentral-webhook`
  - `delete-call-log`

**Frontend Structure**
- Main shell/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- Views:
  - [public/src/views/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\views\crm.js)
  - [public/src/views/work.js](c:\Users\joynoit\Desktop\joyno\public\src\views\work.js)
  - [public/src/views/attendance-upgrade.js](c:\Users\joynoit\Desktop\joyno\public\src\views\attendance-upgrade.js)
  - [public/src/views/extended.js](c:\Users\joynoit\Desktop\joyno\public\src\views\extended.js)
  - [public/src/views/settings.js](c:\Users\joynoit\Desktop\joyno\public\src\views\settings.js)
- Shared modules:
  - [public/src/modules/query-cache.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\query-cache.js)
  - [public/src/modules/cache-keys.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\cache-keys.js)
  - [public/src/modules/attendance-core.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\attendance-core.js)
  - [public/src/modules/task-rbac.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\task-rbac.js)
  - [public/src/modules/task-call.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\task-call.js)

**Major Shipped Improvements**

**CRM**
- `Leads`, `Contacts`, `Accounts`, and `Deals` are cloud-backed.
- `Leads` now follows a much stronger list architecture:
  - cursor-backed next/previous paging
  - server-side filtering
  - server-side default sort
  - rows-only paged query
  - debounced search
  - separate detail fetch path
- `Leads` now supports:
  - bulk row selection
  - bulk status change
  - filter popover UX
  - in-place detail drawer behavior
  - `Timezone` classification derived from phone number
- Import duplicate handling now checks backend/system records by:
  - email
  - phone / secondary phone
  - name + company

**Caching and Speed Improvements**
- Browser cache baseline is configured in [firebase.json](c:\Users\joynoit\Desktop\joyno\firebase.json):
  - `index.html` revalidates
  - `js/css` revalidate
  - `png/svg` are long-cache immutable
- In-memory query caching now exists for:
  - Leads pages
  - CRM collection pages
  - lead/contact/account/deal detail bundles
  - dashboard snapshot
  - calls performance windows
- Current cache strategy is `memory + stale-while-refresh`, not offline/persistent browser storage.
- `Leads` no longer runs the old background metadata fetch path.

**Dashboard**
- Dashboard is Supabase-backed and cached.
- The layout has been simplified into a smaller KPI + insight surface.
- Removed panels include:
  - `Source Performance`
  - `Owner Performance`
  - `Follow-up Pressure`
- Dashboard card radii were normalized to `5px`.

**Work / Tasks / Projects**
- Tasks and projects are Supabase-backed.
- Task RBAC is explicit and more granular.
- Calendar, Kanban, Table, and Projects surfaces have had major UI hardening.
- The task Calendar right-side follow-up panel was removed for a cleaner planner layout.

**Attendance**
- Attendance policy, timeline/history, team attendance, requests, and policy surfaces are in repo.
- Overnight attendance support is in the backend model.
- `Timeline` view includes:
  - live analog clock
  - working/break counters
  - break tracking
  - grouped timeline rows
  - live moving durations
- Team Attendance now has manager add/edit support backed by:
  - `attendance_manual_entry_upsert`
- Manual attendance modal was redesigned toward:
  - member/date top row
  - primary work session
  - secondary break section
  - summary strip

**Calls / Comms**
- Calls workspace has `Live`, `Scheduler`, and `Performance` surfaces.
- `Scheduler` supports policy-based shift windows.
- `Performance` now reads real `lead_status_events` by default and only falls back when the relation is truly missing.
- `Contacted` / `Qualified` KPI counts are deduped by lead instead of blindly counting raw event rows.
- Messenger, SMS, Email, and softphone UI all received dark-mode and bright-surface cleanup.
- Wrap-up dismiss flow has app-side support and matching SQL migration in repo.

**Profile / Team / Settings**
- Profile/settings were redesigned into a hero + tabs + summary/detail layout.
- Profile route includes silent background refresh behavior.
- Team Management cards/table are present and visually hardened.
- Notifications preferences exist in settings and feed the notification client.

**Dark Mode**
- Dark mode phases 1 through 6 were completed across:
  - shell
  - CRM
  - Attendance
  - Calls/Comms
  - modals/overlays
  - dashboard/work surfaces
- Follow-up work is now mostly visual polish, not first-pass theming.

**Notifications**
- Frontend notification system now has:
  - bell inbox integration
  - unread badge
  - mark-as-read
  - dismiss support
  - realtime subscription path with polling fallback
- The production backend expectation is the `notifications` table/migration in:
  - `202603310001_notifications.sql`

**Validation Status**
- Smoke suite is present and still passing:
  - `npm run test:smoke`
- Current tests mainly confirm shell/runtime stability, not full business-flow coverage.

**Current Operational Constraints**
- Supabase sizing still matters. The app has been optimized, but tiny compute/storage tiers can still cause:
  - slow auth bootstrap
  - slow imports
  - slow list refreshes
  - realtime lag
- RingCentral and Gmail flows still need live environment validation beyond repo correctness.
- Notification frontend is ready, but it depends on the matching SQL migration actually being applied.
- Some recent SQL migrations still need live-project confirmation:
  - `202603170001_lead_import_jobs.sql`
  - `202603270001_call_wrapup_dismiss.sql`
  - `202603310001_notifications.sql`
  - `202604010001_lead_phone_timezone_bucket.sql`
  - `202604010002_attendance_manual_entry_upsert.sql`

**Current Known Issues / Open Hardening Work**

**Calls > Performance**
- The month/day calendar state has had multiple fixes, but it is still under refinement.
- Current known issue:
  - month arrows can mutate state correctly while the visible month text still behaves inconsistently in some flows
- The screen can also feel hung because the client still pages through large `lead_status_events` result sets and then performs filtering/chart aggregation in the browser.
- This area likely needs:
  - one source of truth for visible month + selected date
  - lighter data fetches or server-side aggregation for large ranges

**Notifications**
- Frontend integration is in place.
- Production-readiness still depends on:
  - notifications table migration applied
  - notification row generation strategy
  - final delivery rules per channel

**Backend Caching**
- There is no Redis / dedicated backend cache layer yet.
- Current caching is mostly frontend memory-cache + optimized Supabase queries.

**CDN / Browser Cache**
- Baseline cache headers are set.
- There is still no service worker / offline cache.
- JS/CSS are revalidated, not immutable-fingerprinted long-cache assets yet.

**Database / Scale**
- Core indexing is in place.
- No materialized views yet.
- For `100k+` record scenarios, further DB-specific tuning may still be needed after real dataset measurement.

**Comms and Provider Validation**
- RingCentral structure exists, but production validation is still a real checklist item:
  - secrets
  - webhook behavior
  - inbound/outbound validation
  - queue/presence/voicemail verification
- Gmail mailbox/integration paths also still need live validation across real accounts.

**Immediate Next Steps**
1. Finish hardening `Calls > Performance`:
   - fix visible month label state fully
   - reduce large-range event loading cost
   - clarify event-vs-unique-lead counting semantics across the full screen
2. Confirm the latest SQL migrations are applied in the live Supabase project, especially:
   - `202603170001_lead_import_jobs.sql`
   - `202603270001_call_wrapup_dismiss.sql`
   - `202603310001_notifications.sql`
   - `202604010001_lead_phone_timezone_bucket.sql`
   - `202604010002_attendance_manual_entry_upsert.sql`
3. Validate the notifications pipeline end-to-end:
   - notification row creation
   - unread badge
   - mark read/dismiss
   - realtime updates
4. Run large-data validation on CRM routes, especially `Leads`, with real production-scale row counts.
5. Continue live validation for RingCentral and Gmail integrations.

**Bottom Line**
- The project has a strong Supabase-backed operations foundation across CRM, work, attendance, profile/settings, and much of comms.
- The biggest recent gains are:
  - Leads performance architecture
  - query caching
  - duplicate detection improvements
  - timezone classification
  - dark mode rollout
  - notifications foundation
  - attendance manual edit support
- The main remaining risks are not basic scaffolding anymore. They are:
  - live migration parity
  - real integration validation
  - calls performance hardening
  - infra sizing
  - final production tuning at scale
