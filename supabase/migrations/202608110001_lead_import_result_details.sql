begin;

alter table public.lead_import_changes
  add column if not exists reason_code text not null default '',
  add column if not exists lead_name text not null default '',
  add column if not exists owner_member_id uuid references public.team_members(id) on delete set null,
  add column if not exists owner_name text not null default '';

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
