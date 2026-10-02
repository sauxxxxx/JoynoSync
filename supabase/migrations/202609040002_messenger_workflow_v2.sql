begin;

alter table public.messages
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by_member_id uuid references public.team_members(id) on delete set null;

create index if not exists messages_conversation_pinned_idx
on public.messages (conversation_id, pinned_at desc)
where pinned_at is not null and deleted_at is null;

create or replace function private.message_receipts_json(target_message_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'memberId', cm.member_id,
        'name', coalesce(tm.name, 'Unknown'),
        'readAt', cm.last_read_at
      )
      order by coalesce(cm.last_read_at, cm.joined_at) asc
    ) filter (where cm.last_read_at >= m.created_at),
    '[]'::jsonb
  )
  from public.messages m
  join public.conversation_members cm
    on cm.conversation_id = m.conversation_id
   and cm.left_at is null
   and cm.member_id <> m.sender_id
  left join public.team_members tm on tm.id = cm.member_id
  where m.id = target_message_id;
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
    'pinned', m.pinned_at is not null,
    'pinnedAt', m.pinned_at,
    'pinnedByMemberId', m.pinned_by_member_id,
    'readBy', private.message_receipts_json(m.id),
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

create or replace function public.set_message_pinned(
  p_message_id uuid,
  p_pinned boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_member_id uuid;
  target_conversation_id uuid;
begin
  select m.conversation_id
  into target_conversation_id
  from public.messages m
  where m.id = p_message_id
    and m.deleted_at is null;

  if target_conversation_id is null then
    raise exception 'Message not found.' using errcode = 'P0001';
  end if;

  select ctx.member_id
  into actor_member_id
  from private.require_conversation_member(target_conversation_id) as ctx;

  update public.messages
  set
    pinned_at = case when coalesce(p_pinned, true) then timezone('utc', now()) else null end,
    pinned_by_member_id = case when coalesce(p_pinned, true) then actor_member_id else null end
  where id = p_message_id;

  return private.message_json(p_message_id);
end;
$$;

create or replace function public.update_group_conversation(
  p_conversation_id uuid,
  p_title text,
  p_member_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  actor_role text;
  normalized_title text;
  normalized_member_ids uuid[];
  target_member_id uuid;
begin
  select ctx.workspace_id, ctx.member_id
  into target_workspace_id, actor_member_id
  from private.require_conversation_member(p_conversation_id) as ctx;

  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and c.type = 'gc'
  ) then
    raise exception 'Only group conversations can be managed.' using errcode = 'P0001';
  end if;

  select tm.role
  into actor_role
  from public.team_members tm
  where tm.id = actor_member_id;

  if not exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.member_id = actor_member_id
      and cm.role = 'owner'
      and cm.left_at is null
  ) and coalesce(actor_role, '') not in ('Owner', 'Admin', 'Manager') then
    raise exception 'Only the group owner or a workspace manager can update this group.' using errcode = 'P0001';
  end if;

  normalized_title := trim(coalesce(p_title, ''));
  if normalized_title = '' then
    raise exception 'Group name is required.' using errcode = 'P0001';
  end if;

  normalized_member_ids := array(
    select distinct entries.member_id
    from unnest(coalesce(p_member_ids, '{}'::uuid[])) as entries(member_id)
    where entries.member_id is not null
  );

  if not actor_member_id = any(normalized_member_ids) then
    normalized_member_ids := array_append(normalized_member_ids, actor_member_id);
  end if;

  if coalesce(array_length(normalized_member_ids, 1), 0) < 2 then
    raise exception 'A group needs at least two active members.' using errcode = 'P0001';
  end if;

  foreach target_member_id in array normalized_member_ids
  loop
    perform private.ensure_workspace_member(target_workspace_id, target_member_id, true);
    insert into public.conversation_members (conversation_id, member_id, role, last_read_at, left_at)
    values (
      p_conversation_id,
      target_member_id,
      case when target_member_id = actor_member_id then 'owner' else 'member' end,
      case when target_member_id = actor_member_id then timezone('utc', now()) else null end,
      null
    )
    on conflict (conversation_id, member_id)
    do update set left_at = null;
  end loop;

  update public.conversation_members
  set left_at = timezone('utc', now())
  where conversation_id = p_conversation_id
    and left_at is null
    and member_id <> actor_member_id
    and not (member_id = any(normalized_member_ids));

  update public.conversations
  set title = normalized_title, updated_at = timezone('utc', now())
  where id = p_conversation_id;

  return private.conversation_json(p_conversation_id);
end;
$$;

create or replace function public.leave_group_conversation(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_member_id uuid;
  replacement_owner_id uuid;
begin
  select ctx.member_id
  into actor_member_id
  from private.require_conversation_member(p_conversation_id) as ctx;

  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and c.type = 'gc'
  ) then
    raise exception 'Only group conversations can be left.' using errcode = 'P0001';
  end if;

  select cm.member_id
  into replacement_owner_id
  from public.conversation_members cm
  where cm.conversation_id = p_conversation_id
    and cm.left_at is null
    and cm.member_id <> actor_member_id
  order by cm.joined_at asc
  limit 1;

  if replacement_owner_id is null then
    delete from public.conversations where id = p_conversation_id;
    return true;
  end if;

  update public.conversation_members
  set role = 'owner'
  where conversation_id = p_conversation_id
    and member_id = replacement_owner_id;

  update public.conversation_members
  set left_at = timezone('utc', now()), role = 'member'
  where conversation_id = p_conversation_id
    and member_id = actor_member_id;

  update public.conversations
  set updated_at = timezone('utc', now())
  where id = p_conversation_id;

  return true;
end;
$$;

revoke all on function private.message_receipts_json(uuid) from public;
revoke all on function public.set_message_pinned(uuid, boolean) from public;
revoke all on function public.update_group_conversation(uuid, text, uuid[]) from public;
revoke all on function public.leave_group_conversation(uuid) from public;

grant execute on function private.message_receipts_json(uuid) to authenticated;
grant execute on function public.set_message_pinned(uuid, boolean) to authenticated;
grant execute on function public.update_group_conversation(uuid, text, uuid[]) to authenticated;
grant execute on function public.leave_group_conversation(uuid) to authenticated;

commit;
