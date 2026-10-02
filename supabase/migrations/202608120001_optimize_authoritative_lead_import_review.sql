begin;

create or replace function public.review_lead_import_matches(
  p_import_mode text,
  p_rows jsonb
)
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
    raise exception 'Only owners or admins can review lead imports.' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Import rows must be an array.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 500 then
    raise exception 'Import review batches are limited to 500 rows.' using errcode = '22023';
  end if;

  with input_rows as materialized (
    select
      coalesce((item ->> 'rowNumber')::integer, 0) as row_number,
      lower(trim(coalesce(item ->> 'email', ''))) as email_match,
      regexp_replace(coalesce(item ->> 'phone', ''), '\D', '', 'g') as phone_match,
      regexp_replace(coalesce(item ->> 'secondaryPhone', ''), '\D', '', 'g') as secondary_phone_match,
      lower(regexp_replace(trim(coalesce(item ->> 'name', '')), '\s+', ' ', 'g')) as name_match,
      lower(regexp_replace(trim(coalesce(item ->> 'company', '')), '\s+', ' ', 'g')) as company_match,
      coalesce(item ->> 'leadId', '') as exported_lead_id,
      coalesce(item ->> 'updatedAt', '') as exported_version
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) item
  ), candidates as (
    select input.row_number, input.exported_version, lead.id, lead.name, lead.owner_member_id,
      lead.updated_at, lead.archived_at, 'lead_id'::text as match_reason, 0 as priority
    from input_rows input
    join public.leads lead
      on p_import_mode = 'update-exported'
     and input.exported_lead_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and lead.workspace_id = target_workspace_id
     and lead.id = case
       when input.exported_lead_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         then input.exported_lead_id::uuid
       else null
     end
    union all
    select input.row_number, input.exported_version, lead.id, lead.name, lead.owner_member_id,
      lead.updated_at, lead.archived_at, 'email'::text, 1
    from input_rows input
    join public.leads lead
      on p_import_mode <> 'update-exported'
     and input.email_match <> ''
     and lead.workspace_id = target_workspace_id
     and lower(lead.email) = input.email_match
    union all
    select input.row_number, input.exported_version, lead.id, lead.name, lead.owner_member_id,
      lead.updated_at, lead.archived_at, 'phone'::text, 2
    from input_rows input
    join public.leads lead
      on p_import_mode <> 'update-exported'
     and input.phone_match <> ''
     and lead.workspace_id = target_workspace_id
     and lead.phone_digits = input.phone_match
    union all
    select input.row_number, input.exported_version, lead.id, lead.name, lead.owner_member_id,
      lead.updated_at, lead.archived_at, 'phone'::text, 2
    from input_rows input
    join public.leads lead
      on p_import_mode <> 'update-exported'
     and input.phone_match <> ''
     and lead.workspace_id = target_workspace_id
     and lead.secondary_phone_digits = input.phone_match
    union all
    select input.row_number, input.exported_version, lead.id, lead.name, lead.owner_member_id,
      lead.updated_at, lead.archived_at, 'secondary_phone'::text, 3
    from input_rows input
    join public.leads lead
      on p_import_mode <> 'update-exported'
     and input.secondary_phone_match <> ''
     and lead.workspace_id = target_workspace_id
     and lead.phone_digits = input.secondary_phone_match
    union all
    select input.row_number, input.exported_version, lead.id, lead.name, lead.owner_member_id,
      lead.updated_at, lead.archived_at, 'secondary_phone'::text, 3
    from input_rows input
    join public.leads lead
      on p_import_mode <> 'update-exported'
     and input.secondary_phone_match <> ''
     and lead.workspace_id = target_workspace_id
     and lead.secondary_phone_digits = input.secondary_phone_match
    union all
    select input.row_number, input.exported_version, lead.id, lead.name, lead.owner_member_id,
      lead.updated_at, lead.archived_at, 'name_company'::text, 4
    from input_rows input
    join public.leads lead
      on p_import_mode <> 'update-exported'
     and input.name_match <> ''
     and input.company_match <> ''
     and lead.workspace_id = target_workspace_id
     and lead.name_match = input.name_match
     and lead.company_match = input.company_match
  ), best_matches as (
    select distinct on (row_number)
      row_number, exported_version, id, name, owner_member_id, updated_at, archived_at, match_reason
    from candidates
    order by row_number, priority, updated_at desc, id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'rowNumber', row_number,
    'leadId', id,
    'leadName', coalesce(name, ''),
    'ownerMemberId', owner_member_id,
    'updatedAt', updated_at,
    'archived', archived_at is not null,
    'matchReason', match_reason,
    'versionMatches', case
      when p_import_mode <> 'update-exported' then true
      when exported_version = '' then false
      when exported_version ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$'
        then updated_at = exported_version::timestamptz
      else false
    end
  ) order by row_number), '[]'::jsonb)
  into result_rows
  from best_matches;

  return jsonb_build_object('rows', result_rows);
end;
$$;

revoke all on function public.review_lead_import_matches(text, jsonb) from public;
grant execute on function public.review_lead_import_matches(text, jsonb) to authenticated;

commit;
