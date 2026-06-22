begin;

alter table public.tasks
  add column if not exists end_time time,
  add column if not exists call_phone_snapshot text not null default '';

create or replace function private.task_json(target_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'id', t.id,
    'workspaceId', t.workspace_id,
    'title', t.title,
    'assigneeId', t.assignee_member_id,
    'assignee', coalesce(assignee.name, ''),
    'dueDate', to_char(t.due_date, 'YYYY-MM-DD'),
    'deadlineAt', to_char(t.due_date, 'YYYY-MM-DD') || 'T' || to_char(t.start_time, 'HH24:MI'),
    'startTime', to_char(t.start_time, 'HH24:MI'),
    'endTime', coalesce(to_char(t.end_time, 'HH24:MI'), ''),
    'time', to_char(t.start_time, 'HH24:MI'),
    'day', trim(to_char(t.due_date, 'Dy')),
    'status', t.status,
    'priority', t.priority,
    'projectId', coalesce(t.project_id, null),
    'projectName', coalesce(p.name, ''),
    'linkType', t.linked_entity_type,
    'linkId', t.linked_entity_id,
    'linkLabel', t.linked_label_snapshot,
    'accountName', coalesce(nullif(t.account_name_snapshot, ''), p.account_name_snapshot, ''),
    'account', coalesce(nullif(t.account_name_snapshot, ''), p.account_name_snapshot, ''),
    'taskType', coalesce(nullif(t.task_type, ''), 'General'),
    'callPhone', coalesce(t.call_phone_snapshot, ''),
    'reminderMinutes', t.reminder_minutes,
    'recurrence', t.recurrence,
    'slaHours', t.sla_hours,
    'notes', t.description,
    'completedAt', coalesce(t.completed_at::text, ''),
    'createdAt', t.created_at,
    'updatedAt', t.updated_at,
    'backlogState', t.backlog_state,
    'permissions', jsonb_build_object(
      'canView', private.can_view_task(t.id, actor_ctx.actor_member_id),
      'canUpdateProgress', private.can_update_task_progress(t.id, actor_ctx.actor_member_id),
      'canEditCore', private.can_edit_task_core(t.id, actor_ctx.actor_member_id),
      'canReassign', private.can_reassign_task(t.id, actor_ctx.actor_member_id),
      'canDelete', private.can_delete_task(t.id, actor_ctx.actor_member_id),
      'canUploadAttachment', private.can_upload_task_attachment(t.id, actor_ctx.actor_member_id),
      'canComment', private.can_update_task_progress(t.id, actor_ctx.actor_member_id),
      'canManageChecklist', private.can_update_task_progress(t.id, actor_ctx.actor_member_id)
    ),
    'comments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'authorId', c.author_member_id,
          'author', coalesce(author_member.name, 'Unknown'),
          'text', c.body,
          'createdAt', c.created_at
        )
        order by c.created_at asc
      )
      from public.task_comments c
      left join public.team_members author_member on author_member.id = c.author_member_id
      where c.task_id = t.id
    ), '[]'::jsonb),
    'checklist', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', ci.id,
          'label', ci.label,
          'done', ci.done,
          'createdAt', ci.created_at,
          'completedAt', coalesce(ci.completed_at::text, '')
        )
        order by ci.created_at asc
      )
      from public.task_checklist_items ci
      where ci.task_id = t.id
    ), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'name', a.file_name,
          'size', a.size_bytes,
          'type', a.mime_type,
          'storagePath', a.storage_path,
          'addedBy', coalesce(uploader.name, 'Unknown'),
          'addedById', a.uploaded_by_member_id,
          'createdAt', a.created_at,
          'canDelete', private.can_delete_task_attachment_by_member(t.id, actor_ctx.actor_member_id, a.uploaded_by_member_id)
        )
        order by a.created_at desc
      )
      from public.task_attachments a
      left join public.team_members uploader on uploader.id = a.uploaded_by_member_id
      where a.task_id = t.id
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'type', e.event_type,
          'actor', coalesce(actor_member.name, 'System'),
          'actorId', e.actor_member_id,
          'text', e.message,
          'details', e.details,
          'createdAt', e.created_at
        )
        order by e.created_at desc
      )
      from public.task_activity_events e
      left join public.team_members actor_member on actor_member.id = e.actor_member_id
      where e.task_id = t.id
    ), '[]'::jsonb)
  )
  from public.tasks t
  left join public.projects p on p.id = t.project_id
  left join public.team_members assignee on assignee.id = t.assignee_member_id
  left join lateral (
    select private.current_team_member_id(t.workspace_id) as actor_member_id
  ) as actor_ctx on true
  where t.id = target_task_id
  limit 1;
