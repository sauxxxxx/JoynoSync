begin;

create table if not exists public.lead_qualification_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  qualified_owner_member_id uuid not null references public.team_members(id) on delete restrict,
  configured_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_lead_qualification_settings_updated_at on public.lead_qualification_settings;
create trigger set_lead_qualification_settings_updated_at
before update on public.lead_qualification_settings
for each row execute function public.set_updated_at();

alter table public.lead_qualification_settings enable row level security;
revoke all on table public.lead_qualification_settings from public, anon, authenticated;

do $$
declare
  exact_owner_count integer := 0;
begin
  select count(*) into exact_owner_count
  from public.team_members member
  where lower(trim(regexp_replace(coalesce(member.name, ''), '\s+', ' ', 'g'))) = 'lynn cajeta'
    and lower(coalesce(member.status, '')) = 'active';

  if exact_owner_count = 0 then
    raise exception 'Active team member Lynn Cajeta was not found. No qualification setting or backfill was applied.';
  end if;

  if exists (
    select 1
    from public.team_members member
    where lower(trim(regexp_replace(coalesce(member.name, ''), '\s+', ' ', 'g'))) = 'lynn cajeta'
      and lower(coalesce(member.status, '')) = 'active'
    group by member.workspace_id
    having count(*) <> 1
  ) then
    raise exception 'More than one active Lynn Cajeta exists in a workspace. Resolve the duplicate team record first.';
  end if;
end;
$$;

insert into public.lead_qualification_settings (
  workspace_id,
  qualified_owner_member_id,
  configured_by_member_id
)
select
  member.workspace_id,
  member.id,
  null
from public.team_members member
where lower(trim(regexp_replace(coalesce(member.name, ''), '\s+', ' ', 'g'))) = 'lynn cajeta'
  and lower(coalesce(member.status, '')) = 'active'
on conflict (workspace_id) do update set
  qualified_owner_member_id = excluded.qualified_owner_member_id,
  configured_by_member_id = excluded.configured_by_member_id;

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
  configured_owner_member_id uuid;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  select setting.qualified_owner_member_id
  into configured_owner_member_id
  from public.lead_qualification_settings setting
  join public.team_members owner
    on owner.id = setting.qualified_owner_member_id
   and owner.workspace_id = setting.workspace_id
   and lower(coalesce(owner.status, '')) = 'active'
  where setting.workspace_id = target_workspace_id;

  if configured_owner_member_id is null then
    raise exception 'The qualified lead owner is not configured or is inactive. Ask an administrator to update the workspace setting.'
      using errcode = 'P0001';
  end if;

  return public.qualify_and_handoff_leads(
    p_lead_ids,
    configured_owner_member_id,
    p_allow_duplicates
  );
end;
$$;

revoke all on function public.qualify_and_handoff_configured_leads(uuid[], boolean) from public;
grant execute on function public.qualify_and_handoff_configured_leads(uuid[], boolean) to authenticated;
revoke execute on function public.qualify_and_handoff_leads(uuid[], uuid, boolean) from authenticated;

create table if not exists public.lead_qualification_backfill_audit (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  previous_owner_member_id uuid references public.team_members(id) on delete set null,
  qualified_owner_member_id uuid not null references public.team_members(id) on delete restrict,
  backfilled_at timestamptz not null default timezone('utc', now()),
  unique (batch_key, lead_id)
);

alter table public.lead_qualification_backfill_audit enable row level security;
revoke all on table public.lead_qualification_backfill_audit from public, anon, authenticated;

insert into public.lead_qualification_backfill_audit (
  batch_key,
  workspace_id,
  lead_id,
  previous_owner_member_id,
  qualified_owner_member_id
)
select
  '202608200003',
  lead.workspace_id,
  lead.id,
  lead.owner_member_id,
  setting.qualified_owner_member_id
from public.leads lead
join public.lead_qualification_settings setting on setting.workspace_id = lead.workspace_id
where lead.status = 'Qualified'
  and lead.archived_at is null
  and lead.owner_member_id is distinct from setting.qualified_owner_member_id
on conflict (batch_key, lead_id) do nothing;

update public.leads lead
set
  owner_member_id = audit.qualified_owner_member_id,
  active_pool = true,
  meta = coalesce(lead.meta, '{}'::jsonb) || jsonb_build_object(
    'qualificationHandoffHistory',
      coalesce(
        case when jsonb_typeof(lead.meta -> 'qualificationHandoffHistory') = 'array'
          then lead.meta -> 'qualificationHandoffHistory' end,
        '[]'::jsonb
      ) || jsonb_build_array(jsonb_build_object(
        'qualifiedAt', audit.backfilled_at,
        'qualifiedByMemberId', null,
        'qualifiedByName', 'System backfill',
        'previousOwnerMemberId', audit.previous_owner_member_id,
        'previousStatus', 'Qualified',
        'destinationOwnerMemberId', audit.qualified_owner_member_id,
        'destinationOwnerName', 'Lynn Cajeta',
        'duplicateCount', 0,
        'duplicatesConfirmed', false,
        'source', audit.batch_key
      )),
    'qualifiedOwnerMemberId', audit.qualified_owner_member_id
  ),
  updated_by_member_id = null
from public.lead_qualification_backfill_audit audit
where audit.batch_key = '202608200003'
  and audit.lead_id = lead.id
  and audit.workspace_id = lead.workspace_id;

do $$
declare
  backfilled_count integer := 0;
begin
  select count(*) into backfilled_count
  from public.lead_qualification_backfill_audit
  where batch_key = '202608200003';
  raise notice 'Configured Lynn Cajeta as qualified lead owner and reassigned % existing qualified leads.', backfilled_count;
end;
$$;

commit;
