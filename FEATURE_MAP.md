# FEATURE_MAP.md

Quick feature ownership map for faster edits.

Use this when the question is:
- where does this screen render?
- where does the action/save logic live?
- which CSS file owns the UI?
- where is the Supabase/backend path?

For broader workflow rules and gotchas, also see [AGENTS.md](c:\Users\joynoit\Desktop\joyno\AGENTS.md).

## Core Shell

### App shell / routing / global handlers
- Render shell: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- Main CSS: [public/styles/sections/layout.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\layout.css)
- Owns:
  - route switching
  - topbar
  - modal mount
  - central click handling
  - many save flows

## Dashboard

### CRM Dashboard
- Render file: [public/src/views/extended.js](c:\Users\joynoit\Desktop\joyno\public\src\views\extended.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/dashboard-work.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\dashboard-work.css)
- Data/Supabase:
  - [public/src/supabase/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\crm.js)
  - dashboard snapshot migration(s) in [supabase/migrations](c:\Users\joynoit\Desktop\joyno\supabase\migrations)
- Common edits:
  - card removal/addition
  - chart copy/layout
  - dashboard dark mode

## CRM

### Leads
- Render file: [public/src/views/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\views\crm.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/crm-attendance.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\crm-attendance.css)
- Data/Supabase: [public/src/supabase/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\crm.js)
- Related backend:
  - lead import functions in [supabase/functions](c:\Users\joynoit\Desktop\joyno\supabase\functions)
  - lead migrations in [supabase/migrations](c:\Users\joynoit\Desktop\joyno\supabase\migrations)
- Owns:
  - list table
  - filter popover
  - bulk selection and bulk actions
  - row menu
  - lead drawer/profile route
  - archive behavior
  - timezone column

#### Leads filter stack
- Filter UI:
  - [public/src/views/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\views\crm.js)
