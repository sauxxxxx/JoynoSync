# AGENTS.md

Working guide for this repo. The goal is speed, safe edits, and less repeated context hunting.

## Purpose

Use this file as the first-stop map for:
- where a feature usually lives
- which file to check first
- how to verify and deploy a small change
- what traps already exist in this codebase

This is not product status. For current shipped state, use [Project_state.md](c:\Users\joynoit\Desktop\joyno\Project_state.md).

## Stack

- Frontend: Vanilla JS + HTML + CSS
- Hosting: Firebase Hosting
- Backend: Supabase Postgres + Edge Functions
- Realtime/auth/storage: Supabase

## Repo Map

### App shell and state
- [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
  - central state container
  - route switching
  - most click handlers
  - modal open/close logic
  - many save actions
  - many Supabase refresh paths

### Main views
- [public/src/views/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\views\crm.js)
  - Leads, Contacts, Accounts, Deals rendering
  - CRM table layout
  - row menus, filters, bulk bar markup
- [public/src/views/messenger.js](c:\Users\joynoit\Desktop\joyno\public\src\views\messenger.js)
  - Messenger route rendering
  - standalone owner for Messenger view markup
- [public/src/views/work.js](c:\Users\joynoit\Desktop\joyno\public\src\views\work.js)
  - dashboard/work tables, task calendar, kanban, projects
- [public/src/views/attendance-upgrade.js](c:\Users\joynoit\Desktop\joyno\public\src\views\attendance-upgrade.js)
  - attendance route rendering
  - team attendance table
  - attendance summaries
- [public/src/views/extended.js](c:\Users\joynoit\Desktop\joyno\public\src\views\extended.js)
  - dashboard widgets
  - calls performance
  - extra operational views
- [public/src/views/settings.js](c:\Users\joynoit\Desktop\joyno\public\src\views\settings.js)
  - settings/profile pages

### Shared frontend modules
- [public/src/supabase/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\crm.js)
  - CRM Supabase queries
  - performance/event fetches
- [public/src/supabase/attendance.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\attendance.js)
  - attendance-specific Supabase calls
- [public/src/supabase/notifications.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\notifications.js)
  - notifications fetch/read helpers
- [public/src/modules/query-cache.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\query-cache.js)
  - in-memory response cache
- [public/src/modules/cache-keys.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\cache-keys.js)
  - stable cache keys for list/detail routes
- [public/src/modules/confirm-modal.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\confirm-modal.js)
  - shared confirm modal controller
- [public/src/modules/attendance-manual.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\attendance-manual.js)
  - attendance manual modal render/preview/save flow
- [public/src/modules/lead-archive-actions.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\lead-archive-actions.js)
  - single and bulk lead archive flows
- [public/src/modules/attendance-core.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\attendance-core.js)
  - attendance policy and break logic
- [public/src/modules/messenger-controller.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\messenger-controller.js)
  - standalone Messenger interaction controller
  - owner for Messenger actions and composer flow
- [public/src/modules/messenger-realtime.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\messenger-realtime.js)
  - Messenger snapshot mapping/reset, message prefetch, and realtime subscriptions
  - owner for Messenger refresh batching and fallback polling
- [public/src/modules/messenger-customization.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\messenger-customization.js)
  - Messenger theme presets and customization labels

### CSS ownership
- [public/styles/sections/layout.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\layout.css)
  - app shell
  - buttons
  - topbar
  - nav
  - shared chrome
- [public/styles/sections/crm-attendance.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\crm-attendance.css)
  - CRM tables
  - Leads table
  - attendance tables
  - bulk bars
  - many shared operational table surfaces
- [public/styles/sections/dashboard-work.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\dashboard-work.css)
  - dashboard
  - work/calendar/kanban/projects
  - profile/settings layout work
- [public/styles/sections/comms.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\comms.css)
  - calls
  - SMS/email surfaces
- [public/styles/sections/messenger.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\messenger.css)
  - Messenger route layout
  - Messenger thread list, composer, and thread UI
- [public/styles/sections/modals.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\modals.css)
  - modal shells
  - confirm modals
  - import modals
  - attendance manual modal

### Backend
- [supabase/migrations](c:\Users\joynoit\Desktop\joyno\supabase\migrations)
  - database schema and SQL functions
- [supabase/functions](c:\Users\joynoit\Desktop\joyno\supabase\functions)
  - edge functions
  - import workers
  - provider integrations

## Fast Path: Where To Look First

### Small CRM UI tweak
1. [public/src/views/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\views\crm.js)
2. [public/styles/sections/crm-attendance.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\crm-attendance.css)
3. If interaction/save is broken, then [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)

### Modal copy or modal spacing
1. open/render logic in [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
2. confirm modal controller in [public/src/modules/confirm-modal.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\confirm-modal.js)
2. styles in [public/styles/sections/modals.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\modals.css)

### Dashboard card or layout issue
1. [public/src/views/extended.js](c:\Users\joynoit\Desktop\joyno\public\src\views\extended.js)
2. [public/styles/sections/dashboard-work.css](c:\Users\joynoit\Desktop\joyno\public\styles\sections\dashboard-work.css)

### Attendance bug
1. render/UI in [public/src/views/attendance-upgrade.js](c:\Users\joynoit\Desktop\joyno\public\src\views\attendance-upgrade.js)
2. attendance manual flow in [public/src/modules/attendance-manual.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\attendance-manual.js)
3. action/save path in [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
4. policy math in [public/src/modules/attendance-core.js](c:\Users\joynoit\Desktop\joyno\public\src\modules\attendance-core.js)
5. Supabase call in [public/src/supabase/attendance.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\attendance.js)
6. SQL RPC in [supabase/migrations](c:\Users\joynoit\Desktop\joyno\supabase\migrations)

### Calls performance issue
1. [public/src/views/extended.js](c:\Users\joynoit\Desktop\joyno\public\src\views\extended.js)
2. [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
3. [public/src/supabase/crm.js](c:\Users\joynoit\Desktop\joyno\public\src\supabase\crm.js)

### Import / duplicate detection issue
1. frontend review logic in [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
2. backend duplicate logic in [supabase/functions/_shared/lead_import.ts](c:\Users\joynoit\Desktop\joyno\supabase\functions\_shared\lead_import.ts)
3. commit/worker functions in:
   - [supabase/functions/lead-import-worker/index.ts](c:\Users\joynoit\Desktop\joyno\supabase\functions\lead-import-worker\index.ts)
   - [supabase/functions/lead-import-commit/index.ts](c:\Users\joynoit\Desktop\joyno\supabase\functions\lead-import-commit\index.ts)

## Product Rules To Preserve

- Table = list only
- Drawer/profile = details only
- Archive = soft archive, not hard delete
- User-facing copy should never mention:
  - database
  - duplicate detection internals
  - backend/storage terms
- Prefer agent-friendly wording:
  - what changes in the active list
  - what the user can do next
- Keep dark mode neutral charcoal, not blue-tinted
- Dashboard cards use `5px` radius

## Known Patterns

### Leads
- rows-only paged fetch
- cursor-backed next/previous paging
- server-side sort/filter
- debounced search
- bulk selection
- soft archive
- duplicate detection includes archived leads during import

### Team Attendance manual edit
- modal opens from [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js)
- save goes through Supabase attendance upsert path
- avoid forcing team filter to edited member after save

### Notifications
- toast UI exists in frontend
- bell should use real notification rows, not only derived counts

## Common Gotchas

- [public/src/app.js](c:\Users\joynoit\Desktop\joyno\public\src\app.js) is the real interaction hub for many surfaces even when the markup lives in a view file.
- Dark mode overrides often live much later in the CSS file than the base styles.
- Some UI state is split:
  - visible month vs selected date
  - route data vs cached page data
- Import duplicate logic can exist in both:
  - frontend review
  - backend worker/commit
- If a fix seems “saved but not visible,” it may be:
  - stale CSS
  - wrong section stylesheet
  - a later dark override
  - a central rerender path in `app.js`

## Small Change Workflow

For small UI/UX fixes, do this in order:

1. Identify the owning view file
2. Identify the owning section stylesheet
3. Check `app.js` only if behavior, modal flow, or save path is involved
4. Patch the smallest possible surface
5. Verify locally
6. Deploy only what changed

Avoid broad repo-wide searches unless the first owner file fails.

## Verification Matrix

### CSS-only or small UI tweak
- `npm run test:smoke`
- deploy hosting if the change is meant to go live

### Frontend JS change
- `node --check public/src/app.js` or touched JS file
- `npm run test:smoke`
- deploy hosting

### Supabase Edge Function change
- deploy the specific function only
- deploy hosting only if frontend also changed

### SQL / migration / RPC change
- create migration under [supabase/migrations](c:\Users\joynoit\Desktop\joyno\supabase\migrations)
- apply it to the actual Supabase project
- only then treat the feature as fully live

## Deployment Shortcuts

### Hosting
```powershell
firebase deploy --only hosting
```

### Specific Supabase functions
```powershell
npx supabase functions deploy auth-email-status
npx supabase functions deploy invite-upsert
npx supabase functions deploy invite-resolve
npx supabase functions deploy invite-remove
npx supabase functions deploy lead-import-worker
npx supabase functions deploy lead-import-commit
```

Adjust function name as needed.

## Search Tips

Use the fastest narrow search first.

Examples:
```powershell
Select-String -Path 'public\\src\\app.js' -Pattern 'openConfirmModal'
Select-String -Path 'public\\styles\\sections\\modals.css' -Pattern 'confirm-modal'
Select-String -Path 'public\\src\\views\\crm.js' -Pattern 'lead-bulk'
```

If `rg` is unavailable in the environment, use `Select-String`.

## Current Hotspots

These areas are more fragile and should be changed carefully:
- `Calls > Performance`
  - month/date state sync
  - heavy client-side loading
- attendance manager flows
  - save path vs view filters
- lead import
  - frontend review vs backend truth
- team invite/auth public flows
  - `auth-email-status`, `invite-resolve`, `invite-upsert`, and `invite-remove` must all be deployed
- CRM table width balancing
  - `Lead`, `Phone`, `Timezone`, `Interest`, and right-side action columns

## When Updating This File

Update `AGENTS.md` when:
- a feature owner file changes
- a major workflow moves
- a recurring gotcha is discovered
- deployment steps change

Keep it short, tactical, and biased toward faster small fixes.
