begin;

create or replace function private.dashboard_qualification_snapshot_json(
  target_workspace_id uuid,
  p_range text,
  base_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  today_date date := timezone('utc', now())::date;
  normalized_range text := lower(trim(coalesce(p_range, '30d')));
  range_start date;
  range_end date := timezone('utc', now())::date;
  range_start_at timestamptz;
  range_end_at timestamptz;
  qualified_count integer := 0;
  previous_qualified_count integer := 0;
  qualification_rows jsonb := '[]'::jsonb;
  patched_funnel jsonb := '[]'::jsonb;
  patched_distribution jsonb := '[]'::jsonb;
  patched_snapshot jsonb := coalesce(base_snapshot, '{}'::jsonb);
  stage_movements integer := 0;
begin
  if normalized_range not in ('today', '7d', '30d', 'mtd', 'qtd') then
    normalized_range := '30d';
  end if;

  if normalized_range = 'today' then
    range_start := today_date;
  elsif normalized_range = '7d' then
    range_start := today_date - 6;
  elsif normalized_range = 'mtd' then
    range_start := date_trunc('month', timezone('utc', now()))::date;
  elsif normalized_range = 'qtd' then
    range_start := date_trunc('quarter', timezone('utc', now()))::date;
  else
    range_start := today_date - 29;
  end if;

  range_start_at := range_start::timestamp at time zone 'UTC';
  range_end_at := (range_end + 1)::timestamp at time zone 'UTC';

  with first_qualification as (
    select distinct on (event.lead_id)
      event.lead_id,
      event.member_id,
      event.member_name,
      event.occurred_at
    from public.lead_status_events event
    join public.leads lead
      on lead.id = event.lead_id
     and lead.workspace_id = event.workspace_id
    where event.workspace_id = target_workspace_id
      and event.to_status = 'Qualified'
      and lead.archived_at is null
    order by event.lead_id, event.occurred_at, event.created_at, event.id
  )
  select count(*)::integer
  into qualified_count
  from first_qualification
  where occurred_at >= range_start_at
    and occurred_at < range_end_at;

  with first_qualification as (
    select distinct on (event.lead_id)
      event.lead_id,
      event.member_id,
      event.member_name,
      event.occurred_at
    from public.lead_status_events event
    join public.leads lead
      on lead.id = event.lead_id
     and lead.workspace_id = event.workspace_id
    where event.workspace_id = target_workspace_id
      and event.to_status = 'Qualified'
      and lead.archived_at is null
    order by event.lead_id, event.occurred_at, event.created_at, event.id
  ), attributed as (
    select
      coalesce(first_event.member_id, member_by_name.id) as member_id,
      count(*)::integer as qualified_count
    from first_qualification first_event
    left join public.team_members member_by_name
      on first_event.member_id is null
     and member_by_name.workspace_id = target_workspace_id
     and lower(trim(member_by_name.name)) = lower(trim(first_event.member_name))
    where first_event.occurred_at >= range_start_at
      and first_event.occurred_at < range_end_at
    group by coalesce(first_event.member_id, member_by_name.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'memberId', member.id,
    'name', member.name,
    'qualifiedCount', coalesce(attributed.qualified_count, 0)
  ) order by lower(member.name)), '[]'::jsonb)
  into qualification_rows
  from public.team_members member
  left join attributed on attributed.member_id = member.id
  where member.workspace_id = target_workspace_id
    and lower(trim(coalesce(member.status, ''))) = 'active'
    and lower(trim(coalesce(member.team, ''))) = 'sales';

  select coalesce(max((stage ->> 'count')::integer), 0)
  into previous_qualified_count
  from jsonb_array_elements(coalesce(patched_snapshot -> 'salesFunnel', '[]'::jsonb)) stage
  where stage ->> 'key' = 'qualified';

  select coalesce(jsonb_agg(
    case when stage ->> 'key' = 'qualified'
      then jsonb_set(stage, '{count}', to_jsonb(qualified_count), true)
      else stage end
    order by position
  ), '[]'::jsonb)
  into patched_funnel
  from jsonb_array_elements(coalesce(patched_snapshot -> 'salesFunnel', '[]'::jsonb))
    with ordinality as stages(stage, position);

  select coalesce(jsonb_agg(
    case when status ->> 'key' = 'qualified'
      then jsonb_set(status, '{count}', to_jsonb(qualified_count), true)
      else status end
    order by position
  ), '[]'::jsonb)
  into patched_distribution
  from jsonb_array_elements(coalesce(patched_snapshot -> 'leadStatusDistribution', '[]'::jsonb))
    with ordinality as statuses(status, position);

  if not exists (
    select 1
    from jsonb_array_elements(patched_distribution) status
    where status ->> 'key' = 'qualified'
  ) then
    patched_distribution := patched_distribution || jsonb_build_array(jsonb_build_object(
      'key', 'qualified',
      'label', 'Qualified',
      'color', '#f5a623',
      'count', qualified_count
    ));
  end if;

  patched_snapshot := jsonb_set(patched_snapshot, '{salesFunnel}', patched_funnel, true);
  patched_snapshot := jsonb_set(patched_snapshot, '{leadStatusDistribution}', patched_distribution, true);
  patched_snapshot := jsonb_set(patched_snapshot, '{qualificationPerformance}', qualification_rows, true);

  if jsonb_typeof(patched_snapshot -> 'pipelineTrend') = 'object' then
    stage_movements := greatest(
      0,
      coalesce((patched_snapshot #>> '{pipelineTrend,currentStageMovements}')::integer, 0)
        - previous_qualified_count
        + qualified_count
    );
    patched_snapshot := jsonb_set(
      patched_snapshot,
      '{pipelineTrend,currentStageMovements}',
      to_jsonb(stage_movements),
      true
    );
  end if;

  return patched_snapshot;
end;
$$;

revoke all on function private.dashboard_qualification_snapshot_json(uuid, text, jsonb) from public;

create or replace function public.get_dashboard_snapshot(p_range text default '30d')
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  normalized_range text := lower(trim(coalesce(p_range, '30d')));
  cached_snapshot jsonb;
  computed_snapshot jsonb;
begin
  if normalized_range not in ('today', '7d', '30d', 'mtd', 'qtd') then
    normalized_range := '30d';
  end if;

  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_dashboard_viewer(target_workspace_id);

  select snapshot into cached_snapshot
  from public.dashboard_snapshot_cache
  where workspace_id = target_workspace_id
    and member_id = actor_member_id
    and range_key = normalized_range
    and expires_at > now()
  limit 1;

  if cached_snapshot is not null then
    return cached_snapshot || jsonb_build_object(
      'cache', jsonb_build_object('status', 'fresh', 'range', normalized_range)
    );
  end if;

  computed_snapshot := private.dashboard_snapshot_json(target_workspace_id)
    || private.dashboard_command_snapshot_fast_json(target_workspace_id, normalized_range);
  computed_snapshot := private.dashboard_qualification_snapshot_json(
    target_workspace_id,
    normalized_range,
    computed_snapshot
  );

  insert into public.dashboard_snapshot_cache (
    workspace_id, member_id, range_key, snapshot, computed_at, expires_at
  )
  values (
    target_workspace_id, actor_member_id, normalized_range, computed_snapshot, now(), now() + interval '60 seconds'
  )
  on conflict (workspace_id, member_id, range_key) do update set
    snapshot = excluded.snapshot,
    computed_at = excluded.computed_at,
    expires_at = excluded.expires_at;

  return computed_snapshot || jsonb_build_object(
    'cache', jsonb_build_object('status', 'refreshed', 'range', normalized_range)
  );
end;
$$;

delete from public.dashboard_snapshot_cache;

revoke all on function public.get_dashboard_snapshot(text) from public;
grant execute on function public.get_dashboard_snapshot(text) to authenticated;

commit;