- Filter form submit + route state:
  - [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- Server-side Leads filtering:
  - [public/src/supabase/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\crm.js)
- Leads page cache isolation:
  - [public/src/modules/cache-keys.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\cache-keys.js)

### Contacts
- Render file: [public/src/views/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\views\crm.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/crm-attendance.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\crm-attendance.css)
- Data/Supabase: [public/src/supabase/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\crm.js)

### Accounts
- Render file: [public/src/views/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\views\crm.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/crm-attendance.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\crm-attendance.css)
- Data/Supabase: [public/src/supabase/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\crm.js)

### Deals
- Render file: [public/src/views/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\views\crm.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/crm-attendance.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\crm-attendance.css)
- Data/Supabase: [public/src/supabase/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\crm.js)

## Work

### My Work / task list table
- Render file: [public/src/views/work.js](c:\Users\joynoit\Desktop\joyno\public\src\views\work.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS:
  - [public/styles/sections/dashboard-work.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\dashboard-work.css)
  - some shared buttons/chrome in [public/styles/sections/layout.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\layout.css)
- Data/Supabase:
  - work/task queries in app flow
  - task-related modules in:
    - [public/src/modules/task-rbac.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\task-rbac.js)
    - [public/src/modules/task-call.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\task-call.js)

### Calendar
- Render file: [public/src/views/work.js](c:\Users\joynoit\Desktop\joyno\public\src\views\work.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/dashboard-work.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\dashboard-work.css)
- Owns:
  - work calendar
  - agenda/week views
  - task calendar filters

### Kanban
- Render file: [public/src/views/work.js](c:\Users\joynoit\Desktop\joyno\public\src\views\work.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/dashboard-work.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\dashboard-work.css)
- Owns:
  - kanban columns/cards
  - kanban filter UX
  - board toolbar

### Projects
- Render file: [public/src/views/work.js](c:\Users\joynoit\Desktop\joyno\public\src\views\work.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/dashboard-work.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\dashboard-work.css)

## Attendance

### Timeline / personal attendance
- Render file: [public/src/views/attendance-upgrade.js](c:\Users\joynoit\Desktop\joyno\public\src\views\attendance-upgrade.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- Core logic: [public/src/modules/attendance-core.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\attendance-core.js)
- CSS: [public/styles/sections/crm-attendance.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\crm-attendance.css)
- Data/Supabase: [public/src/supabase/attendance.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\attendance.js)

### Team Attendance
- Render file: [public/src/views/attendance-upgrade.js](c:\Users\joynoit\Desktop\joyno\public\src\views\attendance-upgrade.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/crm-attendance.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\crm-attendance.css)
- Data/Supabase: [public/src/supabase/attendance.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\attendance.js)
- Related SQL:
  - attendance core and overnight support migrations
  - manual entry upsert migration in [supabase/migrations](c:\Users\joynoit\Desktop\joyno\supabase\migrations)
- Owns:
  - team attendance table
  - add/edit attendance modal
  - manager summaries
  - filters for date, agent, department

### Attendance Policy
- Render file: [public/src/views/attendance-upgrade.js](c:\Users\joynoit\Desktop\joyno\public\src\views\attendance-upgrade.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- Core logic: [public/src/modules/attendance-core.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\attendance-core.js)
- CSS:
  - [public/styles/sections/crm-attendance.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\crm-attendance.css)
  - modal styling in [public/styles/sections/modals.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\modals.css)

## Comms

### Calls - Live / Scheduler / Performance
- Render file: [public/src/views/extended.js](c:\Users\joynoit\Desktop\joyno\public\src\views\extended.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/comms.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\comms.css)
- Data/Supabase:
  - [public/src/supabase/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\crm.js)
  - provider-backed functions in [supabase/functions](c:\Users\joynoit\Desktop\joyno\supabase\functions)
- Related backend:
  - RingCentral functions
  - call migrations
  - wrap-up dismiss migration
- Owns:
  - performance date/month filters
  - agent/department/outcome filtering
  - contacted/qualified KPI logic
  - dialer UI

### Messenger
- Render file: [public/src/views/extended.js](c:\Users\joynoit\Desktop\joyno\public\src\views\extended.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/comms.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\comms.css)
- Related backend:
  - messenger migrations
  - realtime publication setup

### SMS / Email
- Render file: [public/src/views/extended.js](c:\Users\joynoit\Desktop\joyno\public\src\views\extended.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/comms.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\comms.css)
- Related backend:
  - Gmail functions in [supabase/functions](c:\Users\joynoit\Desktop\joyno\supabase\functions)

## Team

### Team Management
- Render file: [public/src/views/extended.js](c:\Users\joynoit\Desktop\joyno\public\src\views\extended.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS:
  - [public/styles/sections/crm-attendance.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\crm-attendance.css)
  - some profile/layout treatment in [public/styles/sections/dashboard-work.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\dashboard-work.css)
- Related backend:
  - invite and team member migrations
  - invite/auth edge functions

## Settings / Profile

### My Profile
- Render file: [public/src/views/settings.js](c:\Users\joynoit\Desktop\joyno\public\src\views\settings.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS:
  - [public/styles/sections/dashboard-work.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\dashboard-work.css)
  - modal/profile editing in [public/styles/sections/modals.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\modals.css)
- Related backend:
  - profile and workspace asset migrations

### Settings
- Render file: [public/src/views/settings.js](c:\Users\joynoit\Desktop\joyno\public\src\views\settings.js)
- Actions/state: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/dashboard-work.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\dashboard-work.css)
- Owns:
  - appearance
  - notification preferences
  - profile/settings actions

## Notifications

### Toasts + bell inbox
- Render/actions: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/layout.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\layout.css)
- Data/Supabase: [public/src/supabase/notifications.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\notifications.js)
- Related backend:
  - notifications table migration(s)

## Import / Validation

### Lead Import
- Render/actions: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/modals.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\modals.css)
- Backend:
  - shared import logic: [supabase/functions/_shared/lead_import.ts](c:\Users\joynoit\Desktop\joyno\supabase\functions\_shared\lead_import.ts)
  - worker: [supabase/functions/lead-import-worker/index.ts](c:\Users\joynoit\Desktop\joyno\supabase\functions\lead-import-worker\index.ts)
  - commit: [supabase/functions/lead-import-commit/index.ts](c:\Users\joynoit\Desktop\joyno\supabase\functions\lead-import-commit\index.ts)
- Owns:
  - import review
  - duplicate detection
  - update/skip/create behavior
  - archived leads duplicate protection

## Cache Ownership

### Shared query cache
- Cache module: [public/src/modules/query-cache.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\query-cache.js)
- Key definitions: [public/src/modules/cache-keys.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\cache-keys.js)
- Main route consumers:
  - [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
  - [public/src/supabase/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\crm.js)

## Modal Ownership

### Confirm modal
- Open logic:
  - [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js) via `openConfirmModal`
  - [public/src/modules/confirm-modal.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\confirm-modal.js)
- CSS: [public/styles/sections/modals.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\modals.css)

### Attendance manual modal
- Open/save logic:
  - [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
  - [public/src/modules/attendance-manual.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\attendance-manual.js)
- CSS: [public/styles/sections/modals.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\modals.css)
- Data save: [public/src/supabase/attendance.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\attendance.js)

### Lead archive actions
- Action logic:
  - [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
  - [public/src/modules/lead-archive-actions.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\lead-archive-actions.js)

### Lead/contact/account/deal compose modals
- Open/save logic: [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- CSS: [public/styles/sections/modals.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\modals.css)

## Deployment Map

### Hosting-only change
- UI/CSS/copy/frontend behavior only
- Deploy:
```powershell
firebase deploy --only hosting
```

### Supabase function change
- Import/provider/backend runtime logic
- Deploy targeted function:
```powershell
npx supabase functions deploy <function-name>
```

### Migration change
- Database schema, SQL function, trigger, RPC
- Add migration in [supabase/migrations](c:\Users\joynoit\Desktop\joyno\supabase\migrations)
- Then apply it to the real project

## Most Common Touch Combos

### “Visual bug on one screen”
- View file + owning section CSS

### “Button/menu opens but does nothing”
- View file + [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)

### “Save succeeded but UI looks wrong after”
- [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
  - state mutation
  - rerender path
  - filter preservation

### “Import says duplicate / not duplicate incorrectly”
- frontend review in [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- backend truth in [supabase/functions/_shared/lead_import.ts](c:\Users\joynoit\Desktop\joyno\supabase\functions\_shared\lead_import.ts)

### “Dark mode still has white patches”
- owning section CSS
- then search later dark overrides in same file

## Keep This File Updated When

- a feature moves to a different view file
- a save path moves out of `app.js`
- a new shared module becomes the first-stop owner
- a new high-traffic feature is added
