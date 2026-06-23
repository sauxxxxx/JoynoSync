begin;

create or replace function public.manage_lead_ownership(
  p_source_owner_member_id uuid,
  p_action text,
  p_destination_owner_member_id uuid default null,
  p_status text default 'all',
  p_archive_scope text default 'active',
  p_limit integer default null,
  p_order text default 'oldest_updated',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  normalized_action text := lower(trim(coalesce(p_action, 'transfer')));
  normalized_status text := nullif(trim(coalesce(p_status, 'all')), '');
  normalized_archive_scope text := lower(trim(coalesce(p_archive_scope, 'active')));
  normalized_order text := lower(trim(coalesce(p_order, 'oldest_updated')));
  normalized_limit integer := greatest(0, least(coalesce(p_limit, 0), 50000));
  matching_count integer := 0;
  affected_count integer := 0;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if not private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'edit') then
    raise exception 'You do not have permission to manage lead ownership.' using errcode = 'P0001';
  end if;

  if p_source_owner_member_id is null then
    raise exception 'Choose the current owner.' using errcode = 'P0001';
  end if;

  if normalized_action not in ('transfer', 'unassign') then
    raise exception 'Choose a valid ownership action.' using errcode = 'P0001';
  end if;

  if normalized_archive_scope not in ('active', 'archived', 'all') then
    normalized_archive_scope := 'active';
  end if;

  if normalized_order not in ('oldest_updated', 'newest_updated', 'oldest_created', 'newest_created', 'random') then
    normalized_order := 'oldest_updated';
  end if;

  if not exists (
    select 1
    from public.team_members tm
    where tm.id = p_source_owner_member_id
      and tm.workspace_id = target_workspace_id
  ) then
    raise exception 'Current owner was not found in this workspace.' using errcode = 'P0001';
  end if;

  if normalized_action = 'transfer' then
    if p_destination_owner_member_id is null then
      raise exception 'Choose the new owner.' using errcode = 'P0001';
    end if;

    if p_destination_owner_member_id = p_source_owner_member_id then
      raise exception 'Choose a different new owner.' using errcode = 'P0001';
    end if;

    if not exists (
      select 1
      from public.team_members tm
      where tm.id = p_destination_owner_member_id
        and tm.workspace_id = target_workspace_id
        and lower(coalesce(tm.status, '')) = 'active'
    ) then
      raise exception 'New owner must be active in this workspace.' using errcode = 'P0001';
    end if;
  end if;

  with matching as (
    select l.id
    from public.leads l
    where l.workspace_id = target_workspace_id
      and l.owner_member_id = p_source_owner_member_id
      and (
        coalesce(normalized_status, 'all') = 'all'
        or l.status = normalized_status
      )
      and (
        normalized_archive_scope = 'all'
        or (
          normalized_archive_scope = 'active'
          and l.archived_at is null
          and coalesce(l.status, '') <> 'Archived'
        )
        or (
          normalized_archive_scope = 'archived'
          and (
            l.archived_at is not null
            or coalesce(l.status, '') = 'Archived'
          )
        )
      )
  )
  select count(*) into matching_count
  from matching;

  if p_dry_run then
    affected_count := case
      when normalized_limit > 0 then least(matching_count, normalized_limit)
      else matching_count
    end;

    return jsonb_build_object(
      'matchingCount', matching_count,
      'affectedCount', affected_count,
      'dryRun', true,
      'action', normalized_action,
      'limit', normalized_limit,
      'order', normalized_order
    );
  end if;

  with selected as (
    select l.id
    from public.leads l
    where l.workspace_id = target_workspace_id
      and l.owner_member_id = p_source_owner_member_id
      and (
        coalesce(normalized_status, 'all') = 'all'
        or l.status = normalized_status
      )
      and (
        normalized_archive_scope = 'all'
        or (
          normalized_archive_scope = 'active'
          and l.archived_at is null
          and coalesce(l.status, '') <> 'Archived'
        )
        or (
          normalized_archive_scope = 'archived'
          and (
            l.archived_at is not null
            or coalesce(l.status, '') = 'Archived'
          )
        )
      )
    order by
      case when normalized_order = 'oldest_updated' then l.updated_at end asc nulls first,
      case when normalized_order = 'newest_updated' then l.updated_at end desc nulls last,
      case when normalized_order = 'oldest_created' then l.created_at end asc nulls first,
      case when normalized_order = 'newest_created' then l.created_at end desc nulls last,
      case when normalized_order = 'random' then random() end,
      l.id asc
    limit nullif(normalized_limit, 0)
  ),
  updated as (
    update public.leads l
    set
      owner_member_id = case
        when normalized_action = 'transfer' then p_destination_owner_member_id
        else null
      end,
      updated_by_member_id = actor_member_id
    from selected
    where l.id = selected.id
      and l.workspace_id = target_workspace_id
    returning l.id
  )
  select count(*) into affected_count
  from updated;

  return jsonb_build_object(
    'matchingCount', matching_count,
    'affectedCount', affected_count,
    'dryRun', false,
    'action', normalized_action,
    'limit', normalized_limit,
    'order', normalized_order
  );
end;
$$;

revoke all on function public.manage_lead_ownership(uuid, text, uuid, text, text, integer, text, boolean) from public;
grant execute on function public.manage_lead_ownership(uuid, text, uuid, text, text, integer, text, boolean) to authenticated;

commit;
