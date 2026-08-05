begin;

create or replace function private.dashboard_command_snapshot_json(target_workspace_id uuid, p_range text default '30d')
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  today_date date := timezone('utc', now())::date;
  normalized_range text := lower(trim(coalesce(p_range, '30d')));
  month_start date := date_trunc('month', timezone('utc', now()))::date;
  previous_month_start date := (date_trunc('month', timezone('utc', now())) - interval '1 month')::date;
  previous_month_end date := (date_trunc('month', timezone('utc', now())) - interval '1 day')::date;
  quarter_start date := date_trunc('quarter', timezone('utc', now()))::date;
  previous_quarter_start date := (date_trunc('quarter', timezone('utc', now())) - interval '3 months')::date;
  previous_quarter_end date := (date_trunc('quarter', timezone('utc', now())) - interval '1 day')::date;
  range_start date;
  range_end date := timezone('utc', now())::date;
  previous_start date;
  previous_end date;
  range_label text;
  compare_label text;
  viewer_member_id uuid;
  can_view_leads boolean := false;
  can_view_deals boolean := false;
  can_view_accounts boolean := false;
  can_view_contacts boolean := false;
  can_view_calls boolean := false;
  can_manage_calls boolean := false;
  can_view_tasks boolean := true;
  total_leads_value integer := 0;
  total_leads_baseline integer := 0;
  revenue_value numeric(12, 2) := 0;
  revenue_baseline numeric(12, 2) := 0;
  open_deals_value integer := 0;
  open_deals_baseline integer := 0;
  calls_value integer := 0;
  calls_baseline integer := 0;
  lead_contacted integer := 0;
  lead_qualified integer := 0;
  proposal_deals integer := 0;
  closed_deals integer := 0;
  closed_deals_baseline integer := 0;
  current_stage_movements integer := 0;
  previous_stage_movements integer := 0;
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
    range_start := month_start;
    previous_start := previous_month_start;
    previous_end := least(previous_month_start + (today_date - month_start), previous_month_end);
    range_label := 'Month to date';
    compare_label := 'vs previous MTD';
  elsif normalized_range = 'qtd' then
    range_start := quarter_start;
    previous_start := previous_quarter_start;
    previous_end := least(previous_quarter_start + (today_date - quarter_start), previous_quarter_end);
    range_label := 'Quarter to date';
    compare_label := 'vs previous QTD';
  else
    range_start := today_date - 29;
    previous_start := today_date - 59;
    previous_end := today_date - 30;
    range_label := 'Last 30 days';
    compare_label := 'vs previous 30 days';
  end if;

  viewer_member_id := private.require_dashboard_viewer(target_workspace_id);

  can_view_leads := private.team_member_has_permission(target_workspace_id, viewer_member_id, 'leads', 'view');
  can_view_deals := private.team_member_has_permission(target_workspace_id, viewer_member_id, 'deals', 'view');
  can_view_accounts := private.team_member_has_permission(target_workspace_id, viewer_member_id, 'accounts', 'view');
  can_view_contacts := private.team_member_has_permission(target_workspace_id, viewer_member_id, 'contacts', 'view');
  can_view_calls := private.team_member_has_permission(target_workspace_id, viewer_member_id, 'calls', 'view');
  can_manage_calls := can_view_calls and private.can_manage_calls_workspace(target_workspace_id);

  select count(*)::integer
  into total_leads_value
  from public.leads l
  where can_view_leads
    and l.workspace_id = target_workspace_id
    and l.archived_at is null
    and l.created_at::date between range_start and range_end;

  select count(*)::integer
  into total_leads_baseline
  from public.leads l
  where can_view_leads
    and l.workspace_id = target_workspace_id
    and l.archived_at is null
    and l.created_at::date between previous_start and previous_end;

  select coalesce(sum(coalesce(d.value_amount, 0)), 0)
  into revenue_value
  from public.deals d
  where can_view_deals
    and d.workspace_id = target_workspace_id
    and d.archived_at is null
    and d.stage = 'Won'
    and coalesce(d.close_date, d.updated_at::date, d.created_at::date) between range_start and range_end;

  select coalesce(sum(coalesce(d.value_amount, 0)), 0)
  into revenue_baseline
  from public.deals d
  where can_view_deals
    and d.workspace_id = target_workspace_id
    and d.archived_at is null
    and d.stage = 'Won'
    and coalesce(d.close_date, d.updated_at::date, d.created_at::date) between previous_start and previous_end;

  select count(*)::integer
  into open_deals_value
  from public.deals d
  where can_view_deals
    and d.workspace_id = target_workspace_id
    and d.archived_at is null
    and d.stage not in ('Won', 'Lost')
    and coalesce(d.updated_at, d.created_at)::date between range_start and range_end;

  select count(*)::integer
  into open_deals_baseline
  from public.deals d
  where can_view_deals
    and d.workspace_id = target_workspace_id
    and d.archived_at is null
    and d.stage not in ('Won', 'Lost')
    and coalesce(d.updated_at, d.created_at)::date between previous_start and previous_end;

  select count(*)::integer
  into calls_value
  from public.call_logs cl
  where can_view_calls
    and cl.workspace_id = target_workspace_id
    and (can_manage_calls or cl.member_id = viewer_member_id)
    and coalesce(cl.answered_at, cl.started_at, cl.created_at)::date between range_start and range_end;

  select count(*)::integer
  into calls_baseline
  from public.call_logs cl
  where can_view_calls
    and cl.workspace_id = target_workspace_id
    and (can_manage_calls or cl.member_id = viewer_member_id)
    and coalesce(cl.answered_at, cl.started_at, cl.created_at)::date between previous_start and previous_end;

  select count(distinct l.id)::integer
  into lead_contacted
  from public.leads l
  left join public.lead_status_events e on e.workspace_id = target_workspace_id
    and e.lead_id = l.id
    and e.to_status = 'Contacted'
    and e.occurred_at::date between range_start and range_end
  where can_view_leads
    and l.workspace_id = target_workspace_id
    and l.archived_at is null
    and (
      e.id is not null
      or (l.status = 'Contacted' and l.created_at::date between range_start and range_end)
    );

  select count(distinct l.id)::integer
  into lead_qualified
  from public.leads l
  left join public.lead_status_events e on e.workspace_id = target_workspace_id
    and e.lead_id = l.id
    and e.to_status = 'Qualified'
    and e.occurred_at::date between range_start and range_end
  where can_view_leads
    and l.workspace_id = target_workspace_id
    and l.archived_at is null
    and (
      e.id is not null
      or (
        l.status in ('Qualified', 'Converted')
        and coalesce(l.converted_at, l.updated_at, l.created_at)::date between range_start and range_end
      )
    );

  select count(*)::integer
  into proposal_deals
  from public.deals d
  where can_view_deals
    and d.workspace_id = target_workspace_id
    and d.archived_at is null
    and d.stage in ('Proposal', 'Negotiation')
    and coalesce(d.updated_at, d.created_at)::date between range_start and range_end;

  select count(*)::integer
  into closed_deals
  from public.deals d
  where can_view_deals
    and d.workspace_id = target_workspace_id
    and d.archived_at is null
    and d.stage = 'Won'
    and coalesce(d.close_date, d.updated_at::date, d.created_at::date) between range_start and range_end;

  select count(*)::integer
  into closed_deals_baseline
  from public.deals d
  where can_view_deals
    and d.workspace_id = target_workspace_id
    and d.archived_at is null
    and d.stage = 'Won'
    and coalesce(d.close_date, d.updated_at::date, d.created_at::date) between previous_start and previous_end;

  select
    total_leads_value
    + coalesce((
      select count(*)::integer
      from public.lead_status_events e
      join public.leads l on l.id = e.lead_id
      where can_view_leads
        and e.workspace_id = target_workspace_id
        and l.archived_at is null
        and e.to_status in ('Contacted', 'Qualified')
        and e.occurred_at::date between range_start and range_end
    ), 0)
    + closed_deals
  into current_stage_movements;

  select
    total_leads_baseline
    + coalesce((
      select count(*)::integer
      from public.lead_status_events e
      join public.leads l on l.id = e.lead_id
      where can_view_leads
        and e.workspace_id = target_workspace_id
        and l.archived_at is null
        and e.to_status in ('Contacted', 'Qualified')
        and e.occurred_at::date between previous_start and previous_end
    ), 0)
    + closed_deals_baseline
  into previous_stage_movements;

  return jsonb_build_object(
    'schemaVersion', 'command-sections-v3',
    'range', normalized_range,
    'rangeLabel', range_label,
    'compareLabel', compare_label,
    'window', jsonb_build_object(
      'startDate', range_start,
      'endDate', range_end,
      'previousStartDate', previous_start,
      'previousEndDate', previous_end
    ),
    'kpis', jsonb_build_object(
      'totalLeads', jsonb_build_object(
        'value', total_leads_value,
        'baseline', total_leads_baseline,
        'compareLabel', compare_label
      ),
      'revenue', jsonb_build_object(
        'value', revenue_value,
        'baseline', revenue_baseline,
        'compareLabel', compare_label
      ),
      'openDeals', jsonb_build_object(
        'value', open_deals_value,
        'baseline', open_deals_baseline,
        'compareLabel', compare_label
      ),
      'callsToday', jsonb_build_object(
        'value', calls_value,
        'baseline', calls_baseline,
        'compareLabel', compare_label
      )
    ),
    'pipelineStages', case
      when can_view_deals then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', stage.stage_id,
          'label', stage.label,
          'count', coalesce(stage_rollup.deal_count, 0),
          'value', coalesce(stage_rollup.stage_value, 0)
        ) order by stage.position)
        from (
          values
            ('Prospecting', 'Prospecting', 1),
            ('Qualified', 'Qualified', 2),
            ('Proposal', 'Proposal', 3),
            ('Negotiation', 'Negotiation', 4),
            ('Won', 'Won', 5)
        ) as stage(stage_id, label, position)
        left join lateral (
          select
            count(*)::integer as deal_count,
            coalesce(sum(coalesce(d.value_amount, 0)), 0) as stage_value
          from public.deals d
          where d.workspace_id = target_workspace_id
            and d.archived_at is null
            and d.stage = stage.stage_id
            and coalesce(d.close_date, d.updated_at::date, d.created_at::date) between range_start and range_end
        ) as stage_rollup on true
      ), '[]'::jsonb)
      else '[]'::jsonb
    end,
    'leadStatusDistribution', case
      when can_view_leads then coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', status_bucket.key,
          'label', status_bucket.label,
          'color', status_bucket.color,
          'count', coalesce(status_rollup.lead_count, 0)
        ) order by status_bucket.position)
        from (
          values
            ('contacted', 'Contacted', '#1f84f1', 1),
            ('new', 'New', '#20b486', 2),
            ('qualified', 'Qualified', '#f5a623', 3),
            ('lost', 'Lost', '#e25555', 4)
        ) as status_bucket(key, label, color, position)
        left join lateral (
          select count(*)::integer as lead_count
          from public.leads l
          left join lateral (
            select max(e.occurred_at) as latest_status_at
            from public.lead_status_events e
            where e.workspace_id = target_workspace_id
              and e.lead_id = l.id
          ) latest_event on true
          where l.workspace_id = target_workspace_id
            and l.archived_at is null
            and coalesce(l.converted_at, latest_event.latest_status_at, l.updated_at, l.created_at)::date between range_start and range_end
            and (
              (status_bucket.key = 'contacted' and l.status = 'Contacted')
              or (status_bucket.key = 'new' and l.status = 'New')
              or (status_bucket.key = 'qualified' and l.status in ('Qualified', 'Converted'))
              or (status_bucket.key = 'lost' and l.status = 'Unqualified')
            )
        ) as status_rollup on true
      ), '[]'::jsonb)
      else '[]'::jsonb
    end,
    'salesFunnel', jsonb_build_array(
      jsonb_build_object('key', 'leads', 'label', 'Leads', 'count', case when can_view_leads then total_leads_value else 0 end, 'tone', 'leads'),
      jsonb_build_object('key', 'contacted', 'label', 'Contacted', 'count', case when can_view_leads then lead_contacted else 0 end, 'tone', 'contacted'),
      jsonb_build_object('key', 'qualified', 'label', 'Qualified', 'count', case when can_view_leads then lead_qualified else 0 end, 'tone', 'qualified'),
      jsonb_build_object('key', 'proposal', 'label', 'Proposal', 'count', case when can_view_deals then proposal_deals else 0 end, 'tone', 'proposal'),
      jsonb_build_object('key', 'closed', 'label', 'Closed', 'count', case when can_view_deals then closed_deals else 0 end, 'tone', 'closed')
    ),
    'topReps', case
      when can_view_deals then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', rep.id,
          'name', rep.name,
          'initials', rep.initials,
          'dealsClosed', rep.deals_closed,
          'percent', case when closed_deals > 0 then round((rep.deals_closed::numeric / closed_deals::numeric) * 100)::integer else 0 end
        ) order by rep.deals_closed desc, rep.name asc)
        from (
          select
            tm.id,
            coalesce(nullif(trim(tm.name), ''), 'Unknown') as name,
            upper(left(coalesce(nullif(trim(tm.name), ''), 'U'), 1)) as initials,
            count(d.id)::integer as deals_closed
          from public.team_members tm
          left join public.deals d on d.workspace_id = target_workspace_id
            and d.archived_at is null
            and d.stage = 'Won'
            and d.owner_member_id = tm.id
            and coalesce(d.close_date, d.updated_at::date, d.created_at::date) between range_start and range_end
          where tm.workspace_id = target_workspace_id
            and tm.status = 'Active'
          group by tm.id, tm.name
          order by count(d.id) desc, tm.name asc
          limit 5
        ) as rep
      ), '[]'::jsonb)
      else '[]'::jsonb
    end,
    'followUpTasks', case
      when can_view_tasks then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', queued.id,
          'title', queued.title,
          'assignee', queued.assignee,
          'dueDate', queued.due_date,
          'status', queued.status
        ) order by queued.priority_rank asc, queued.due_date asc, queued.created_at desc)
        from (
          select
            t.id,
            t.title,
            coalesce(nullif(trim(assignee_member.name), ''), 'Unassigned') as assignee,
            t.due_date,
            t.status,
            t.created_at,
            case
              when t.due_date < today_date then 0
              when t.due_date = today_date then 1
              else 2
            end as priority_rank
          from public.tasks t
          left join public.team_members assignee_member on assignee_member.id = t.assignee_member_id
          where t.workspace_id = target_workspace_id
            and t.status <> 'Completed'
            and t.due_date between range_start and range_end
            and private.can_view_task(t.id, viewer_member_id)
          order by
            case
              when t.due_date < today_date then 0
              when t.due_date = today_date then 1
              else 2
            end asc,
            t.due_date asc,
            t.created_at desc
          limit 5
        ) as queued
      ), '[]'::jsonb)
      else '[]'::jsonb
    end,
    'dueTasks', jsonb_build_object(
      'dueTodayCount', case
        when can_view_tasks then coalesce((
          select count(*)::integer
          from public.tasks t
          where t.workspace_id = target_workspace_id
            and t.status <> 'Completed'
            and t.due_date between range_start and range_end
            and private.can_view_task(t.id, viewer_member_id)
        ), 0)
        else 0
      end,
      'items', case
        when can_view_tasks then coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', queued.id,
            'title', queued.title,
            'assignee', queued.assignee,
            'dueDate', queued.due_date,
            'status', queued.status
          ) order by queued.priority_rank asc, queued.due_date asc, queued.created_at desc)
          from (
            select
              t.id,
              t.title,
              coalesce(nullif(trim(assignee_member.name), ''), 'Unassigned') as assignee,
              t.due_date,
              t.status,
              t.created_at,
              case
                when t.due_date < today_date then 0
                when t.due_date = today_date then 1
                else 2
              end as priority_rank
            from public.tasks t
            left join public.team_members assignee_member on assignee_member.id = t.assignee_member_id
            where t.workspace_id = target_workspace_id
              and t.status <> 'Completed'
              and t.due_date between range_start and range_end
              and private.can_view_task(t.id, viewer_member_id)
            order by
              case
                when t.due_date < today_date then 0
                when t.due_date = today_date then 1
                else 2
              end asc,
              t.due_date asc,
              t.created_at desc
            limit 3
          ) as queued
        ), '[]'::jsonb)
        else '[]'::jsonb
      end
    ),
    'pipelineTrend', jsonb_build_object(
      'currentStageMovements', case when can_view_leads or can_view_deals then current_stage_movements else 0 end,
      'previousStageMovements', case when can_view_leads or can_view_deals then previous_stage_movements else 0 end,
      'points', case
        when can_view_leads or can_view_deals then coalesce((
          select jsonb_agg(jsonb_build_object(
            'key', to_char(bucket.bucket_start, 'YYYY-MM-DD'),
            'label', case
              when bucket.bucket_start = bucket.bucket_end then to_char(bucket.bucket_start, 'Mon DD')
              else to_char(bucket.bucket_start, 'Mon DD') || ' to ' || to_char(bucket.bucket_end, 'Mon DD')
            end,
            'shortLabel', case
              when normalized_range = 'today' then 'Today'
              when normalized_range = '7d' then trim(to_char(bucket.bucket_start, 'Dy'))
              when normalized_range = 'qtd' then to_char(bucket.bucket_end, 'Mon DD')
              when bucket.bucket_index = 0 or bucket.bucket_index = bucket.bucket_count - 1 or bucket.bucket_index % 5 = 0 then to_char(bucket.bucket_start, 'Mon DD')
              else ''
            end,
            'values', jsonb_build_object(
              'new', coalesce(trend_rollup.new_count, 0),
              'contacted', coalesce(trend_rollup.contacted_count, 0),
              'qualified', coalesce(trend_rollup.qualified_count, 0),
              'won', coalesce(trend_rollup.won_count, 0)
            )
          ) order by bucket.bucket_start)
          from (
            select
              row_number() over (order by series.bucket_start::date) - 1 as bucket_index,
              count(*) over () as bucket_count,
              series.bucket_start::date as bucket_start,
              least(series.bucket_start::date + case when normalized_range = 'qtd' then 6 else 0 end, range_end) as bucket_end
            from generate_series(
              range_start,
              range_end,
              case when normalized_range = 'qtd' then interval '7 days' else interval '1 day' end
            ) as series(bucket_start)
          ) as bucket
          left join lateral (
            select
              coalesce((
                select count(*)::integer
                from public.leads l
                where can_view_leads
                  and l.workspace_id = target_workspace_id
                  and l.archived_at is null
                  and l.created_at::date between bucket.bucket_start and bucket.bucket_end
              ), 0) as new_count,
              coalesce((
                select count(distinct e.lead_id)::integer
                from public.lead_status_events e
                join public.leads l on l.id = e.lead_id
                where can_view_leads
                  and e.workspace_id = target_workspace_id
                  and l.archived_at is null
                  and e.to_status = 'Contacted'
                  and e.occurred_at::date between bucket.bucket_start and bucket.bucket_end
              ), 0) as contacted_count,
              coalesce((
                select count(distinct e.lead_id)::integer
                from public.lead_status_events e
                join public.leads l on l.id = e.lead_id
                where can_view_leads
                  and e.workspace_id = target_workspace_id
                  and l.archived_at is null
                  and e.to_status = 'Qualified'
                  and e.occurred_at::date between bucket.bucket_start and bucket.bucket_end
              ), 0) as qualified_count,
              (
                coalesce((
                  select count(*)::integer
                  from public.deals d
                  where can_view_deals
                    and d.workspace_id = target_workspace_id
                    and d.archived_at is null
                    and d.stage = 'Won'
                    and coalesce(d.close_date, d.updated_at::date, d.created_at::date) between bucket.bucket_start and bucket.bucket_end
                ), 0)
                + coalesce((
                  select count(*)::integer
                  from public.leads l
                  where can_view_leads
                    and l.workspace_id = target_workspace_id
                    and l.archived_at is null
                    and l.status = 'Converted'
                    and coalesce(l.converted_at, l.updated_at, l.created_at)::date between bucket.bucket_start and bucket.bucket_end
                ), 0)
              )::integer as won_count
          ) as trend_rollup on true
        ), '[]'::jsonb)
        else '[]'::jsonb
      end
    ),
    'topDeals', case
      when can_view_deals then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', ranked.id,
          'account', ranked.account_name,
          'contactName', ranked.contact_name,
          'value', ranked.value_amount,
          'stage', ranked.stage,
          'closeDate', ranked.close_date
        ) order by ranked.sort_value desc, ranked.updated_at desc)
        from (
          select
            d.id,
            case
              when can_view_accounts then coalesce(nullif(trim(a.name), ''), 'No account')
              when d.account_id is null then 'No account'
              else 'Restricted account'
            end as account_name,
            case
              when can_view_contacts then coalesce((
                select c.name
                from public.contacts c
                where c.workspace_id = target_workspace_id
                  and c.archived_at is null
                  and c.account_id = d.account_id
                order by c.created_at asc
                limit 1
              ), coalesce(nullif(trim(owner_member.name), ''), 'Unknown'))
              else coalesce(nullif(trim(owner_member.name), ''), 'Unknown')
            end as contact_name,
            coalesce(d.value_amount, 0) as value_amount,
            coalesce(d.value_amount, 0) as sort_value,
            d.stage,
            d.close_date,
            d.updated_at
          from public.deals d
          left join public.accounts a on a.id = d.account_id
          left join public.team_members owner_member on owner_member.id = d.owner_member_id
          where d.workspace_id = target_workspace_id
            and d.archived_at is null
            and d.stage <> 'Lost'
            and coalesce(d.close_date, d.updated_at::date, d.created_at::date) between range_start and range_end
          order by coalesce(d.value_amount, 0) desc, d.updated_at desc
          limit 5
        ) as ranked
      ), '[]'::jsonb)
      else '[]'::jsonb
    end
  );
end;
$$;

revoke all on function private.dashboard_command_snapshot_json(uuid, text) from public;

drop function if exists public.get_dashboard_snapshot();

create or replace function public.get_dashboard_snapshot(p_range text default '30d')
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
begin
  target_workspace_id := private.current_workspace_id();
  perform private.require_dashboard_viewer(target_workspace_id);
  return private.dashboard_snapshot_json(target_workspace_id) || private.dashboard_command_snapshot_json(target_workspace_id, p_range);
end;
$$;

revoke all on function public.get_dashboard_snapshot(text) from public;
grant execute on function public.get_dashboard_snapshot(text) to authenticated;

commit;