$$;

create or replace function public.create_task(p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  target_task_id uuid;
  project_id uuid;
  assignee_member_id uuid;
  task_title text;
  due_date_value date;
  start_time_value time;
  end_time_value time;
  backlog_state_value text;
  task_type_value text;
  call_phone_value text;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  task_title := trim(coalesce(payload ->> 'title', ''));
  if task_title = '' then
    raise exception 'Task title is required.' using errcode = 'P0001';
  end if;

  project_id := nullif(trim(coalesce(payload ->> 'projectId', '')), '')::uuid;
  if project_id is not null and not exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.workspace_id = target_workspace_id
  ) then
    raise exception 'Selected project was not found in this workspace.' using errcode = 'P0001';
  end if;

  assignee_member_id := private.ensure_workspace_member(
    target_workspace_id,
    nullif(trim(coalesce(payload ->> 'assigneeId', '')), '')::uuid,
    true
  );
  if assignee_member_id is null then
    assignee_member_id := actor_member_id;
  end if;

  if not private.can_create_task(target_workspace_id, actor_member_id, project_id, assignee_member_id) then
    raise exception 'You do not have permission to create this task in the selected scope.' using errcode = 'P0001';
  end if;

  due_date_value := coalesce(nullif(trim(coalesce(payload ->> 'dueDate', '')), '')::date, timezone('utc', now())::date);
  start_time_value := coalesce(nullif(trim(coalesce(payload ->> 'startTime', '')), '')::time, time '09:00');
  end_time_value := nullif(trim(coalesce(payload ->> 'endTime', '')), '')::time;
  task_type_value := coalesce(nullif(trim(coalesce(payload ->> 'taskType', '')), ''), 'General');
  call_phone_value := trim(coalesce(payload ->> 'callPhone', ''));
  if task_type_value not in ('Call', 'Callback') then
    end_time_value := null;
    call_phone_value := '';
  end if;
  if end_time_value is not null and end_time_value <= start_time_value then
    raise exception 'End time must be later than the start time.' using errcode = 'P0001';
  end if;
  backlog_state_value := lower(coalesce(payload ->> 'backlogState', 'scheduled'));
  if backlog_state_value not in ('queue', 'scheduled') then
    backlog_state_value := 'scheduled';
  end if;

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
    end_time,
    reminder_minutes,
    recurrence,
    sla_hours,
    linked_entity_type,
    linked_entity_id,
    linked_label_snapshot,
    account_name_snapshot,
    task_type,
    call_phone_snapshot,
    backlog_state,
    completed_at,
    created_by_member_id,
    updated_by_member_id
  )
  values (
    target_workspace_id,
    project_id,
    task_title,
    trim(coalesce(payload ->> 'notes', '')),
    case
      when trim(coalesce(payload ->> 'status', '')) in ('New', 'Scheduled', 'In progress', 'Completed')
        then trim(coalesce(payload ->> 'status', ''))
      else 'New'
    end,
    case
      when lower(trim(coalesce(payload ->> 'priority', ''))) in ('high', 'medium', 'low')
        then lower(trim(coalesce(payload ->> 'priority', '')))
      else 'low'
    end,
    assignee_member_id,
    due_date_value,
    start_time_value,
    end_time_value,
    greatest(0, coalesce(nullif(trim(coalesce(payload ->> 'reminderMinutes', '')), '')::integer, 15)),
    case
      when lower(trim(coalesce(payload ->> 'recurrence', 'none'))) in ('none', 'daily', 'weekly', 'monthly')
        then lower(trim(coalesce(payload ->> 'recurrence', 'none')))
      else 'none'
    end,
    nullif(trim(coalesce(payload ->> 'slaHours', '')), '')::integer,
    trim(coalesce(payload ->> 'linkType', '')),
    trim(coalesce(payload ->> 'linkId', '')),
    trim(coalesce(payload ->> 'linkLabel', '')),
    trim(coalesce(payload ->> 'accountName', '')),
    task_type_value,
    call_phone_value,
    backlog_state_value,
    case
      when trim(coalesce(payload ->> 'status', '')) = 'Completed' then timezone('utc', now())
      else null
    end,
    actor_member_id,
    actor_member_id
  )
  returning id into target_task_id;

  perform private.record_work_activity(
    target_workspace_id,
    target_task_id,
    project_id,
    actor_member_id,
    'created',
    'Task created',
    jsonb_build_object('title', task_title)
  );

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
  next_start_time time;
  next_end_time time;
  next_task_type text;
  next_call_phone text;
