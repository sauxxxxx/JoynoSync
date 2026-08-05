begin;

create or replace function public.get_leads_cursor_page(
  p_scope text default 'all',
  p_status_filter text default 'all',
  p_date_filter text default 'all',
  p_source_filter text default 'all',
  p_timezone_filter text default 'all',
  p_owner_filter text default 'all',
  p_search_term text default '',
  p_page integer default 1,
  p_page_size integer default 25,
  p_sort_key text default 'lasttouch',
  p_sort_dir text default 'desc',
  p_cursor_sort_value text default null,
  p_cursor_id uuid default null,
  p_cursor_direction text default 'next',
  p_today date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  can_manage boolean := false;
  normalized_scope text := lower(trim(coalesce(p_scope, 'all')));
  normalized_status text := trim(coalesce(p_status_filter, 'all'));
  normalized_date text := lower(trim(coalesce(p_date_filter, 'all')));
  normalized_source text := trim(coalesce(p_source_filter, 'all'));
  normalized_timezone text := trim(coalesce(p_timezone_filter, 'all'));
  normalized_owner text := trim(coalesce(p_owner_filter, 'all'));
  normalized_search text := trim(coalesce(p_search_term, ''));
  normalized_page integer := greatest(1, coalesce(p_page, 1));
  normalized_page_size integer := least(100, greatest(1, coalesce(p_page_size, 25)));
  normalized_sort_key text := lower(trim(coalesce(p_sort_key, 'lasttouch')));
  normalized_sort_dir text := case when lower(trim(coalesce(p_sort_dir, 'desc'))) = 'asc' then 'asc' else 'desc' end;
  normalized_cursor_direction text := case when lower(trim(coalesce(p_cursor_direction, 'next'))) = 'prev' then 'prev' else 'next' end;
  sort_column text;
  sort_type text;
  order_direction text;
  nulls_direction text := 'last';
  cursor_comparator text;
  cursor_predicate text := '';
  cursor_applied boolean := false;
  offset_count integer := 0;
  rows_json jsonb := '[]'::jsonb;
  fetched_count integer := 0;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if not private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'view') then
    raise exception 'You do not have permission to view leads.' using errcode = 'P0001';
  end if;
  can_manage := private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'edit');

  normalized_scope := case
    when not can_manage then 'mine'
    when normalized_scope in ('all', 'mine', 'unassigned', 'assigned') then normalized_scope
    else 'all'
  end;
  if not can_manage then
    normalized_owner := 'all';
  end if;
  normalized_date := case
    when normalized_date in ('all', 'overdue', 'today', 'tomorrow', 'not-set') then normalized_date
    else 'all'
  end;

  sort_column := case normalized_sort_key
    when 'lead' then 'name'
    when 'name' then 'name'
    when 'phone' then 'phone'
    when 'timezone' then 'phone_timezone_bucket'
    when 'interest' then 'interest_sort_key'
    when 'status' then 'status'
    when 'owner' then 'owner_member_id'
    when 'lasttouch' then 'updated_at'
    when 'nextfollowup' then 'next_follow_up_date'
    else 'updated_at'
  end;
  sort_type := case sort_column
    when 'owner_member_id' then 'uuid'
    when 'updated_at' then 'timestamptz'
    when 'next_follow_up_date' then 'date'
    else 'text'
  end;

  cursor_applied := nullif(trim(coalesce(p_cursor_sort_value, '')), '') is not null and p_cursor_id is not null;
  if cursor_applied then
    if normalized_cursor_direction = 'prev' then
      order_direction := case when normalized_sort_dir = 'asc' then 'desc' else 'asc' end;
      cursor_comparator := case when normalized_sort_dir = 'asc' then '<' else '>' end;
      nulls_direction := 'first';
    else
      order_direction := normalized_sort_dir;
      cursor_comparator := case when normalized_sort_dir = 'asc' then '>' else '<' end;
    end if;
    cursor_predicate := format(
      'and (%1$I is not null and ((%1$I %2$s $11::%3$s) or (%1$I = $11::%3$s and id %2$s $12)))',
      sort_column,
      cursor_comparator,
      sort_type
    );
  else
    order_direction := normalized_sort_dir;
    offset_count := (normalized_page - 1) * normalized_page_size;
  end if;

  execute format(
    $sql$
      select coalesce(jsonb_agg(to_jsonb(page_rows)), '[]'::jsonb), count(*)::integer
      from (
        select
          id, workspace_id, account_id, converted_account_id, name, company_name,
          email, phone, secondary_phone, phone_timezone_bucket, interest, interest_sort_key,
          source, status, owner_member_id, next_follow_up_date, created_at, updated_at,
          archived_at, active_pool,
          jsonb_strip_nulls(jsonb_build_object(
            'attemptCount', meta -> 'attemptCount',
            'lastAttemptAt', meta -> 'lastAttemptAt',
            'lastAttemptReason', meta -> 'lastAttemptReason',
            'assignedAt', meta -> 'assignedAt',
            'attemptHistory', meta -> 'attemptHistory'
          )) as meta
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
            or ($5 = 'not-set' and next_follow_up_date is null)
            or ($5 = 'overdue' and next_follow_up_date < $10)
            or ($5 = 'today' and next_follow_up_date = $10)
            or ($5 = 'tomorrow' and next_follow_up_date = $10 + 1)
          )
          and ($6 = 'all' or source = $6)
          and ($7 = 'all' or phone_timezone_bucket = $7)
          and ($8 = 'all' or ($8 = 'unassigned' and owner_member_id is null) or owner_member_id::text = $8)
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
            or role ilike ('%%' || $9 || '%%')
          )
          %s
        order by %I %s nulls %s, id %s
        limit $13 offset $14
      ) page_rows
    $sql$,
    cursor_predicate,
    sort_column,
    order_direction,
    nulls_direction,
    order_direction
  )
  into rows_json, fetched_count
  using
    target_workspace_id,
    normalized_scope,
    actor_member_id,
    normalized_status,
    normalized_date,
    normalized_source,
    normalized_timezone,
    normalized_owner,
    normalized_search,
    coalesce(p_today, current_date),
    p_cursor_sort_value,
    p_cursor_id,
    normalized_page_size + 1,
    offset_count;

  return jsonb_build_object(
    'rows', rows_json,
    'page', normalized_page,
    'pageSize', normalized_page_size,
    'hasMore', fetched_count > normalized_page_size,
    'cursorApplied', cursor_applied,
    'cursorDirection', normalized_cursor_direction
  );
end;
$$;

revoke all on function public.get_leads_cursor_page(text, text, text, text, text, text, text, integer, integer, text, text, text, uuid, text, date) from public;
grant execute on function public.get_leads_cursor_page(text, text, text, text, text, text, text, integer, integer, text, text, text, uuid, text, date) to authenticated;

commit;
