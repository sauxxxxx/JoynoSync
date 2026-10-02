begin;

create index if not exists leads_workspace_archived_at_idx
on public.leads (workspace_id, archived_at desc, id)
where archived_at is not null;

create or replace function public.get_archived_leads_page(
  p_page integer default 1,
  p_page_size integer default 25,
  p_status_filter text default 'all',
  p_search_term text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  normalized_page integer := greatest(1, coalesce(p_page, 1));
  normalized_page_size integer := least(100, greatest(1, coalesce(p_page_size, 25)));
  normalized_status text := trim(coalesce(p_status_filter, 'all'));
  normalized_search text := trim(coalesce(p_search_term, ''));
  total_count integer := 0;
  rows_json jsonb := '[]'::jsonb;
begin
  target_workspace_id := private.current_workspace_id();
  perform private.require_active_workspace_member(target_workspace_id);

  if not private.can_manage_workspace(target_workspace_id) then
    raise exception 'Only workspace owners and admins can manage archived leads.' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into total_count
  from public.leads lead
  where lead.workspace_id = target_workspace_id
    and lead.archived_at is not null
    and (normalized_status = 'all' or lead.status = normalized_status)
    and (
      normalized_search = ''
      or lead.name ilike ('%' || normalized_search || '%')
      or lead.company_name ilike ('%' || normalized_search || '%')
      or lead.email ilike ('%' || normalized_search || '%')
      or lead.phone ilike ('%' || normalized_search || '%')
      or lead.source ilike ('%' || normalized_search || '%')
      or lead.status ilike ('%' || normalized_search || '%')
    );

  select coalesce(jsonb_agg(to_jsonb(page_rows)), '[]'::jsonb)
  into rows_json
  from (
    select
      lead.id,
      lead.workspace_id,
      lead.name,
      lead.company_name,
      lead.email,
      lead.phone,
      lead.source,
      lead.status,
      lead.owner_member_id,
      owner.name as owner_name,
      lead.created_at,
      lead.updated_at,
      lead.archived_at,
      lead.active_pool
    from public.leads lead
    left join public.team_members owner on owner.id = lead.owner_member_id
    where lead.workspace_id = target_workspace_id
      and lead.archived_at is not null
      and (normalized_status = 'all' or lead.status = normalized_status)
      and (
        normalized_search = ''
        or lead.name ilike ('%' || normalized_search || '%')
        or lead.company_name ilike ('%' || normalized_search || '%')
        or lead.email ilike ('%' || normalized_search || '%')
        or lead.phone ilike ('%' || normalized_search || '%')
        or lead.source ilike ('%' || normalized_search || '%')
        or lead.status ilike ('%' || normalized_search || '%')
      )
    order by lead.archived_at desc, lead.id
    limit normalized_page_size
    offset (normalized_page - 1) * normalized_page_size
  ) page_rows;

  return jsonb_build_object(
    'rows', rows_json,
    'totalCount', total_count,
    'page', normalized_page,
    'pageSize', normalized_page_size,
    'hasMore', normalized_page * normalized_page_size < total_count
  );
end;
$$;

create or replace function public.restore_archived_lead(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  restored_lead public.leads%rowtype;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if not private.can_manage_workspace(target_workspace_id) then
    raise exception 'Only workspace owners and admins can restore archived leads.' using errcode = 'P0001';
  end if;

  update public.leads
  set
    archived_at = null,
    active_pool = true,
    updated_by_member_id = actor_member_id
  where id = p_lead_id
    and workspace_id = target_workspace_id
    and archived_at is not null
  returning * into restored_lead;

  if restored_lead.id is null then
    raise exception 'Archived lead not found.' using errcode = 'P0001';
  end if;

  return jsonb_build_object('id', restored_lead.id, 'name', restored_lead.name);
end;
$$;

create or replace function public.permanently_delete_archived_lead(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  deleted_lead public.leads%rowtype;
begin
  target_workspace_id := private.current_workspace_id();
  perform private.require_active_workspace_member(target_workspace_id);

  if not private.can_manage_workspace(target_workspace_id) then
    raise exception 'Only workspace owners and admins can permanently delete archived leads.' using errcode = 'P0001';
  end if;

  delete from public.leads
  where id = p_lead_id
    and workspace_id = target_workspace_id
    and archived_at is not null
  returning * into deleted_lead;

  if deleted_lead.id is null then
    raise exception 'Archived lead not found.' using errcode = 'P0001';
  end if;

  return jsonb_build_object('id', deleted_lead.id, 'name', deleted_lead.name);
end;
$$;

revoke all on function public.get_archived_leads_page(integer, integer, text, text) from public;
revoke all on function public.restore_archived_lead(uuid) from public;
revoke all on function public.permanently_delete_archived_lead(uuid) from public;

grant execute on function public.get_archived_leads_page(integer, integer, text, text) to authenticated;
grant execute on function public.restore_archived_lead(uuid) to authenticated;
grant execute on function public.permanently_delete_archived_lead(uuid) to authenticated;

commit;
