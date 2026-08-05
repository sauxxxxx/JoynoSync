begin;

alter table public.team_members
  add column if not exists phone text not null default '',
  add column if not exists title text not null default '',
  add column if not exists avatar_url text not null default '',
  add column if not exists language text not null default 'English',
  add column if not exists availability text not null default 'Online',
  add column if not exists manager text not null default '',
  add column if not exists shift text not null default '09:00-18:00',
  add column if not exists workload integer not null default 0,
  add column if not exists scope text not null default 'own',
  add column if not exists queue_eligible boolean not null default true,
  add column if not exists default_owner boolean not null default false,
  add column if not exists notifications jsonb not null default '{"inApp": true, "email": true, "sms": false}'::jsonb,
  add column if not exists communication jsonb not null default '{"senderName": "", "signature": ""}'::jsonb,
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists updated_by_name text not null default '';

update public.team_members
set
  phone = coalesce(nullif(trim(phone), ''), ''),
  title = coalesce(nullif(trim(title), ''), ''),
  avatar_url = coalesce(nullif(trim(avatar_url), ''), ''),
  language = case
    when trim(coalesce(language, '')) = '' then 'English'
    else trim(language)
  end,
  availability = case lower(trim(coalesce(availability, '')))
    when 'away' then 'Away'
    when 'offline' then 'Offline'
    else 'Online'
  end,
  manager = coalesce(nullif(trim(manager), ''), ''),
  shift = case
    when trim(coalesce(shift, '')) = '' then '09:00-18:00'
    else trim(shift)
  end,
  workload = least(100, greatest(0, coalesce(workload, 0))),
  scope = case
    when lower(trim(coalesce(scope, ''))) in ('own', 'team', 'all') then lower(trim(scope))
    when lower(trim(coalesce(role, ''))) in ('owner', 'admin') then 'all'
    when lower(trim(coalesce(role, ''))) = 'manager' then 'team'
    else 'own'
  end,
  queue_eligible = coalesce(queue_eligible, true),
  default_owner = coalesce(default_owner, false),
  notifications = case
    when jsonb_typeof(notifications) = 'object' then jsonb_build_object(
      'inApp', coalesce((notifications ->> 'inApp')::boolean, true),
      'email', coalesce((notifications ->> 'email')::boolean, true),
      'sms', coalesce((notifications ->> 'sms')::boolean, false)
    )
    else '{"inApp": true, "email": true, "sms": false}'::jsonb
  end,
  communication = case
    when jsonb_typeof(communication) = 'object' then jsonb_build_object(
      'senderName', coalesce(nullif(trim(communication ->> 'senderName'), ''), trim(name), 'User'),
      'signature', coalesce(communication ->> 'signature', '')
    )
    else jsonb_build_object(
      'senderName', coalesce(nullif(trim(name), ''), 'User'),
      'signature', ''
    )
  end,
  permissions = case
    when jsonb_typeof(permissions) = 'object' then permissions
    else '{}'::jsonb
  end,
  updated_by_name = coalesce(nullif(trim(updated_by_name), ''), '');

alter table public.team_members
  drop constraint if exists team_members_availability_check,
  drop constraint if exists team_members_scope_check,
  drop constraint if exists team_members_workload_check;

alter table public.team_members
  add constraint team_members_availability_check check (availability in ('Online', 'Away', 'Offline')),
  add constraint team_members_scope_check check (scope in ('own', 'team', 'all')),
  add constraint team_members_workload_check check (workload >= 0 and workload <= 100);

drop policy if exists "active_user_can_refresh_own_team_member" on public.team_members;
create policy "active_user_can_refresh_own_team_member"
on public.team_members
for update
to authenticated
using (
  workspace_id = private.current_workspace_id()
  and auth_user_id = auth.uid()
  and status = 'Active'
)
with check (
  workspace_id = private.current_workspace_id()
  and auth_user_id = auth.uid()
  and status = 'Active'
);

commit;
