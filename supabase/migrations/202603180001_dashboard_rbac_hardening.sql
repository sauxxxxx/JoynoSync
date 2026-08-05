begin;

create or replace function private.default_permission_value_by_role(
  target_role text,
  target_action text,
  target_module text
)
returns boolean
language plpgsql
immutable
as $$
declare
  normalized_role text := lower(trim(coalesce(target_role, 'member')));
  normalized_action text := lower(trim(coalesce(target_action, 'view')));
  normalized_module text := lower(trim(coalesce(target_module, '')));
begin
  if normalized_module = '' then
    return false;
  end if;

  if normalized_role in ('owner', 'admin') then
    return true;
  end if;

  if normalized_role = 'manager' then
    if normalized_module = 'settings' and normalized_action in ('delete', 'export') then
      return false;
    end if;

    if normalized_module = 'team' and normalized_action = 'delete' then
      return false;
    end if;

    return true;
  end if;

  if normalized_role = 'guest' then
    return normalized_action = 'view'
      and normalized_module in ('dashboard', 'projects', 'messenger', 'calls', 'sms', 'email');
  end if;

  if normalized_module in ('team', 'settings') then
    return normalized_action = 'view';
  end if;

  if normalized_action = 'view' then
    return true;
  end if;

  if normalized_action in ('create', 'edit') then
    return normalized_module not in ('dashboard', 'settings');
  end if;

  return false;
end;
$$;

