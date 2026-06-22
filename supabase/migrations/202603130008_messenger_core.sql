begin;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type text not null default 'direct',
  title text not null default '',
  created_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint conversations_type_check check (type in ('direct', 'gc'))
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  role text not null default 'member',
  pinned boolean not null default false,
  muted boolean not null default false,
  last_read_at timestamptz,
  joined_at timestamptz not null default timezone('utc', now()),
  left_at timestamptz,
  primary key (conversation_id, member_id),
  constraint conversation_members_role_check check (role in ('owner', 'member'))
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sender_id uuid references public.team_members(id) on delete set null,
  body text not null default '',
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  storage_path text not null,
  mime_type text not null default '',
  size_bytes bigint not null default 0,
  filename text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint message_attachments_message_path_key unique (message_id, storage_path)
);

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (message_id, member_id, emoji)
);

create table if not exists public.typing_indicators (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (conversation_id, member_id)
);

drop trigger if exists set_conversations_updated_at on public.conversations;
create trigger set_conversations_updated_at
before update on public.conversations
for each row
execute function public.set_updated_at();

create index if not exists conversations_workspace_updated_idx
on public.conversations (workspace_id, updated_at desc, created_at desc);

create index if not exists conversation_members_member_idx
on public.conversation_members (member_id, conversation_id);

create index if not exists messages_conversation_created_idx
on public.messages (conversation_id, created_at desc);

create index if not exists message_attachments_message_idx
on public.message_attachments (message_id, created_at asc);

create index if not exists message_reactions_message_idx
on public.message_reactions (message_id);

create index if not exists typing_indicators_conversation_idx
on public.typing_indicators (conversation_id, updated_at desc);

create or replace function private.require_conversation_member(p_conversation_id uuid)
returns table (workspace_id uuid, member_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  current_member_id uuid;
begin
  select c.workspace_id
  into target_workspace_id
  from public.conversations c
  where c.id = p_conversation_id;

  if target_workspace_id is null then
    raise exception 'Conversation not found.' using errcode = 'P0001';
  end if;

  current_member_id := private.require_active_workspace_member(target_workspace_id);

  if not exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.member_id = current_member_id
      and cm.left_at is null
  ) then
    raise exception 'You are not a member of this conversation.' using errcode = 'P0001';
  end if;

  workspace_id := target_workspace_id;
  member_id := current_member_id;
  return next;
end;
$$;

create or replace function private.can_edit_message(target_message_id uuid, actor_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = target_message_id
      and (
        m.sender_id = actor_member_id
        or exists (
          select 1
          from public.team_members tm
          where tm.id = actor_member_id
            and tm.workspace_id = c.workspace_id
            and tm.status = 'Active'
            and tm.role in ('Owner', 'Admin', 'Manager')
        )
      )
  );
$$;

create or replace function private.require_message_editor(target_message_id uuid)
returns table (workspace_id uuid, member_id uuid, conversation_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  current_member_id uuid;
  target_conversation_id uuid;
begin
  select m.conversation_id, c.workspace_id
  into target_conversation_id, target_workspace_id
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.id = target_message_id;

  if target_workspace_id is null then
    raise exception 'Message not found.' using errcode = 'P0001';
  end if;

  current_member_id := private.require_active_workspace_member(target_workspace_id);

  if not private.can_edit_message(target_message_id, current_member_id) then
    raise exception 'You do not have permission to update this message.' using errcode = 'P0001';
  end if;

  workspace_id := target_workspace_id;
  member_id := current_member_id;
  conversation_id := target_conversation_id;
  return next;
end;
$$;

create or replace function private.message_reactions_json(target_message_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'emoji', reaction_data.emoji,
    'count', reaction_data.reaction_count,
    'reacted', reaction_data.reacted
  ) order by reaction_data.emoji), '[]'::jsonb)
  from (
    select
      r.emoji,
      count(*)::integer as reaction_count,
      bool_or(r.member_id = private.current_team_member_id(c.workspace_id)) as reacted
    from public.message_reactions r
    join public.messages m on m.id = r.message_id
    join public.conversations c on c.id = m.conversation_id
    where r.message_id = target_message_id
    group by r.emoji, c.workspace_id
  ) reaction_data;
$$;

