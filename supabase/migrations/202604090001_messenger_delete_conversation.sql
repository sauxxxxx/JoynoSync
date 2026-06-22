begin;

create or replace function public.delete_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_member_id uuid;
  target_type text;
  remaining_active_count integer;
  promoted_owner_id uuid;
  removed_for_all boolean := false;
begin
  select c.type, ctx.member_id
  into target_type, actor_member_id
  from public.conversations c
  join private.require_conversation_member(p_conversation_id) as ctx on true
  where c.id = p_conversation_id;

  if target_type is null then
    raise exception 'Conversation not found.' using errcode = 'P0001';
  end if;

  if target_type = 'direct' then
    update public.conversation_members
    set
      left_at = timezone('utc', now()),
      pinned = false,
      muted = false,
      last_read_at = timezone('utc', now())
    where conversation_id = p_conversation_id
      and left_at is null;

    removed_for_all := true;
  else
    update public.conversation_members
    set
      left_at = timezone('utc', now()),
      pinned = false,
      muted = false,
      last_read_at = timezone('utc', now())
    where conversation_id = p_conversation_id
      and member_id = actor_member_id
      and left_at is null;

    select count(*)
    into remaining_active_count
    from public.conversation_members
    where conversation_id = p_conversation_id
      and left_at is null;

    removed_for_all := coalesce(remaining_active_count, 0) = 0;

    if not removed_for_all and not exists (
      select 1
      from public.conversation_members
      where conversation_id = p_conversation_id
        and left_at is null
        and role = 'owner'
    ) then
      select cm.member_id
      into promoted_owner_id
      from public.conversation_members cm
      where cm.conversation_id = p_conversation_id
        and cm.left_at is null
      order by cm.joined_at asc, cm.member_id asc
      limit 1;

      if promoted_owner_id is not null then
        update public.conversation_members
        set role = case when member_id = promoted_owner_id then 'owner' else 'member' end
        where conversation_id = p_conversation_id
          and left_at is null;
      end if;
    end if;
  end if;

  update public.conversations
  set updated_at = timezone('utc', now())
  where id = p_conversation_id;

  return jsonb_build_object(
    'conversationId', p_conversation_id,
    'removedForAll', removed_for_all
  );
end;
$$;

grant execute on function public.delete_conversation(uuid) to authenticated;

commit;