create or replace function private.team_member_has_permission(
  target_workspace_id uuid,
  actor_member_id uuid,
  target_module text,
  target_action text default 'view'
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  actor_role text := '';
  actor_status text := '';
  actor_permissions jsonb := '{}'::jsonb;
  normalized_module text := lower(trim(coalesce(target_module, '')));
  normalized_action text := lower(trim(coalesce(target_action, 'view')));
  raw_permission_value text := '';
begin
  if target_workspace_id is null or actor_member_id is null or normalized_module = '' then
    return false;
  end if;

  select
    coalesce(tm.role, ''),
    coalesce(tm.status, ''),
    case
      when jsonb_typeof(tm.permissions) = 'object' then tm.permissions
      else '{}'::jsonb
    end
  into actor_role, actor_status, actor_permissions
  from public.team_members tm
  where tm.workspace_id = target_workspace_id
    and tm.id = actor_member_id
  limit 1;

  if actor_status <> 'Active' then
    return false;
  end if;

  raw_permission_value := lower(trim(coalesce(actor_permissions -> normalized_module ->> normalized_action, '')));

  if raw_permission_value in ('true', 't', '1', 'yes', 'on') then
    return true;
  end if;

  if raw_permission_value in ('false', 'f', '0', 'no', 'off') then
    return false;
  end if;

  return private.default_permission_value_by_role(actor_role, normalized_action, normalized_module);
end;
$$;

create or replace function private.can_view_dashboard(target_workspace_id uuid, actor_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.team_member_has_permission(target_workspace_id, actor_member_id, 'dashboard', 'view');
$$;

create or replace function private.require_dashboard_viewer(target_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_member_id uuid;
begin
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if not private.can_view_dashboard(target_workspace_id, actor_member_id) then
    raise exception 'You do not have permission to view the dashboard.' using errcode = 'P0001';
  end if;

  return actor_member_id;
end;
$$;

create or replace function private.dashboard_snapshot_json(target_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  today_date date := timezone('utc', now())::date;
  yesterday_date date := timezone('utc', now())::date - integer '1';
  month_start date := date_trunc('month', timezone('utc', now()))::date;
  quarter_label text := to_char(timezone('utc', now()), '"Q"Q YYYY');
  actor_member_id uuid;
  can_view_leads boolean := false;
  can_view_deals boolean := false;
  can_view_accounts boolean := false;
  can_view_contacts boolean := false;
  can_view_calls boolean := false;
  can_view_projects boolean := false;
  can_manage_calls boolean := false;
  total_leads_value integer := 0;
  total_leads_baseline integer := 0;
  revenue_value numeric(12, 2) := 0;
  revenue_baseline numeric(12, 2) := 0;
  open_deals_value integer := 0;
  open_deals_baseline integer := 0;
  calls_today_value integer := 0;
  calls_yesterday_value integer := 0;
begin
  actor_member_id := private.current_team_member_id(target_workspace_id);

  if actor_member_id is null or not private.can_view_dashboard(target_workspace_id, actor_member_id) then
    raise exception 'You do not have permission to view the dashboard.' using errcode = 'P0001';
  end if;

  can_view_leads := private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'view');
  can_view_deals := private.team_member_has_permission(target_workspace_id, actor_member_id, 'deals', 'view');
  can_view_accounts := private.team_member_has_permission(target_workspace_id, actor_member_id, 'accounts', 'view');
  can_view_contacts := private.team_member_has_permission(target_workspace_id, actor_member_id, 'contacts', 'view');
  can_view_calls := private.team_member_has_permission(target_workspace_id, actor_member_id, 'calls', 'view');
  can_view_projects := private.team_member_has_permission(target_workspace_id, actor_member_id, 'projects', 'view');
  can_manage_calls := can_view_calls and private.can_manage_calls_workspace(target_workspace_id);

  select count(*)
  into total_leads_value
  from public.leads l
  where can_view_leads
    and l.workspace_id = target_workspace_id
    and l.archived_at is null;

  select count(*)
  into total_leads_baseline
  from public.leads l
  where can_view_leads
    and l.workspace_id = target_workspace_id
    and l.archived_at is null
    and l.created_at::date < month_start;

  select coalesce(sum(coalesce(d.value_amount, 0)), 0)
  into revenue_value
  from public.deals d
  where can_view_deals
    and d.workspace_id = target_workspace_id
    and d.archived_at is null
    and d.stage = 'Won';

  select coalesce(sum(coalesce(d.value_amount, 0)), 0)
  into revenue_baseline
  from public.deals d
  where can_view_deals
    and d.workspace_id = target_workspace_id
    and d.archived_at is null
    and d.stage = 'Won'
    and coalesce(d.close_date, d.created_at::date) < month_start;

  select count(*)
  into open_deals_value
  from public.deals d
  where can_view_deals
    and d.workspace_id = target_workspace_id
    and d.archived_at is null
    and d.stage not in ('Won', 'Lost');

  select count(*)
  into open_deals_baseline
  from public.deals d
  where can_view_deals
    and d.workspace_id = target_workspace_id
    and d.archived_at is null
    and d.stage not in ('Won', 'Lost')
    and d.created_at::date < month_start;

  select count(*)
  into calls_today_value
  from public.call_logs cl
  where can_view_calls
    and cl.workspace_id = target_workspace_id
    and (can_manage_calls or cl.member_id = actor_member_id)
    and coalesce(cl.answered_at, cl.started_at, cl.created_at)::date = today_date;

  select count(*)
  into calls_yesterday_value
  from public.call_logs cl
  where can_view_calls
    and cl.workspace_id = target_workspace_id
    and (can_manage_calls or cl.member_id = actor_member_id)
    and coalesce(cl.answered_at, cl.started_at, cl.created_at)::date = yesterday_date;

  return jsonb_build_object(
    'generatedAt', timezone('utc', now()),
    'quarterLabel', quarter_label,
    'kpis', jsonb_build_object(
      'totalLeads', jsonb_build_object(
        'value', total_leads_value,
        'baseline', greatest(1, total_leads_baseline),
        'compareLabel', 'vs last month'
      ),
      'revenue', jsonb_build_object(
        'value', revenue_value,
        'baseline', greatest(1, revenue_baseline),
        'compareLabel', 'vs last month'
      ),
      'openDeals', jsonb_build_object(
        'value', open_deals_value,
        'baseline', greatest(1, open_deals_baseline),
        'compareLabel', 'vs last month'
      ),
      'callsToday', jsonb_build_object(
        'value', calls_today_value,
        'baseline', greatest(1, calls_yesterday_value),
        'compareLabel', 'vs yesterday'
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
            ('Prospecting', 'Prospect', 1),
            ('Qualified', 'Qualified', 2),
            ('Proposal', 'Proposal', 3),
            ('Negotiation', 'Negotiation', 4),
            ('Won', 'Closed Won', 5)
        ) as stage(stage_id, label, position)
        left join lateral (
          select
            count(*)::integer as deal_count,
            coalesce(sum(coalesce(d.value_amount, 0)), 0) as stage_value
          from public.deals d
          where d.workspace_id = target_workspace_id
            and d.archived_at is null
            and d.stage = stage.stage_id
        ) as stage_rollup on true
      ), '[]'::jsonb)
      else '[]'::jsonb
    end,
    'topDeals', case
      when can_view_deals then coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', ranked.id,
          'account', ranked.account_name,
          'contactName', ranked.contact_name,
          'value', ranked.value_amount,
          'stage', ranked.stage,
          'closeDate', ranked.close_date
        ) order by ranked.sort_close asc, ranked.created_at desc)
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
            d.stage,
            d.close_date,
            coalesce(d.close_date, date '9999-12-31') as sort_close,
            d.created_at
          from public.deals d
          left join public.accounts a on a.id = d.account_id
          left join public.team_members owner_member on owner_member.id = d.owner_member_id
          where d.workspace_id = target_workspace_id
            and d.archived_at is null
          order by coalesce(d.close_date, date '9999-12-31') asc, d.created_at desc
          limit 5
        ) as ranked
      ), '[]'::jsonb)
      else '[]'::jsonb
    end,
    'recentActivity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'actor', recent_rows.actor,
        'headline', recent_rows.headline,
        'createdAt', recent_rows.created_at
      ) order by recent_rows.created_at desc)
      from (
        select *
        from (
          select
            coalesce(nullif(trim(actor_member.name), ''), 'System') as actor,
            tae.message as headline,
            tae.created_at
          from public.task_activity_events tae
          left join public.team_members actor_member on actor_member.id = tae.actor_member_id
          where tae.workspace_id = target_workspace_id
            and (
              (tae.task_id is not null and private.can_view_task(tae.task_id, actor_member_id))
              or (tae.task_id is null and tae.project_id is not null and can_view_projects)
            )

          union all

          select
            coalesce(nullif(trim(created_member.name), ''), 'System') as actor,
            'Created lead ' || coalesce(nullif(trim(l.name), ''), 'Untitled lead') as headline,
            l.created_at
          from public.leads l
          left join public.team_members created_member on created_member.id = l.created_by_member_id
          where can_view_leads
            and l.workspace_id = target_workspace_id
            and l.archived_at is null

          union all

          select
            coalesce(nullif(trim(created_member.name), ''), 'System') as actor,
            'Opened deal ' || coalesce(nullif(trim(d.name), ''), 'Untitled deal') as headline,
            d.created_at
          from public.deals d
          left join public.team_members created_member on created_member.id = d.created_by_member_id
          where can_view_deals
            and d.workspace_id = target_workspace_id
            and d.archived_at is null

          union all

          select
            coalesce(nullif(trim(call_member.name), ''), 'System') as actor,
            case
              when cl.status = 'completed' then
                'Call completed with ' || coalesce(nullif(trim(cl.counterparty_name), ''), nullif(trim(cl.to_number), ''), nullif(trim(cl.from_number), ''), 'Unknown')
              when cl.status = 'missed' then
                'Missed call from ' || coalesce(nullif(trim(cl.counterparty_name), ''), nullif(trim(cl.from_number), ''), nullif(trim(cl.to_number), ''), 'Unknown')
              when cl.status = 'voicemail' then
                'Voicemail from ' || coalesce(nullif(trim(cl.counterparty_name), ''), nullif(trim(cl.from_number), ''), nullif(trim(cl.to_number), ''), 'Unknown')
              else
                'Call updated with ' || coalesce(nullif(trim(cl.counterparty_name), ''), nullif(trim(cl.to_number), ''), nullif(trim(cl.from_number), ''), 'Unknown')
            end as headline,
            coalesce(cl.ended_at, cl.updated_at, cl.created_at) as created_at
          from public.call_logs cl
          left join public.team_members call_member on call_member.id = cl.member_id
          where can_view_calls
            and cl.workspace_id = target_workspace_id
            and (can_manage_calls or cl.member_id = actor_member_id)
        ) as combined
        order by combined.created_at desc
        limit 5
      ) as recent_rows
    ), '[]'::jsonb),
    'dueTasks', jsonb_build_object(
      'dueTodayCount', coalesce((
        select count(*)::integer
        from public.tasks t
        where t.workspace_id = target_workspace_id
          and t.status <> 'Completed'
          and t.due_date = today_date
          and private.can_view_task(t.id, actor_member_id)
      ), 0),
      'items', coalesce((
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
            case when t.due_date = today_date then 0 else 1 end as priority_rank
          from public.tasks t
          left join public.team_members assignee_member on assignee_member.id = t.assignee_member_id
          where t.workspace_id = target_workspace_id
            and t.status <> 'Completed'
            and private.can_view_task(t.id, actor_member_id)
          order by case when t.due_date = today_date then 0 else 1 end asc, t.due_date asc, t.created_at desc
          limit 5
        ) as queued
      ), '[]'::jsonb)
    )
  );
end;
$$;

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
  return private.dashboard_snapshot_json(target_workspace_id);
end;
$$;

revoke all on function private.default_permission_value_by_role(text, text, text) from public;
revoke all on function private.team_member_has_permission(uuid, uuid, text, text) from public;
revoke all on function private.can_view_dashboard(uuid, uuid) from public;
revoke all on function private.require_dashboard_viewer(uuid) from public;
revoke all on function private.dashboard_snapshot_json(uuid) from public;

grant execute on function public.get_dashboard_snapshot() to authenticated;

commit;
