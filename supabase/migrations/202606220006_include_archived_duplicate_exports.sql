begin;

create or replace function public.get_lead_export_rows(
  p_export_type text,
  p_scope text default 'new',
  p_date_from date default null,
  p_date_to date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  normalized_type text := private.normalize_lead_export_type(p_export_type);
  normalized_scope text := private.normalize_lead_export_scope(p_scope);
  rows_json jsonb := '[]'::jsonb;
  last_batch jsonb := null;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if not private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'view') then
    raise exception 'You do not have permission to export leads.' using errcode = 'P0001';
  end if;

  if normalized_type = 'unqualified' then
    with candidate_rows as (
      select
        l.id,
        l.id::text as export_key,
        l.name,
        l.company_name,
        l.email,
        l.phone,
        l.secondary_phone,
        l.source,
        l.status,
        l.interest,
        l.created_at,
        l.updated_at,
        tm.name as owner
      from public.leads l
      left join public.team_members tm on tm.id = l.owner_member_id
      where l.workspace_id = target_workspace_id
        and l.archived_at is null
        and l.status = 'Unqualified'
        and (
          normalized_scope <> 'date-range'
          or (
            coalesce(l.updated_at::date, l.created_at::date) >= coalesce(p_date_from, coalesce(l.updated_at::date, l.created_at::date))
            and coalesce(l.updated_at::date, l.created_at::date) <= coalesce(p_date_to, coalesce(l.updated_at::date, l.created_at::date))
          )
        )
    )
    select coalesce(jsonb_agg(to_jsonb(candidate_rows) order by updated_at desc nulls last), '[]'::jsonb)
    into rows_json
    from candidate_rows
    where normalized_scope <> 'new'
       or not exists (
        select 1
        from public.lead_export_items item
        where item.workspace_id = target_workspace_id
          and item.export_type = normalized_type
          and item.export_key = candidate_rows.export_key
      );
  else
    with normalized_leads as (
      select
        l.*,
        nullif(lower(trim(l.email)), '') as email_key,
        nullif(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), '') as phone_key,
        tm.name as owner
      from public.leads l
      left join public.team_members tm on tm.id = l.owner_member_id
      where l.workspace_id = target_workspace_id
    ),
    duplicate_keys as (
      select 'email:' || email_key as group_key
      from normalized_leads
      where email_key is not null
      group by email_key
      having count(*) > 1
      union
      select 'phone:' || phone_key as group_key
      from normalized_leads
      where phone_key is not null
      group by phone_key
      having count(*) > 1
    ),
    candidate_rows as (
      select distinct on (nl.id)
        nl.id,
        nl.id::text as export_key,
        nl.name,
        nl.company_name,
        nl.email,
        nl.phone,
        nl.secondary_phone,
        nl.source,
        nl.status,
        nl.interest,
        nl.created_at,
        nl.updated_at,
        nl.owner,
        coalesce('email:' || nl.email_key, 'phone:' || nl.phone_key) as duplicate_group
      from normalized_leads nl
      join duplicate_keys dk
        on dk.group_key = 'email:' || nl.email_key
        or dk.group_key = 'phone:' || nl.phone_key
      where normalized_scope <> 'date-range'
         or (
          nl.created_at::date >= coalesce(p_date_from, nl.created_at::date)
          and nl.created_at::date <= coalesce(p_date_to, nl.created_at::date)
        )
      order by nl.id, nl.updated_at desc nulls last
    )
    select coalesce(jsonb_agg(to_jsonb(candidate_rows) order by updated_at desc nulls last), '[]'::jsonb)
    into rows_json
    from candidate_rows
    where normalized_scope <> 'new'
       or not exists (
        select 1
        from public.lead_export_items item
        where item.workspace_id = target_workspace_id
          and item.export_type = normalized_type
          and item.export_key = candidate_rows.export_key
      );
  end if;

  select to_jsonb(batch)
  into last_batch
  from (
    select id, export_type, scope, date_from, date_to, exported_count, created_at
    from public.lead_export_batches
    where workspace_id = target_workspace_id
      and export_type = normalized_type
    order by created_at desc
    limit 1
  ) batch;

  return jsonb_build_object('rows', rows_json, 'lastBatch', last_batch);
end;
$$;

revoke all on function public.get_lead_export_rows(text, text, date, date) from public;
grant execute on function public.get_lead_export_rows(text, text, date, date) to authenticated;

commit;