create or replace function private.message_json(target_message_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'id', m.id,
    'conversationId', m.conversation_id,
    'workspaceId', m.workspace_id,
    'senderId', m.sender_id,
    'sender', coalesce(sender_member.name, 'Unknown'),
    'body', m.body,
    'createdAt', m.created_at,
    'editedAt', m.edited_at,
    'deletedAt', m.deleted_at,
    'attachments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'storagePath', a.storage_path,
          'mimeType', a.mime_type,
          'size', a.size_bytes,
          'filename', a.filename,
          'createdAt', a.created_at
        )
        order by a.created_at asc
      )
      from public.message_attachments a
      where a.message_id = m.id
    ), '[]'::jsonb),
    'reactions', private.message_reactions_json(m.id)
  )
  from public.messages m
  left join public.team_members sender_member on sender_member.id = m.sender_id
  where m.id = target_message_id;
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
    )
  )
  from public.conversations c
  join public.conversation_members cm
    on cm.conversation_id = c.id
   and cm.member_id = private.current_team_member_id(c.workspace_id)
   and cm.left_at is null
  where c.id = target_conversation_id;
$$;

create or replace function private.validate_message_attachments(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_attachments jsonb
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  attachment jsonb;
  storage_path text;
  mime_type text;
  file_name text;
  file_ext text;
  size_bytes bigint;
  allowed_mimes text[] := array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel'
  ];
  allowed_exts text[] := array['png', 'jpg', 'jpeg', 'webp', 'pdf', 'docx', 'xlsx', 'csv'];
begin
  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    return;
  end if;

  for attachment in select * from jsonb_array_elements(p_attachments)
  loop
    storage_path := trim(coalesce(attachment->>'storagePath', ''));
    mime_type := trim(coalesce(attachment->>'mimeType', ''));
    file_name := trim(coalesce(attachment->>'filename', ''));
    size_bytes := greatest(0, coalesce((attachment->>'sizeBytes')::bigint, 0));

    if storage_path = '' or file_name = '' then
      raise exception 'Attachment metadata is required.' using errcode = 'P0001';
    end if;

    if size_bytes > 26214400 then
      raise exception 'Attachment exceeds the 25 MB limit.' using errcode = 'P0001';
    end if;

    if mime_type = '' or not mime_type = any(allowed_mimes) then
      raise exception 'Attachment type is not allowed.' using errcode = 'P0001';
    end if;

    file_ext := lower(nullif(regexp_replace(file_name, '^.*\.', ''), file_name));
    if file_ext is null or not file_ext = any(allowed_exts) then
      raise exception 'Attachment file extension is not allowed.' using errcode = 'P0001';
    end if;

    if split_part(storage_path, '/', 1) <> p_workspace_id::text then
      raise exception 'Attachment storage path is invalid.' using errcode = 'P0001';
    end if;

    if split_part(storage_path, '/', 2) <> p_conversation_id::text then
      raise exception 'Attachment storage path is invalid.' using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

