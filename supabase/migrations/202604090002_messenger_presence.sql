begin;

create table if not exists public.messenger_presence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  presence_status text not null default 'Offline',
  active_conversation_id uuid references public.conversations(id) on delete set null,
  last_seen_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint messenger_presence_status_check check (presence_status in ('Active', 'Idle', 'Offline')),
  constraint messenger_presence_workspace_member_key unique (workspace_id, member_id)
);

drop trigger if exists set_messenger_presence_updated_at on public.messenger_presence;
create trigger set_messenger_presence_updated_at
before update on public.messenger_presence
for each row
execute function public.set_updated_at();

create index if not exists messenger_presence_workspace_member_idx
on public.messenger_presence (workspace_id, member_id, updated_at desc);

create index if not exists messenger_presence_workspace_seen_idx
on public.messenger_presence (workspace_id, last_seen_at desc);

create or replace function private.ensure_messenger_presence_row(
  target_workspace_id uuid,
  target_member_id uuid
)
returns public.messenger_presence
language plpgsql
security definer
set search_path = public, private
as $$
declare
  presence_row public.messenger_presence%rowtype;
begin
  insert into public.messenger_presence (
    workspace_id,
    member_id,
    presence_status,
    active_conversation_id,
    last_seen_at
  )
  values (
    target_workspace_id,
    target_member_id,
    'Offline',
    null,
    timezone('utc', now())
  )
  on conflict (workspace_id, member_id) do nothing;

  select * into presence_row
  from public.messenger_presence mp
  where mp.workspace_id = target_workspace_id
    and mp.member_id = target_member_id
  limit 1;

  return presence_row;
end;
$$;

create or replace function private.messenger_presence_json(
  target_workspace_id uuid,
  target_member_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'id', mp.id,
    'memberId', mp.member_id,
    'presenceStatus', mp.presence_status,
    'activeConversationId', mp.active_conversation_id,
    'lastSeenAt', mp.last_seen_at,
    'updatedAt', mp.updated_at
  )
  from public.messenger_presence mp
  where mp.workspace_id = target_workspace_id
    and mp.member_id = target_member_id
  limit 1;
$$;

create or replace function private.conversation_json(target_conversation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'id', c.id,
    'workspaceId', c.workspace_id,
    'type', c.type,
    'title', c.title,
    'createdAt', c.created_at,
    'updatedAt', c.updated_at,
    'memberIds', coalesce((
      select jsonb_agg(cm.member_id order by cm.joined_at asc)
      from public.conversation_members cm
      where cm.conversation_id = c.id
        and cm.left_at is null
    ), '[]'::jsonb),
    'unreadCount', coalesce((
      select count(*)
      from public.messages m
      where m.conversation_id = c.id
        and m.deleted_at is null
        and (cm.last_read_at is null or m.created_at > cm.last_read_at)
    ), 0),
    'pinned', cm.pinned,
    'muted', cm.muted,
    'lastReadAt', cm.last_read_at,
    'latestMessage', (
      select jsonb_build_object(
        'id', m.id,
        'senderId', m.sender_id,
        'sender', coalesce(sender_member.name, 'Unknown'),
        'body', m.body,
        'createdAt', m.created_at,
        'deletedAt', m.deleted_at,
        'attachmentCount', (
          select count(*)
          from public.message_attachments a
          where a.message_id = m.id
        )
      )
      from public.messages m
      left join public.team_members sender_member on sender_member.id = m.sender_id
      where m.conversation_id = c.id
      order by m.created_at desc
      limit 1
    ),
    'presence', jsonb_build_object(
      'members', coalesce((
        select jsonb_agg(
          coalesce(
            private.messenger_presence_json(c.workspace_id, cm.member_id),
            jsonb_build_object(
              'id', null,
              'memberId', cm.member_id,
              'presenceStatus', 'Offline',
              'activeConversationId', null,
              'lastSeenAt', null,
              'updatedAt', null
            )
          )
          order by cm.joined_at asc
        )
        from public.conversation_members cm
        where cm.conversation_id = c.id
          and cm.left_at is null
      ), '[]'::jsonb),
      'activeCount', coalesce((
        select count(*)
        from public.conversation_members cm
        join public.messenger_presence mp
          on mp.workspace_id = c.workspace_id
         and mp.member_id = cm.member_id
        where cm.conversation_id = c.id
          and cm.left_at is null
          and mp.presence_status = 'Active'
          and mp.last_seen_at >= timezone('utc', now()) - interval '45 seconds'
      ), 0),
      'recentCount', coalesce((
        select count(*)
        from public.conversation_members cm
        join public.messenger_presence mp
          on mp.workspace_id = c.workspace_id
         and mp.member_id = cm.member_id
        where cm.conversation_id = c.id
          and cm.left_at is null
          and mp.last_seen_at >= timezone('utc', now()) - interval '5 minutes'
      ), 0),
      'lastSeenAt', (
        select max(mp.last_seen_at)
        from public.conversation_members cm
        join public.messenger_presence mp
          on mp.workspace_id = c.workspace_id
         and mp.member_id = cm.member_id
        where cm.conversation_id = c.id
          and cm.left_at is null
      )
    )
  )
  from public.conversations c
  join public.conversation_members cm
    on cm.conversation_id = c.id
   and cm.member_id = private.current_team_member_id(c.workspace_id)
   and cm.left_at is null
  where c.id = target_conversation_id;
$$;

create or replace function public.set_messenger_presence(
  p_presence_status text default 'Active',
  p_active_conversation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  next_status text;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);
  perform private.ensure_messenger_presence_row(target_workspace_id, actor_member_id);

  next_status := trim(coalesce(p_presence_status, 'Active'));
  if next_status not in ('Active', 'Idle', 'Offline') then
    next_status := 'Active';
  end if;

  update public.messenger_presence
  set
    presence_status = next_status,
    active_conversation_id = case
      when next_status = 'Active' and p_active_conversation_id is not null then p_active_conversation_id
      else null
    end,
    last_seen_at = timezone('utc', now())
  where workspace_id = target_workspace_id
    and member_id = actor_member_id;

  return private.messenger_presence_json(target_workspace_id, actor_member_id);
end;
$$;

revoke all on function private.ensure_messenger_presence_row(uuid, uuid) from public;
revoke all on function private.messenger_presence_json(uuid, uuid) from public;
revoke all on function public.set_messenger_presence(text, uuid) from public;

grant execute on function private.ensure_messenger_presence_row(uuid, uuid) to authenticated;
grant execute on function private.messenger_presence_json(uuid, uuid) to authenticated;
grant execute on function public.set_messenger_presence(text, uuid) to authenticated;

alter table public.messenger_presence enable row level security;

drop policy if exists "messenger_presence_member_select" on public.messenger_presence;
create policy "messenger_presence_member_select"
on public.messenger_presence
for select
to authenticated
using (
  workspace_id = private.current_workspace_id()
);

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'messenger_presence'
    ) then
      execute 'alter publication supabase_realtime add table public.messenger_presence';
    end if;
  end if;
end;
$$;

commit;
