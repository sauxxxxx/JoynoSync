begin;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  owner_member_id uuid references public.team_members(id) on delete set null,
  status text not null default 'On Track',
  progress integer not null default 0,
  deadline date not null,
  account_id uuid references public.accounts(id) on delete set null,
  account_name_snapshot text not null default '',
  description text not null default '',
  risks text not null default '',
  created_by_member_id uuid references public.team_members(id) on delete set null,
  updated_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint projects_status_check check (status in ('On Track', 'Needs Focus', 'Blocked')),
  constraint projects_progress_check check (progress >= 0 and progress <= 100)
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default timezone('utc', now()),
  primary key (project_id, member_id),
  constraint project_members_role_check check (role in ('owner', 'member'))
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  description text not null default '',
  status text not null default 'New',
  priority text not null default 'low',
  assignee_member_id uuid references public.team_members(id) on delete set null,
  due_date date not null,
  start_time time not null default time '09:00',
  reminder_minutes integer not null default 15,
  recurrence text not null default 'none',
  sla_hours integer,
  linked_entity_type text not null default '',
  linked_entity_id text not null default '',
  linked_label_snapshot text not null default '',
  account_name_snapshot text not null default '',
  task_type text not null default 'General',
  backlog_state text not null default 'scheduled',
  completed_at timestamptz,
  created_by_member_id uuid references public.team_members(id) on delete set null,
  updated_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tasks_status_check check (status in ('New', 'Scheduled', 'In progress', 'Completed')),
  constraint tasks_priority_check check (priority in ('high', 'medium', 'low')),
  constraint tasks_recurrence_check check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  constraint tasks_backlog_state_check check (backlog_state in ('queue', 'scheduled')),
  constraint tasks_sla_hours_check check (sla_hours is null or sla_hours > 0)
);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_member_id uuid references public.team_members(id) on delete set null,
  body text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  label text not null,
  done boolean not null default false,
  completed_at timestamptz,
  created_by_member_id uuid references public.team_members(id) on delete set null,
  updated_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null default '',
  size_bytes bigint not null default 0,
  uploaded_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint task_attachments_workspace_path_key unique (workspace_id, storage_path)
);

create table if not exists public.task_activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  actor_member_id uuid references public.team_members(id) on delete set null,
  event_type text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row
execute function public.set_updated_at();

drop trigger if exists set_task_checklist_items_updated_at on public.task_checklist_items;
create trigger set_task_checklist_items_updated_at
before update on public.task_checklist_items
for each row
execute function public.set_updated_at();

create index if not exists projects_workspace_updated_idx
on public.projects (workspace_id, updated_at desc, created_at desc);

create index if not exists project_members_project_idx
on public.project_members (project_id, member_id);

create index if not exists tasks_workspace_due_idx
on public.tasks (workspace_id, due_date asc, start_time asc, created_at desc);

create index if not exists tasks_workspace_assignee_idx
on public.tasks (workspace_id, assignee_member_id, due_date asc);

create index if not exists tasks_workspace_project_idx
on public.tasks (workspace_id, project_id, created_at desc);

create index if not exists task_comments_task_created_idx
on public.task_comments (task_id, created_at asc);

create index if not exists task_checklist_items_task_created_idx
on public.task_checklist_items (task_id, created_at asc);

create index if not exists task_attachments_task_created_idx
on public.task_attachments (task_id, created_at desc);

create index if not exists task_activity_events_task_created_idx
on public.task_activity_events (task_id, created_at desc);

create index if not exists task_activity_events_project_created_idx
on public.task_activity_events (project_id, created_at desc);

create or replace function private.current_team_member_id(target_workspace_id uuid default private.current_workspace_id())
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select tm.id
  from public.team_members tm
  where tm.workspace_id = coalesce(target_workspace_id, private.current_workspace_id())
    and (tm.auth_user_id = auth.uid() or lower(tm.email) = private.current_user_email())
  order by
    case
      when tm.status = 'Active' then 0
      when tm.status = 'Pending Invite' then 1
      when tm.status = 'Inactive' then 2
      else 3
    end,
    coalesce(tm.updated_at, tm.invite_last_sent_at, tm.invited_at) desc
  limit 1;
