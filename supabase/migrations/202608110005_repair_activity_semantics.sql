begin;

-- A status repair is administrative history, not a customer interaction.
-- Restore the pre-repair status metadata, retain the audit marker, and derive
-- Last Activity / progress only from genuine sales-touch evidence.
delete from public.lead_status_events status_event
using public.lead_status_repair_backups backup
where status_event.workspace_id = backup.workspace_id
  and status_event.lead_id = backup.lead_id
  and status_event.from_status = 'New'
  and status_event.to_status = backup.repaired_status
  and lower(coalesce(status_event.meta ->> 'source', '')) = 'lead-status-trigger'
  and status_event.occurred_at between backup.repaired_at - interval '1 second'
                                   and backup.repaired_at + interval '1 second';

with repair_evidence as (
  select
    lead.id as lead_id,
    backup.lead_snapshot -> 'meta' as snapshot_meta,
    case
      when coalesce(backup.lead_snapshot ->> 'updated_by_member_id', '')
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (backup.lead_snapshot ->> 'updated_by_member_id')::uuid
      else lead.updated_by_member_id
    end as snapshot_updated_by_member_id,
    greatest(
      lead.last_touch_at,
      case
        when coalesce(backup.lead_snapshot ->> 'last_touch_at', '') ~ '^\d{4}-\d{2}-\d{2}'
          then (backup.lead_snapshot ->> 'last_touch_at')::timestamptz
        else null
      end,
      (
        select max(event.created_at)
        from public.lead_activity_events event
        where event.workspace_id = lead.workspace_id
          and event.lead_id = lead.id
          and event.is_sales_touch
      ),
      (
        select max(coalesce(call_log.ended_at, call_log.answered_at, call_log.started_at, call_log.created_at))
        from public.call_logs call_log
        where call_log.workspace_id = lead.workspace_id
          and lower(call_log.linked_entity_type) = 'lead'
          and call_log.linked_entity_id = lead.id::text
          and (
            call_log.outcome_submitted_at is not null
            or trim(coalesce(call_log.disposition, '')) <> ''
          )
      )
    ) as genuine_last_touch_at,
    least(3, greatest(
      case
        when coalesce(lead.meta ->> 'attemptCount', '') ~ '^\d+$'
          then (lead.meta ->> 'attemptCount')::integer
        else 0
      end,
      case
        when jsonb_typeof(lead.meta -> 'attemptHistory') = 'array'
          then jsonb_array_length(lead.meta -> 'attemptHistory')
        else 0
      end,
      (
        select count(*)::integer
        from public.call_logs call_log
        where call_log.workspace_id = lead.workspace_id
          and lower(call_log.linked_entity_type) = 'lead'
          and call_log.linked_entity_id = lead.id::text
          and (
            call_log.outcome_submitted_at is not null
            or trim(coalesce(call_log.disposition, '')) <> ''
          )
      ),
      (
        select count(*)::integer
        from public.lead_activity_events event
        where event.workspace_id = lead.workspace_id
          and event.lead_id = lead.id
          and event.is_sales_touch
      )
    )) as evidence_attempt_count
  from public.lead_status_repair_backups backup
  join public.leads lead
    on lead.workspace_id = backup.workspace_id
   and lead.id = backup.lead_id
  where lead.status = backup.repaired_status
    and lead.meta ->> 'statusRepairImportJobId' = backup.import_job_id::text
)
update public.leads lead
set
  last_touch_at = evidence.genuine_last_touch_at,
  meta = (
    coalesce(lead.meta, '{}'::jsonb)
      - 'lastStatusChangedAt'
      - 'lastStatusChangedByMemberId'
      - 'lastStatusChangedByName'
      - 'lastStatusChangedFrom'
      - 'lastStatusChangedTo'
  ) || jsonb_strip_nulls(jsonb_build_object(
    'lastStatusChangedAt', evidence.snapshot_meta -> 'lastStatusChangedAt',
    'lastStatusChangedByMemberId', evidence.snapshot_meta -> 'lastStatusChangedByMemberId',
    'lastStatusChangedByName', evidence.snapshot_meta -> 'lastStatusChangedByName',
    'lastStatusChangedFrom', evidence.snapshot_meta -> 'lastStatusChangedFrom',
    'lastStatusChangedTo', evidence.snapshot_meta -> 'lastStatusChangedTo',
    'attemptCount', evidence.evidence_attempt_count
  )),
  updated_by_member_id = evidence.snapshot_updated_by_member_id
from repair_evidence evidence
where lead.id = evidence.lead_id;

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
    when 'lasttouch' then 'last_activity_sort_at'
    when 'nextfollowup' then 'next_follow_up_date'
    else 'last_activity_sort_at'
  end;
  sort_type := case sort_column
    when 'owner_member_id' then 'uuid'
    when 'last_activity_sort_at' then 'timestamptz'
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
      'and ((%1$I %2$s $11::%3$s) or (%1$I = $11::%3$s and id %2$s $12))',
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
          source, status, owner_member_id, next_follow_up_date, last_touch_at,
          last_activity_sort_at, created_at, updated_at, archived_at, active_pool,
          jsonb_strip_nulls(jsonb_build_object(
            'attemptCount', meta -> 'attemptCount',
            'lastAttemptAt', meta -> 'lastAttemptAt',
            'lastAttemptReason', meta -> 'lastAttemptReason',
            'assignedAt', meta -> 'assignedAt',
            'attemptHistory', meta -> 'attemptHistory'
          )) as meta
        from (
          select
            lead.*,
            coalesce(lead.last_touch_at, timestamptz '0001-01-01 00:00:00+00') as last_activity_sort_at
          from public.leads lead
        ) lead_pool
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
