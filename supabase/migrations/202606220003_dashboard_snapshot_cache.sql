begin;

create table if not exists public.dashboard_snapshot_cache (
  workspace_id uuid not null,
  member_id uuid not null,
  range_key text not null,
  snapshot jsonb not null,
  computed_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 seconds',
  primary key (workspace_id, member_id, range_key)
);

create index if not exists dashboard_snapshot_cache_expires_idx
on public.dashboard_snapshot_cache (expires_at);

alter table public.dashboard_snapshot_cache enable row level security;

drop policy if exists dashboard_snapshot_cache_no_direct_access on public.dashboard_snapshot_cache;
create policy dashboard_snapshot_cache_no_direct_access
on public.dashboard_snapshot_cache
for all
using (false)
with check (false);

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
  stale_snapshot jsonb;
  computed_snapshot jsonb;
  cache_ttl interval := interval '60 seconds';
begin
  if normalized_range not in ('7d', '30d', '90d', 'month', 'quarter', 'year') then
    normalized_range := '30d';
  end if;

  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_dashboard_viewer(target_workspace_id);

  select dsc.snapshot
  into cached_snapshot
  from public.dashboard_snapshot_cache dsc
  where dsc.workspace_id = target_workspace_id
    and dsc.member_id = actor_member_id
    and dsc.range_key = normalized_range
    and dsc.expires_at > now()
  limit 1;

  if cached_snapshot is not null then
    return cached_snapshot || jsonb_build_object(
      'cache', jsonb_build_object(
        'status', 'fresh',
        'range', normalized_range
      )
    );
  end if;

  select dsc.snapshot
  into stale_snapshot
  from public.dashboard_snapshot_cache dsc
  where dsc.workspace_id = target_workspace_id
    and dsc.member_id = actor_member_id
    and dsc.range_key = normalized_range
  order by dsc.computed_at desc
  limit 1;

  begin
    computed_snapshot :=
      private.dashboard_snapshot_json(target_workspace_id)
      || private.dashboard_command_snapshot_json(target_workspace_id, normalized_range);

    insert into public.dashboard_snapshot_cache (
      workspace_id,
      member_id,
      range_key,
      snapshot,
      computed_at,
      expires_at
    )
    values (
      target_workspace_id,
      actor_member_id,
      normalized_range,
      computed_snapshot,
      now(),
      now() + cache_ttl
    )
    on conflict (workspace_id, member_id, range_key)
    do update set
      snapshot = excluded.snapshot,
      computed_at = excluded.computed_at,
      expires_at = excluded.expires_at;

    return computed_snapshot || jsonb_build_object(
      'cache', jsonb_build_object(
        'status', 'refreshed',
        'range', normalized_range
      )
    );
  exception
    when query_canceled then
      if stale_snapshot is not null then
        return stale_snapshot || jsonb_build_object(
          'cache', jsonb_build_object(
            'status', 'stale',
            'range', normalized_range,
            'reason', 'refresh-timeout'
          )
        );
      end if;
      raise;
    when others then
      if stale_snapshot is not null then
        return stale_snapshot || jsonb_build_object(
          'cache', jsonb_build_object(
            'status', 'stale',
            'range', normalized_range,
            'reason', 'refresh-failed'
          )
        );
      end if;
      raise;
  end;
end;
$$;

revoke all on table public.dashboard_snapshot_cache from public;
revoke all on function public.get_dashboard_snapshot(text) from public;
grant execute on function public.get_dashboard_snapshot(text) to authenticated;

commit;
