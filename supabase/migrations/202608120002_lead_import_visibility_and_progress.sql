begin;

alter table public.lead_import_changes
  add column if not exists was_assigned boolean not null default false;

create or replace function public.get_lead_import_result_leads(
  p_job_id uuid,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  normalized_page integer := greatest(1, coalesce(p_page, 1));
  normalized_page_size integer := least(100, greatest(1, coalesce(p_page_size, 25)));
  offset_count integer;
  total_count integer := 0;
  result_rows jsonb := '[]'::jsonb;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if not private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'edit') then
    raise exception 'You do not have permission to review import results.' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
    from public.lead_import_jobs
    where id = p_job_id and workspace_id = target_workspace_id
  ) then
    raise exception 'Import job was not found.' using errcode = 'P0001';
  end if;

  offset_count := (normalized_page - 1) * normalized_page_size;

  with changed as (
    select distinct on (c.lead_id) c.lead_id, c.row_number
    from public.lead_import_changes c
    where c.workspace_id = target_workspace_id
      and c.job_id = p_job_id
      and c.operation in ('created', 'updated')
      and c.lead_id is not null
    order by c.lead_id, c.row_number
  )
  select count(*) into total_count from changed;

  with changed as (
    select distinct on (c.lead_id) c.lead_id, c.row_number
    from public.lead_import_changes c
    where c.workspace_id = target_workspace_id
      and c.job_id = p_job_id
      and c.operation in ('created', 'updated')
      and c.lead_id is not null
    order by c.lead_id, c.row_number
  ), page_rows as (
    select l.*, c.row_number as import_row_number
    from changed c
    join public.leads l on l.id = c.lead_id and l.workspace_id = target_workspace_id
    order by c.row_number
    limit normalized_page_size offset offset_count
  )
  select coalesce(jsonb_agg(to_jsonb(page_rows) order by import_row_number), '[]'::jsonb)
  into result_rows
  from page_rows;

  return jsonb_build_object(
    'rows', result_rows,
    'totalCount', total_count,
    'page', normalized_page,
    'pageSize', normalized_page_size,
    'hasMore', offset_count + normalized_page_size < total_count
  );
end;
$$;

revoke all on function public.get_lead_import_result_leads(uuid, integer, integer) from public;
grant execute on function public.get_lead_import_result_leads(uuid, integer, integer) to authenticated;

create or replace function public.record_lead_import_progress(
  p_job_id uuid,
  p_change jsonb,
  p_counts jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_workspace_id uuid;
begin
  select workspace_id into target_workspace_id
  from public.lead_import_jobs
  where id = p_job_id
  for update;

  if target_workspace_id is null then
    raise exception 'Import job was not found.' using errcode = 'P0001';
  end if;

  insert into public.lead_import_changes (
    workspace_id, job_id, row_number, operation, lead_id, before_data,
    reason, reason_code, lead_name, owner_member_id, owner_name, was_assigned
  ) values (
    target_workspace_id,
    p_job_id,
    coalesce((p_change ->> 'rowNumber')::integer, 0),
    coalesce(nullif(p_change ->> 'operation', ''), 'skipped'),
    nullif(p_change ->> 'leadId', '')::uuid,
    p_change -> 'beforeData',
    coalesce(p_change ->> 'reason', ''),
    coalesce(p_change ->> 'reasonCode', ''),
    coalesce(p_change ->> 'leadName', ''),
    nullif(p_change ->> 'ownerMemberId', '')::uuid,
    coalesce(p_change ->> 'ownerName', ''),
    coalesce((p_change ->> 'wasAssigned')::boolean, false)
  )
  on conflict (job_id, row_number) do update set
    operation = excluded.operation,
    lead_id = excluded.lead_id,
    before_data = excluded.before_data,
    reason = excluded.reason,
    reason_code = excluded.reason_code,
    lead_name = excluded.lead_name,
    owner_member_id = excluded.owner_member_id,
    owner_name = excluded.owner_name,
    was_assigned = excluded.was_assigned;

  update public.lead_import_jobs set
    status = 'processing',
    processed_count = coalesce((p_counts ->> 'processed')::integer, processed_count),
    created_count = coalesce((p_counts ->> 'created')::integer, created_count),
    updated_count = coalesce((p_counts ->> 'updated')::integer, updated_count),
    skipped_count = coalesce((p_counts ->> 'skipped')::integer, skipped_count),
    assigned_count = coalesce((p_counts ->> 'assigned')::integer, assigned_count),
    left_unassigned_count = coalesce((p_counts ->> 'leftUnassigned')::integer, left_unassigned_count),
    last_error = '',
    heartbeat_at = timezone('utc', now())
  where id = p_job_id;
end;
$$;

revoke all on function public.record_lead_import_progress(uuid, jsonb, jsonb) from public;
grant execute on function public.record_lead_import_progress(uuid, jsonb, jsonb) to service_role;

create or replace function public.get_lead_import_results(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  actor_role text;
  result_rows jsonb;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);
  select role into actor_role from public.team_members where id = actor_member_id;
  if actor_role not in ('Owner', 'Admin') then
    raise exception 'Only owners or admins can view import results.' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.lead_import_jobs
    where id = p_job_id and workspace_id = target_workspace_id
  ) then
    raise exception 'Import job was not found.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'rowNumber', row_number,
    'operation', operation,
    'leadId', lead_id,
    'leadName', lead_name,
    'ownerMemberId', owner_member_id,
    'ownerName', owner_name,
    'assigned', was_assigned,
    'reasonCode', reason_code,
    'reason', reason
  ) order by row_number), '[]'::jsonb)
  into result_rows
  from public.lead_import_changes
  where job_id = p_job_id and workspace_id = target_workspace_id;

  return jsonb_build_object('rows', result_rows);
end;
$$;

revoke all on function public.get_lead_import_results(uuid) from public;
grant execute on function public.get_lead_import_results(uuid) to authenticated;

commit;
