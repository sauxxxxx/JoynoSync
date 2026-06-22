begin;

create or replace function private.can_access_messenger_attachment_storage(
  target_workspace_id uuid,
  target_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select
    private.is_active_workspace_member(target_workspace_id)
    and exists (
      select 1
      from public.conversations c
      join public.conversation_members cm on cm.conversation_id = c.id
      where c.id = target_conversation_id
        and c.workspace_id = target_workspace_id
        and cm.member_id = private.current_team_member_id(target_workspace_id)
        and cm.left_at is null
    );
$$;

create or replace function private.can_delete_messenger_attachment_storage(
  target_workspace_id uuid,
  target_conversation_id uuid,
  target_storage_path text
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_member_id uuid;
  existing_message_id uuid;
begin
  actor_member_id := private.current_team_member_id(target_workspace_id);

  if actor_member_id is null or not private.is_active_workspace_member(target_workspace_id) then
    return false;
  end if;

  select a.message_id
  into existing_message_id
  from public.message_attachments a
  join public.messages m on m.id = a.message_id
  where a.storage_path = coalesce(target_storage_path, '')
    and m.workspace_id = target_workspace_id
    and m.conversation_id = target_conversation_id
  limit 1;

  if existing_message_id is not null then
    return private.can_edit_message(existing_message_id, actor_member_id);
  end if;

  return private.can_access_messenger_attachment_storage(target_workspace_id, target_conversation_id);
end;
$$;

create or replace function private.can_write_task_attachment_storage(
  target_workspace_id uuid,
  target_task_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_member_id uuid;
begin
  actor_member_id := private.current_team_member_id(target_workspace_id);

  if actor_member_id is null or not private.is_active_workspace_member(target_workspace_id) then
    return false;
  end if;

  if not exists (
    select 1
    from public.tasks t
    where t.id = target_task_id
      and t.workspace_id = target_workspace_id
  ) then
    return false;
  end if;

  return private.can_edit_task(target_task_id, actor_member_id);
end;
$$;

create or replace function private.can_delete_task_attachment_storage(
  target_workspace_id uuid,
  target_task_id uuid,
  target_storage_path text
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_member_id uuid;
  existing_task_id uuid;
begin
  actor_member_id := private.current_team_member_id(target_workspace_id);

  if actor_member_id is null or not private.is_active_workspace_member(target_workspace_id) then
    return false;
  end if;

  select a.task_id
  into existing_task_id
  from public.task_attachments a
  where a.workspace_id = target_workspace_id
    and a.storage_path = coalesce(target_storage_path, '')
  limit 1;

  existing_task_id := coalesce(existing_task_id, target_task_id);

  if existing_task_id is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.tasks t
    where t.id = existing_task_id
      and t.workspace_id = target_workspace_id
  ) then
    return false;
  end if;

  return private.can_edit_task(existing_task_id, actor_member_id);
end;
$$;

revoke all on function private.can_access_messenger_attachment_storage(uuid, uuid) from public;
revoke all on function private.can_delete_messenger_attachment_storage(uuid, uuid, text) from public;
revoke all on function private.can_write_task_attachment_storage(uuid, uuid) from public;
revoke all on function private.can_delete_task_attachment_storage(uuid, uuid, text) from public;

grant execute on function private.can_access_messenger_attachment_storage(uuid, uuid) to authenticated;
grant execute on function private.can_delete_messenger_attachment_storage(uuid, uuid, text) to authenticated;
grant execute on function private.can_write_task_attachment_storage(uuid, uuid) to authenticated;
grant execute on function private.can_delete_task_attachment_storage(uuid, uuid, text) to authenticated;

drop policy if exists "messenger_attachments_storage_select" on storage.objects;
create policy "messenger_attachments_storage_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'messenger-attachments'
  and private.can_access_messenger_attachment_storage(
    nullif(split_part(name, '/', 1), '')::uuid,
    nullif(split_part(name, '/', 2), '')::uuid
  )
);

drop policy if exists "messenger_attachments_storage_insert" on storage.objects;
create policy "messenger_attachments_storage_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'messenger-attachments'
  and private.can_access_messenger_attachment_storage(
    nullif(split_part(name, '/', 1), '')::uuid,
    nullif(split_part(name, '/', 2), '')::uuid
  )
);

drop policy if exists "messenger_attachments_storage_delete" on storage.objects;
create policy "messenger_attachments_storage_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'messenger-attachments'
  and private.can_delete_messenger_attachment_storage(
    nullif(split_part(name, '/', 1), '')::uuid,
    nullif(split_part(name, '/', 2), '')::uuid,
    name
  )
);

