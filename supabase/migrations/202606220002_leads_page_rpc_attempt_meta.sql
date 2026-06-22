begin;

create or replace function public.get_leads_page(
  p_scope text default 'all',
  p_current_user_id uuid default null,
  p_status_filter text default 'all',
  p_date_filter text default 'all',
  p_source_filter text default 'all',
  p_timezone_filter text default 'all',
  p_owner_filter text default 'all',
  p_search_term text default '',
  p_page integer default 1,
  p_page_size integer default 25,
  p_sort_key text default 'name',
  p_sort_dir text default 'asc'
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  normalized_scope text := lower(trim(coalesce(p_scope, 'all')));
  normalized_status text := trim(coalesce(p_status_filter, 'all'));
  normalized_date text := lower(trim(coalesce(p_date_filter, 'all')));
  normalized_source text := trim(coalesce(p_source_filter, 'all'));
  normalized_timezone text := trim(coalesce(p_timezone_filter, 'all'));
  normalized_owner text := trim(coalesce(p_owner_filter, 'all'));
  normalized_search text := trim(coalesce(p_search_term, ''));
  normalized_page integer := greatest(1, coalesce(p_page, 1));
  normalized_page_size integer := least(100, greatest(1, coalesce(p_page_size, 25)));
  normalized_sort_key text := lower(trim(coalesce(p_sort_key, 'name')));
  normalized_sort_dir text := lower(trim(coalesce(p_sort_dir, 'asc')));
  sort_column text;
  order_direction text;
  offset_count integer;
  rows_json jsonb := '[]'::jsonb;
  fetched_count integer := 0;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if not private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'view') then
    raise exception 'You do not have permission to view leads.' using errcode = 'P0001';
  end if;

  normalized_scope := case
    when normalized_scope in ('all', 'mine', 'unassigned', 'assigned') then normalized_scope
    else 'all'
  end;
  normalized_sort_dir := case when normalized_sort_dir = 'desc' then 'desc' else 'asc' end;
  order_direction := case when normalized_sort_dir = 'desc' then 'desc' else 'asc' end;
  sort_column := case normalized_sort_key
    when 'lead' then 'name'
    when 'phone' then 'phone'
    when 'timezone' then 'phone_timezone_bucket'
    when 'interest' then 'interest'
    when 'status' then 'status'
    when 'owner' then 'owner_member_id'
    when 'lasttouch' then 'updated_at'
    when 'nextfollowup' then 'next_follow_up_date'
    else 'name'
  end;
  offset_count := (normalized_page - 1) * normalized_page_size;

  execute format(
    $sql$
      select coalesce(jsonb_agg(to_jsonb(page_rows)), '[]'::jsonb), count(*)::integer
      from (
        select
          id,
          workspace_id,
          account_id,
          converted_account_id,
          name,
          company_name,
          email,
          phone,
          secondary_phone,
          phone_timezone_bucket,
          interest,
          source,
          status,
          owner_member_id,
          next_follow_up_date,
          created_at,
          updated_at,
          archived_at,
          active_pool,
          jsonb_strip_nulls(
            jsonb_build_object(
              'attemptCount', meta -> 'attemptCount',
              'lastAttemptAt', meta -> 'lastAttemptAt',
              'lastAttemptReason', meta -> 'lastAttemptReason',
              'assignedAt', meta -> 'assignedAt',
              'attemptHistory', meta -> 'attemptHistory'
            )
          ) as meta
        from public.leads
        where workspace_id = $1
          and archived_at is null
          and status <> 'Archived'
          and active_pool = true
          and (
            $2 = 'all'
            or ($2 = 'mine' and owner_member_id = $3)
            or ($2 = 'unassigned' and owner_member_id is null)
            or ($2 = 'assigned' and owner_member_id is not null)
          )
          and ($4 = 'all' or status = $4)
          and (
            $5 = 'all'
            or ($5 = 'today' and created_at >= current_date and created_at < current_date + interval '1 day')
            or ($5 = '7d' and created_at >= now() - interval '7 days')
            or ($5 = '30d' and created_at >= now() - interval '30 days')
          )
          and ($6 = 'all' or source = $6)
          and ($7 = 'all' or phone_timezone_bucket = $7)
          and (
            $8 = 'all'
            or ($8 = 'unassigned' and owner_member_id is null)
            or owner_member_id::text = $8
          )
          and (
            $9 = ''
            or name ilike ('%%' || $9 || '%%')
            or company_name ilike ('%%' || $9 || '%%')
            or email ilike ('%%' || $9 || '%%')
            or phone ilike ('%%' || $9 || '%%')
            or secondary_phone ilike ('%%' || $9 || '%%')
            or phone_timezone_bucket ilike ('%%' || $9 || '%%')
            or interest ilike ('%%' || $9 || '%%')
            or source ilike ('%%' || $9 || '%%')
            or status ilike ('%%' || $9 || '%%')
          )
        order by %I %s nulls last, id %s
        limit $10
        offset $11
      ) page_rows
    $sql$,
    sort_column,
    order_direction,
    order_direction
  )
  into rows_json, fetched_count
  using
    target_workspace_id,
    normalized_scope,
    p_current_user_id,
    normalized_status,
    normalized_date,
    normalized_source,
    normalized_timezone,
    normalized_owner,
    normalized_search,
    normalized_page_size + 1,
    offset_count;

  return jsonb_build_object(
    'rows', rows_json,
    'page', normalized_page,
    'pageSize', normalized_page_size,
    'hasMore', fetched_count > normalized_page_size
  );
end;
$$;

revoke all on function public.get_leads_page(text, uuid, text, text, text, text, text, text, integer, integer, text, text) from public;
grant execute on function public.get_leads_page(text, uuid, text, text, text, text, text, text, integer, integer, text, text) to authenticated;

commit;
