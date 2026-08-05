begin;

create table if not exists public.lead_activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_type text not null,
  actor_member_id uuid references public.team_members(id) on delete set null,
  old_value jsonb not null default '{}'::jsonb,
  new_value jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_sales_touch boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  constraint lead_activity_events_type_check check (
    event_type in (
      'owner_changed',
      'archived',
      'unarchived',
      'field_changed',
      'bulk_reassigned'
    )
  )
);

create index if not exists lead_activity_events_workspace_created_idx
on public.lead_activity_events (workspace_id, created_at desc);

create index if not exists lead_activity_events_lead_created_idx
on public.lead_activity_events (lead_id, created_at desc);

create index if not exists lead_activity_events_workspace_type_idx
on public.lead_activity_events (workspace_id, event_type, created_at desc);

alter table public.lead_activity_events enable row level security;

drop policy if exists lead_activity_events_member_select on public.lead_activity_events;
create policy lead_activity_events_member_select
on public.lead_activity_events
for select
to authenticated
using (private.is_active_workspace_member(workspace_id));

drop policy if exists lead_activity_events_no_direct_insert on public.lead_activity_events;
create policy lead_activity_events_no_direct_insert
on public.lead_activity_events
for insert
to authenticated
with check (false);

drop policy if exists lead_activity_events_no_direct_update on public.lead_activity_events;
create policy lead_activity_events_no_direct_update
on public.lead_activity_events
for update
to authenticated
using (false)
with check (false);

drop policy if exists lead_activity_events_no_direct_delete on public.lead_activity_events;
create policy lead_activity_events_no_direct_delete
on public.lead_activity_events
for delete
to authenticated
using (false);

create or replace function private.capture_lead_activity_event()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_member_id uuid := new.updated_by_member_id;
  old_fields jsonb := '{}'::jsonb;
  new_fields jsonb := '{}'::jsonb;
  changed_fields jsonb := '[]'::jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.owner_member_id is distinct from new.owner_member_id then
    insert into public.lead_activity_events (
      workspace_id,
      lead_id,
      event_type,
      actor_member_id,
      old_value,
      new_value,
      metadata
    )
    values (
      new.workspace_id,
      new.id,
      'owner_changed',
      actor_member_id,
      jsonb_build_object('ownerMemberId', old.owner_member_id),
      jsonb_build_object('ownerMemberId', new.owner_member_id),
      jsonb_build_object('source', 'lead-update-trigger')
    );
  end if;

  if old.archived_at is null and new.archived_at is not null then
    insert into public.lead_activity_events (
      workspace_id,
      lead_id,
      event_type,
      actor_member_id,
      old_value,
      new_value,
      metadata
    )
    values (
      new.workspace_id,
      new.id,
      'archived',
      actor_member_id,
      jsonb_build_object('archivedAt', old.archived_at),
      jsonb_build_object('archivedAt', new.archived_at),
      jsonb_build_object('source', 'lead-update-trigger')
    );
  elsif old.archived_at is not null and new.archived_at is null then
    insert into public.lead_activity_events (
      workspace_id,
      lead_id,
      event_type,
      actor_member_id,
      old_value,
      new_value,
      metadata
    )
    values (
      new.workspace_id,
      new.id,
      'unarchived',
      actor_member_id,
      jsonb_build_object('archivedAt', old.archived_at),
      jsonb_build_object('archivedAt', new.archived_at),
      jsonb_build_object('source', 'lead-update-trigger')
    );
  end if;

  if old.name is distinct from new.name then
    old_fields := old_fields || jsonb_build_object('name', old.name);
    new_fields := new_fields || jsonb_build_object('name', new.name);
  end if;

  if old.company_name is distinct from new.company_name then
    old_fields := old_fields || jsonb_build_object('companyName', old.company_name);
    new_fields := new_fields || jsonb_build_object('companyName', new.company_name);
  end if;

  if old.email is distinct from new.email then
    old_fields := old_fields || jsonb_build_object('email', old.email);
    new_fields := new_fields || jsonb_build_object('email', new.email);
  end if;

  if old.phone is distinct from new.phone then
    old_fields := old_fields || jsonb_build_object('phone', old.phone);
    new_fields := new_fields || jsonb_build_object('phone', new.phone);
  end if;

  if old.secondary_phone is distinct from new.secondary_phone then
    old_fields := old_fields || jsonb_build_object('secondaryPhone', old.secondary_phone);
    new_fields := new_fields || jsonb_build_object('secondaryPhone', new.secondary_phone);
  end if;

  if old.role is distinct from new.role then
    old_fields := old_fields || jsonb_build_object('role', old.role);
    new_fields := new_fields || jsonb_build_object('role', new.role);
  end if;

  if old.interest is distinct from new.interest then
    old_fields := old_fields || jsonb_build_object('interest', old.interest);
    new_fields := new_fields || jsonb_build_object('interest', new.interest);
  end if;

  if old.source is distinct from new.source then
    old_fields := old_fields || jsonb_build_object('source', old.source);
    new_fields := new_fields || jsonb_build_object('source', new.source);
  end if;

  if old.next_follow_up_date is distinct from new.next_follow_up_date then
    old_fields := old_fields || jsonb_build_object('nextFollowUpDate', old.next_follow_up_date);
    new_fields := new_fields || jsonb_build_object('nextFollowUpDate', new.next_follow_up_date);
  end if;

  if old.tags is distinct from new.tags then
    old_fields := old_fields || jsonb_build_object('tags', old.tags);
    new_fields := new_fields || jsonb_build_object('tags', new.tags);
  end if;

  if old_fields <> '{}'::jsonb then
    select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
    into changed_fields
    from jsonb_object_keys(new_fields) as key;

    insert into public.lead_activity_events (
      workspace_id,
      lead_id,
      event_type,
      actor_member_id,
      old_value,
      new_value,
      metadata
    )
    values (
      new.workspace_id,
      new.id,
      'field_changed',
      actor_member_id,
      old_fields,
      new_fields,
      jsonb_build_object(
        'source', 'lead-update-trigger',
        'fields', changed_fields
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists capture_lead_activity_event on public.leads;
create trigger capture_lead_activity_event
after update on public.leads
for each row
execute function private.capture_lead_activity_event();

revoke all on table public.lead_activity_events from public;
revoke all on function private.capture_lead_activity_event() from public;
grant select on table public.lead_activity_events to authenticated;

commit;
