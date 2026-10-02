begin;

create or replace function public.qualify_and_handoff_configured_leads(
  p_lead_ids uuid[],
  p_allow_duplicates boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  actor_is_active_sales boolean := false;
  configured_owner_member_id uuid;
  destination_owner_member_id uuid;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  select exists (
    select 1
    from public.team_members member
    where member.id = actor_member_id
      and member.workspace_id = target_workspace_id
      and lower(trim(coalesce(member.status, ''))) = 'active'
      and lower(trim(coalesce(member.team, ''))) = 'sales'
  ) into actor_is_active_sales;

  select setting.qualified_owner_member_id
  into configured_owner_member_id
  from public.lead_qualification_settings setting
  join public.team_members owner
    on owner.id = setting.qualified_owner_member_id
   and owner.workspace_id = setting.workspace_id
   and lower(trim(coalesce(owner.status, ''))) = 'active'
  where setting.workspace_id = target_workspace_id;

  if configured_owner_member_id is null then
    raise exception 'The qualified lead fallback owner is not configured or is inactive. Ask an administrator to update the workspace setting.'
      using errcode = 'P0001';
  end if;

  destination_owner_member_id := case
    when actor_is_active_sales then actor_member_id
    else configured_owner_member_id
  end;

  return public.qualify_and_handoff_leads(
    p_lead_ids,
    destination_owner_member_id,
    p_allow_duplicates
  );
end;
$$;

revoke all on function public.qualify_and_handoff_configured_leads(uuid[], boolean) from public;
grant execute on function public.qualify_and_handoff_configured_leads(uuid[], boolean) to authenticated;

create table if not exists public.lead_qualification_owner_restore_audit (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  previous_owner_member_id uuid references public.team_members(id) on delete set null,
  restored_owner_member_id uuid not null references public.team_members(id) on delete restrict,
  qualification_occurred_at timestamptz,
  restored_at timestamptz not null default timezone('utc', now()),
  unique (batch_key, lead_id)
);

alter table public.lead_qualification_owner_restore_audit enable row level security;
revoke all on table public.lead_qualification_owner_restore_audit from public, anon, authenticated;

with first_qualification as (
  select distinct on (event.workspace_id, event.lead_id)
    event.workspace_id,
    event.lead_id,
    event.member_id,
    event.member_name,
    event.occurred_at
  from public.lead_status_events event
  where event.to_status = 'Qualified'
  order by event.workspace_id, event.lead_id, event.occurred_at, event.created_at, event.id
), candidates as (
  select
    lead.workspace_id,
    lead.id as lead_id,
    lead.owner_member_id as previous_owner_member_id,
    first_qualification.occurred_at as qualification_occurred_at,
    coalesce(
      original_owner.id,
      event_owner.id,
      named_event_owner.id,
      meta_owner.id
    ) as restored_owner_member_id
  from public.leads lead
  left join public.lead_qualification_backfill_audit original_audit
    on original_audit.workspace_id = lead.workspace_id
   and original_audit.lead_id = lead.id
   and original_audit.batch_key = '202608200003'
  left join public.team_members original_owner
    on original_owner.id = original_audit.previous_owner_member_id
   and original_owner.workspace_id = lead.workspace_id
   and lower(trim(coalesce(original_owner.status, ''))) = 'active'
   and lower(trim(coalesce(original_owner.team, ''))) = 'sales'
  left join first_qualification
    on first_qualification.workspace_id = lead.workspace_id
   and first_qualification.lead_id = lead.id
  left join public.team_members event_owner
    on event_owner.id = first_qualification.member_id
   and event_owner.workspace_id = lead.workspace_id
   and lower(trim(coalesce(event_owner.status, ''))) = 'active'
   and lower(trim(coalesce(event_owner.team, ''))) = 'sales'
  left join public.team_members named_event_owner
    on first_qualification.member_id is null
   and named_event_owner.workspace_id = lead.workspace_id
   and lower(trim(coalesce(named_event_owner.name, ''))) = lower(trim(coalesce(first_qualification.member_name, '')))
   and lower(trim(coalesce(named_event_owner.status, ''))) = 'active'
   and lower(trim(coalesce(named_event_owner.team, ''))) = 'sales'
  left join public.team_members meta_owner
    on meta_owner.id = case
      when coalesce(lead.meta ->> 'qualifiedByMemberId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (lead.meta ->> 'qualifiedByMemberId')::uuid
      else null
    end
   and meta_owner.workspace_id = lead.workspace_id
   and lower(trim(coalesce(meta_owner.status, ''))) = 'active'
   and lower(trim(coalesce(meta_owner.team, ''))) = 'sales'
  where lead.status = 'Qualified'
    and lead.archived_at is null
), restorable as (
  select *
  from candidates
  where restored_owner_member_id is not null
    and previous_owner_member_id is distinct from restored_owner_member_id
)
insert into public.lead_qualification_owner_restore_audit (
  batch_key,
  workspace_id,
  lead_id,
  previous_owner_member_id,
  restored_owner_member_id,
  qualification_occurred_at
)
select
  '202608240001',
  workspace_id,
  lead_id,
  previous_owner_member_id,
  restored_owner_member_id,
  qualification_occurred_at
from restorable
on conflict (batch_key, lead_id) do nothing;

update public.leads lead
set
  owner_member_id = audit.restored_owner_member_id,
  meta = coalesce(lead.meta, '{}'::jsonb) || jsonb_build_object(
    'qualifiedOwnerMemberId', audit.restored_owner_member_id,
    'qualificationOwnershipRestoredAt', audit.restored_at,
    'qualificationOwnershipRestoredFromMemberId', audit.previous_owner_member_id
  )
from public.lead_qualification_owner_restore_audit audit
where audit.batch_key = '202608240001'
  and audit.workspace_id = lead.workspace_id
  and audit.lead_id = lead.id
  and lead.status = 'Qualified'
  and lead.archived_at is null
  and lead.owner_member_id is distinct from audit.restored_owner_member_id;

delete from public.dashboard_snapshot_cache;

do $$
declare
  restored_count integer := 0;
begin
  select count(*) into restored_count
  from public.lead_qualification_owner_restore_audit
  where batch_key = '202608240001';
  raise notice 'Restored % qualified leads to active Sales owners without changing qualification timestamps.', restored_count;
end;
$$;

commit;