create or replace function public.create_direct_conversation(p_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  current_member_id uuid;
  conversation_id uuid;
begin
  if p_member_id is null then
    raise exception 'Member is required.' using errcode = 'P0001';
  end if;

  select tm.workspace_id
  into target_workspace_id
  from public.team_members tm
  where tm.id = p_member_id;

  if target_workspace_id is null then
    raise exception 'Team member not found.' using errcode = 'P0001';
  end if;

  current_member_id := private.require_active_workspace_member(target_workspace_id);

  if current_member_id = p_member_id then
    raise exception 'Cannot start a direct chat with yourself.' using errcode = 'P0001';
  end if;

  perform private.ensure_workspace_member(target_workspace_id, p_member_id, true);

  select c.id
  into conversation_id
  from public.conversations c
  join public.conversation_members cm_self
    on cm_self.conversation_id = c.id
   and cm_self.member_id = current_member_id
   and cm_self.left_at is null
  join public.conversation_members cm_other
    on cm_other.conversation_id = c.id
   and cm_other.member_id = p_member_id
   and cm_other.left_at is null
  where c.workspace_id = target_workspace_id
    and c.type = 'direct'
    and (
      select count(*)
      from public.conversation_members cm_count
      where cm_count.conversation_id = c.id
        and cm_count.left_at is null
    ) = 2
  limit 1;

  if conversation_id is not null then
    return conversation_id;
  end if;

  insert into public.conversations (
    workspace_id,
    type,
    title,
    created_by_member_id
  )
  values (
    target_workspace_id,
    'direct',
    '',
    current_member_id
  )
  returning id into conversation_id;

  insert into public.conversation_members (
    conversation_id,
    member_id,
    role,
    last_read_at
  )
  values
    (conversation_id, current_member_id, 'owner', timezone('utc', now())),
    (conversation_id, p_member_id, 'member', null);

  return conversation_id;
end;
$$;

create or replace function public.create_group_conversation(
  p_title text,
  p_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  current_member_id uuid;
  conversation_id uuid;
  normalized_title text;
  member_ids uuid[];
  member_id uuid;
begin
  normalized_title := trim(coalesce(p_title, ''));
  if normalized_title = '' then
    raise exception 'Group name is required.' using errcode = 'P0001';
  end if;

  target_workspace_id := private.current_workspace_id();
  current_member_id := private.require_active_workspace_member(target_workspace_id);

  member_ids := array(
    select distinct unnest(coalesce(p_member_ids, '{}'::uuid[]))
  );

  if current_member_id is not null and not current_member_id = any(member_ids) then
    member_ids := array_append(member_ids, current_member_id);
  end if;

  if member_ids is null or array_length(member_ids, 1) < 2 then
    raise exception 'Select at least two members.' using errcode = 'P0001';
  end if;

  foreach member_id in array member_ids
  loop
    perform private.ensure_workspace_member(target_workspace_id, member_id, true);
  end loop;

  insert into public.conversations (
    workspace_id,
    type,
    title,
    created_by_member_id
  )
  values (
    target_workspace_id,
    'gc',
    normalized_title,
    current_member_id
  )
  returning id into conversation_id;

  foreach member_id in array member_ids
  loop
    insert into public.conversation_members (
      conversation_id,
      member_id,
      role,
      last_read_at
    )
    values (
      conversation_id,
      member_id,
      case when member_id = current_member_id then 'owner' else 'member' end,
      case when member_id = current_member_id then timezone('utc', now()) else null end
    );
  end loop;

  return conversation_id;
end;
$$;

create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text,
  p_attachments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  cleaned_body text;
  message_id uuid;
begin
  select ctx.workspace_id, ctx.member_id
  into target_workspace_id, actor_member_id
  from private.require_conversation_member(p_conversation_id) as ctx;

  cleaned_body := trim(coalesce(p_body, ''));
  if cleaned_body = '' and (p_attachments is null or jsonb_array_length(p_attachments) = 0) then
    raise exception 'Message text or attachment is required.' using errcode = 'P0001';
  end if;

  perform private.validate_message_attachments(target_workspace_id, p_conversation_id, p_attachments);

  insert into public.messages (
    conversation_id,
    workspace_id,
    sender_id,
    body
  )
  values (
    p_conversation_id,
    target_workspace_id,
    actor_member_id,
    cleaned_body
  )
  returning id into message_id;

  if p_attachments is not null and jsonb_typeof(p_attachments) = 'array' then
    insert into public.message_attachments (
      message_id,
      storage_path,
      mime_type,
      size_bytes,
      filename
    )
    select
      message_id,
      trim(coalesce(attachment->>'storagePath', '')),
      trim(coalesce(attachment->>'mimeType', '')),
      greatest(0, coalesce((attachment->>'sizeBytes')::bigint, 0)),
      trim(coalesce(attachment->>'filename', ''))
    from jsonb_array_elements(p_attachments) as attachment;
  end if;

  update public.conversations
  set updated_at = timezone('utc', now())
  where id = p_conversation_id;

  update public.conversation_members
  set last_read_at = timezone('utc', now())
  where conversation_id = p_conversation_id
    and member_id = actor_member_id;

  return private.message_json(message_id);
end;
$$;

create or replace function public.edit_message(
  p_message_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  target_conversation_id uuid;
  cleaned_body text;
  has_attachments boolean;
begin
  select ctx.workspace_id, ctx.member_id, ctx.conversation_id
  into target_workspace_id, actor_member_id, target_conversation_id
  from private.require_message_editor(p_message_id) as ctx;

  select exists (
    select 1
    from public.message_attachments a
    where a.message_id = p_message_id
  )
  into has_attachments;

  cleaned_body := trim(coalesce(p_body, ''));
  if cleaned_body = '' and not has_attachments then
    raise exception 'Message text cannot be empty.' using errcode = 'P0001';
  end if;

  update public.messages
  set
    body = cleaned_body,
    edited_at = timezone('utc', now())
  where id = p_message_id
    and deleted_at is null;

  update public.conversations
  set updated_at = timezone('utc', now())
  where id = target_conversation_id;

  return private.message_json(p_message_id);
end;
$$;

create or replace function public.delete_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_conversation_id uuid;
begin
  select ctx.conversation_id
  into target_conversation_id
  from private.require_message_editor(p_message_id) as ctx;

  update public.messages
  set
    deleted_at = timezone('utc', now()),
    body = ''
  where id = p_message_id
    and deleted_at is null;

  update public.conversations
  set updated_at = timezone('utc', now())
  where id = target_conversation_id;

  return private.message_json(p_message_id);
end;
$$;

create or replace function public.add_reaction(
  p_message_id uuid,
  p_emoji text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_conversation_id uuid;
  actor_member_id uuid;
begin
  select m.conversation_id
  into target_conversation_id
  from public.messages m
  where m.id = p_message_id;

  if target_conversation_id is null then
    raise exception 'Message not found.' using errcode = 'P0001';
  end if;

  select ctx.member_id
  into actor_member_id
  from private.require_conversation_member(target_conversation_id) as ctx;

  insert into public.message_reactions (
    message_id,
    member_id,
    emoji
  )
  values (
    p_message_id,
    actor_member_id,
    trim(coalesce(p_emoji, ''))
  )
  on conflict do nothing;

  return jsonb_build_object(
    'messageId', p_message_id,
    'reactions', private.message_reactions_json(p_message_id)
  );
end;
$$;

create or replace function public.remove_reaction(
  p_message_id uuid,
  p_emoji text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_conversation_id uuid;
  actor_member_id uuid;
begin
  select m.conversation_id
  into target_conversation_id
  from public.messages m
  where m.id = p_message_id;

  if target_conversation_id is null then
    raise exception 'Message not found.' using errcode = 'P0001';
  end if;

  select ctx.member_id
  into actor_member_id
  from private.require_conversation_member(target_conversation_id) as ctx;

  delete from public.message_reactions
  where message_id = p_message_id
    and member_id = actor_member_id
    and emoji = trim(coalesce(p_emoji, ''));

  return jsonb_build_object(
    'messageId', p_message_id,
    'reactions', private.message_reactions_json(p_message_id)
  );
end;
$$;

create or replace function public.mark_read(
  p_conversation_id uuid,
  p_mark_unread boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_member_id uuid;
begin
  select ctx.member_id
  into actor_member_id
  from private.require_conversation_member(p_conversation_id) as ctx;

  update public.conversation_members
  set last_read_at = case when p_mark_unread then null else timezone('utc', now()) end
  where conversation_id = p_conversation_id
    and member_id = actor_member_id;

  return private.conversation_json(p_conversation_id);
end;
$$;

create or replace function public.update_conversation_prefs(
  p_conversation_id uuid,
  p_pinned boolean default null,
  p_muted boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_member_id uuid;
begin
  select ctx.member_id
  into actor_member_id
  from private.require_conversation_member(p_conversation_id) as ctx;

  update public.conversation_members
  set
    pinned = coalesce(p_pinned, pinned),
    muted = coalesce(p_muted, muted)
  where conversation_id = p_conversation_id
    and member_id = actor_member_id;

  return private.conversation_json(p_conversation_id);
end;
$$;

create or replace function public.get_conversations_snapshot()
returns jsonb
language sql
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'conversations',
    coalesce(jsonb_agg(private.conversation_json(c.id) order by c.updated_at desc), '[]'::jsonb)
  )
  from public.conversations c
  join public.conversation_members cm
    on cm.conversation_id = c.id
   and cm.member_id = private.current_team_member_id(c.workspace_id)
   and cm.left_at is null;
$$;

create or replace function public.get_messages(
  p_conversation_id uuid,
  p_limit integer default 60,
  p_before timestamptz default null,
  p_search text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  normalized_limit integer;
begin
  select ctx.workspace_id, ctx.member_id
  into target_workspace_id, actor_member_id
  from private.require_conversation_member(p_conversation_id) as ctx;

  normalized_limit := greatest(1, least(200, coalesce(p_limit, 60)));

  return jsonb_build_object(
    'messages',
    coalesce((
      select jsonb_agg(private.message_json(message_slice.id) order by message_slice.created_at asc)
      from (
        select m.id, m.created_at
        from public.messages m
        where m.conversation_id = p_conversation_id
          and (p_before is null or m.created_at < p_before)
          and (p_search is null or trim(p_search) = '' or m.body ilike ('%' || trim(p_search) || '%'))
        order by m.created_at desc
        limit normalized_limit
      ) message_slice
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_typing(
  p_conversation_id uuid,
  p_is_typing boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_member_id uuid;
begin
  select ctx.member_id
  into actor_member_id
  from private.require_conversation_member(p_conversation_id) as ctx;

  delete from public.typing_indicators
  where updated_at < timezone('utc', now()) - interval '12 seconds';

  if p_is_typing then
    insert into public.typing_indicators (conversation_id, member_id, updated_at)
    values (p_conversation_id, actor_member_id, timezone('utc', now()))
    on conflict (conversation_id, member_id)
    do update set updated_at = excluded.updated_at;
  else
    delete from public.typing_indicators
    where conversation_id = p_conversation_id
      and member_id = actor_member_id;
  end if;
end;
$$;

revoke all on function private.require_conversation_member(uuid) from public;
revoke all on function private.can_edit_message(uuid, uuid) from public;
revoke all on function private.require_message_editor(uuid) from public;
revoke all on function private.message_reactions_json(uuid) from public;
revoke all on function private.message_json(uuid) from public;
revoke all on function private.conversation_json(uuid) from public;
revoke all on function private.validate_message_attachments(uuid, uuid, jsonb) from public;

grant execute on function private.require_conversation_member(uuid) to authenticated;
grant execute on function private.can_edit_message(uuid, uuid) to authenticated;
grant execute on function private.require_message_editor(uuid) to authenticated;
grant execute on function private.message_reactions_json(uuid) to authenticated;
grant execute on function private.message_json(uuid) to authenticated;
grant execute on function private.conversation_json(uuid) to authenticated;
grant execute on function private.validate_message_attachments(uuid, uuid, jsonb) to authenticated;

grant execute on function public.create_direct_conversation(uuid) to authenticated;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;
grant execute on function public.send_message(uuid, text, jsonb) to authenticated;
grant execute on function public.edit_message(uuid, text) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
grant execute on function public.add_reaction(uuid, text) to authenticated;
grant execute on function public.remove_reaction(uuid, text) to authenticated;
grant execute on function public.mark_read(uuid, boolean) to authenticated;
grant execute on function public.update_conversation_prefs(uuid, boolean, boolean) to authenticated;
grant execute on function public.get_conversations_snapshot() to authenticated;
grant execute on function public.get_messages(uuid, integer, timestamptz, text) to authenticated;
grant execute on function public.set_typing(uuid, boolean) to authenticated;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_reactions enable row level security;
alter table public.typing_indicators enable row level security;

drop policy if exists "conversations_member_select" on public.conversations;
create policy "conversations_member_select"
on public.conversations
for select
to authenticated
using (
  exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = id
      and cm.member_id = private.current_team_member_id(workspace_id)
      and cm.left_at is null
  )
);

drop policy if exists "conversation_members_member_select" on public.conversation_members;
create policy "conversation_members_member_select"
on public.conversation_members
for select
to authenticated
using (
  exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = conversation_id
      and cm.member_id = private.current_team_member_id((select c.workspace_id from public.conversations c where c.id = conversation_id))
      and cm.left_at is null
  )
);

drop policy if exists "messages_member_select" on public.messages;
create policy "messages_member_select"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.member_id = private.current_team_member_id(messages.workspace_id)
      and cm.left_at is null
  )
);

drop policy if exists "message_attachments_member_select" on public.message_attachments;
create policy "message_attachments_member_select"
on public.message_attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.messages m
    join public.conversation_members cm on cm.conversation_id = m.conversation_id
    where m.id = message_id
      and cm.member_id = private.current_team_member_id(m.workspace_id)
      and cm.left_at is null
  )
);

drop policy if exists "message_reactions_member_select" on public.message_reactions;
create policy "message_reactions_member_select"
on public.message_reactions
for select
to authenticated
using (
  exists (
    select 1
    from public.messages m
    join public.conversation_members cm on cm.conversation_id = m.conversation_id
    where m.id = message_id
      and cm.member_id = private.current_team_member_id(m.workspace_id)
      and cm.left_at is null
  )
);

drop policy if exists "typing_indicators_member_select" on public.typing_indicators;
create policy "typing_indicators_member_select"
on public.typing_indicators
for select
to authenticated
using (
  exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = conversation_id
      and cm.member_id = private.current_team_member_id((select c.workspace_id from public.conversations c where c.id = conversation_id))
      and cm.left_at is null
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'messenger-attachments',
  'messenger-attachments',
  false,
  26214400,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel'
  ]
)
on conflict (id) do nothing;

drop policy if exists "messenger_attachments_storage_select" on storage.objects;
create policy "messenger_attachments_storage_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'messenger-attachments'
  and private.is_active_workspace_member(nullif(split_part(name, '/', 1), '')::uuid)
);

drop policy if exists "messenger_attachments_storage_insert" on storage.objects;
create policy "messenger_attachments_storage_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'messenger-attachments'
  and private.is_active_workspace_member(nullif(split_part(name, '/', 1), '')::uuid)
);

drop policy if exists "messenger_attachments_storage_delete" on storage.objects;
create policy "messenger_attachments_storage_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'messenger-attachments'
  and private.is_active_workspace_member(nullif(split_part(name, '/', 1), '')::uuid)
);

commit;
