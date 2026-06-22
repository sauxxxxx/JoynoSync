begin;

create or replace function public.update_project(
  p_project_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  current_project public.projects%rowtype;
  next_owner_member_id uuid;
  team_member_ids uuid[];
begin
  select * into current_project
  from public.projects
  where id = p_project_id;

  if current_project.id is null then
    raise exception 'Project not found.' using errcode = 'P0001';
  end if;

  select ctx.workspace_id, ctx.actor_member_id
  into target_workspace_id, actor_member_id
  from private.require_project_manager(p_project_id) as ctx;

  next_owner_member_id := private.ensure_workspace_member(
    target_workspace_id,
    coalesce(nullif(trim(coalesce(payload ->> 'ownerId', '')), '')::uuid, current_project.owner_member_id),
    true
  );

  update public.projects
  set
    name = coalesce(nullif(trim(coalesce(payload ->> 'name', '')), ''), current_project.name),
    owner_member_id = coalesce(next_owner_member_id, current_project.owner_member_id),
    status = case
      when trim(coalesce(payload ->> 'status', '')) in ('On Track', 'Needs Focus', 'Blocked')
        then trim(coalesce(payload ->> 'status', ''))
      else current_project.status
    end,
    progress = coalesce(greatest(0, least(100, nullif(trim(coalesce(payload ->> 'progress', '')), '')::integer)), current_project.progress),
    deadline = coalesce(nullif(trim(coalesce(payload ->> 'deadline', '')), '')::date, current_project.deadline),
    account_id = case
      when payload ? 'accountId' then nullif(trim(coalesce(payload ->> 'accountId', '')), '')::uuid
      else current_project.account_id
    end,
    account_name_snapshot = case
      when payload ? 'accountName' then trim(coalesce(payload ->> 'accountName', ''))
      else current_project.account_name_snapshot
    end,
    description = case
      when payload ? 'description' then trim(coalesce(payload ->> 'description', ''))
      else current_project.description
    end,
    risks = case
      when payload ? 'risks' then trim(coalesce(payload ->> 'risks', ''))
      else current_project.risks
    end,
    updated_by_member_id = actor_member_id
  where id = p_project_id;

  if payload ? 'teamMemberIds' then
    team_member_ids := coalesce((
      select array_agg(value::uuid)
      from jsonb_array_elements_text(coalesce(payload -> 'teamMemberIds', '[]'::jsonb)) value
    ), array[]::uuid[]);
    if next_owner_member_id is not null and not (next_owner_member_id = any(team_member_ids)) then
      team_member_ids := array_append(team_member_ids, next_owner_member_id);
    end if;
    perform private.set_project_members_internal(target_workspace_id, p_project_id, team_member_ids);
  elsif next_owner_member_id is not null then
    perform private.set_project_members_internal(
      target_workspace_id,
      p_project_id,
      array(
        select pm.member_id
        from public.project_members pm
        where pm.project_id = p_project_id
        union
        select next_owner_member_id
      )
    );
  end if;

  perform private.record_work_activity(
    target_workspace_id,
    null,
    p_project_id,
    actor_member_id,
    'updated',
    'Project updated',
    jsonb_build_object('projectId', p_project_id)
  );

  return private.work_snapshot_json(target_workspace_id);
end;
$$;

create or replace function public.set_project_progress(
  p_project_id uuid,
  p_progress integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  next_progress integer;
begin
  select ctx.workspace_id, ctx.actor_member_id
  into target_workspace_id, actor_member_id
  from private.require_project_manager(p_project_id) as ctx;

  next_progress := greatest(0, least(100, coalesce(p_progress, 0)));

  update public.projects
  set
    progress = next_progress,
    status = case when next_progress >= 100 then 'On Track' else status end,
    updated_by_member_id = actor_member_id
  where id = p_project_id;

  perform private.record_work_activity(
    target_workspace_id,
    null,
    p_project_id,
    actor_member_id,
    'progress',
    'Project progress updated',
    jsonb_build_object('progress', next_progress)
  );

  return private.work_snapshot_json(target_workspace_id);
end;
$$;

create or replace function public.delete_project(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
begin
  select ctx.workspace_id, ctx.actor_member_id
  into target_workspace_id, actor_member_id
  from private.require_project_manager(p_project_id) as ctx;

  update public.tasks
  set
    project_id = null,
    linked_entity_type = case when linked_entity_type = 'Project' then '' else linked_entity_type end,
    linked_entity_id = case when linked_entity_type = 'Project' then '' else linked_entity_id end,
    linked_label_snapshot = case when linked_entity_type = 'Project' then '' else linked_label_snapshot end,
    updated_by_member_id = actor_member_id
  where project_id = p_project_id;

  delete from public.projects
  where id = p_project_id;

  return private.work_snapshot_json(target_workspace_id);
end;
$$;

create or replace function public.update_task(
  p_task_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  current_task public.tasks%rowtype;
  next_project_id uuid;
  next_assignee_member_id uuid;
begin
  select * into current_task
  from public.tasks
  where id = p_task_id;

  if current_task.id is null then
    raise exception 'Task not found.' using errcode = 'P0001';
  end if;

  select ctx.workspace_id, ctx.actor_member_id
  into target_workspace_id, actor_member_id
  from private.require_task_editor(p_task_id) as ctx;

  next_project_id := coalesce(
    case
      when payload ? 'projectId' then nullif(trim(coalesce(payload ->> 'projectId', '')), '')::uuid
      else current_task.project_id
    end,
    null
  );

  if next_project_id is not null and not exists (
    select 1
    from public.projects p
    where p.id = next_project_id
      and p.workspace_id = target_workspace_id
  ) then
    raise exception 'Selected project was not found in this workspace.' using errcode = 'P0001';
  end if;

  next_assignee_member_id := private.ensure_workspace_member(
    target_workspace_id,
    coalesce(
      case
        when payload ? 'assigneeId' then nullif(trim(coalesce(payload ->> 'assigneeId', '')), '')::uuid
        else current_task.assignee_member_id
      end,
      actor_member_id
    ),
    true
  );

  update public.tasks
  set
    project_id = next_project_id,
    title = coalesce(nullif(trim(coalesce(payload ->> 'title', '')), ''), current_task.title),
    description = case
      when payload ? 'notes' then trim(coalesce(payload ->> 'notes', ''))
      else current_task.description
    end,
    priority = case
      when lower(trim(coalesce(payload ->> 'priority', ''))) in ('high', 'medium', 'low')
        then lower(trim(coalesce(payload ->> 'priority', '')))
      else current_task.priority
    end,
    assignee_member_id = next_assignee_member_id,
    due_date = coalesce(
      case when payload ? 'dueDate' then nullif(trim(coalesce(payload ->> 'dueDate', '')), '')::date else null end,
      current_task.due_date
    ),
    start_time = coalesce(
      case when payload ? 'startTime' then nullif(trim(coalesce(payload ->> 'startTime', '')), '')::time else null end,
      current_task.start_time
    ),
    reminder_minutes = coalesce(
      case when payload ? 'reminderMinutes' then greatest(0, nullif(trim(coalesce(payload ->> 'reminderMinutes', '')), '')::integer) else null end,
      current_task.reminder_minutes
    ),
    recurrence = case
      when lower(trim(coalesce(payload ->> 'recurrence', ''))) in ('none', 'daily', 'weekly', 'monthly')
        then lower(trim(coalesce(payload ->> 'recurrence', '')))
      else current_task.recurrence
    end,
    sla_hours = case
      when payload ? 'slaHours' then nullif(trim(coalesce(payload ->> 'slaHours', '')), '')::integer
      else current_task.sla_hours
    end,
    linked_entity_type = case when payload ? 'linkType' then trim(coalesce(payload ->> 'linkType', '')) else current_task.linked_entity_type end,
    linked_entity_id = case when payload ? 'linkId' then trim(coalesce(payload ->> 'linkId', '')) else current_task.linked_entity_id end,
    linked_label_snapshot = case when payload ? 'linkLabel' then trim(coalesce(payload ->> 'linkLabel', '')) else current_task.linked_label_snapshot end,
    account_name_snapshot = case when payload ? 'accountName' then trim(coalesce(payload ->> 'accountName', '')) else current_task.account_name_snapshot end,
    task_type = case when payload ? 'taskType' then coalesce(nullif(trim(coalesce(payload ->> 'taskType', '')), ''), 'General') else current_task.task_type end,
    backlog_state = case
      when lower(trim(coalesce(payload ->> 'backlogState', ''))) in ('queue', 'scheduled')
        then lower(trim(coalesce(payload ->> 'backlogState', '')))
      else current_task.backlog_state
    end,
    updated_by_member_id = actor_member_id
  where id = p_task_id;

  perform private.record_work_activity(
    target_workspace_id,
    p_task_id,
    next_project_id,
    actor_member_id,
    'updated',
    'Task updated',
    jsonb_build_object('taskId', p_task_id)
  );

  return private.work_snapshot_json(target_workspace_id);
end;
$$;

create or replace function public.set_task_status(
  p_task_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  current_task public.tasks%rowtype;
  normalized_status text;
  next_due_date date;
  next_task_id uuid;
begin
  select * into current_task
  from public.tasks
  where id = p_task_id;

  if current_task.id is null then
    raise exception 'Task not found.' using errcode = 'P0001';
  end if;

  select ctx.workspace_id, ctx.actor_member_id
  into target_workspace_id, actor_member_id
  from private.require_task_editor(p_task_id) as ctx;

  normalized_status := trim(coalesce(p_status, ''));
  if normalized_status not in ('New', 'Scheduled', 'In progress', 'Completed') then
    raise exception 'Invalid task status.' using errcode = 'P0001';
  end if;

  if normalized_status <> current_task.status then
    update public.tasks
    set
      status = normalized_status,
      completed_at = case when normalized_status = 'Completed' then timezone('utc', now()) else null end,
      updated_by_member_id = actor_member_id
    where id = p_task_id;

    perform private.record_work_activity(
      target_workspace_id,
      p_task_id,
      current_task.project_id,
      actor_member_id,
      'status',
      format('Status changed from %s to %s', current_task.status, normalized_status),
      jsonb_build_object('from', current_task.status, 'to', normalized_status)
    );

    if normalized_status = 'Completed' and current_task.status <> 'Completed' and current_task.recurrence <> 'none' then
      next_due_date := private.next_task_due_date(current_task.due_date, current_task.recurrence);
      if next_due_date is not null then
        insert into public.tasks (
          workspace_id,
          project_id,
          title,
          description,
          status,
          priority,
          assignee_member_id,
          due_date,
          start_time,
          reminder_minutes,
          recurrence,
          sla_hours,
          linked_entity_type,
          linked_entity_id,
          linked_label_snapshot,
          account_name_snapshot,
          task_type,
          backlog_state,
          created_by_member_id,
          updated_by_member_id
        )
        values (
          current_task.workspace_id,
          current_task.project_id,
          current_task.title,
          current_task.description,
          'New',
          current_task.priority,
          current_task.assignee_member_id,
          next_due_date,
          current_task.start_time,
          current_task.reminder_minutes,
          current_task.recurrence,
          current_task.sla_hours,
          current_task.linked_entity_type,
          current_task.linked_entity_id,
          current_task.linked_label_snapshot,
          current_task.account_name_snapshot,
          current_task.task_type,
          current_task.backlog_state,
          actor_member_id,
          actor_member_id
        )
        returning id into next_task_id;

        perform private.record_work_activity(
          target_workspace_id,
          next_task_id,
          current_task.project_id,
          actor_member_id,
          'created',
          format('Recurring task created from %s', current_task.title),
          jsonb_build_object('sourceTaskId', current_task.id)
        );
      end if;
    end if;
  end if;

  return private.work_snapshot_json(target_workspace_id);
end;
$$;

create or replace function public.move_task_schedule(
  p_task_id uuid,
  p_due_date date,
  p_start_time text default null,
  p_backlog_state text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  current_task public.tasks%rowtype;
  next_start_time time;
  next_backlog_state text;
begin
  select * into current_task
  from public.tasks
  where id = p_task_id;

  if current_task.id is null then
    raise exception 'Task not found.' using errcode = 'P0001';
  end if;

  select ctx.workspace_id, ctx.actor_member_id
  into target_workspace_id, actor_member_id
  from private.require_task_editor(p_task_id) as ctx;

  if p_due_date is null then
    raise exception 'Due date is required.' using errcode = 'P0001';
  end if;

  next_start_time := coalesce(nullif(trim(coalesce(p_start_time, '')), '')::time, current_task.start_time);
  next_backlog_state := lower(coalesce(nullif(trim(coalesce(p_backlog_state, '')), ''), current_task.backlog_state));
  if next_backlog_state not in ('queue', 'scheduled') then
    next_backlog_state := current_task.backlog_state;
  end if;

  update public.tasks
  set
    due_date = p_due_date,
    start_time = next_start_time,
    backlog_state = next_backlog_state,
    updated_by_member_id = actor_member_id
  where id = p_task_id;

  perform private.record_work_activity(
    target_workspace_id,
    p_task_id,
    current_task.project_id,
    actor_member_id,
    'schedule',
    format('Due date moved to %s', to_char(p_due_date, 'Mon DD, YYYY')),
    jsonb_build_object('dueDate', to_char(p_due_date, 'YYYY-MM-DD'), 'backlogState', next_backlog_state)
  );

  return private.work_snapshot_json(target_workspace_id);
end;
$$;

create or replace function public.delete_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
begin
  select ctx.workspace_id, ctx.actor_member_id
  into target_workspace_id, actor_member_id
  from private.require_task_editor(p_task_id) as ctx;

  delete from public.tasks
  where id = p_task_id;

  return private.work_snapshot_json(target_workspace_id);
end;
$$;

create or replace function public.add_task_comment(
  p_task_id uuid,
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
begin
  select ctx.workspace_id, ctx.actor_member_id
  into target_workspace_id, actor_member_id
  from private.require_task_editor(p_task_id) as ctx;

  if trim(coalesce(p_body, '')) = '' then
    raise exception 'Comment text is required.' using errcode = 'P0001';
  end if;

  insert into public.task_comments (workspace_id, task_id, author_member_id, body)
  values (target_workspace_id, p_task_id, actor_member_id, trim(p_body));

  perform private.record_work_activity(
    target_workspace_id,
    p_task_id,
    null,
    actor_member_id,
    'comment',
    'Posted a comment',
    jsonb_build_object('taskId', p_task_id)
  );

  return private.work_snapshot_json(target_workspace_id);
end;
$$;

create or replace function public.add_task_checklist_item(
  p_task_id uuid,
  p_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
begin
  select ctx.workspace_id, ctx.actor_member_id
  into target_workspace_id, actor_member_id
  from private.require_task_editor(p_task_id) as ctx;

  if trim(coalesce(p_label, '')) = '' then
    raise exception 'Checklist label is required.' using errcode = 'P0001';
  end if;

  insert into public.task_checklist_items (
    workspace_id,
    task_id,
    label,
    done,
    created_by_member_id,
    updated_by_member_id
  )
  values (target_workspace_id, p_task_id, trim(p_label), false, actor_member_id, actor_member_id);

  perform private.record_work_activity(
    target_workspace_id,
    p_task_id,
    null,
    actor_member_id,
    'checklist',
    format('Added checklist item: %s', trim(p_label)),
    jsonb_build_object('label', trim(p_label))
  );

  return private.work_snapshot_json(target_workspace_id);
end;
$$;

create or replace function public.toggle_task_checklist_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_item public.task_checklist_items%rowtype;
  current_task public.tasks%rowtype;
  target_workspace_id uuid;
  actor_member_id uuid;
begin
  select * into current_item
  from public.task_checklist_items
  where id = p_item_id;

  if current_item.id is null then
    raise exception 'Checklist item not found.' using errcode = 'P0001';
  end if;

  select * into current_task
  from public.tasks
  where id = current_item.task_id;

  select ctx.workspace_id, ctx.actor_member_id
  into target_workspace_id, actor_member_id
  from private.require_task_editor(current_item.task_id) as ctx;

  update public.task_checklist_items
  set
    done = not current_item.done,
    completed_at = case when not current_item.done then timezone('utc', now()) else null end,
    updated_by_member_id = actor_member_id
  where id = p_item_id;

  perform private.record_work_activity(
    target_workspace_id,
    current_item.task_id,
    current_task.project_id,
    actor_member_id,
    'checklist',
    format('%s checklist item: %s', case when current_item.done then 'Reopened' else 'Completed' end, current_item.label),
    jsonb_build_object('itemId', current_item.id, 'done', not current_item.done)
  );

  return private.work_snapshot_json(target_workspace_id);
end;
$$;

create or replace function public.delete_task_checklist_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_item public.task_checklist_items%rowtype;
  current_task public.tasks%rowtype;
  target_workspace_id uuid;
  actor_member_id uuid;
begin
  select * into current_item
  from public.task_checklist_items
  where id = p_item_id;

  if current_item.id is null then
    raise exception 'Checklist item not found.' using errcode = 'P0001';
  end if;

  select * into current_task
  from public.tasks
  where id = current_item.task_id;

  select ctx.workspace_id, ctx.actor_member_id
  into target_workspace_id, actor_member_id
  from private.require_task_editor(current_item.task_id) as ctx;

  delete from public.task_checklist_items
  where id = p_item_id;

  perform private.record_work_activity(
    target_workspace_id,
    current_item.task_id,
    current_task.project_id,
    actor_member_id,
    'checklist',
    format('Removed checklist item: %s', current_item.label),
    jsonb_build_object('itemId', current_item.id)
  );

  return private.work_snapshot_json(target_workspace_id);
end;
$$;

create or replace function public.register_task_attachment(
  p_task_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text default '',
  p_size_bytes bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  current_task public.tasks%rowtype;
begin
  select * into current_task
  from public.tasks
  where id = p_task_id;

  if current_task.id is null then
    raise exception 'Task not found.' using errcode = 'P0001';
  end if;

  select ctx.workspace_id, ctx.actor_member_id
  into target_workspace_id, actor_member_id
  from private.require_task_editor(p_task_id) as ctx;

  if trim(coalesce(p_storage_path, '')) = '' or trim(coalesce(p_file_name, '')) = '' then
    raise exception 'Attachment metadata is required.' using errcode = 'P0001';
  end if;

  insert into public.task_attachments (
    workspace_id,
    task_id,
    storage_path,
    file_name,
    mime_type,
    size_bytes,
    uploaded_by_member_id
  )
  values (
    target_workspace_id,
    p_task_id,
    trim(p_storage_path),
    trim(p_file_name),
    trim(coalesce(p_mime_type, '')),
    greatest(0, coalesce(p_size_bytes, 0)),
    actor_member_id
  );

  perform private.record_work_activity(
    target_workspace_id,
    p_task_id,
    current_task.project_id,
    actor_member_id,
    'attachment',
    format('Added attachment: %s', trim(p_file_name)),
    jsonb_build_object('storagePath', trim(p_storage_path))
  );

  return private.work_snapshot_json(target_workspace_id);
end;
$$;

create or replace function public.delete_task_attachment(p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  current_attachment public.task_attachments%rowtype;
  current_task public.tasks%rowtype;
  target_workspace_id uuid;
  actor_member_id uuid;
begin
  select * into current_attachment
  from public.task_attachments
  where id = p_attachment_id;

  if current_attachment.id is null then
    raise exception 'Attachment not found.' using errcode = 'P0001';
  end if;

  select * into current_task
  from public.tasks
  where id = current_attachment.task_id;

  select ctx.workspace_id, ctx.actor_member_id
  into target_workspace_id, actor_member_id
  from private.require_task_editor(current_attachment.task_id) as ctx;

  delete from public.task_attachments
  where id = p_attachment_id;

  perform private.record_work_activity(
    target_workspace_id,
    current_attachment.task_id,
    current_task.project_id,
    actor_member_id,
    'attachment',
    format('Removed attachment: %s', current_attachment.file_name),
    jsonb_build_object('storagePath', current_attachment.storage_path)
  );

  return private.work_snapshot_json(target_workspace_id);
end;
$$;

commit;