begin
  select * into current_task
  from public.tasks
  where id = p_task_id;

  if current_task.id is null then
    raise exception 'Task not found.' using errcode = 'P0001';
  end if;

  select ctx.workspace_id, ctx.actor_member_id
  into target_workspace_id, actor_member_id
  from private.require_task_core_editor(p_task_id) as ctx;

  next_project_id := case
    when payload ? 'projectId' then nullif(trim(coalesce(payload ->> 'projectId', '')), '')::uuid
    else current_task.project_id
  end;

  if next_project_id is not null and not exists (
    select 1
    from public.projects p
    where p.id = next_project_id
      and p.workspace_id = target_workspace_id
  ) then
    raise exception 'Selected project was not found in this workspace.' using errcode = 'P0001';
  end if;

  if not private.can_use_task_project(target_workspace_id, actor_member_id, next_project_id) then
    raise exception 'You do not have permission to move this task into the selected project.' using errcode = 'P0001';
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

  if next_assignee_member_id is distinct from current_task.assignee_member_id
    and not private.can_reassign_task(p_task_id, actor_member_id) then
    raise exception 'You do not have permission to reassign this task.' using errcode = 'P0001';
  end if;

  next_start_time := coalesce(
    case when payload ? 'startTime' then nullif(trim(coalesce(payload ->> 'startTime', '')), '')::time else null end,
    current_task.start_time
  );
  next_end_time := case
    when payload ? 'endTime' then nullif(trim(coalesce(payload ->> 'endTime', '')), '')::time
    else current_task.end_time
  end;
  next_task_type := case
    when payload ? 'taskType' then coalesce(nullif(trim(coalesce(payload ->> 'taskType', '')), ''), 'General')
    else current_task.task_type
  end;
  next_call_phone := case
    when payload ? 'callPhone' then trim(coalesce(payload ->> 'callPhone', ''))
    else coalesce(current_task.call_phone_snapshot, '')
  end;

  if next_task_type not in ('Call', 'Callback') then
    next_end_time := null;
    next_call_phone := '';
  end if;
  if next_end_time is not null and next_end_time <= next_start_time then
    raise exception 'End time must be later than the start time.' using errcode = 'P0001';
  end if;

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
    start_time = next_start_time,
    end_time = next_end_time,
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
    task_type = next_task_type,
    call_phone_snapshot = next_call_phone,
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
    jsonb_build_object('title', coalesce(nullif(trim(coalesce(payload ->> 'title', '')), ''), current_task.title))
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
  from private.require_task_progress_editor(p_task_id) as ctx;

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
          end_time,
          reminder_minutes,
          recurrence,
          sla_hours,
          linked_entity_type,
          linked_entity_id,
          linked_label_snapshot,
          account_name_snapshot,
          task_type,
          call_phone_snapshot,
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
          current_task.end_time,
          current_task.reminder_minutes,
          current_task.recurrence,
          current_task.sla_hours,
          current_task.linked_entity_type,
          current_task.linked_entity_id,
          current_task.linked_label_snapshot,
          current_task.account_name_snapshot,
          current_task.task_type,
          current_task.call_phone_snapshot,
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

commit;
