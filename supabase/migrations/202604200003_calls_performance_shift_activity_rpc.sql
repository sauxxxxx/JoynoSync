begin;

create or replace function public.get_calls_performance_shift_activity(
  p_workspace_id uuid,
  p_start_at timestamptz,
  p_end_before timestamptz,
  p_time_zone text default 'UTC',
  p_shift_start text default '09:00',
  p_shift_end text default '18:00'
)
returns table (
  id text,
  workspace_id text,
  lead_id text,
  lead_name text,
  from_status text,
  outcome text,
  agent_id text,
  agent_name text,
  department text,
  occurred_at timestamptz,
  occurred_date text,
  shift_date text,
  direction text,
  meta jsonb
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  normalized_time_zone text := nullif(trim(coalesce(p_time_zone, '')), '');
  shift_start_minutes integer := 540;
  shift_end_minutes integer := 1080;
  shift_start_match text[];
  shift_end_match text[];
begin
  if p_workspace_id is null or p_start_at is null or p_end_before is null then
    return;
  end if;

  if not private.is_active_workspace_member(p_workspace_id) then
    return;
  end if;

  if normalized_time_zone is null or lower(normalized_time_zone) = 'local' then
    normalized_time_zone := 'UTC';
  end if;

  begin
    perform timezone(normalized_time_zone, now());
  exception when others then
    normalized_time_zone := 'UTC';
  end;

  shift_start_match := regexp_match(trim(coalesce(p_shift_start, '09:00')), '^(\d{1,2}):(\d{2})');
  if shift_start_match is not null then
    shift_start_minutes := greatest(
      0,
      least(
        1439,
        coalesce(shift_start_match[1]::integer, 9) * 60 + coalesce(shift_start_match[2]::integer, 0)
      )
    );
  end if;

  shift_end_match := regexp_match(trim(coalesce(p_shift_end, '18:00')), '^(\d{1,2}):(\d{2})');
  if shift_end_match is not null then
    shift_end_minutes := greatest(
      0,
      least(
        1439,
        coalesce(shift_end_match[1]::integer, 18) * 60 + coalesce(shift_end_match[2]::integer, 0)
      )
    );
  end if;

  return query
  with scoped_events as (
    select
      e.id as event_id,
      e.workspace_id as event_workspace_id,
      e.lead_id as event_lead_id,
      e.lead_name as event_lead_name,
      e.from_status as event_from_status,
      e.to_status as event_outcome,
      e.member_id as event_member_id,
      e.member_name as event_member_name,
      e.department as event_department,
      e.occurred_at as event_occurred_at,
      e.meta as event_meta,
      timezone(normalized_time_zone, e.occurred_at) as local_occurred_at
    from public.lead_status_events e
    where e.workspace_id = p_workspace_id
      and e.occurred_at >= p_start_at
      and e.occurred_at < p_end_before
      and e.to_status in ('New', 'Contacted', 'Qualified', 'Unqualified')
  ),
  shifted_events as (
    select
      scoped.*,
      case
        when shift_end_minutes < shift_start_minutes
          and (extract(hour from scoped.local_occurred_at)::integer * 60 + extract(minute from scoped.local_occurred_at)::integer) < shift_end_minutes
          then (scoped.local_occurred_at::date - 1)
        else scoped.local_occurred_at::date
      end as event_shift_date
    from scoped_events scoped
  ),
  latest_by_lead_shift as (
    select
      shifted.*,
      row_number() over (
        partition by shifted.event_lead_id, shifted.event_shift_date
        order by shifted.event_occurred_at desc, shifted.event_id desc
      ) as row_rank
    from shifted_events shifted
  )
  select
    latest.event_id::text as id,
    latest.event_workspace_id::text as workspace_id,
    latest.event_lead_id::text as lead_id,
    coalesce(latest.event_lead_name, 'Lead') as lead_name,
    coalesce(latest.event_from_status, '') as from_status,
    latest.event_outcome as outcome,
    coalesce(latest.event_member_id::text, '') as agent_id,
    coalesce(nullif(trim(latest.event_member_name), ''), 'Unassigned') as agent_name,
    coalesce(latest.event_department, '') as department,
    latest.event_occurred_at as occurred_at,
    latest.event_occurred_at::date::text as occurred_date,
    latest.event_shift_date::text as shift_date,
    'Outbound'::text as direction,
    coalesce(latest.event_meta, '{}'::jsonb) as meta
  from latest_by_lead_shift latest
  where latest.row_rank = 1
    and latest.event_outcome in ('Contacted', 'Qualified', 'Unqualified')
  order by latest.event_occurred_at desc, latest.event_id desc;
end;
$$;

revoke all on function public.get_calls_performance_shift_activity(uuid, timestamptz, timestamptz, text, text, text) from public;
grant execute on function public.get_calls_performance_shift_activity(uuid, timestamptz, timestamptz, text, text, text) to authenticated;

commit;
