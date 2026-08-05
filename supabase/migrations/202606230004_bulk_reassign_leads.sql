begin;

create or replace function public.bulk_reassign_leads(
  p_lead_ids uuid[],
  p_owner_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  updated_count integer := 0;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if not private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'edit') then
    raise exception 'You do not have permission to reassign leads.' using errcode = 'P0001';
  end if;

  if p_owner_member_id is null then
    raise exception 'Choose an assignee.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.team_members tm
    where tm.id = p_owner_member_id
      and tm.workspace_id = target_workspace_id
      and lower(coalesce(tm.status, '')) = 'active'
  ) then
    raise exception 'Selected assignee is not active in this workspace.' using errcode = 'P0001';
  end if;

  update public.leads l
  set
    owner_member_id = p_owner_member_id,
    updated_by_member_id = actor_member_id
  where l.workspace_id = target_workspace_id
    and l.id = any(coalesce(p_lead_ids, '{}'::uuid[]))
    and l.owner_member_id is distinct from p_owner_member_id;

  get diagnostics updated_count = row_count;

  return jsonb_build_object('updatedCount', updated_count);
end;
$$;

revoke all on function public.bulk_reassign_leads(uuid[], uuid) from public;
grant execute on function public.bulk_reassign_leads(uuid[], uuid) to authenticated;

commit;