drop policy if exists "task_attachments_storage_insert" on storage.objects;
create policy "task_attachments_storage_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'task-attachments'
  and private.can_write_task_attachment_storage(
    nullif(split_part(name, '/', 1), '')::uuid,
    nullif(split_part(name, '/', 2), '')::uuid
  )
);

drop policy if exists "task_attachments_storage_delete" on storage.objects;
create policy "task_attachments_storage_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'task-attachments'
  and private.can_delete_task_attachment_storage(
    nullif(split_part(name, '/', 1), '')::uuid,
    nullif(split_part(name, '/', 2), '')::uuid,
    name
  )
);

revoke all on function private.require_active_workspace_member(uuid) from authenticated;
revoke all on function private.require_workspace_manager(uuid) from authenticated;
revoke all on function private.ensure_workspace_member(uuid, uuid, boolean) from authenticated;
revoke all on function private.record_work_activity(uuid, uuid, uuid, uuid, text, text, jsonb) from authenticated;
revoke all on function private.next_task_due_date(date, text) from authenticated;
revoke all on function private.can_edit_task(uuid, uuid) from authenticated;
revoke all on function private.require_task_editor(uuid) from authenticated;
revoke all on function private.can_manage_project(uuid, uuid) from authenticated;
revoke all on function private.require_project_manager(uuid) from authenticated;
revoke all on function private.task_json(uuid) from authenticated;
revoke all on function private.project_json(uuid) from authenticated;
revoke all on function private.work_snapshot_json(uuid) from authenticated;
revoke all on function private.set_project_members_internal(uuid, uuid, uuid[]) from authenticated;

revoke all on function private.require_active_workspace_member(uuid) from public;
revoke all on function private.require_workspace_manager(uuid) from public;
revoke all on function private.ensure_workspace_member(uuid, uuid, boolean) from public;
revoke all on function private.record_work_activity(uuid, uuid, uuid, uuid, text, text, jsonb) from public;
revoke all on function private.next_task_due_date(date, text) from public;
revoke all on function private.can_edit_task(uuid, uuid) from public;
revoke all on function private.require_task_editor(uuid) from public;
revoke all on function private.can_manage_project(uuid, uuid) from public;
revoke all on function private.require_project_manager(uuid) from public;
revoke all on function private.task_json(uuid) from public;
revoke all on function private.project_json(uuid) from public;
revoke all on function private.work_snapshot_json(uuid) from public;
revoke all on function private.set_project_members_internal(uuid, uuid, uuid[]) from public;

revoke all on function private.require_conversation_member(uuid) from authenticated;
revoke all on function private.can_edit_message(uuid, uuid) from authenticated;
revoke all on function private.require_message_editor(uuid) from authenticated;
revoke all on function private.message_reactions_json(uuid) from authenticated;
revoke all on function private.message_json(uuid) from authenticated;
revoke all on function private.conversation_json(uuid) from authenticated;
revoke all on function private.validate_message_attachments(uuid, uuid, jsonb) from authenticated;

revoke all on function private.require_conversation_member(uuid) from public;
revoke all on function private.can_edit_message(uuid, uuid) from public;
revoke all on function private.require_message_editor(uuid) from public;
revoke all on function private.message_reactions_json(uuid) from public;
revoke all on function private.message_json(uuid) from public;
revoke all on function private.conversation_json(uuid) from public;
revoke all on function private.validate_message_attachments(uuid, uuid, jsonb) from public;

revoke all on function public.get_dashboard_snapshot() from public;
grant execute on function public.get_dashboard_snapshot() to authenticated;

revoke all on function public.get_work_snapshot() from public;
revoke all on function public.create_project(jsonb) from public;
revoke all on function public.update_project(uuid, jsonb) from public;
revoke all on function public.set_project_progress(uuid, integer) from public;
revoke all on function public.delete_project(uuid) from public;
revoke all on function public.create_task(jsonb) from public;
revoke all on function public.update_task(uuid, jsonb) from public;
revoke all on function public.set_task_status(uuid, text) from public;
revoke all on function public.move_task_schedule(uuid, date, text, text) from public;
revoke all on function public.delete_task(uuid) from public;
revoke all on function public.add_task_comment(uuid, text) from public;
revoke all on function public.add_task_checklist_item(uuid, text) from public;
revoke all on function public.toggle_task_checklist_item(uuid) from public;
revoke all on function public.delete_task_checklist_item(uuid) from public;
revoke all on function public.register_task_attachment(uuid, text, text, text, bigint) from public;
revoke all on function public.delete_task_attachment(uuid) from public;

