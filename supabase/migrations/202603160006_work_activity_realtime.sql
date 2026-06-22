begin;

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
    'updatedAt', p.updated_at,
    'activity', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'type', e.event_type,
          'actor', coalesce(actor_member.name, 'System'),
          'actorId', e.actor_member_id,
          'text', e.message,
          'details', e.details,
          'taskId', coalesce(e.task_id::text, ''),
          'taskTitle', '',
          'createdAt', e.created_at
        )
        order by e.created_at desc
      )
      from public.task_activity_events e
      left join public.team_members actor_member on actor_member.id = e.actor_member_id
      where e.project_id = p.id
        and e.task_id is null
    ), '[]'::jsonb)
  )
  from public.projects p
  left join public.team_members owner_member on owner_member.id = p.owner_member_id
  where p.id = target_project_id
  limit 1;
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
  from private.require_task_editor(p_task_id) as ctx;

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
        and tablename = 'projects'
    ) then
      execute 'alter publication supabase_realtime add table public.projects';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'project_members'
    ) then
      execute 'alter publication supabase_realtime add table public.project_members';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'tasks'
    ) then
      execute 'alter publication supabase_realtime add table public.tasks';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'task_comments'
    ) then
      execute 'alter publication supabase_realtime add table public.task_comments';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'task_checklist_items'
    ) then
      execute 'alter publication supabase_realtime add table public.task_checklist_items';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'task_attachments'
    ) then
      execute 'alter publication supabase_realtime add table public.task_attachments';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'task_activity_events'
    ) then
      execute 'alter publication supabase_realtime add table public.task_activity_events';
    end if;
  end if;
end;
$$;

commit;
