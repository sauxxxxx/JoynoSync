begin;

create or replace function private.dashboard_qualification_snapshot_secure_json(
  target_workspace_id uuid,
  actor_member_id uuid,
  p_range text,
  base_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'view') then
    return base_snapshot;
  end if;

  return private.dashboard_qualification_snapshot_json(
    target_workspace_id,
    p_range,
    base_snapshot
  );
end;
$$;

revoke all on function private.dashboard_qualification_snapshot_secure_json(uuid, uuid, text, jsonb) from public;

create or replace function public.get_dashboard_snapshot(p_range text default '30d')
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  normalized_range text := lower(trim(coalesce(p_range, '30d')));
  cached_snapshot jsonb;
  computed_snapshot jsonb;
begin
  if normalized_range not in ('today', '7d', '30d', 'mtd', 'qtd') then
    normalized_range := '30d';
  end if;

  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_dashboard_viewer(target_workspace_id);

  select snapshot into cached_snapshot
  from public.dashboard_snapshot_cache
  where workspace_id = target_workspace_id
    and member_id = actor_member_id
    and range_key = normalized_range
    and expires_at > now()
  limit 1;

  if cached_snapshot is not null then
    return cached_snapshot || jsonb_build_object(
      'cache', jsonb_build_object('status', 'fresh', 'range', normalized_range)
    );
  end if;

  computed_snapshot := private.dashboard_snapshot_json(target_workspace_id)
    || private.dashboard_command_snapshot_fast_json(target_workspace_id, normalized_range);
  computed_snapshot := private.dashboard_qualification_snapshot_secure_json(
    target_workspace_id,
    actor_member_id,
    normalized_range,
    computed_snapshot
  );

  insert into public.dashboard_snapshot_cache (
    workspace_id, member_id, range_key, snapshot, computed_at, expires_at
  )
  values (
    target_workspace_id, actor_member_id, normalized_range, computed_snapshot, now(), now() + interval '60 seconds'
  )
  on conflict (workspace_id, member_id, range_key) do update set
    snapshot = excluded.snapshot,
    computed_at = excluded.computed_at,
    expires_at = excluded.expires_at;

  return computed_snapshot || jsonb_build_object(
    'cache', jsonb_build_object('status', 'refreshed', 'range', normalized_range)
  );
end;
$$;

delete from public.dashboard_snapshot_cache;

revoke all on function public.get_dashboard_snapshot(text) from public;
grant execute on function public.get_dashboard_snapshot(text) to authenticated;

commit;