grant execute on function public.get_work_snapshot() to authenticated;
grant execute on function public.create_project(jsonb) to authenticated;
grant execute on function public.update_project(uuid, jsonb) to authenticated;
grant execute on function public.set_project_progress(uuid, integer) to authenticated;
grant execute on function public.delete_project(uuid) to authenticated;
grant execute on function public.create_task(jsonb) to authenticated;
grant execute on function public.update_task(uuid, jsonb) to authenticated;
grant execute on function public.set_task_status(uuid, text) to authenticated;
grant execute on function public.move_task_schedule(uuid, date, text, text) to authenticated;
grant execute on function public.delete_task(uuid) to authenticated;
grant execute on function public.add_task_comment(uuid, text) to authenticated;
grant execute on function public.add_task_checklist_item(uuid, text) to authenticated;
grant execute on function public.toggle_task_checklist_item(uuid) to authenticated;
grant execute on function public.delete_task_checklist_item(uuid) to authenticated;
grant execute on function public.register_task_attachment(uuid, text, text, text, bigint) to authenticated;
grant execute on function public.delete_task_attachment(uuid) to authenticated;

revoke all on function public.get_conversations_snapshot() from public;
revoke all on function public.create_direct_conversation(uuid) from public;
revoke all on function public.create_group_conversation(text, uuid[]) from public;
revoke all on function public.send_message(uuid, text, jsonb) from public;
revoke all on function public.edit_message(uuid, text) from public;
revoke all on function public.delete_message(uuid) from public;
revoke all on function public.add_reaction(uuid, text) from public;
revoke all on function public.remove_reaction(uuid, text) from public;
revoke all on function public.mark_read(uuid, boolean) from public;
revoke all on function public.update_conversation_prefs(uuid, boolean, boolean) from public;
revoke all on function public.get_messages(uuid, integer, timestamptz, text) from public;
revoke all on function public.set_typing(uuid, boolean) from public;

grant execute on function public.get_conversations_snapshot() to authenticated;
grant execute on function public.create_direct_conversation(uuid) to authenticated;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;
grant execute on function public.send_message(uuid, text, jsonb) to authenticated;
grant execute on function public.edit_message(uuid, text) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
grant execute on function public.add_reaction(uuid, text) to authenticated;
grant execute on function public.remove_reaction(uuid, text) to authenticated;
grant execute on function public.mark_read(uuid, boolean) to authenticated;
grant execute on function public.update_conversation_prefs(uuid, boolean, boolean) to authenticated;
grant execute on function public.get_messages(uuid, integer, timestamptz, text) to authenticated;
grant execute on function public.set_typing(uuid, boolean) to authenticated;

revoke all on function public.get_attendance_snapshot(timestamptz) from public;
revoke all on function public.attendance_clock_in() from public;
revoke all on function public.attendance_start_break(text) from public;
revoke all on function public.attendance_end_break() from public;
revoke all on function public.attendance_clock_out() from public;
revoke all on function public.create_attendance_adjustment_request(date, text, text, timestamptz, timestamptz) from public;
revoke all on function public.review_attendance_adjustment_request(uuid, text, text) from public;
revoke all on function public.upsert_attendance_policy(text, text, integer, integer, integer, integer, text, smallint[], jsonb) from public;

grant execute on function public.get_attendance_snapshot(timestamptz) to authenticated;
grant execute on function public.attendance_clock_in() to authenticated;
grant execute on function public.attendance_start_break(text) to authenticated;
grant execute on function public.attendance_end_break() to authenticated;
grant execute on function public.attendance_clock_out() to authenticated;
grant execute on function public.create_attendance_adjustment_request(date, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.review_attendance_adjustment_request(uuid, text, text) to authenticated;
grant execute on function public.upsert_attendance_policy(text, text, integer, integer, integer, integer, text, smallint[], jsonb) to authenticated;

commit;