$$;

create or replace function private.current_team_role_for_workspace(target_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select tm.role
  from public.team_members tm
  where tm.workspace_id = target_workspace_id
    and (tm.auth_user_id = auth.uid() or lower(tm.email) = private.current_user_email())
  order by
    case
      when tm.status = 'Active' then 0
      when tm.status = 'Pending Invite' then 1
      when tm.status = 'Inactive' then 2
      else 3
    end,
    coalesce(tm.updated_at, tm.invite_last_sent_at, tm.invited_at) desc
  limit 1;
$$;

create or replace function private.current_team_status_for_workspace(target_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select tm.status
  from public.team_members tm
  where tm.workspace_id = target_workspace_id
    and (tm.auth_user_id = auth.uid() or lower(tm.email) = private.current_user_email())
  order by
    case
      when tm.status = 'Active' then 0
      when tm.status = 'Pending Invite' then 1
      when tm.status = 'Inactive' then 2
      else 3
    end,
    coalesce(tm.updated_at, tm.invite_last_sent_at, tm.invited_at) desc
  limit 1;
$$;

create or replace function private.require_active_workspace_member(target_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  member_id uuid;
  member_status text;
begin
  if target_workspace_id is null then
    raise exception 'Workspace context is required.' using errcode = 'P0001';
  end if;

  member_id := private.current_team_member_id(target_workspace_id);
  member_status := coalesce(private.current_team_status_for_workspace(target_workspace_id), '');

  if member_id is null or member_status <> 'Active' then
    raise exception 'Active workspace membership is required.' using errcode = 'P0001';
  end if;

  return member_id;
end;
$$;

create or replace function private.require_workspace_manager(target_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  member_id uuid;
  member_role text;
begin
  member_id := private.require_active_workspace_member(target_workspace_id);
  member_role := coalesce(private.current_team_role_for_workspace(target_workspace_id), '');

  if member_role not in ('Owner', 'Admin', 'Manager') then
    raise exception 'Manager access is required for this action.' using errcode = 'P0001';
  end if;

  return member_id;
end;
$$;

create or replace function private.ensure_workspace_member(
  target_workspace_id uuid,
  target_member_id uuid,
  require_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  matched_status text;
begin
  if target_member_id is null then
    return null;
  end if;

  select tm.status
  into matched_status
  from public.team_members tm
  where tm.workspace_id = target_workspace_id
    and tm.id = target_member_id
  limit 1;

  if matched_status is null then
    raise exception 'Selected team member was not found in this workspace.' using errcode = 'P0001';
  end if;

  if require_active and matched_status <> 'Active' then
    raise exception 'Selected team member must be active.' using errcode = 'P0001';
  end if;

  return target_member_id;
end;
$$;

create or replace function private.record_work_activity(
  target_workspace_id uuid,
  target_task_id uuid,
  target_project_id uuid,
  actor_member_id uuid,
  target_event_type text,
  target_message text,
  target_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public, private
as $$
  insert into public.task_activity_events (
    workspace_id,
    task_id,
    project_id,
    actor_member_id,
    event_type,
    message,
    details
  )
  values (
    target_workspace_id,
    target_task_id,
    target_project_id,
    actor_member_id,
    coalesce(nullif(trim(target_event_type), ''), 'update'),
    coalesce(nullif(trim(target_message), ''), 'Updated'),
    coalesce(target_details, '{}'::jsonb)
  );
$$;

create or replace function private.next_task_due_date(source_due_date date, source_recurrence text)
returns date
language plpgsql
immutable
as $$
begin
  if source_due_date is null then
    return null;
  end if;

  case lower(coalesce(source_recurrence, 'none'))
    when 'daily' then
      return source_due_date + integer '1';
    when 'weekly' then
      return source_due_date + integer '7';
    when 'monthly' then
      return (source_due_date + interval '1 month')::date;
    else
      return null;
  end case;
end;
$$;

create or replace function private.can_edit_task(target_task_id uuid, actor_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.tasks t
    left join public.projects p on p.id = t.project_id
    where t.id = target_task_id
      and (
        t.assignee_member_id = actor_member_id
        or t.created_by_member_id = actor_member_id
        or p.owner_member_id = actor_member_id
        or exists (
          select 1
          from public.team_members tm
          where tm.id = actor_member_id
            and tm.workspace_id = t.workspace_id
            and tm.status = 'Active'
            and tm.role in ('Owner', 'Admin', 'Manager')
        )
      )
  );
$$;

create or replace function private.require_task_editor(target_task_id uuid)
returns table (workspace_id uuid, actor_member_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  current_actor_id uuid;
begin
  select t.workspace_id
  into target_workspace_id
  from public.tasks t
  where t.id = target_task_id;

  if target_workspace_id is null then
    raise exception 'Task not found.' using errcode = 'P0001';
  end if;

  current_actor_id := private.require_active_workspace_member(target_workspace_id);

  if not private.can_edit_task(target_task_id, current_actor_id) then
    raise exception 'You do not have permission to update this task.' using errcode = 'P0001';
  end if;

  workspace_id := target_workspace_id;
  actor_member_id := current_actor_id;
  return next;
end;
$$;

create or replace function private.can_manage_project(target_project_id uuid, actor_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and (
        p.owner_member_id = actor_member_id
        or p.created_by_member_id = actor_member_id
        or exists (
          select 1
          from public.team_members tm
          where tm.id = actor_member_id
            and tm.workspace_id = p.workspace_id
            and tm.status = 'Active'
            and tm.role in ('Owner', 'Admin', 'Manager')
        )
      )
  );
$$;

create or replace function private.require_project_manager(target_project_id uuid)
returns table (workspace_id uuid, actor_member_id uuid)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  current_actor_id uuid;
begin
  select p.workspace_id
  into target_workspace_id
  from public.projects p
  where p.id = target_project_id;

  if target_workspace_id is null then
    raise exception 'Project not found.' using errcode = 'P0001';
  end if;

  current_actor_id := private.require_active_workspace_member(target_workspace_id);

  if not private.can_manage_project(target_project_id, current_actor_id) then
    raise exception 'You do not have permission to update this project.' using errcode = 'P0001';
  end if;

  workspace_id := target_workspace_id;
  actor_member_id := current_actor_id;
  return next;
end;
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
          'createdAt', a.created_at
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
  where t.id = target_task_id
  limit 1;
$$;

create or replace function private.project_json(target_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'id', p.id,
    'workspaceId', p.workspace_id,
    'name', p.name,
    'ownerId', p.owner_member_id,
    'owner', coalesce(owner_member.name, ''),
    'status', p.status,
    'progress', p.progress,
    'deadline', to_char(p.deadline, 'YYYY-MM-DD'),
    'accountId', p.account_id,
    'accountName', p.account_name_snapshot,
    'account', p.account_name_snapshot,
    'teamMemberIds', coalesce((
      select jsonb_agg(pm.member_id order by lower(coalesce(member_record.name, '')), pm.member_id)
      from public.project_members pm
      left join public.team_members member_record on member_record.id = pm.member_id
      where pm.project_id = p.id
    ), '[]'::jsonb),
    'teamMembers', coalesce((
      select jsonb_agg(coalesce(member_record.name, '') order by lower(coalesce(member_record.name, '')), pm.member_id)
      from public.project_members pm
      left join public.team_members member_record on member_record.id = pm.member_id
      where pm.project_id = p.id
    ), '[]'::jsonb),
    'description', p.description,
    'risks', p.risks,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at
  )
  from public.projects p
  left join public.team_members owner_member on owner_member.id = p.owner_member_id
  where p.id = target_project_id
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
    ), '[]'::jsonb)
  );
$$;

create or replace function private.set_project_members_internal(
  target_workspace_id uuid,
  target_project_id uuid,
  member_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  normalized_member_ids uuid[];
  next_member_id uuid;
begin
  normalized_member_ids := coalesce(member_ids, array[]::uuid[]);

  delete from public.project_members pm
  where pm.project_id = target_project_id
    and not (pm.member_id = any(normalized_member_ids));

  foreach next_member_id in array normalized_member_ids
  loop
    perform private.ensure_workspace_member(target_workspace_id, next_member_id, true);
    insert into public.project_members (project_id, member_id, role)
    values (
      target_project_id,
      next_member_id,
      case when exists (
        select 1
        from public.projects p
        where p.id = target_project_id
          and p.owner_member_id = next_member_id
      ) then 'owner' else 'member' end
    )
    on conflict (project_id, member_id) do update
    set role = excluded.role;
  end loop;
end;
$$;

create or replace function public.get_work_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
begin
  target_workspace_id := private.current_workspace_id();
  perform private.require_active_workspace_member(target_workspace_id);
  return private.work_snapshot_json(target_workspace_id);
end;
$$;

create or replace function public.create_project(p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  target_project_id uuid;
  owner_member_id uuid;
  team_member_ids uuid[];
  project_name text;
  project_status text;
  project_progress integer;
  project_deadline date;
  account_id uuid;
  account_name text;
  description_text text;
  risks_text text;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  project_name := trim(coalesce(payload ->> 'name', ''));
  if project_name = '' then
    raise exception 'Project name is required.' using errcode = 'P0001';
  end if;

  owner_member_id := private.ensure_workspace_member(
    target_workspace_id,
    nullif(trim(coalesce(payload ->> 'ownerId', '')), '')::uuid,
    true
  );
  if owner_member_id is null then
    owner_member_id := actor_member_id;
  end if;

  project_status := trim(coalesce(payload ->> 'status', 'On Track'));
  if project_status not in ('On Track', 'Needs Focus', 'Blocked') then
    raise exception 'Invalid project status.' using errcode = 'P0001';
  end if;

  project_progress := greatest(0, least(100, coalesce(nullif(trim(coalesce(payload ->> 'progress', '')), '')::integer, 0)));
  project_deadline := coalesce(nullif(trim(coalesce(payload ->> 'deadline', '')), '')::date, timezone('utc', now())::date);
  account_id := nullif(trim(coalesce(payload ->> 'accountId', '')), '')::uuid;
  account_name := trim(coalesce(payload ->> 'accountName', ''));
  description_text := trim(coalesce(payload ->> 'description', ''));
  risks_text := trim(coalesce(payload ->> 'risks', ''));
  team_member_ids := coalesce((
    select array_agg(value::uuid)
    from jsonb_array_elements_text(coalesce(payload -> 'teamMemberIds', '[]'::jsonb)) value
  ), array[]::uuid[]);

  if owner_member_id is not null and not (owner_member_id = any(team_member_ids)) then
    team_member_ids := array_append(team_member_ids, owner_member_id);
  end if;

  insert into public.projects (
    workspace_id,
    name,
    owner_member_id,
    status,
    progress,
    deadline,
    account_id,
    account_name_snapshot,
    description,
    risks,
    created_by_member_id,
    updated_by_member_id
  )
  values (
    target_workspace_id,
    project_name,
    owner_member_id,
    project_status,
    project_progress,
    project_deadline,
    account_id,
    account_name,
    description_text,
    risks_text,
    actor_member_id,
    actor_member_id
  )
  returning id into target_project_id;

  perform private.set_project_members_internal(target_workspace_id, target_project_id, team_member_ids);
  perform private.record_work_activity(
    target_workspace_id,
    null,
    target_project_id,
    actor_member_id,
    'created',
    'Project created',
    jsonb_build_object('name', project_name)
  );

  return private.work_snapshot_json(target_workspace_id);
end;
$$;

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

revoke all on function private.current_team_member_id(uuid) from public;
revoke all on function private.current_team_role_for_workspace(uuid) from public;
revoke all on function private.current_team_status_for_workspace(uuid) from public;
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

grant execute on function private.current_team_member_id(uuid) to authenticated;
grant execute on function private.current_team_role_for_workspace(uuid) to authenticated;
grant execute on function private.current_team_status_for_workspace(uuid) to authenticated;
grant execute on function private.require_active_workspace_member(uuid) to authenticated;
grant execute on function private.require_workspace_manager(uuid) to authenticated;
grant execute on function private.ensure_workspace_member(uuid, uuid, boolean) to authenticated;
grant execute on function private.record_work_activity(uuid, uuid, uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function private.next_task_due_date(date, text) to authenticated;
grant execute on function private.can_edit_task(uuid, uuid) to authenticated;
grant execute on function private.require_task_editor(uuid) to authenticated;
grant execute on function private.can_manage_project(uuid, uuid) to authenticated;
grant execute on function private.require_project_manager(uuid) to authenticated;
grant execute on function private.task_json(uuid) to authenticated;
grant execute on function private.project_json(uuid) to authenticated;
grant execute on function private.work_snapshot_json(uuid) to authenticated;
grant execute on function private.set_project_members_internal(uuid, uuid, uuid[]) to authenticated;

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

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.task_attachments enable row level security;
alter table public.task_activity_events enable row level security;

drop policy if exists "projects_member_select" on public.projects;
create policy "projects_member_select"
on public.projects
for select
to authenticated
using (
  private.is_active_workspace_member(workspace_id)
);

drop policy if exists "project_members_member_select" on public.project_members;
create policy "project_members_member_select"
on public.project_members
for select
to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and private.is_active_workspace_member(p.workspace_id)
  )
);

drop policy if exists "tasks_member_select" on public.tasks;
create policy "tasks_member_select"
on public.tasks
for select
to authenticated
using (
  private.is_active_workspace_member(workspace_id)
);

drop policy if exists "task_comments_member_select" on public.task_comments;
create policy "task_comments_member_select"
on public.task_comments
for select
to authenticated
using (
  private.is_active_workspace_member(workspace_id)
);

drop policy if exists "task_checklist_items_member_select" on public.task_checklist_items;
create policy "task_checklist_items_member_select"
on public.task_checklist_items
for select
to authenticated
using (
  private.is_active_workspace_member(workspace_id)
);

drop policy if exists "task_attachments_member_select" on public.task_attachments;
create policy "task_attachments_member_select"
on public.task_attachments
for select
to authenticated
using (
  private.is_active_workspace_member(workspace_id)
);

drop policy if exists "task_activity_events_member_select" on public.task_activity_events;
create policy "task_activity_events_member_select"
on public.task_activity_events
for select
to authenticated
using (
  private.is_active_workspace_member(workspace_id)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments',
  'task-attachments',
  false,
  20971520,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.ms-excel',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain'
  ]
)
on conflict (id) do nothing;

drop policy if exists "task_attachments_storage_select" on storage.objects;
create policy "task_attachments_storage_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'task-attachments'
  and private.is_active_workspace_member(nullif(split_part(name, '/', 1), '')::uuid)
);

drop policy if exists "task_attachments_storage_insert" on storage.objects;
create policy "task_attachments_storage_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'task-attachments'
  and private.is_active_workspace_member(nullif(split_part(name, '/', 1), '')::uuid)
);

drop policy if exists "task_attachments_storage_delete" on storage.objects;
create policy "task_attachments_storage_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'task-attachments'
  and private.is_active_workspace_member(nullif(split_part(name, '/', 1), '')::uuid)
);

commit;
