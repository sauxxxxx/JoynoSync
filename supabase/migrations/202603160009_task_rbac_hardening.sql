begin;

create or replace function private.task_scope_snapshot(target_task_id uuid, actor_member_id uuid)
returns table (
  workspace_id uuid,
  task_status text,
  project_id uuid,
  assignee_member_id uuid,
  created_by_member_id uuid,
  actor_role text,
  actor_status text,
  is_workspace_operator boolean,
  is_project_manager boolean,
  is_project_member boolean,
  is_creator boolean,
  is_assignee boolean
)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    t.workspace_id,
    t.status,
    t.project_id,
    t.assignee_member_id,
    t.created_by_member_id,
    coalesce(actor.role, '') as actor_role,
    coalesce(actor.status, '') as actor_status,
    coalesce(actor.role, '') in ('Owner', 'Admin') as is_workspace_operator,
    (
      t.project_id is not null
      and (
        p.owner_member_id = actor_member_id
        or exists (
          select 1
          from public.project_members pm_owner
          where pm_owner.project_id = t.project_id
            and pm_owner.member_id = actor_member_id
            and pm_owner.role = 'owner'
        )
      )
    ) as is_project_manager,
    (
      t.project_id is not null
      and (
        p.owner_member_id = actor_member_id
        or exists (
          select 1
          from public.project_members pm_member
          where pm_member.project_id = t.project_id
            and pm_member.member_id = actor_member_id
        )
      )
    ) as is_project_member,
    t.created_by_member_id = actor_member_id as is_creator,
    t.assignee_member_id = actor_member_id as is_assignee
  from public.tasks t
  left join public.projects p on p.id = t.project_id
  left join public.team_members actor
    on actor.id = actor_member_id
   and actor.workspace_id = t.workspace_id
  where t.id = target_task_id
  limit 1;
$$;

