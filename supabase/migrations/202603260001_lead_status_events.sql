begin;

create table if not exists public.lead_status_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  member_id uuid references public.team_members(id) on delete set null,
  from_status text not null default '',
  to_status text not null,
  lead_name text not null default '',
  member_name text not null default '',
  department text not null default '',
  occurred_at timestamptz not null default timezone('utc', now()),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint lead_status_events_to_status_check check (to_status in ('Contacted', 'Qualified', 'Unqualified')),
  constraint lead_status_events_from_status_check check (
    from_status = '' or from_status in ('New', 'Contacted', 'Qualified', 'Unqualified', 'Converted')
  )
);

create index if not exists lead_status_events_workspace_occurred_idx
on public.lead_status_events (workspace_id, occurred_at desc);

create index if not exists lead_status_events_workspace_member_idx
on public.lead_status_events (workspace_id, member_id, occurred_at desc);

create index if not exists lead_status_events_workspace_status_idx
on public.lead_status_events (workspace_id, to_status, occurred_at desc);

alter table public.lead_status_events enable row level security;

drop policy if exists "lead_status_events_member_select" on public.lead_status_events;
create policy "lead_status_events_member_select"
on public.lead_status_events
for select
to authenticated
using (private.is_active_workspace_member(workspace_id));

drop policy if exists "lead_status_events_member_insert" on public.lead_status_events;
create policy "lead_status_events_member_insert"
on public.lead_status_events
for insert
to authenticated
with check (private.is_active_workspace_member(workspace_id));

drop policy if exists "lead_status_events_manager_delete" on public.lead_status_events;
create policy "lead_status_events_manager_delete"
on public.lead_status_events
for delete
to authenticated
using (private.can_manage_workspace(workspace_id));

create or replace function private.capture_lead_status_event()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_member public.team_members%rowtype;
  actor_name text := '';
  actor_department text := '';
  meta_actor_name text := nullif(trim(coalesce(new.meta ->> 'lastStatusChangedByName', '')), '');
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if coalesce(new.status, '') is not distinct from coalesce(old.status, '') then
    return new;
  end if;

  if new.status not in ('Contacted', 'Qualified', 'Unqualified') then
    return new;
  end if;

  if new.updated_by_member_id is not null then
    select *
    into actor_member
    from public.team_members tm
    where tm.id = new.updated_by_member_id
    limit 1;

    actor_name := trim(coalesce(actor_member.name, ''));
    actor_department := trim(coalesce(actor_member.team, ''));
  end if;

  insert into public.lead_status_events (
    workspace_id,
    lead_id,
    member_id,
    from_status,
    to_status,
    lead_name,
    member_name,
    department,
    occurred_at,
    meta
  )
  values (
    new.workspace_id,
    new.id,
    new.updated_by_member_id,
    coalesce(old.status, ''),
    new.status,
    coalesce(new.name, ''),
    coalesce(nullif(actor_name, ''), meta_actor_name, ''),
    coalesce(actor_department, ''),
    coalesce(new.updated_at, timezone('utc', now())),
    jsonb_strip_nulls(
      jsonb_build_object(
        'source', 'lead-status-trigger',
        'lastStatusChangedAt', new.meta ->> 'lastStatusChangedAt',
        'lastStatusChangedFrom', new.meta ->> 'lastStatusChangedFrom',
        'lastStatusChangedTo', new.meta ->> 'lastStatusChangedTo'
      )
    )
  );

  return new;
end;
$$;

drop trigger if exists capture_lead_status_event on public.leads;
create trigger capture_lead_status_event
after update on public.leads
for each row
execute function private.capture_lead_status_event();

with seeded_leads as (
  select
    l.workspace_id,
    l.id as lead_id,
    l.name as lead_name,
    coalesce(nullif(trim(coalesce(l.meta ->> 'lastStatusChangedFrom', '')), ''), '') as from_status,
    trim(coalesce(l.meta ->> 'lastStatusChangedTo', '')) as to_status,
    coalesce(
      nullif(trim(coalesce(l.meta ->> 'lastStatusChangedAt', '')), '')::timestamptz,
      l.updated_at
    ) as occurred_at,
    case
      when coalesce(l.meta ->> 'lastStatusChangedByMemberId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (l.meta ->> 'lastStatusChangedByMemberId')::uuid
      else l.updated_by_member_id
    end as member_id,
    nullif(trim(coalesce(l.meta ->> 'lastStatusChangedByName', '')), '') as meta_member_name
  from public.leads l
  where trim(coalesce(l.meta ->> 'lastStatusChangedTo', '')) in ('Contacted', 'Qualified', 'Unqualified')
    and coalesce(
      nullif(trim(coalesce(l.meta ->> 'lastStatusChangedAt', '')), '')::timestamptz,
      l.updated_at
    ) is not null
)
insert into public.lead_status_events (
  workspace_id,
  lead_id,
  member_id,
  from_status,
  to_status,
  lead_name,
  member_name,
  department,
  occurred_at,
  meta
)
select
  seeded.workspace_id,
  seeded.lead_id,
  seeded.member_id,
  seeded.from_status,
  seeded.to_status,
  coalesce(seeded.lead_name, ''),
  coalesce(nullif(trim(coalesce(tm.name, '')), ''), seeded.meta_member_name, ''),
  trim(coalesce(tm.team, '')),
  seeded.occurred_at,
  jsonb_build_object('seededFromLeadMeta', true)
from seeded_leads seeded
left join public.team_members tm on tm.id = seeded.member_id
where not exists (
  select 1
  from public.lead_status_events existing
  where existing.lead_id = seeded.lead_id
    and existing.to_status = seeded.to_status
    and existing.occurred_at = seeded.occurred_at
);

commit;
