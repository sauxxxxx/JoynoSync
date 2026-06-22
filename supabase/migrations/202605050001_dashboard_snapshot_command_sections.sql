begin;

create or replace function private.dashboard_command_snapshot_json(target_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  today_date date := timezone('utc', now())::date;
  trend_start date := timezone('utc', now())::date - integer '6';
  previous_trend_start date := timezone('utc', now())::date - integer '13';
  viewer_member_id uuid;
  can_view_leads boolean := false;
  can_view_deals boolean := false;
  can_view_tasks boolean := true;
  lead_total integer := 0;
  lead_contacted integer := 0;
  lead_qualified integer := 0;
  proposal_deals integer := 0;
  closed_deals integer := 0;
  current_stage_movements integer := 0;
  previous_stage_movements integer := 0;
begin
  viewer_member_id := private.require_dashboard_viewer(target_workspace_id);

  can_view_leads := private.team_member_has_permission(target_workspace_id, viewer_member_id, 'leads', 'view');
  can_view_deals := private.team_member_has_permission(target_workspace_id, viewer_member_id, 'deals', 'view');
  select count(*)::integer
  into lead_total
  from public.leads l
  where can_view_leads
    and l.workspace_id = target_workspace_id
    and l.archived_at is null;

  select count(*)::integer
  into lead_contacted
  from public.leads l
  where can_view_leads
    and l.workspace_id = target_workspace_id
    and l.archived_at is null
    and l.status = 'Contacted';

  select count(*)::integer
  into lead_qualified
  from public.leads l
  where can_view_leads
    and l.workspace_id = target_workspace_id
    and l.archived_at is null
    and l.status = 'Qualified';

  select count(*)::integer
  into proposal_deals
  from public.deals d
  where can_view_deals
    and d.workspace_id = target_workspace_id
    and d.archived_at is null
    and d.stage in ('Proposal', 'Negotiation');

  select count(*)::integer
  into closed_deals
  from public.deals d
  where can_view_deals
    and d.workspace_id = target_workspace_id
    and d.archived_at is null
    and d.stage = 'Won';

  select count(*)::integer
  into current_stage_movements
  from public.leads l
  where can_view_leads
    and l.workspace_id = target_workspace_id
    and l.archived_at is null
    and l.status in ('New', 'Contacted', 'Qualified', 'Converted')
    and coalesce(l.updated_at, l.created_at)::date between trend_start and today_date;

  select count(*)::integer
  into previous_stage_movements
  from public.leads l
  where can_view_leads
    and l.workspace_id = target_workspace_id
    and l.archived_at is null
    and l.status in ('New', 'Contacted', 'Qualified', 'Converted')
    and coalesce(l.updated_at, l.created_at)::date >= previous_trend_start
    and coalesce(l.updated_at, l.created_at)::date < trend_start;

  return jsonb_build_object(
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
          where l.workspace_id = target_workspace_id
            and l.archived_at is null
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
      jsonb_build_object('key', 'leads', 'label', 'Leads', 'count', case when can_view_leads then lead_total else 0 end, 'tone', 'leads'),
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
    'pipelineTrend', jsonb_build_object(
      'currentStageMovements', case when can_view_leads then current_stage_movements else 0 end,
      'previousStageMovements', case when can_view_leads then previous_stage_movements else 0 end,
      'points', case
        when can_view_leads then coalesce((
          select jsonb_agg(jsonb_build_object(
            'key', to_char(bucket.day_value::date, 'YYYY-MM-DD'),
            'label', to_char(bucket.day_value::date, 'Mon DD'),
            'shortLabel', trim(to_char(bucket.day_value::date, 'Dy')),
            'values', jsonb_build_object(
              'new', coalesce(trend_rollup.new_count, 0),
              'contacted', coalesce(trend_rollup.contacted_count, 0),
              'qualified', coalesce(trend_rollup.qualified_count, 0),
              'won', coalesce(trend_rollup.won_count, 0)
            )
          ) order by bucket.day_value::date)
          from generate_series(trend_start, today_date, interval '1 day') as bucket(day_value)
          left join lateral (
            select
              count(*) filter (where l.status = 'New')::integer as new_count,
              count(*) filter (where l.status = 'Contacted')::integer as contacted_count,
              count(*) filter (where l.status = 'Qualified')::integer as qualified_count,
              count(*) filter (where l.status = 'Converted')::integer as won_count
            from public.leads l
            where l.workspace_id = target_workspace_id
              and l.archived_at is null
              and coalesce(l.updated_at, l.created_at)::date = bucket.day_value::date
          ) as trend_rollup on true
        ), '[]'::jsonb)
        else '[]'::jsonb
      end
    )
  );
end;
$$;

revoke all on function private.dashboard_command_snapshot_json(uuid) from public;

create or replace function public.get_dashboard_snapshot()
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
  return private.dashboard_snapshot_json(target_workspace_id) || private.dashboard_command_snapshot_json(target_workspace_id);
end;
$$;

grant execute on function public.get_dashboard_snapshot() to authenticated;

commit;
