# Release Checklist

## Automated Gates

Run these before every production deploy:

```powershell
npm install
npm run release:check
```

Smoke coverage included in the repo:

- SPA shell boots on `#/`
- dashboard route renders without crashing
- profile route renders without crashing
- settings route renders without crashing
- invite route renders without crashing

## Required Backend State

Confirm these migrations are applied in production:

- `202603160004_messenger_realtime_publication.sql`
- `202603160005_dashboard_snapshot.sql`
- `202603160006_work_activity_realtime.sql`
- `202603160007_team_member_security_hardening.sql`
- `202603160008_backend_permission_hardening.sql`

Confirm these Supabase Edge Functions are deployed when in scope:

- `invite-resolve`
- `invite-upsert`
- `invite-remove`
- `lead-import-commit`
- Gmail functions if email is enabled later
- RingCentral functions if calls are enabled later

## Manual Smoke Pass

Use two real browser sessions for the live checks below.

### Auth And Access

- Sign in with a valid workspace member account.
- Confirm invite acceptance still works for a pending invite.
- Confirm blocked users do not get into the workspace.

### CRM

- Create, edit, archive, and delete one lead.
- Convert a qualified lead.
- Create, edit, and delete one contact.
- Create, edit, and delete one account.
- Create, edit, and delete one deal.

### Work

- Create a project and add members.
- Create a task, change status, reschedule it, add a checklist item, and delete it.
- Upload and delete a task attachment.
- Confirm the second session sees task and project changes without manual refresh.

### Messenger

- Send a direct message from session A to session B.
- Confirm session B receives it without refresh.
- Test reaction, edit, delete, read state, and typing indicator.
- Upload and delete a messenger attachment.

### Dashboard

- Open dashboard after sign-in and confirm it loads.
- Verify KPIs, recent activity, top deals, and due tasks render from live data.
- Confirm dashboard still loads after creating CRM and Work records.

### Team Security

- Member can update only self-service profile fields.
- Admin cannot promote, demote, deactivate, or delete the last owner.
- Non-owner cannot manage an owner account.
- Owner can manage owner-level actions.

### Attendance

- Clock in, start break, end break, and clock out.
- Create an attendance adjustment request.
- Review the request with a manager/admin account.

## Deferred Scope

These are intentionally not part of the current production gate:

- live RingCentral calling validation
- live SMS provider validation
- live Gmail send validation

Keep those blocked from final production sign-off until the integrations are configured and tested.
