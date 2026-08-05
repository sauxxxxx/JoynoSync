begin;

create schema if not exists private;
revoke all on schema private from public;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function private.current_user_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function private.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select tm.workspace_id
  from public.team_members tm
  where tm.auth_user_id = auth.uid()
     or lower(tm.email) = private.current_user_email()
  order by
    case
      when tm.status = 'Active' then 0
      when tm.status = 'Pending Invite' then 1
      when tm.status = 'Inactive' then 2
      else 3
    end,
    coalesce(tm.updated_at, tm.invite_last_sent_at, tm.invited_at) desc
  limit 1;
$$;

create or replace function private.current_team_status()
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select tm.status
  from public.team_members tm
  where tm.auth_user_id = auth.uid()
     or lower(tm.email) = private.current_user_email()
  order by
    case
      when tm.status = 'Active' then 0
      when tm.status = 'Pending Invite' then 1
      when tm.status = 'Inactive' then 2
      else 3
    end,
    coalesce(tm.updated_at, tm.invite_last_sent_at, tm.invited_at) desc
  limit 1;
$$;

create or replace function private.current_team_role()
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select tm.role
  from public.team_members tm
  where tm.auth_user_id = auth.uid()
     or lower(tm.email) = private.current_user_email()
  order by
    case
      when tm.status = 'Active' then 0
      when tm.status = 'Pending Invite' then 1
      when tm.status = 'Inactive' then 2
      else 3
    end,
    coalesce(tm.updated_at, tm.invite_last_sent_at, tm.invited_at) desc
  limit 1;
$$;

create or replace function private.is_active_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.workspace_id = target_workspace_id
      and (tm.auth_user_id = auth.uid() or lower(tm.email) = private.current_user_email())
      and tm.status = 'Active'
  );
$$;

create or replace function private.can_manage_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.workspace_id = target_workspace_id
      and (tm.auth_user_id = auth.uid() or lower(tm.email) = private.current_user_email())
      and tm.status = 'Active'
      and tm.role in ('Owner', 'Admin', 'Manager')
  );
$$;

revoke all on function private.current_workspace_id() from public;
revoke all on function private.current_team_status() from public;
revoke all on function private.current_team_role() from public;
revoke all on function private.is_active_workspace_member(uuid) from public;
revoke all on function private.can_manage_workspace(uuid) from public;

grant execute on function private.current_workspace_id() to authenticated;
grant execute on function private.current_team_status() to authenticated;
grant execute on function private.current_team_role() to authenticated;
grant execute on function private.is_active_workspace_member(uuid) to authenticated;
grant execute on function private.can_manage_workspace(uuid) to authenticated;

alter table public.workspaces enable row level security;
alter table public.team_members enable row level security;

drop policy if exists "members can read own workspace" on public.workspaces;
create policy "members can read own workspace"
on public.workspaces
for select
to authenticated
using (
  id = private.current_workspace_id()
  and private.current_team_status() in ('Pending Invite', 'Active')
);

drop policy if exists "members can read workspace team" on public.team_members;
create policy "members can read workspace team"
on public.team_members
for select
to authenticated
using (
  lower(email) = private.current_user_email()
  or (
    workspace_id = private.current_workspace_id()
    and private.current_team_status() = 'Active'
  )
);

drop policy if exists "owner_admin can invite team" on public.team_members;
create policy "owner_admin can invite team"
on public.team_members
for insert
to authenticated
with check (
  workspace_id = private.current_workspace_id()
  and private.current_team_status() = 'Active'
  and private.current_team_role() in ('Owner', 'Admin')
);

drop policy if exists "owner_admin can update workspace team" on public.team_members;
create policy "owner_admin can update workspace team"
on public.team_members
for update
to authenticated
using (
  workspace_id = private.current_workspace_id()
  and private.current_team_status() = 'Active'
  and private.current_team_role() in ('Owner', 'Admin')
)
with check (
  workspace_id = private.current_workspace_id()
  and private.current_team_status() = 'Active'
  and private.current_team_role() in ('Owner', 'Admin')
);

drop policy if exists "owner_admin can delete workspace team" on public.team_members;
create policy "owner_admin can delete workspace team"
on public.team_members
for delete
to authenticated
using (
  workspace_id = private.current_workspace_id()
  and private.current_team_status() = 'Active'
  and private.current_team_role() in ('Owner', 'Admin')
);

drop policy if exists "pending_invite_user_can_activate_self" on public.team_members;
create policy "pending_invite_user_can_activate_self"
on public.team_members
for update
to authenticated
using (
  lower(email) = private.current_user_email()
  and status = 'Pending Invite'
)
with check (
  lower(email) = private.current_user_email()
  and auth_user_id = auth.uid()
  and status = 'Active'
);

drop policy if exists "active_user_can_refresh_own_team_member" on public.team_members;
create policy "active_user_can_refresh_own_team_member"
on public.team_members
for update
to authenticated
using (
  lower(email) = private.current_user_email()
  or auth_user_id = auth.uid()
)
with check (
  lower(email) = private.current_user_email()
  and auth_user_id = auth.uid()
  and status = 'Active'
);

commit;
