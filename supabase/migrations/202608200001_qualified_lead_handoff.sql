begin;

create or replace function public.qualify_and_handoff_leads(
  p_lead_ids uuid[],
  p_destination_owner_member_id uuid,
  p_allow_duplicates boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  actor_name text;
  destination_name text;
  normalized_lead_ids uuid[];
  selected_count integer := 0;
  updated_count integer := 0;
  changed_at timestamptz := timezone('utc', now());
  duplicate_rows jsonb := '[]'::jsonb;
  updated_lead_ids jsonb := '[]'::jsonb;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  select array_agg(distinct lead_id)
  into normalized_lead_ids
  from unnest(coalesce(p_lead_ids, '{}'::uuid[])) as lead_id
  where lead_id is not null;

  if coalesce(array_length(normalized_lead_ids, 1), 0) = 0 then
    raise exception 'Select at least one lead.' using errcode = 'P0001';
  end if;
  if p_destination_owner_member_id is null then
    raise exception 'Choose the qualified lead owner.' using errcode = 'P0001';
  end if;

  select name into actor_name
  from public.team_members
  where id = actor_member_id and workspace_id = target_workspace_id;

  select name into destination_name
  from public.team_members
  where id = p_destination_owner_member_id
    and workspace_id = target_workspace_id
    and lower(coalesce(status, '')) = 'active';
  if destination_name is null then
    raise exception 'The qualified lead owner is not active in this workspace.' using errcode = 'P0001';
  end if;

  select count(*) into selected_count
  from public.leads lead
  where lead.workspace_id = target_workspace_id
    and lead.id = any(normalized_lead_ids)
    and lead.archived_at is null
    and coalesce(lead.status, '') <> 'Archived';
  if selected_count <> array_length(normalized_lead_ids, 1) then
    raise exception 'One or more selected leads are unavailable.' using errcode = 'P0001';
  end if;

  if not private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'edit')
     and exists (
       select 1
       from public.leads lead
       where lead.workspace_id = target_workspace_id
         and lead.id = any(normalized_lead_ids)
         and lead.owner_member_id is distinct from actor_member_id
     ) then
    raise exception 'You can only qualify leads assigned to you.' using errcode = 'P0001';
  end if;

  with candidate_matches as (
    select
      source.id as lead_id,
      source.name as lead_name,
      candidate.id as duplicate_lead_id,
      candidate.name as duplicate_lead_name,
      candidate.status,
      candidate.owner_member_id,
      candidate.active_pool,
      candidate.archived_at,
      case
        when coalesce(source.email, '') <> '' and lower(source.email) = lower(candidate.email) then 'email'
        when coalesce(source.phone_digits, '') <> '' and source.phone_digits in (candidate.phone_digits, candidate.secondary_phone_digits) then 'phone'
        when coalesce(source.secondary_phone_digits, '') <> '' and source.secondary_phone_digits in (candidate.phone_digits, candidate.secondary_phone_digits) then 'secondary_phone'
        else 'name_company'
      end as match_reason
    from public.leads source
    join public.leads candidate
      on candidate.workspace_id = source.workspace_id
     and candidate.id <> source.id
     and (
       (coalesce(source.email, '') <> '' and lower(source.email) = lower(candidate.email))
       or (
         coalesce(source.phone_digits, '') <> ''
         and source.phone_digits in (candidate.phone_digits, candidate.secondary_phone_digits)
       )
       or (
         coalesce(source.secondary_phone_digits, '') <> ''
         and source.secondary_phone_digits in (candidate.phone_digits, candidate.secondary_phone_digits)
       )
       or (
         coalesce(source.name_match, '') <> ''
         and coalesce(source.company_match, '') <> ''
         and source.name_match = candidate.name_match
         and source.company_match = candidate.company_match
       )
     )
    where source.workspace_id = target_workspace_id
      and source.id = any(normalized_lead_ids)
  ), unique_matches as (
    select distinct on (lead_id, duplicate_lead_id) *
    from candidate_matches
    order by lead_id, duplicate_lead_id,
      case match_reason when 'email' then 0 when 'phone' then 1 when 'secondary_phone' then 2 else 3 end
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'leadId', match.lead_id,
    'leadName', coalesce(match.lead_name, ''),
    'duplicateLeadId', match.duplicate_lead_id,
    'duplicateLeadName', coalesce(match.duplicate_lead_name, ''),
    'status', coalesce(match.status, ''),
    'ownerMemberId', match.owner_member_id,
    'ownerName', coalesce(owner.name, ''),
    'activePool', coalesce(match.active_pool, false),
    'archived', match.archived_at is not null or match.status = 'Archived',
    'matchReason', match.match_reason
  ) order by match.lead_name, match.duplicate_lead_name), '[]'::jsonb)
  into duplicate_rows
  from unique_matches match
  left join public.team_members owner
    on owner.id = match.owner_member_id and owner.workspace_id = target_workspace_id;

  if jsonb_array_length(duplicate_rows) > 0 and not coalesce(p_allow_duplicates, false) then
    return jsonb_build_object(
      'qualified', false,
      'requiresDuplicateConfirmation', true,
      'duplicates', duplicate_rows,
      'selectedCount', selected_count,
      'destinationOwnerMemberId', p_destination_owner_member_id,
      'destinationOwnerName', destination_name
    );
  end if;

  with updated as (
    update public.leads lead
    set
      status = 'Qualified',
      owner_member_id = p_destination_owner_member_id,
      active_pool = true,
      meta = coalesce(lead.meta, '{}'::jsonb) || jsonb_build_object(
        'qualificationHandoffHistory',
          coalesce(
            case when jsonb_typeof(lead.meta -> 'qualificationHandoffHistory') = 'array'
              then lead.meta -> 'qualificationHandoffHistory' end,
            '[]'::jsonb
          ) || jsonb_build_array(jsonb_build_object(
            'qualifiedAt', changed_at,
            'qualifiedByMemberId', actor_member_id,
            'qualifiedByName', coalesce(actor_name, ''),
            'previousOwnerMemberId', lead.owner_member_id,
            'previousStatus', coalesce(lead.status, ''),
            'destinationOwnerMemberId', p_destination_owner_member_id,
            'destinationOwnerName', destination_name,
            'duplicateCount', jsonb_array_length(duplicate_rows),
            'duplicatesConfirmed', coalesce(p_allow_duplicates, false)
          )),
        'qualifiedAt', changed_at,
        'qualifiedByMemberId', actor_member_id,
        'qualifiedByName', coalesce(actor_name, ''),
        'qualifiedOwnerMemberId', p_destination_owner_member_id,
        'lastStatusChangedAt', changed_at,
        'lastStatusChangedByMemberId', actor_member_id,
        'lastStatusChangedByName', coalesce(actor_name, ''),
        'lastStatusChangedFrom', coalesce(lead.status, ''),
        'lastStatusChangedTo', 'Qualified'
      ),
      updated_by_member_id = actor_member_id
    where lead.workspace_id = target_workspace_id
      and lead.id = any(normalized_lead_ids)
    returning lead.id
  )
  select count(*), coalesce(jsonb_agg(id), '[]'::jsonb)
  into updated_count, updated_lead_ids
  from updated;

  return jsonb_build_object(
    'qualified', true,
    'requiresDuplicateConfirmation', false,
    'updatedCount', updated_count,
    'updatedLeadIds', updated_lead_ids,
    'duplicates', duplicate_rows,
    'destinationOwnerMemberId', p_destination_owner_member_id,
    'destinationOwnerName', destination_name
  );
end;
$$;

revoke all on function public.qualify_and_handoff_leads(uuid[], uuid, boolean) from public;
grant execute on function public.qualify_and_handoff_leads(uuid[], uuid, boolean) to authenticated;

commit;