create or replace function private.can_use_task_project(
  target_workspace_id uuid,
  actor_member_id uuid,
  target_project_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  actor_role text := '';
begin
  if target_project_id is null then
    return true;
  end if;

  select coalesce(tm.role, '')
  into actor_role
  from public.team_members tm
  where tm.workspace_id = target_workspace_id
    and tm.id = actor_member_id
    and tm.status = 'Active'
  limit 1;

  if actor_role in ('Owner', 'Admin') then
    return exists (
      select 1
      from public.projects p
      where p.id = target_project_id
        and p.workspace_id = target_workspace_id
    );
  end if;

  if actor_role = 'Manager' then
    return exists (
      select 1
      from public.projects p
      left join public.project_members pm
        on pm.project_id = p.id
       and pm.member_id = actor_member_id
       and pm.role = 'owner'
      where p.id = target_project_id
        and p.workspace_id = target_workspace_id
        and (
          p.owner_member_id = actor_member_id
          or pm.member_id is not null
        )
    );
  end if;

  if actor_role = 'Member' then
    return exists (
      select 1
      from public.projects p
      left join public.project_members pm
        on pm.project_id = p.id
       and pm.member_id = actor_member_id
      where p.id = target_project_id
        and p.workspace_id = target_workspace_id
        and (
          p.owner_member_id = actor_member_id
          or pm.member_id is not null
        )
    );
  end if;

  return false;
end;
$$;

create or replace function private.can_create_task(
  target_workspace_id uuid,
  actor_member_id uuid,
  target_project_id uuid,
  target_assignee_member_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  actor_role text := '';
begin
  select coalesce(tm.role, '')
  into actor_role
  from public.team_members tm
  where tm.workspace_id = target_workspace_id
    and tm.id = actor_member_id
    and tm.status = 'Active'
  limit 1;

  if actor_role in ('Owner', 'Admin') then
    return true;
  end if;

  if actor_role = 'Manager' then
    if target_project_id is not null then
      return private.can_use_task_project(target_workspace_id, actor_member_id, target_project_id);
    end if;
    return target_assignee_member_id = actor_member_id;
  end if;

  if actor_role = 'Member' then
    if target_assignee_member_id is distinct from actor_member_id then
      return false;
    end if;
    return private.can_use_task_project(target_workspace_id, actor_member_id, target_project_id);
  end if;

  return false;
end;
$$;

create or replace function private.can_view_task(target_task_id uuid, actor_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from private.task_scope_snapshot(target_task_id, actor_member_id) as ctx
    where ctx.actor_status = 'Active'
      and (
        ctx.is_workspace_operator
        or (ctx.actor_role = 'Manager' and (ctx.is_project_manager or ctx.is_creator or ctx.is_assignee))
        or (ctx.actor_role = 'Member' and (ctx.is_creator or ctx.is_assignee or ctx.is_project_member))
        or (lower(ctx.actor_role) = 'guest' and ctx.is_assignee)
        or (ctx.actor_role not in ('Owner', 'Admin', 'Manager', 'Member', 'Guest') and ctx.is_assignee)
      )
  );
$$;

create or replace function private.can_update_task_progress(target_task_id uuid, actor_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from private.task_scope_snapshot(target_task_id, actor_member_id) as ctx
    where ctx.actor_status = 'Active'
      and (
        ctx.is_workspace_operator
        or (ctx.actor_role = 'Manager' and (ctx.is_project_manager or ctx.is_creator or ctx.is_assignee))
        or (
          ctx.actor_role = 'Member'
          and (
            ctx.is_assignee
            or (ctx.task_status <> 'Completed' and (ctx.is_creator or ctx.is_project_member))
          )
        )
        or (lower(ctx.actor_role) = 'guest' and ctx.is_assignee)
        or (ctx.actor_role not in ('Owner', 'Admin', 'Manager', 'Member', 'Guest') and ctx.is_assignee)
      )
  );
$$;

create or replace function private.can_edit_task_core(target_task_id uuid, actor_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from private.task_scope_snapshot(target_task_id, actor_member_id) as ctx
    where ctx.actor_status = 'Active'
      and (
        ctx.is_workspace_operator
        or (
          ctx.actor_role = 'Manager'
          and ctx.task_status <> 'Completed'
          and (ctx.is_project_manager or ctx.is_creator or ctx.is_assignee)
        )
        or (
          ctx.actor_role = 'Member'
          and ctx.task_status <> 'Completed'
          and ctx.is_creator
          and (ctx.assignee_member_id is null or ctx.is_assignee)
        )
      )
  );
$$;

create or replace function private.can_reassign_task(target_task_id uuid, actor_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from private.task_scope_snapshot(target_task_id, actor_member_id) as ctx
    where ctx.actor_status = 'Active'
      and (
        ctx.is_workspace_operator
        or (
          ctx.actor_role = 'Manager'
          and ctx.task_status <> 'Completed'
          and (ctx.is_project_manager or ctx.is_creator or ctx.is_assignee)
        )
      )
  );
$$;

create or replace function private.can_delete_task(target_task_id uuid, actor_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from private.task_scope_snapshot(target_task_id, actor_member_id) as ctx
    where ctx.actor_status = 'Active'
      and (
        ctx.is_workspace_operator
        or (ctx.actor_role = 'Manager' and (ctx.is_project_manager or ctx.is_creator or ctx.is_assignee))
        or (ctx.actor_role = 'Member' and ctx.is_creator and ctx.task_status <> 'Completed')
      )
  );
$$;

create or replace function private.can_upload_task_attachment(target_task_id uuid, actor_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.can_update_task_progress(target_task_id, actor_member_id);
$$;

create or replace function private.can_manage_task_attachment(target_task_id uuid, actor_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.can_upload_task_attachment(target_task_id, actor_member_id);
$$;

create or replace function private.can_delete_task_attachment_by_member(
  target_task_id uuid,
  actor_member_id uuid,
  attachment_uploader_member_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from private.task_scope_snapshot(target_task_id, actor_member_id) as ctx
    where ctx.actor_status = 'Active'
      and (
        ctx.is_workspace_operator
        or (ctx.actor_role = 'Manager' and (ctx.is_project_manager or ctx.is_creator or ctx.is_assignee))
        or (ctx.actor_role = 'Member' and (ctx.is_creator or attachment_uploader_member_id = actor_member_id))
        or (lower(ctx.actor_role) = 'guest' and attachment_uploader_member_id = actor_member_id)
        or (
          ctx.actor_role not in ('Owner', 'Admin', 'Manager', 'Member', 'Guest')
          and attachment_uploader_member_id = actor_member_id
        )
      )
  );
$$;

create or replace function private.require_task_action(target_task_id uuid, target_action text)
returns table (workspace_id uuid, actor_member_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  current_actor_id uuid;
  allowed boolean := false;
  action_name text := lower(coalesce(target_action, ''));
begin
  select t.workspace_id
  into target_workspace_id
  from public.tasks t
  where t.id = target_task_id;

  if target_workspace_id is null then
    raise exception 'Task not found.' using errcode = 'P0001';
  end if;

  current_actor_id := private.require_active_workspace_member(target_workspace_id);

  case action_name
    when 'view' then
      allowed := private.can_view_task(target_task_id, current_actor_id);
    when 'progress' then
      allowed := private.can_update_task_progress(target_task_id, current_actor_id);
    when 'core' then
      allowed := private.can_edit_task_core(target_task_id, current_actor_id);
    when 'reassign' then
      allowed := private.can_reassign_task(target_task_id, current_actor_id);
    when 'delete' then
      allowed := private.can_delete_task(target_task_id, current_actor_id);
    when 'attachment-upload' then
      allowed := private.can_upload_task_attachment(target_task_id, current_actor_id);
    else
      raise exception 'Unsupported task permission action.' using errcode = 'P0001';
  end case;

  if not allowed then
    case action_name
      when 'view' then
        raise exception 'You do not have permission to view this task.' using errcode = 'P0001';
      when 'progress' then
        raise exception 'You do not have permission to update this task.' using errcode = 'P0001';
      when 'core' then
        raise exception 'You do not have permission to edit this task.' using errcode = 'P0001';
      when 'reassign' then
        raise exception 'You do not have permission to reassign this task.' using errcode = 'P0001';
      when 'delete' then
        raise exception 'You do not have permission to delete this task.' using errcode = 'P0001';
      when 'attachment-upload' then
        raise exception 'You do not have permission to attach files to this task.' using errcode = 'P0001';
      else
        raise exception 'You do not have permission to access this task.' using errcode = 'P0001';
    end case;
  end if;

  workspace_id := target_workspace_id;
  actor_member_id := current_actor_id;
  return next;
end;
$$;

create or replace function private.require_task_viewer(target_task_id uuid)
returns table (workspace_id uuid, actor_member_id uuid)
language sql
security definer
set search_path = public, private
as $$
  select * from private.require_task_action(target_task_id, 'view');
$$;

create or replace function private.require_task_progress_editor(target_task_id uuid)
returns table (workspace_id uuid, actor_member_id uuid)
language sql
security definer
set search_path = public, private
as $$
  select * from private.require_task_action(target_task_id, 'progress');
$$;

create or replace function private.require_task_core_editor(target_task_id uuid)
returns table (workspace_id uuid, actor_member_id uuid)
language sql
security definer
set search_path = public, private
as $$
  select * from private.require_task_action(target_task_id, 'core');
$$;

create or replace function private.require_task_reassigner(target_task_id uuid)
returns table (workspace_id uuid, actor_member_id uuid)
language sql
security definer
set search_path = public, private
as $$
  select * from private.require_task_action(target_task_id, 'reassign');
$$;

create or replace function private.require_task_deleter(target_task_id uuid)
returns table (workspace_id uuid, actor_member_id uuid)
language sql
security definer
set search_path = public, private
as $$
  select * from private.require_task_action(target_task_id, 'delete');
$$;

create or replace function private.require_task_attachment_uploader(target_task_id uuid)
returns table (workspace_id uuid, actor_member_id uuid)
language sql
security definer
set search_path = public, private
as $$
  select * from private.require_task_action(target_task_id, 'attachment-upload');
$$;

create or replace function private.require_task_attachment_deleter(target_attachment_id uuid)
returns table (workspace_id uuid, actor_member_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  target_task_id uuid;
  uploaded_by_member_id uuid;
  current_actor_id uuid;
begin
  select a.workspace_id, a.task_id, a.uploaded_by_member_id
  into target_workspace_id, target_task_id, uploaded_by_member_id
  from public.task_attachments a
  where a.id = target_attachment_id;

  if target_workspace_id is null or target_task_id is null then
    raise exception 'Attachment not found.' using errcode = 'P0001';
  end if;

  current_actor_id := private.require_active_workspace_member(target_workspace_id);

  if not private.can_delete_task_attachment_by_member(target_task_id, current_actor_id, uploaded_by_member_id) then
    raise exception 'You do not have permission to delete this attachment.' using errcode = 'P0001';
  end if;

  workspace_id := target_workspace_id;
  actor_member_id := current_actor_id;
  return next;
end;
$$;

create or replace function private.can_edit_task(target_task_id uuid, actor_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.can_edit_task_core(target_task_id, actor_member_id);
$$;

create or replace function private.require_task_editor(target_task_id uuid)
returns table (workspace_id uuid, actor_member_id uuid)
language sql
security definer
set search_path = public, private
as $$
  select * from private.require_task_core_editor(target_task_id);
$$;

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
    'endTime', '',
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

create or replace function private.work_snapshot_json(target_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(private.project_json(p.id) order by lower(p.name), p.id)
      from public.projects p
      where p.workspace_id = target_workspace_id
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(private.task_json(t.id) order by t.due_date asc, t.start_time asc, t.created_at desc)
      from public.tasks t
      where t.workspace_id = target_workspace_id
        and private.can_view_task(t.id, private.current_team_member_id(target_workspace_id))
    ), '[]'::jsonb)
  );
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
  backlog_state_value text;
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
    reminder_minutes,
    recurrence,
    sla_hours,
    linked_entity_type,
    linked_entity_id,
    linked_label_snapshot,
    account_name_snapshot,
    task_type,
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
    coalesce(nullif(trim(coalesce(payload ->> 'taskType', '')), ''), 'General'),
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
  from private.require_task_core_editor(p_task_id) as ctx;

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
  from private.require_task_deleter(p_task_id) as ctx;

  if current_task.project_id is not null then
    perform private.record_work_activity(
      target_workspace_id,
      null,
      current_task.project_id,
      actor_member_id,
      'deleted',
      format('Deleted task %s', current_task.title),
      jsonb_build_object('taskId', current_task.id, 'title', current_task.title)
    );
  end if;

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
  from private.require_task_progress_editor(p_task_id) as ctx;

  if trim(coalesce(p_body, '')) = '' then
    raise exception 'Comment text is required.' using errcode = 'P0001';
  end if;

  insert into public.task_comments (workspace_id, task_id, author_member_id, body)
  values (target_workspace_id, p_task_id, actor_member_id, trim(p_body));

  perform private.record_work_activity(
    target_workspace_id,
    p_task_id,
    current_task.project_id,
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
  from private.require_task_progress_editor(p_task_id) as ctx;

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
    current_task.project_id,
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
  from private.require_task_progress_editor(current_item.task_id) as ctx;

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
  from private.require_task_progress_editor(current_item.task_id) as ctx;

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
  from private.require_task_attachment_uploader(p_task_id) as ctx;

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
  from private.require_task_attachment_deleter(p_attachment_id) as ctx;

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

create or replace function private.can_read_task_attachment_storage(
  target_workspace_id uuid,
  target_task_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.can_view_task(target_task_id, private.current_team_member_id(target_workspace_id));
$$;

create or replace function private.can_write_task_attachment_storage(
  target_workspace_id uuid,
  target_task_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.can_upload_task_attachment(target_task_id, private.current_team_member_id(target_workspace_id));
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
  attachment_uploader_member_id uuid;
begin
  actor_member_id := private.current_team_member_id(target_workspace_id);

  if actor_member_id is null or not private.is_active_workspace_member(target_workspace_id) then
    return false;
  end if;

  select a.task_id, a.uploaded_by_member_id
  into existing_task_id, attachment_uploader_member_id
  from public.task_attachments a
  where a.workspace_id = target_workspace_id
    and a.storage_path = coalesce(target_storage_path, '')
  limit 1;

  existing_task_id := coalesce(existing_task_id, target_task_id);

  if existing_task_id is null then
    return false;
  end if;

  return private.can_delete_task_attachment_by_member(existing_task_id, actor_member_id, attachment_uploader_member_id);
end;
$$;

drop policy if exists "tasks_member_select" on public.tasks;
create policy "tasks_member_select"
on public.tasks
for select
to authenticated
using (
  private.can_view_task(id, private.current_team_member_id(workspace_id))
);

drop policy if exists "task_comments_member_select" on public.task_comments;
create policy "task_comments_member_select"
on public.task_comments
for select
to authenticated
using (
  private.can_view_task(task_id, private.current_team_member_id(workspace_id))
);

drop policy if exists "task_checklist_items_member_select" on public.task_checklist_items;
create policy "task_checklist_items_member_select"
on public.task_checklist_items
for select
to authenticated
using (
  private.can_view_task(task_id, private.current_team_member_id(workspace_id))
);

drop policy if exists "task_attachments_member_select" on public.task_attachments;
create policy "task_attachments_member_select"
on public.task_attachments
for select
to authenticated
using (
  private.can_view_task(task_id, private.current_team_member_id(workspace_id))
);

drop policy if exists "task_activity_events_member_select" on public.task_activity_events;
create policy "task_activity_events_member_select"
on public.task_activity_events
for select
to authenticated
using (
  (
    task_id is not null
    and private.can_view_task(task_id, private.current_team_member_id(workspace_id))
  )
  or (
    task_id is null
    and private.is_active_workspace_member(workspace_id)
  )
);

drop policy if exists "task_attachments_storage_select" on storage.objects;
create policy "task_attachments_storage_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'task-attachments'
  and private.can_read_task_attachment_storage(
    nullif(split_part(name, '/', 1), '')::uuid,
    nullif(split_part(name, '/', 2), '')::uuid
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

revoke all on function private.task_scope_snapshot(uuid, uuid) from public;
revoke all on function private.can_use_task_project(uuid, uuid, uuid) from public;
revoke all on function private.can_create_task(uuid, uuid, uuid, uuid) from public;
revoke all on function private.can_view_task(uuid, uuid) from public;
revoke all on function private.can_update_task_progress(uuid, uuid) from public;
revoke all on function private.can_edit_task_core(uuid, uuid) from public;
revoke all on function private.can_reassign_task(uuid, uuid) from public;
revoke all on function private.can_delete_task(uuid, uuid) from public;
revoke all on function private.can_upload_task_attachment(uuid, uuid) from public;
revoke all on function private.can_manage_task_attachment(uuid, uuid) from public;
revoke all on function private.can_delete_task_attachment_by_member(uuid, uuid, uuid) from public;
revoke all on function private.require_task_action(uuid, text) from public;
revoke all on function private.require_task_viewer(uuid) from public;
revoke all on function private.require_task_progress_editor(uuid) from public;
revoke all on function private.require_task_core_editor(uuid) from public;
revoke all on function private.require_task_reassigner(uuid) from public;
revoke all on function private.require_task_deleter(uuid) from public;
revoke all on function private.require_task_attachment_uploader(uuid) from public;
revoke all on function private.require_task_attachment_deleter(uuid) from public;
revoke all on function private.can_read_task_attachment_storage(uuid, uuid) from public;
revoke all on function private.can_write_task_attachment_storage(uuid, uuid) from public;
revoke all on function private.can_delete_task_attachment_storage(uuid, uuid, text) from public;

revoke all on function private.task_scope_snapshot(uuid, uuid) from authenticated;
revoke all on function private.can_use_task_project(uuid, uuid, uuid) from authenticated;
revoke all on function private.can_create_task(uuid, uuid, uuid, uuid) from authenticated;
revoke all on function private.can_update_task_progress(uuid, uuid) from authenticated;
revoke all on function private.can_edit_task_core(uuid, uuid) from authenticated;
revoke all on function private.can_reassign_task(uuid, uuid) from authenticated;
revoke all on function private.can_delete_task(uuid, uuid) from authenticated;
revoke all on function private.can_upload_task_attachment(uuid, uuid) from authenticated;
revoke all on function private.can_manage_task_attachment(uuid, uuid) from authenticated;
revoke all on function private.can_delete_task_attachment_by_member(uuid, uuid, uuid) from authenticated;
revoke all on function private.require_task_action(uuid, text) from authenticated;
revoke all on function private.require_task_viewer(uuid) from authenticated;
revoke all on function private.require_task_progress_editor(uuid) from authenticated;
revoke all on function private.require_task_core_editor(uuid) from authenticated;
revoke all on function private.require_task_reassigner(uuid) from authenticated;
revoke all on function private.require_task_deleter(uuid) from authenticated;
revoke all on function private.require_task_attachment_uploader(uuid) from authenticated;
revoke all on function private.require_task_attachment_deleter(uuid) from authenticated;

grant execute on function private.can_view_task(uuid, uuid) to authenticated;
grant execute on function private.can_read_task_attachment_storage(uuid, uuid) to authenticated;
grant execute on function private.can_write_task_attachment_storage(uuid, uuid) to authenticated;
grant execute on function private.can_delete_task_attachment_storage(uuid, uuid, text) to authenticated;

commit;
