begin;

create or replace function public.bulk_reassign_and_restart_leads(
  p_lead_ids uuid[],
  p_owner_member_id uuid,
  p_restart_workflow boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  actor_name text;
  changed_count integer := 0;
  restarted_count integer := 0;
  changed_at timestamptz := timezone('utc', now());
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if not private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'edit') then
    raise exception 'You do not have permission to reassign leads.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_lead_ids, 1), 0) = 0 then
    raise exception 'Select at least one lead.' using errcode = 'P0001';
  end if;
  if p_owner_member_id is null then
    raise exception 'Choose an assignee.' using errcode = 'P0001';
  end if;

  select name into actor_name
  from public.team_members
  where id = actor_member_id and workspace_id = target_workspace_id;

  if not exists (
    select 1 from public.team_members tm
    where tm.id = p_owner_member_id
      and tm.workspace_id = target_workspace_id
      and lower(coalesce(tm.status, '')) = 'active'
  ) then
    raise exception 'Selected assignee is not active in this workspace.' using errcode = 'P0001';
  end if;

  with selected as (
    select l.*
    from public.leads l
    where l.workspace_id = target_workspace_id
      and l.id = any(p_lead_ids)
      and l.archived_at is null
    for update
  ), updated as (
    update public.leads l
    set owner_member_id = p_owner_member_id,
        active_pool = true,
        status = case when p_restart_workflow then 'New' else l.status end,
        next_follow_up_date = case when p_restart_workflow then null else l.next_follow_up_date end,
        meta = case
          when not p_restart_workflow then coalesce(l.meta, '{}'::jsonb) || jsonb_build_object(
            'assignedAt', changed_at,
            'assignedBy', coalesce(actor_name, '')
          )
          else (
            coalesce(l.meta, '{}'::jsonb)
            || jsonb_build_object(
              'restartHistory', coalesce(
                case when jsonb_typeof(l.meta -> 'restartHistory') = 'array' then l.meta -> 'restartHistory' end,
                '[]'::jsonb
              ) || jsonb_build_array(jsonb_build_object(
                'restartedAt', changed_at,
                'restartedByMemberId', actor_member_id,
                'restartedByName', coalesce(actor_name, ''),
                'previousOwnerMemberId', l.owner_member_id,
                'previousStatus', l.status,
                'previousAttemptCount', coalesce(l.meta -> 'attemptCount', '0'::jsonb),
                'previousAttemptHistory', coalesce(l.meta -> 'attemptHistory', '[]'::jsonb)
              )),
              'attemptCount', 0,
              'attemptHistory', '[]'::jsonb,
              'lastAttemptAt', '',
              'lastAttemptReason', '',
              'assignedAt', changed_at,
              'assignedBy', coalesce(actor_name, ''),
              'attemptLimitAt', '',
              'attemptLimitRemovalDueAt', '',
              'attemptLimitRemovalState', '',
              'attemptLimitRemovedFromActiveAt', '',
              'attemptLimitRemovedFromActiveReason', '',
              'lastStatusChangedAt', changed_at,
              'lastStatusChangedByMemberId', actor_member_id,
              'lastStatusChangedByName', coalesce(actor_name, ''),
              'lastStatusChangedFrom', coalesce(l.status, ''),
              'lastStatusChangedTo', 'New'
            )
          )
        end,
        updated_by_member_id = actor_member_id
    from selected s
    where l.id = s.id
      and l.workspace_id = target_workspace_id
      and (l.owner_member_id is distinct from p_owner_member_id or p_restart_workflow)
    returning l.id
  )
  select count(*) into changed_count from updated;

  if p_restart_workflow then
    restarted_count := changed_count;
    insert into public.lead_activity_events (
      workspace_id, lead_id, event_type, actor_member_id, new_value, metadata
    )
    select
      target_workspace_id,
      lead_id,
      'status_restarted',
      actor_member_id,
      jsonb_build_object('status', 'New', 'ownerMemberId', p_owner_member_id),
      jsonb_build_object('source', 'bulk-reassign-and-restart')
    from unnest(p_lead_ids) as lead_id
    where exists (
      select 1 from public.leads l
      where l.id = lead_id and l.workspace_id = target_workspace_id and l.archived_at is null
    );
  end if;

  return jsonb_build_object(
    'updatedCount', changed_count,
    'restartedCount', restarted_count,
    'status', case when p_restart_workflow then 'New' else null end
  );
end;
$$;

revoke all on function public.bulk_reassign_and_restart_leads(uuid[], uuid, boolean) from public;
grant execute on function public.bulk_reassign_and_restart_leads(uuid[], uuid, boolean) to authenticated;

commit;
