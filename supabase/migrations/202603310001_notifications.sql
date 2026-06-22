begin;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  type text not null default 'info',
  dedupe_key text not null,
  title text not null,
  meta text not null default '',
  body text not null default '',
  badge text not null default '',
  tone text not null default 'info',
  route_id text not null default 'dashboard',
  route_params jsonb not null default '{}'::jsonb,
  entity_type text not null default '',
  entity_id text not null default '',
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint notifications_workspace_member_dedupe_key unique (workspace_id, member_id, dedupe_key),
  constraint notifications_tone_check check (tone in ('info', 'success', 'warning', 'danger', 'crm'))
);

create index if not exists notifications_member_unread_idx
on public.notifications (member_id, read_at, dismissed_at, created_at desc);

create index if not exists notifications_workspace_member_created_idx
on public.notifications (workspace_id, member_id, created_at desc);

create index if not exists notifications_entity_idx
on public.notifications (workspace_id, member_id, entity_type, entity_id, dismissed_at);

alter table public.notifications enable row level security;

drop policy if exists "notifications_member_select" on public.notifications;
create policy "notifications_member_select"
on public.notifications
for select
to authenticated
using (
  workspace_id in (
    select tm.workspace_id
    from public.team_members tm
    where tm.id = public.notifications.member_id
      and (tm.auth_user_id = auth.uid() or lower(tm.email) = private.current_user_email())
      and tm.status = 'Active'
  )
);

