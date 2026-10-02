begin;

alter table public.notifications
  add column if not exists dismissed_was_read boolean;

update public.team_members
set notifications = (coalesce(notifications, '{}'::jsonb) - 'email' - 'sms') || jsonb_build_object(
  'inApp', coalesce((notifications ->> 'inApp')::boolean, true),
  'messages', coalesce((notifications ->> 'messages')::boolean, true),
  'tasks', coalesce((notifications ->> 'tasks')::boolean, true),
  'crm', coalesce((notifications ->> 'crm')::boolean, true),
  'calls', coalesce((notifications ->> 'calls')::boolean, true)
);

create or replace function private.notification_preference_enabled(
  target_member_id uuid,
  preference_key text
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce((
    select coalesce((tm.notifications ->> 'inApp')::boolean, true)
      and coalesce((tm.notifications ->> preference_key)::boolean, true)
    from public.team_members tm
    where tm.id = target_member_id
      and tm.status = 'Active'
    limit 1
  ), false);
$$;

create or replace function private.workspace_local_date(target_workspace_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = public, private, pg_catalog
as $$
declare
  configured_timezone text;
begin
  select nullif(trim(ap.timezone), '')
  into configured_timezone
  from public.attendance_policies ap
  where ap.workspace_id = target_workspace_id;

  if configured_timezone is null
    or configured_timezone = 'Local'
    or not exists (select 1 from pg_timezone_names where name = configured_timezone)
  then
    configured_timezone := 'UTC';
  end if;

  return (timezone(configured_timezone, now()))::date;
end;
$$;

create or replace function private.sync_due_notifications_v2(
  target_workspace_id uuid,
  target_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  local_today date;
begin
  if target_workspace_id is null or target_member_id is null then
    return;
  end if;

  local_today := private.workspace_local_date(target_workspace_id);

  if private.notification_preference_enabled(target_member_id, 'tasks') then
    insert into public.notifications (
      workspace_id, member_id, type, dedupe_key, title, meta, body, badge, tone,
      route_id, route_params, entity_type, entity_id, payload
    )
    select
      t.workspace_id,
      target_member_id,
      'task-due',
      format('task-due:%s:%s', t.id, local_today),
      case when t.due_date < local_today then format('Task overdue: %s', t.title)
        else format('Task due today: %s', t.title) end,
      format('Due %s · Tasks', to_char(t.due_date, 'Mon DD')),
      coalesce(nullif(trim(t.description), ''), 'Open the task to review the next step.'),
      case when t.due_date < local_today then 'Overdue' else 'Today' end,
      case when t.due_date < local_today then 'danger' else 'warning' end,
      'kanban',
      '{}'::jsonb,
      'task',
      t.id::text,
      jsonb_build_object('taskId', t.id, 'dueDate', t.due_date)
    from public.tasks t
    where t.workspace_id = target_workspace_id
      and t.assignee_member_id = target_member_id
      and t.status <> 'Completed'
      and t.due_date <= local_today
    on conflict (workspace_id, member_id, dedupe_key) do nothing;
  end if;

  update public.notifications n
  set dismissed_at = coalesce(n.dismissed_at, timezone('utc', now())),
      read_at = coalesce(n.read_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where n.workspace_id = target_workspace_id
    and n.member_id = target_member_id
    and n.type = 'task-due'
    and n.dismissed_at is null
    and not exists (
      select 1 from public.tasks t
      where t.id::text = n.entity_id
        and t.workspace_id = target_workspace_id
        and t.assignee_member_id = target_member_id
        and t.status <> 'Completed'
        and t.due_date <= local_today
    );

  if private.notification_preference_enabled(target_member_id, 'crm') then
    insert into public.notifications (
      workspace_id, member_id, type, dedupe_key, title, meta, body, badge, tone,
      route_id, route_params, entity_type, entity_id, payload
    )
    select
      l.workspace_id,
      target_member_id,
      'lead-followup',
      format('lead-followup:%s:%s', l.id, local_today),
      case when l.next_follow_up_date < local_today then format('Lead follow-up overdue: %s', l.name)
        else format('Lead follow-up due today: %s', l.name) end,
      format('Leads · %s', to_char(l.next_follow_up_date, 'Mon DD')),
      coalesce(nullif(trim(l.interest), ''), nullif(trim(l.company_name), ''), 'Open the lead to review the follow-up.'),
      case when l.next_follow_up_date < local_today then 'Overdue' else 'Today' end,
      case when l.next_follow_up_date < local_today then 'danger' else 'crm' end,
      'leads',
      '{}'::jsonb,
      'lead',
      l.id::text,
      jsonb_build_object('leadId', l.id, 'nextFollowUpDate', l.next_follow_up_date)
    from public.leads l
    where l.workspace_id = target_workspace_id
      and l.owner_member_id = target_member_id
      and l.archived_at is null
      and l.status <> 'Converted'
      and l.next_follow_up_date is not null
      and l.next_follow_up_date <= local_today
    on conflict (workspace_id, member_id, dedupe_key) do nothing;
  end if;

  update public.notifications n
  set dismissed_at = coalesce(n.dismissed_at, timezone('utc', now())),
      read_at = coalesce(n.read_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where n.workspace_id = target_workspace_id
    and n.member_id = target_member_id
    and n.type = 'lead-followup'
    and n.dismissed_at is null
    and not exists (
      select 1 from public.leads l
      where l.id::text = n.entity_id
        and l.workspace_id = target_workspace_id
        and l.owner_member_id = target_member_id
        and l.archived_at is null
        and l.status <> 'Converted'
        and l.next_follow_up_date is not null
        and l.next_follow_up_date <= local_today
    );
end;
$$;

create or replace function private.notify_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  recipient record;
  sender_name text;
  message_preview text;
  conversation_type text;
begin
  if new.deleted_at is not null then return new; end if;
  select coalesce(tm.name, 'Someone') into sender_name from public.team_members tm where tm.id = new.sender_id limit 1;
  select c.type into conversation_type from public.conversations c where c.id = new.conversation_id limit 1;
  message_preview := coalesce(nullif(left(trim(new.body), 120), ''), 'Open Messenger to view the latest message.');

  for recipient in
    select cm.member_id
    from public.conversation_members cm
    where cm.conversation_id = new.conversation_id
      and cm.left_at is null
      and cm.member_id is distinct from new.sender_id
      and coalesce(cm.muted, false) = false
  loop
    if private.notification_preference_enabled(recipient.member_id, 'messages') then
      perform private.upsert_notification(
        new.workspace_id, recipient.member_id, 'message', format('message:%s:%s', new.id, recipient.member_id),
        format('New message from %s', sender_name), message_preview, message_preview, 'Unread', 'info',
        'comms-messenger', '{}'::jsonb, 'conversation', new.conversation_id::text,
        jsonb_build_object('conversationId', new.conversation_id, 'targetType', coalesce(conversation_type, 'direct'), 'messageId', new.id)
      );
    end if;
  end loop;
  return new;
end;
$$;

create or replace function private.notify_task_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_id uuid;
begin
  actor_id := coalesce(new.updated_by_member_id, new.created_by_member_id);
  if new.assignee_member_id is not null
    and new.assignee_member_id is distinct from actor_id
    and (tg_op = 'INSERT' or new.assignee_member_id is distinct from old.assignee_member_id)
    and private.notification_preference_enabled(new.assignee_member_id, 'tasks')
  then
    perform private.upsert_notification(
      new.workspace_id, new.assignee_member_id, 'task-assigned',
      format('task-assigned:%s:%s:%s', new.id, new.assignee_member_id, extract(epoch from new.updated_at)),
      format('Task assigned: %s', new.title), 'Tasks',
      coalesce(nullif(trim(new.description), ''), 'Open the task to review the details.'), 'Assigned', 'info',
      'kanban', '{}'::jsonb, 'task', new.id::text, jsonb_build_object('taskId', new.id)
    );
  end if;
  return new;
end;
$$;

create or replace function private.notify_task_comment()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_task public.tasks%rowtype;
  author_name text;
begin
  select * into target_task from public.tasks where id = new.task_id;
  if target_task.assignee_member_id is null
    or target_task.assignee_member_id is not distinct from new.author_member_id
    or not private.notification_preference_enabled(target_task.assignee_member_id, 'tasks')
  then return new; end if;
  select coalesce(name, 'A teammate') into author_name from public.team_members where id = new.author_member_id;
  perform private.upsert_notification(
    new.workspace_id, target_task.assignee_member_id, 'task-comment', format('task-comment:%s:%s', new.id, target_task.assignee_member_id),
    format('New comment on %s', target_task.title), coalesce(author_name, 'A teammate'),
    left(trim(new.body), 160), 'Comment', 'info', 'kanban', '{}'::jsonb, 'task', target_task.id::text,
    jsonb_build_object('taskId', target_task.id, 'commentId', new.id)
  );
  return new;
end;
$$;

create or replace function private.notify_lead_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_id uuid;
  event_key text;
  event_title text;
  event_badge text;
begin
  actor_id := coalesce(new.updated_by_member_id, new.created_by_member_id);
  if new.owner_member_id is null or new.owner_member_id is not distinct from actor_id
    or not private.notification_preference_enabled(new.owner_member_id, 'crm')
  then return new; end if;
  if lower(new.status) = 'qualified' and (tg_op = 'INSERT' or lower(old.status) <> 'qualified') then
    event_key := 'lead-qualified'; event_title := format('Qualified lead ready: %s', new.name); event_badge := 'Qualified';
  elsif tg_op = 'INSERT' or new.owner_member_id is distinct from old.owner_member_id then
    event_key := 'lead-assigned'; event_title := format('Lead assigned: %s', new.name); event_badge := 'Assigned';
  else return new; end if;
  perform private.upsert_notification(
    new.workspace_id, new.owner_member_id, event_key,
    format('%s:%s:%s:%s', event_key, new.id, new.owner_member_id, extract(epoch from new.updated_at)),
    event_title, 'Leads', coalesce(nullif(trim(new.interest), ''), nullif(trim(new.company_name), ''), 'Open the lead to review the details.'),
    event_badge, 'crm', 'leads', '{}'::jsonb, 'lead', new.id::text, jsonb_build_object('leadId', new.id)
  );
  return new;
end;
$$;

create or replace function private.notify_deal_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_id uuid;
  event_title text;
begin
  actor_id := coalesce(new.updated_by_member_id, new.created_by_member_id);
  if new.owner_member_id is null or new.owner_member_id is not distinct from actor_id
    or not private.notification_preference_enabled(new.owner_member_id, 'crm')
  then return new; end if;
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    event_title := format('%s moved to %s', new.name, new.stage);
  elsif tg_op = 'INSERT' or new.owner_member_id is distinct from old.owner_member_id then
    event_title := format('Deal assigned: %s', new.name);
  else return new; end if;
  perform private.upsert_notification(
    new.workspace_id, new.owner_member_id, 'deal-update',
    format('deal-update:%s:%s:%s', new.id, new.owner_member_id, extract(epoch from new.updated_at)),
    event_title, 'Deals', 'Open the deal to review the latest details.', new.stage, 'crm',
    'deal-profile', jsonb_build_object('deal', new.id), 'deal', new.id::text, jsonb_build_object('dealId', new.id)
  );
  return new;
end;
$$;

create or replace function private.notify_missed_call()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.member_id is null or new.direction <> 'inbound'
    or new.status not in ('missed', 'voicemail', 'declined')
    or (tg_op = 'UPDATE' and new.status is not distinct from old.status)
    or not private.notification_preference_enabled(new.member_id, 'calls')
  then return new; end if;
  perform private.upsert_notification(
    new.workspace_id, new.member_id, 'missed-call', format('missed-call:%s:%s', new.id, new.status),
    case when new.status = 'voicemail' then 'New voicemail' else 'Missed inbound call' end,
    'Calls', coalesce(nullif(trim(new.counterparty_name), ''), nullif(trim(new.from_number), ''), 'Unknown caller'),
    case when new.status = 'voicemail' then 'Voicemail' else 'Missed' end, 'warning',
    'comms-calls', '{}'::jsonb, 'call', new.id::text, jsonb_build_object('callLogId', new.id)
  );
  return new;
end;
$$;

drop trigger if exists notifications_on_task_change on public.tasks;
create trigger notifications_on_task_change after insert or update of assignee_member_id on public.tasks
for each row execute function private.notify_task_change();
drop trigger if exists notifications_on_task_comment on public.task_comments;
create trigger notifications_on_task_comment after insert on public.task_comments
for each row execute function private.notify_task_comment();
drop trigger if exists notifications_on_lead_change on public.leads;
create trigger notifications_on_lead_change after insert or update of owner_member_id, status on public.leads
for each row execute function private.notify_lead_change();
drop trigger if exists notifications_on_deal_change on public.deals;
create trigger notifications_on_deal_change after insert or update of owner_member_id, stage on public.deals
for each row execute function private.notify_deal_change();
drop trigger if exists notifications_on_missed_call on public.call_logs;
create trigger notifications_on_missed_call after insert or update of status on public.call_logs
for each row execute function private.notify_missed_call();

create or replace function public.get_notifications_page(
  p_workspace_id uuid,
  p_filter text default 'all',
  p_limit integer default 24,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_member_id uuid;
  enabled boolean;
  normalized_filter text;
  page_limit integer;
  page_offset integer;
  total_count integer;
  unread_total integer;
  page_items jsonb;
begin
  current_member_id := private.require_active_workspace_member(p_workspace_id);
  select coalesce((notifications ->> 'inApp')::boolean, true) into enabled
  from public.team_members where id = current_member_id;
  if not coalesce(enabled, true) then
    return jsonb_build_object('enabled', false, 'totalCount', 0, 'unreadCount', 0, 'notifications', '[]'::jsonb, 'hasMore', false);
  end if;
  perform private.sync_due_notifications_v2(p_workspace_id, current_member_id);
  normalized_filter := case when lower(coalesce(p_filter, 'all')) in ('unread', 'read') then lower(p_filter) else 'all' end;
  page_limit := greatest(1, least(coalesce(p_limit, 24), 50));
  page_offset := greatest(0, coalesce(p_offset, 0));
  select count(*) filter (where read_at is null), count(*) filter (
    where normalized_filter = 'all' or (normalized_filter = 'unread' and read_at is null) or (normalized_filter = 'read' and read_at is not null)
  ) into unread_total, total_count
  from public.notifications
  where workspace_id = p_workspace_id and member_id = current_member_id and dismissed_at is null;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id, 'type', n.type, 'title', n.title, 'meta', n.meta, 'body', n.body, 'badge', n.badge,
    'tone', n.tone, 'routeId', n.route_id, 'routeParams', n.route_params, 'entityType', n.entity_type,
    'entityId', n.entity_id, 'payload', n.payload, 'createdAt', n.created_at, 'updatedAt', n.updated_at, 'readAt', n.read_at
  ) order by n.created_at desc), '[]'::jsonb) into page_items
  from (
    select * from public.notifications
    where workspace_id = p_workspace_id and member_id = current_member_id and dismissed_at is null
      and (normalized_filter = 'all' or (normalized_filter = 'unread' and read_at is null) or (normalized_filter = 'read' and read_at is not null))
    order by created_at desc limit page_limit offset page_offset
  ) n;
  return jsonb_build_object('enabled', true, 'totalCount', total_count, 'unreadCount', unread_total,
    'notifications', page_items, 'hasMore', page_offset + jsonb_array_length(page_items) < total_count);
end;
$$;

create or replace function public.get_notifications_snapshot(p_workspace_id uuid, p_limit integer default 12)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare result jsonb;
begin
  result := public.get_notifications_page(p_workspace_id, 'all', p_limit, 0);
  return jsonb_build_object('enabled', result -> 'enabled', 'unreadCount', result -> 'unreadCount', 'notifications', result -> 'notifications');
end;
$$;

create or replace function public.mark_all_notifications_read(p_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare current_member_id uuid; touched_count integer;
begin
  current_member_id := private.require_active_workspace_member(p_workspace_id);
  update public.notifications set read_at = timezone('utc', now()), updated_at = timezone('utc', now())
  where workspace_id = p_workspace_id and member_id = current_member_id and dismissed_at is null and read_at is null;
  get diagnostics touched_count = row_count;
  return touched_count;
end;
$$;

create or replace function public.dismiss_notification(p_workspace_id uuid, p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare current_member_id uuid; touched_count integer;
begin
  current_member_id := private.require_active_workspace_member(p_workspace_id);
  update public.notifications
  set dismissed_was_read = read_at is not null, dismissed_at = timezone('utc', now()),
      read_at = coalesce(read_at, timezone('utc', now())), updated_at = timezone('utc', now())
  where workspace_id = p_workspace_id and member_id = current_member_id and id = p_notification_id and dismissed_at is null;
  get diagnostics touched_count = row_count;
  return touched_count > 0;
end;
$$;

create or replace function public.restore_notification(p_workspace_id uuid, p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare current_member_id uuid; touched_count integer;
begin
  current_member_id := private.require_active_workspace_member(p_workspace_id);
  update public.notifications
  set read_at = case when coalesce(dismissed_was_read, false) then read_at else null end,
      dismissed_at = null, dismissed_was_read = null, updated_at = timezone('utc', now())
  where workspace_id = p_workspace_id and member_id = current_member_id and id = p_notification_id and dismissed_at is not null;
  get diagnostics touched_count = row_count;
  return touched_count > 0;
end;
$$;

create or replace function private.sync_all_due_notifications_v2()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare recipient record;
begin
  for recipient in
    select workspace_id, id from public.team_members
    where status = 'Active' and coalesce((notifications ->> 'inApp')::boolean, true)
  loop
    perform private.sync_due_notifications_v2(recipient.workspace_id, recipient.id);
  end loop;
end;
$$;

do $$
begin
  create extension if not exists pg_cron;
  if exists (select 1 from cron.job where jobname = 'joynosync-notifications-due-hourly') then
    perform cron.unschedule('joynosync-notifications-due-hourly');
  end if;
  perform cron.schedule('joynosync-notifications-due-hourly', '5 * * * *', 'select private.sync_all_due_notifications_v2();');
exception when others then
  raise notice 'pg_cron schedule unavailable; clients will continue the periodic reminder refresh: %', sqlerrm;
end;
$$;

revoke all on function public.get_notifications_page(uuid, text, integer, integer) from public;
revoke all on function public.mark_all_notifications_read(uuid) from public;
revoke all on function public.restore_notification(uuid, uuid) from public;
grant execute on function public.get_notifications_page(uuid, text, integer, integer) to authenticated;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;
grant execute on function public.restore_notification(uuid, uuid) to authenticated;

commit;
