begin;

create index if not exists leads_dashboard_created_idx
on public.leads (workspace_id, created_at)
where archived_at is null;

create index if not exists leads_dashboard_status_updated_idx
on public.leads (workspace_id, status, updated_at)
where archived_at is null;

create index if not exists leads_weekly_attempt_candidates_idx
on public.leads (workspace_id, status, updated_at, id)
where archived_at is null
  and active_pool = true
  and (meta ->> 'attemptCount') = '3';

create index if not exists leads_weekly_redistribution_candidates_idx
on public.leads (workspace_id, status, owner_member_id, created_at, id)
where archived_at is null and active_pool = true;

create index if not exists deals_dashboard_stage_updated_idx
on public.deals (workspace_id, stage, updated_at)
where archived_at is null;

create index if not exists call_logs_dashboard_created_idx
on public.call_logs (workspace_id, member_id, created_at);

create or replace function private.dashboard_command_snapshot_fast_json(
  target_workspace_id uuid,
  p_range text default '30d'
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
  previous_start date;
  previous_end date;
  range_start_at timestamptz;
  range_end_at timestamptz;
  previous_start_at timestamptz;
  previous_end_at timestamptz;
  range_label text;
  compare_label text;
  viewer_member_id uuid;
  can_view_leads boolean := false;
  can_view_deals boolean := false;
  can_view_calls boolean := false;
  can_manage_calls boolean := false;
  total_leads_value integer := 0;
  total_leads_baseline integer := 0;
  revenue_value numeric := 0;
  revenue_baseline numeric := 0;
  open_deals_value integer := 0;
  open_deals_baseline integer := 0;
  calls_value integer := 0;
  calls_baseline integer := 0;
  contacted_value integer := 0;
  qualified_value integer := 0;
  proposal_value integer := 0;
  closed_value integer := 0;
begin
  if normalized_range not in ('today', '7d', '30d', 'mtd', 'qtd') then
    normalized_range := '30d';
  end if;

  if normalized_range = 'today' then
    range_start := today_date;
    previous_start := today_date - 1;
    previous_end := today_date - 1;
    range_label := 'Today';
    compare_label := 'vs yesterday';
  elsif normalized_range = '7d' then
    range_start := today_date - 6;
    previous_start := today_date - 13;
    previous_end := today_date - 7;
    range_label := 'Last 7 days';
    compare_label := 'vs previous 7 days';
  elsif normalized_range = 'mtd' then
    range_start := date_trunc('month', timezone('utc', now()))::date;
    previous_start := (range_start - interval '1 month')::date;
    previous_end := least(previous_start + (today_date - range_start), range_start - 1);
    range_label := 'Month to date';
    compare_label := 'vs previous MTD';
  elsif normalized_range = 'qtd' then
    range_start := date_trunc('quarter', timezone('utc', now()))::date;
    previous_start := (range_start - interval '3 months')::date;
    previous_end := least(previous_start + (today_date - range_start), range_start - 1);
    range_label := 'Quarter to date';
    compare_label := 'vs previous QTD';
  else
    range_start := today_date - 29;
    previous_start := today_date - 59;
    previous_end := today_date - 30;
    range_label := 'Last 30 days';
    compare_label := 'vs previous 30 days';
  end if;

  range_start_at := range_start::timestamp at time zone 'UTC';
  range_end_at := (range_end + 1)::timestamp at time zone 'UTC';
  previous_start_at := previous_start::timestamp at time zone 'UTC';
  previous_end_at := (previous_end + 1)::timestamp at time zone 'UTC';
  viewer_member_id := private.require_dashboard_viewer(target_workspace_id);
  can_view_leads := private.team_member_has_permission(target_workspace_id, viewer_member_id, 'leads', 'view');
  can_view_deals := private.team_member_has_permission(target_workspace_id, viewer_member_id, 'deals', 'view');
  can_view_calls := private.team_member_has_permission(target_workspace_id, viewer_member_id, 'calls', 'view');
  can_manage_calls := can_view_calls and private.can_manage_calls_workspace(target_workspace_id);

  select
    count(*) filter (where l.created_at >= range_start_at and l.created_at < range_end_at),
    count(*) filter (where l.created_at >= previous_start_at and l.created_at < previous_end_at),
    count(*) filter (where l.status = 'Contacted' and l.updated_at >= range_start_at and l.updated_at < range_end_at),
    count(*) filter (where l.status in ('Qualified', 'Converted') and l.updated_at >= range_start_at and l.updated_at < range_end_at)
  into total_leads_value, total_leads_baseline, contacted_value, qualified_value
  from public.leads l
  where can_view_leads and l.workspace_id = target_workspace_id and l.archived_at is null;

  select
    coalesce(sum(d.value_amount) filter (where d.stage = 'Won' and d.updated_at >= range_start_at and d.updated_at < range_end_at), 0),
    coalesce(sum(d.value_amount) filter (where d.stage = 'Won' and d.updated_at >= previous_start_at and d.updated_at < previous_end_at), 0),
    count(*) filter (where d.stage not in ('Won', 'Lost') and d.updated_at >= range_start_at and d.updated_at < range_end_at),
    count(*) filter (where d.stage not in ('Won', 'Lost') and d.updated_at >= previous_start_at and d.updated_at < previous_end_at),
    count(*) filter (where d.stage in ('Proposal', 'Negotiation') and d.updated_at >= range_start_at and d.updated_at < range_end_at),
    count(*) filter (where d.stage = 'Won' and d.updated_at >= range_start_at and d.updated_at < range_end_at)
  into revenue_value, revenue_baseline, open_deals_value, open_deals_baseline, proposal_value, closed_value
  from public.deals d
  where can_view_deals and d.workspace_id = target_workspace_id and d.archived_at is null;

  select
    count(*) filter (where cl.created_at >= range_start_at and cl.created_at < range_end_at),
    count(*) filter (where cl.created_at >= previous_start_at and cl.created_at < previous_end_at)
  into calls_value, calls_baseline
  from public.call_logs cl
  where can_view_calls and cl.workspace_id = target_workspace_id
    and (can_manage_calls or cl.member_id = viewer_member_id);

  return jsonb_build_object(
    'schemaVersion', 'command-sections-v3',
    'generatedAt', timezone('utc', now()),
    'range', normalized_range,
    'rangeLabel', range_label,
    'compareLabel', compare_label,
    'window', jsonb_build_object(
      'startDate', range_start, 'endDate', range_end,
      'previousStartDate', previous_start, 'previousEndDate', previous_end
    ),
    'kpis', jsonb_build_object(
      'totalLeads', jsonb_build_object('value', total_leads_value, 'baseline', total_leads_baseline, 'compareLabel', compare_label),
      'revenue', jsonb_build_object('value', revenue_value, 'baseline', revenue_baseline, 'compareLabel', compare_label),
      'openDeals', jsonb_build_object('value', open_deals_value, 'baseline', open_deals_baseline, 'compareLabel', compare_label),
      'callsToday', jsonb_build_object('value', calls_value, 'baseline', calls_baseline, 'compareLabel', compare_label)
    ),
    'pipelineStages', case when can_view_deals then coalesce((
      select jsonb_agg(jsonb_build_object('id', s.stage, 'label', s.stage, 'count', s.total, 'value', s.amount) order by s.stage)
      from (
        select d.stage, count(*)::integer total, coalesce(sum(d.value_amount), 0) amount
        from public.deals d
        where d.workspace_id = target_workspace_id and d.archived_at is null
          and d.updated_at >= range_start_at and d.updated_at < range_end_at
        group by d.stage
      ) s
    ), '[]'::jsonb) else '[]'::jsonb end,
    'leadStatusDistribution', case when can_view_leads then coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', lower(s.status), 'label', s.status,
        'color', case s.status when 'Contacted' then '#1f84f1' when 'New' then '#20b486' when 'Qualified' then '#f5a623' else '#e25555' end,
        'count', s.total
      ) order by s.status)
      from (
        select l.status, count(*)::integer total
        from public.leads l
        where l.workspace_id = target_workspace_id and l.archived_at is null
          and l.updated_at >= range_start_at and l.updated_at < range_end_at
        group by l.status
      ) s
    ), '[]'::jsonb) else '[]'::jsonb end,
    'salesFunnel', jsonb_build_array(
      jsonb_build_object('key', 'leads', 'label', 'Leads', 'count', total_leads_value, 'tone', 'leads'),
      jsonb_build_object('key', 'contacted', 'label', 'Contacted', 'count', contacted_value, 'tone', 'contacted'),
      jsonb_build_object('key', 'qualified', 'label', 'Qualified', 'count', qualified_value, 'tone', 'qualified'),
      jsonb_build_object('key', 'proposal', 'label', 'Proposal', 'count', proposal_value, 'tone', 'proposal'),
      jsonb_build_object('key', 'closed', 'label', 'Closed', 'count', closed_value, 'tone', 'closed')
    ),
    'topReps', case when can_view_deals then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'initials', upper(left(r.name, 1)),
        'dealsClosed', r.total, 'percent', case when closed_value > 0 then round(r.total::numeric * 100 / closed_value)::integer else 0 end
      ) order by r.total desc, r.name)
      from (
        select tm.id, coalesce(nullif(trim(tm.name), ''), 'Unknown') name, count(d.id)::integer total
        from public.team_members tm
        left join public.deals d on d.owner_member_id = tm.id and d.workspace_id = target_workspace_id
          and d.archived_at is null and d.stage = 'Won'
          and d.updated_at >= range_start_at and d.updated_at < range_end_at
        where tm.workspace_id = target_workspace_id and tm.status = 'Active'
        group by tm.id, tm.name order by count(d.id) desc limit 5
      ) r
    ), '[]'::jsonb) else '[]'::jsonb end,
    'pipelineTrend', jsonb_build_object(
      'currentStageMovements', total_leads_value + contacted_value + qualified_value + closed_value,
      'previousStageMovements', total_leads_baseline,
      'points', '[]'::jsonb
    ),
    'followUpTasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'assignee', coalesce(tm.name, 'Unassigned'),
        'dueDate', t.due_date, 'status', t.status
      ) order by t.due_date, t.created_at desc)
      from (
        select * from public.tasks
        where workspace_id = target_workspace_id and status <> 'Completed'
          and due_date between range_start and range_end
          and private.can_view_task(id, viewer_member_id)
        order by due_date, created_at desc limit 5
      ) t
      left join public.team_members tm on tm.id = t.assignee_member_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function private.dashboard_command_snapshot_fast_json(uuid, text) from public;

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
  where workspace_id = target_workspace_id and member_id = actor_member_id
    and range_key = normalized_range and expires_at > now()
  limit 1;
  if cached_snapshot is not null then
    return cached_snapshot || jsonb_build_object('cache', jsonb_build_object('status', 'fresh', 'range', normalized_range));
  end if;

  computed_snapshot := private.dashboard_snapshot_json(target_workspace_id)
    || private.dashboard_command_snapshot_fast_json(target_workspace_id, normalized_range);
  insert into public.dashboard_snapshot_cache (workspace_id, member_id, range_key, snapshot, computed_at, expires_at)
  values (target_workspace_id, actor_member_id, normalized_range, computed_snapshot, now(), now() + interval '60 seconds')
  on conflict (workspace_id, member_id, range_key) do update set
    snapshot = excluded.snapshot, computed_at = excluded.computed_at, expires_at = excluded.expires_at;
  return computed_snapshot || jsonb_build_object('cache', jsonb_build_object('status', 'refreshed', 'range', normalized_range));
end;
$$;

delete from public.dashboard_snapshot_cache;
revoke all on function public.get_dashboard_snapshot(text) from public;
grant execute on function public.get_dashboard_snapshot(text) to authenticated;

commit;
