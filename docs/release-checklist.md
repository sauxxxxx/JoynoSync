# JoynoSync release checklist

Use this checklist for every production release. A release is blocked when any required item fails.

## 1. Repository preflight

- [ ] `git status` contains only intended source, test, migration, asset, and documentation changes.
- [ ] No `.env`, provider credential, service-account file, browser artifact, export, log, or dependency folder is staged.
- [ ] Secret scanning reports no service-role key, JWT, OAuth secret, refresh token, or private key.
- [ ] `git diff --check` passes.
- [ ] The release commit and target branch are confirmed.

## 2. Automated release gate

```powershell
npm ci
npm run release:check
```

- [ ] JavaScript syntax checks pass.
- [ ] Unit tests pass.
- [ ] Playwright smoke tests pass.
- [ ] Any skipped live tests are documented and completed manually when required by the release.

## 3. Supabase verification

- [ ] The CLI is linked to the intended Supabase project.
- [ ] `npx supabase migration list` matches the target environment.
- [ ] Pending migration SQL has been reviewed.
- [ ] `npx supabase db push` succeeds without warnings or partial application.
- [ ] Runtime query verification migrations pass.
- [ ] Required Edge Functions are deployed individually.
- [ ] Function logs show no new authentication, CORS, validation, or database errors.
- [ ] Row Level Security and server-side permission checks are enabled for affected data.

## 4. Authentication and permissions UAT

- [ ] Owner can sign in, access all approved modules, and manage the workspace.
- [ ] Manager access matches the approved permission model.
- [ ] Agent access excludes administrative and restricted provider operations.
- [ ] Invitation, account setup, login, logout, and expired/invalid invite handling work.
- [ ] The last Owner cannot be demoted, deactivated, or removed.
- [ ] Local QA entry is visible only on loopback hosts and cannot write to Supabase.

## 5. CRM and lead lifecycle UAT

- [ ] Leads load, search, filter, sort, and paginate without stale rows or duplicates.
- [ ] Next and Previous page transitions remain stable under repeated switching.
- [ ] Lead ownership and bulk reassignment respect permissions.
- [ ] Archive remains a soft archive and records can be restored where supported.
- [ ] New-lead import reviews mappings, missing values, duplicates, and assignment before writing.
- [ ] Exported-lead update import matches by Lead ID and does not create unintended records.
- [ ] Blank update fields preserve values unless an explicit clear/reset option is selected.
- [ ] Import progress, results, error export, and rollback behave correctly.
- [ ] Contacts, Accounts, Deals, and detail/profile routes save and refresh correctly.

## 6. Work, attendance, and notifications UAT

- [ ] Dashboard metrics match source records for the selected range.
- [ ] My Work, Calendar, Kanban, Table, and Projects remain consistent after edits.
- [ ] Task permissions, reminders, recurrence, and project links behave correctly.
- [ ] Clock in/out and break start/end work across route re-entry.
- [ ] Overnight attendance and manager manual adjustments are correct.
- [ ] The notification bell uses real notification rows and read state persists.

## 7. RingCentral UAT

- [ ] Workspace connection test passes with server-side JWT credentials.
- [ ] Every calling agent is mapped to one valid RingCentral extension.
- [ ] The agent’s RingCentral device is open, signed in, and configured for RingOut.
- [ ] A controlled click-to-call rings the agent first and then the test destination.
- [ ] Provider events create or update the expected call history row.
- [ ] Last Activity updates automatically for a matched lead.
- [ ] Unmatched or ambiguous numbers remain reviewable and are not attached incorrectly.
- [ ] Call outcome is required.
- [ ] Active outcomes require a valid next task.
- [ ] Unsupported RingCentral features fail gracefully without breaking core synchronization.

## 8. UI, accessibility, and responsive review

- [ ] Light and dark themes preserve contrast and use the approved design language.
- [ ] Keyboard focus is visible and dialogs can be closed without a mouse.
- [ ] Form controls have accessible names and validation errors explain the correction.
- [ ] Tables, modals, navigation, and forms work at desktop, tablet, and mobile widths.
- [ ] Empty, loading, success, and failure states are understandable.
- [ ] No debug, Local QA, database, or implementation wording appears on production screens.

## 9. Deployment and post-release checks

- [ ] Database migrations are applied first.
- [ ] Required Edge Functions are deployed second.
- [ ] Live UAT passes before Hosting deployment.
- [ ] `firebase deploy --only hosting` succeeds.
- [ ] Production route smoke checks pass.
- [ ] Browser console and Supabase Function logs contain no new release errors.
- [ ] Rollback owner, rollback steps, and previous Hosting release are identified.

## Release decision

- [ ] All required checks passed: release approved.
- [ ] Any blocker failed: release rejected until corrected and retested.