create or replace function private.upsert_notification(
  target_workspace_id uuid,
  target_member_id uuid,
  target_type text,
  target_dedupe_key text,
  target_title text,
  target_meta text,
  target_body text,
  target_badge text,
  target_tone text,
  target_route_id text,
  target_route_params jsonb default '{}'::jsonb,
  target_entity_type text default '',
  target_entity_id text default '',
  target_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  notification_id uuid;
begin
  if target_workspace_id is null or target_member_id is null or coalesce(target_dedupe_key, '') = '' then
    return null;
  end if;

  insert into public.notifications (
    workspace_id,
    member_id,
    type,
    dedupe_key,
    title,
    meta,
    body,
    badge,
    tone,
    route_id,
    route_params,
    entity_type,
    entity_id,
    payload
  )
  values (
    target_workspace_id,
    target_member_id,
    coalesce(nullif(target_type, ''), 'info'),
    target_dedupe_key,
    coalesce(nullif(target_title, ''), 'Notification'),
    coalesce(target_meta, ''),
    coalesce(target_body, ''),
    coalesce(target_badge, ''),
    case
      when target_tone in ('info', 'success', 'warning', 'danger', 'crm') then target_tone
      else 'info'
    end,
    coalesce(nullif(target_route_id, ''), 'dashboard'),
    coalesce(target_route_params, '{}'::jsonb),
    coalesce(target_entity_type, ''),
    coalesce(target_entity_id, ''),
    coalesce(target_payload, '{}'::jsonb)
  )
  on conflict (workspace_id, member_id, dedupe_key)
  do update
  set
    type = excluded.type,
    title = excluded.title,
    meta = excluded.meta,
    body = excluded.body,
    badge = excluded.badge,
    tone = excluded.tone,
    route_id = excluded.route_id,
    route_params = excluded.route_params,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    payload = excluded.payload,
    updated_at = timezone('utc', now())
  where public.notifications.type is distinct from excluded.type
    or public.notifications.title is distinct from excluded.title
    or public.notifications.meta is distinct from excluded.meta
    or public.notifications.body is distinct from excluded.body
    or public.notifications.badge is distinct from excluded.badge
    or public.notifications.tone is distinct from excluded.tone
    or public.notifications.route_id is distinct from excluded.route_id
    or public.notifications.route_params is distinct from excluded.route_params
    or public.notifications.entity_type is distinct from excluded.entity_type
    or public.notifications.entity_id is distinct from excluded.entity_id
    or public.notifications.payload is distinct from excluded.payload
  returning id
  into notification_id;

  if notification_id is null then
    select n.id
    into notification_id
    from public.notifications n
    where n.workspace_id = target_workspace_id
      and n.member_id = target_member_id
      and n.dedupe_key = target_dedupe_key
    limit 1;
  end if;

  return notification_id;
end;
$$;

create or replace function private.sync_due_notifications(
  target_workspace_id uuid,
  target_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  notifications_enabled boolean;
begin
  if target_workspace_id is null or target_member_id is null then
    return;
  end if;

  select coalesce((tm.notifications ->> 'inApp')::boolean, true)
  into notifications_enabled
  from public.team_members tm
  where tm.workspace_id = target_workspace_id
    and tm.id = target_member_id
  limit 1;

  if coalesce(notifications_enabled, true) is not true then
    return;
  end if;

  insert into public.notifications (
    workspace_id,
    member_id,
    type,
    dedupe_key,
    title,
    meta,
    body,
    badge,
    tone,
    route_id,
    route_params,
    entity_type,
    entity_id,
    payload
  )
  select
    t.workspace_id,
    target_member_id,
    'task-due',
    format('task-due:%s:%s', t.id, t.due_date),
    case
      when t.due_date < current_date then format('Task overdue: %s', t.title)
      else format('Task due today: %s', t.title)
    end,
    format('Due %s · Work', to_char(t.due_date, 'Mon DD')),
    coalesce(nullif(trim(t.description), ''), coalesce(nullif(trim(t.linked_label_snapshot), ''), 'Open Work to review this task.')),
    case
      when t.due_date < current_date then 'Overdue'
      else 'Today'
    end,
    case
      when t.due_date < current_date then 'danger'
      else 'warning'
    end,
    'my-work',
    '{}'::jsonb,
    'task',
    t.id::text,
    jsonb_build_object('taskId', t.id, 'dueDate', t.due_date)
  from public.tasks t
  where t.workspace_id = target_workspace_id
    and t.assignee_member_id = target_member_id
    and t.status <> 'Completed'
    and t.due_date <= current_date
  on conflict (workspace_id, member_id, dedupe_key)
  do update
  set
    title = excluded.title,
    meta = excluded.meta,
    body = excluded.body,
    badge = excluded.badge,
    tone = excluded.tone,
    route_id = excluded.route_id,
    route_params = excluded.route_params,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    payload = excluded.payload,
    updated_at = timezone('utc', now())
  where public.notifications.title is distinct from excluded.title
    or public.notifications.meta is distinct from excluded.meta
    or public.notifications.body is distinct from excluded.body
    or public.notifications.badge is distinct from excluded.badge
    or public.notifications.tone is distinct from excluded.tone
    or public.notifications.route_id is distinct from excluded.route_id
    or public.notifications.route_params is distinct from excluded.route_params
    or public.notifications.entity_type is distinct from excluded.entity_type
    or public.notifications.entity_id is distinct from excluded.entity_id
    or public.notifications.payload is distinct from excluded.payload;

  update public.notifications n
  set
    dismissed_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where n.workspace_id = target_workspace_id
    and n.member_id = target_member_id
    and n.type = 'task-due'
    and n.dismissed_at is null
    and not exists (
      select 1
      from public.tasks t
      where t.id::text = n.entity_id
        and t.workspace_id = target_workspace_id
        and t.assignee_member_id = target_member_id
        and t.status <> 'Completed'
        and t.due_date <= current_date
    );

  insert into public.notifications (
    workspace_id,
    member_id,
    type,
    dedupe_key,
    title,
    meta,
    body,
    badge,
    tone,
    route_id,
    route_params,
    entity_type,
    entity_id,
    payload
  )
  select
    l.workspace_id,
    target_member_id,
    'lead-followup',
    format('lead-followup:%s:%s', l.id, l.next_follow_up_date),
    case
      when l.next_follow_up_date < current_date then format('Lead follow-up overdue: %s', l.name)
      else format('Lead follow-up due today: %s', l.name)
    end,
    format('CRM · %s', to_char(l.next_follow_up_date, 'Mon DD')),
    coalesce(nullif(trim(l.interest), ''), coalesce(nullif(trim(l.company_name), ''), 'Open Leads to review this follow-up.')),
    case
      when l.next_follow_up_date < current_date then 'Overdue'
      else 'Today'
    end,
    case
      when l.next_follow_up_date < current_date then 'danger'
      else 'crm'
    end,
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
    and l.next_follow_up_date <= current_date
  on conflict (workspace_id, member_id, dedupe_key)
  do update
  set
    title = excluded.title,
    meta = excluded.meta,
    body = excluded.body,
    badge = excluded.badge,
    tone = excluded.tone,
    route_id = excluded.route_id,
    route_params = excluded.route_params,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    payload = excluded.payload,
    updated_at = timezone('utc', now())
  where public.notifications.title is distinct from excluded.title
    or public.notifications.meta is distinct from excluded.meta
    or public.notifications.body is distinct from excluded.body
    or public.notifications.badge is distinct from excluded.badge
    or public.notifications.tone is distinct from excluded.tone
    or public.notifications.route_id is distinct from excluded.route_id
    or public.notifications.route_params is distinct from excluded.route_params
    or public.notifications.entity_type is distinct from excluded.entity_type
    or public.notifications.entity_id is distinct from excluded.entity_id
    or public.notifications.payload is distinct from excluded.payload;

  update public.notifications n
  set
    dismissed_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where n.workspace_id = target_workspace_id
    and n.member_id = target_member_id
    and n.type = 'lead-followup'
    and n.dismissed_at is null
    and not exists (
      select 1
      from public.leads l
      where l.id::text = n.entity_id
        and l.workspace_id = target_workspace_id
        and l.owner_member_id = target_member_id
        and l.archived_at is null
        and l.status <> 'Converted'
        and l.next_follow_up_date is not null
        and l.next_follow_up_date <= current_date
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
  if new.deleted_at is not null then
    return new;
  end if;

  select coalesce(tm.name, 'Someone')
  into sender_name
  from public.team_members tm
  where tm.id = new.sender_id
  limit 1;

  select c.type
  into conversation_type
  from public.conversations c
  where c.id = new.conversation_id
  limit 1;

  message_preview := nullif(trim(new.body), '');
  if message_preview is null then
    message_preview := 'Open Messenger to view the latest message.';
  else
    message_preview := left(message_preview, 120);
  end if;

  for recipient in
    select
      cm.member_id,
      coalesce((tm.notifications ->> 'inApp')::boolean, true) as in_app_enabled
    from public.conversation_members cm
    join public.team_members tm on tm.id = cm.member_id
    where cm.conversation_id = new.conversation_id
      and cm.left_at is null
      and cm.member_id is distinct from new.sender_id
      and tm.status = 'Active'
      and coalesce(cm.muted, false) = false
  loop
    if recipient.in_app_enabled is not true then
      continue;
    end if;

    perform private.upsert_notification(
      new.workspace_id,
      recipient.member_id,
      'message',
      format('message:%s:%s', new.id, recipient.member_id),
      format('New message from %s', sender_name),
      message_preview,
      message_preview,
      'Unread',
      'info',
      'comms-messenger',
      '{}'::jsonb,
      'conversation',
      new.conversation_id::text,
      jsonb_build_object(
        'conversationId', new.conversation_id,
        'targetType', coalesce(conversation_type, 'direct'),
        'messageId', new.id
      )
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists notifications_on_message_insert on public.messages;
create trigger notifications_on_message_insert
after insert on public.messages
for each row
execute function private.notify_message_insert();

create or replace function public.get_notifications_snapshot(
  p_workspace_id uuid,
  p_limit integer default 12
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_member_id uuid;
  notifications_enabled boolean;
  unread_total integer := 0;
  notifications_payload jsonb := '[]'::jsonb;
begin
  current_member_id := private.require_active_workspace_member(p_workspace_id);

  select coalesce((tm.notifications ->> 'inApp')::boolean, true)
  into notifications_enabled
  from public.team_members tm
  where tm.workspace_id = p_workspace_id
    and tm.id = current_member_id
  limit 1;

  if coalesce(notifications_enabled, true) is not true then
    return jsonb_build_object(
      'enabled', false,
      'unreadCount', 0,
      'notifications', '[]'::jsonb
    );
  end if;

  perform private.sync_due_notifications(p_workspace_id, current_member_id);

  select count(*)
  into unread_total
  from public.notifications n
  where n.workspace_id = p_workspace_id
    and n.member_id = current_member_id
    and n.dismissed_at is null
    and n.read_at is null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', n.id,
        'type', n.type,
        'title', n.title,
        'meta', n.meta,
        'body', n.body,
        'badge', n.badge,
        'tone', n.tone,
        'routeId', n.route_id,
        'routeParams', n.route_params,
        'entityType', n.entity_type,
        'entityId', n.entity_id,
        'payload', n.payload,
        'createdAt', n.created_at,
        'updatedAt', n.updated_at,
        'readAt', n.read_at
      )
      order by case when n.read_at is null then 0 else 1 end, n.created_at desc
    ),
    '[]'::jsonb
  )
  into notifications_payload
  from (
    select *
    from public.notifications
    where workspace_id = p_workspace_id
      and member_id = current_member_id
      and dismissed_at is null
    order by case when read_at is null then 0 else 1 end, created_at desc
    limit greatest(1, least(coalesce(p_limit, 12), 50))
  ) n;

  return jsonb_build_object(
    'enabled', true,
    'unreadCount', unread_total,
    'notifications', notifications_payload
  );
end;
$$;

create or replace function public.mark_notifications_read(
  p_workspace_id uuid,
  p_notification_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_member_id uuid;
  touched_count integer := 0;
begin
  current_member_id := private.require_active_workspace_member(p_workspace_id);

  if coalesce(array_length(p_notification_ids, 1), 0) = 0 then
    return 0;
  end if;

  update public.notifications n
  set
    read_at = coalesce(n.read_at, timezone('utc', now())),
    updated_at = timezone('utc', now())
  where n.workspace_id = p_workspace_id
    and n.member_id = current_member_id
    and n.id = any(p_notification_ids)
    and n.dismissed_at is null
    and n.read_at is null;

  get diagnostics touched_count = row_count;
  return touched_count;
end;
$$;

create or replace function public.mark_entity_notifications_read(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id text
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_member_id uuid;
  touched_count integer := 0;
begin
  current_member_id := private.require_active_workspace_member(p_workspace_id);

  if coalesce(p_entity_type, '') = '' or coalesce(p_entity_id, '') = '' then
    return 0;
  end if;

  update public.notifications n
  set
    read_at = coalesce(n.read_at, timezone('utc', now())),
    updated_at = timezone('utc', now())
  where n.workspace_id = p_workspace_id
    and n.member_id = current_member_id
    and n.entity_type = p_entity_type
    and n.entity_id = p_entity_id
    and n.dismissed_at is null
    and n.read_at is null;

  get diagnostics touched_count = row_count;
  return touched_count;
end;
$$;

create or replace function public.dismiss_notification(
  p_workspace_id uuid,
  p_notification_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_member_id uuid;
  touched_count integer := 0;
begin
  current_member_id := private.require_active_workspace_member(p_workspace_id);

  if p_notification_id is null then
    return false;
  end if;

  update public.notifications n
  set
    dismissed_at = coalesce(n.dismissed_at, timezone('utc', now())),
    read_at = coalesce(n.read_at, timezone('utc', now())),
    updated_at = timezone('utc', now())
  where n.workspace_id = p_workspace_id
    and n.member_id = current_member_id
    and n.id = p_notification_id
    and n.dismissed_at is null;

  get diagnostics touched_count = row_count;
  return touched_count > 0;
end;
$$;

insert into public.notifications (
  workspace_id,
  member_id,
  type,
  dedupe_key,
  title,
  meta,
  body,
  badge,
  tone,
  route_id,
  route_params,
  entity_type,
  entity_id,
  payload
)
select
  t.workspace_id,
  t.assignee_member_id,
  'task-due',
  format('task-due:%s:%s', t.id, t.due_date),
  case
    when t.due_date < current_date then format('Task overdue: %s', t.title)
    else format('Task due today: %s', t.title)
  end,
  format('Due %s · Work', to_char(t.due_date, 'Mon DD')),
  coalesce(nullif(trim(t.description), ''), coalesce(nullif(trim(t.linked_label_snapshot), ''), 'Open Work to review this task.')),
  case when t.due_date < current_date then 'Overdue' else 'Today' end,
  case when t.due_date < current_date then 'danger' else 'warning' end,
  'my-work',
  '{}'::jsonb,
  'task',
  t.id::text,
  jsonb_build_object('taskId', t.id, 'dueDate', t.due_date)
from public.tasks t
join public.team_members tm
  on tm.id = t.assignee_member_id
where t.assignee_member_id is not null
  and tm.status = 'Active'
  and coalesce((tm.notifications ->> 'inApp')::boolean, true) = true
  and t.status <> 'Completed'
  and t.due_date <= current_date
on conflict (workspace_id, member_id, dedupe_key) do nothing;

insert into public.notifications (
  workspace_id,
  member_id,
  type,
  dedupe_key,
  title,
  meta,
  body,
  badge,
  tone,
  route_id,
  route_params,
  entity_type,
  entity_id,
  payload
)
select
  l.workspace_id,
  l.owner_member_id,
  'lead-followup',
  format('lead-followup:%s:%s', l.id, l.next_follow_up_date),
  case
    when l.next_follow_up_date < current_date then format('Lead follow-up overdue: %s', l.name)
    else format('Lead follow-up due today: %s', l.name)
  end,
  format('CRM · %s', to_char(l.next_follow_up_date, 'Mon DD')),
  coalesce(nullif(trim(l.interest), ''), coalesce(nullif(trim(l.company_name), ''), 'Open Leads to review this follow-up.')),
  case when l.next_follow_up_date < current_date then 'Overdue' else 'Today' end,
  case when l.next_follow_up_date < current_date then 'danger' else 'crm' end,
  'leads',
  '{}'::jsonb,
  'lead',
  l.id::text,
  jsonb_build_object('leadId', l.id, 'nextFollowUpDate', l.next_follow_up_date)
from public.leads l
join public.team_members tm
  on tm.id = l.owner_member_id
where l.owner_member_id is not null
  and tm.status = 'Active'
  and coalesce((tm.notifications ->> 'inApp')::boolean, true) = true
  and l.archived_at is null
  and l.status <> 'Converted'
  and l.next_follow_up_date is not null
  and l.next_follow_up_date <= current_date
on conflict (workspace_id, member_id, dedupe_key) do nothing;

insert into public.notifications (
  workspace_id,
  member_id,
  type,
  dedupe_key,
  title,
  meta,
  body,
  badge,
  tone,
  route_id,
  route_params,
  entity_type,
  entity_id,
  payload
)
select
  m.workspace_id,
  cm.member_id,
  'message',
  format('message:%s:%s', m.id, cm.member_id),
  format('New message from %s', coalesce(sender_member.name, 'Someone')),
  coalesce(nullif(left(trim(m.body), 120), ''), 'Open Messenger to view the latest message.'),
  coalesce(nullif(left(trim(m.body), 120), ''), 'Open Messenger to view the latest message.'),
  'Unread',
  'info',
  'comms-messenger',
  '{}'::jsonb,
  'conversation',
  m.conversation_id::text,
  jsonb_build_object(
    'conversationId', m.conversation_id,
    'targetType', c.type,
    'messageId', m.id
  )
from public.messages m
join public.conversations c
  on c.id = m.conversation_id
join public.conversation_members cm
  on cm.conversation_id = c.id
 and cm.left_at is null
 and cm.member_id is distinct from m.sender_id
join public.team_members recipient_member
  on recipient_member.id = cm.member_id
 and recipient_member.status = 'Active'
left join public.team_members sender_member
  on sender_member.id = m.sender_id
where m.deleted_at is null
  and coalesce(cm.muted, false) = false
  and coalesce((recipient_member.notifications ->> 'inApp')::boolean, true) = true
  and (cm.last_read_at is null or m.created_at > cm.last_read_at)
on conflict (workspace_id, member_id, dedupe_key) do nothing;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end;
$$;

commit;
