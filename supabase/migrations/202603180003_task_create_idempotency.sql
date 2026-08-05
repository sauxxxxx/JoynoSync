begin;

alter table public.tasks
  add column if not exists client_request_id text not null default '';

update public.tasks
set client_request_id = ''
where client_request_id is null;

create unique index if not exists tasks_workspace_actor_request_unique
  on public.tasks (workspace_id, created_by_member_id, client_request_id)
  where client_request_id <> '';

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
  existing_task_id uuid;
  project_id uuid;
  assignee_member_id uuid;
  task_title text;
  due_date_value date;
  start_time_value time;
  end_time_value time;
  backlog_state_value text;
  task_type_value text;
  call_phone_value text;
  client_request_id_value text;
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

  client_request_id_value := trim(coalesce(payload ->> 'clientRequestId', ''));
  if client_request_id_value <> '' then
    select t.id
    into existing_task_id
    from public.tasks t
    where t.workspace_id = target_workspace_id
      and t.created_by_member_id = actor_member_id
      and t.client_request_id = client_request_id_value
    limit 1;

    if existing_task_id is not null then
      return private.work_snapshot_json(target_workspace_id);
    end if;
  end if;

  begin
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
      client_request_id,
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
      client_request_id_value,
      actor_member_id,
      actor_member_id
    )
    returning id into target_task_id;
  exception
    when unique_violation then
      if client_request_id_value <> '' then
        select t.id
        into target_task_id
        from public.tasks t
        where t.workspace_id = target_workspace_id
          and t.created_by_member_id = actor_member_id
          and t.client_request_id = client_request_id_value
        limit 1;

        if target_task_id is not null then
          return private.work_snapshot_json(target_workspace_id);
        end if;
      end if;
      raise;
  end;

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

commit;
