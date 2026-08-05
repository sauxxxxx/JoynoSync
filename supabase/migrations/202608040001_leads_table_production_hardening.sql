begin;

create extension if not exists pg_trgm with schema extensions;

alter table public.leads
add column if not exists interest_sort_key text
generated always as (left(coalesce(interest, ''), 256)) stored;

create index if not exists leads_active_name_page_v2_idx
on public.leads (workspace_id, name, id)
where archived_at is null and status <> 'Archived' and active_pool = true;

create index if not exists leads_active_updated_page_v2_idx
on public.leads (workspace_id, updated_at, id)
where archived_at is null and status <> 'Archived' and active_pool = true;

create index if not exists leads_active_phone_page_idx
on public.leads (workspace_id, phone, id)
where archived_at is null and status <> 'Archived' and active_pool = true;

create index if not exists leads_active_timezone_page_idx
on public.leads (workspace_id, phone_timezone_bucket, id)
where archived_at is null and status <> 'Archived' and active_pool = true;

create index if not exists leads_active_interest_page_idx
on public.leads (workspace_id, interest_sort_key, id)
where archived_at is null and status <> 'Archived' and active_pool = true;

create index if not exists leads_active_status_page_idx
on public.leads (workspace_id, status, id)
where archived_at is null and status <> 'Archived' and active_pool = true;

create index if not exists leads_active_follow_up_page_idx
on public.leads (workspace_id, next_follow_up_date, id)
where archived_at is null and status <> 'Archived' and active_pool = true;

create index if not exists leads_active_owner_page_idx
on public.leads (workspace_id, owner_member_id, id)
where archived_at is null and status <> 'Archived' and active_pool = true;

create index if not exists leads_name_search_idx on public.leads using gin (name extensions.gin_trgm_ops);
create index if not exists leads_company_search_idx on public.leads using gin (company_name extensions.gin_trgm_ops);
create index if not exists leads_email_search_idx on public.leads using gin (email extensions.gin_trgm_ops);
create index if not exists leads_phone_search_idx on public.leads using gin (phone extensions.gin_trgm_ops);
create index if not exists leads_secondary_phone_search_idx on public.leads using gin (secondary_phone extensions.gin_trgm_ops);
create index if not exists leads_timezone_search_idx on public.leads using gin (phone_timezone_bucket extensions.gin_trgm_ops);
create index if not exists leads_interest_search_idx on public.leads using gin (interest extensions.gin_trgm_ops);
create index if not exists leads_source_search_idx on public.leads using gin (source extensions.gin_trgm_ops);
create index if not exists leads_status_search_idx on public.leads using gin (status extensions.gin_trgm_ops);
create index if not exists leads_role_search_idx on public.leads using gin (role extensions.gin_trgm_ops);

create or replace function public.get_leads_page_meta(
  p_scope text default 'all',
  p_current_user_id uuid default null,
  p_status_filter text default 'all',
  p_date_filter text default 'all',
  p_source_filter text default 'all',
  p_timezone_filter text default 'all',
  p_owner_filter text default 'all',
  p_search_term text default '',
  p_today date default current_date,
  p_include_reserve boolean default false
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
  result jsonb;
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
  normalized_date := case
    when normalized_date in ('all', 'overdue', 'today', 'tomorrow', 'not-set') then normalized_date
    else 'all'
  end;

  with base as (
    select l.*
    from public.leads l
    where l.workspace_id = target_workspace_id
      and l.archived_at is null
      and l.status <> 'Archived'
      and l.active_pool = true
  ), owned as (
    select b.*
    from base b
    where (
      normalized_scope = 'all'
      or (normalized_scope = 'mine' and b.owner_member_id = p_current_user_id)
      or (normalized_scope = 'unassigned' and b.owner_member_id is null)
      or (normalized_scope = 'assigned' and b.owner_member_id is not null)
    )
      and (
        normalized_owner = 'all'
        or (normalized_owner = 'unassigned' and b.owner_member_id is null)
        or b.owner_member_id::text = normalized_owner
      )
  ), filtered as (
    select o.*
    from owned o
    where (normalized_status = 'all' or o.status = normalized_status)
      and (normalized_source = 'all' or o.source = normalized_source)
      and (normalized_timezone = 'all' or o.phone_timezone_bucket = normalized_timezone)
      and (
        normalized_date = 'all'
        or (normalized_date = 'not-set' and o.next_follow_up_date is null)
        or (normalized_date = 'overdue' and o.next_follow_up_date < p_today)
        or (normalized_date = 'today' and o.next_follow_up_date = p_today)
        or (normalized_date = 'tomorrow' and o.next_follow_up_date = p_today + 1)
      )
      and (
        normalized_search = ''
        or o.name ilike ('%' || normalized_search || '%')
        or o.company_name ilike ('%' || normalized_search || '%')
        or o.email ilike ('%' || normalized_search || '%')
        or o.phone ilike ('%' || normalized_search || '%')
        or o.secondary_phone ilike ('%' || normalized_search || '%')
        or o.phone_timezone_bucket ilike ('%' || normalized_search || '%')
        or o.interest ilike ('%' || normalized_search || '%')
        or o.source ilike ('%' || normalized_search || '%')
        or o.status ilike ('%' || normalized_search || '%')
        or o.role ilike ('%' || normalized_search || '%')
      )
  ), sources as (
    select distinct o.source
    from owned o
    where nullif(trim(coalesce(o.source, '')), '') is not null
    order by o.source
  ), waiting as (
    select o.id, o.name, o.company_name, o.owner_member_id, o.next_follow_up_date
    from owned o
    where o.next_follow_up_date is not null
    order by o.next_follow_up_date asc, o.id asc
    limit 24
  )
  select jsonb_build_object(
    'totalCount', (select count(*) from filtered),
    'scopeCounts', jsonb_build_object(
      'all', (select count(*) from base b where normalized_owner = 'all' or (normalized_owner = 'unassigned' and b.owner_member_id is null) or b.owner_member_id::text = normalized_owner),
      'mine', (select count(*) from base b where b.owner_member_id = p_current_user_id and (normalized_owner = 'all' or b.owner_member_id::text = normalized_owner)),
      'unassigned', (select count(*) from base b where b.owner_member_id is null and normalized_owner in ('all', 'unassigned')),
      'assigned', (select count(*) from base b where b.owner_member_id is not null and (normalized_owner = 'all' or b.owner_member_id::text = normalized_owner))
    ),
    'reserveCount', case when p_include_reserve then (
      select count(*) from public.leads l
      where l.workspace_id = target_workspace_id and l.active_pool = false
        and l.owner_member_id is null and l.archived_at is null and l.status <> 'Archived'
    ) else 0 end,
    'sources', coalesce((select jsonb_agg(s.source order by s.source) from sources s), '[]'::jsonb),
    'waitingItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id,
        'name', w.name,
        'companyName', w.company_name,
        'ownerMemberId', w.owner_member_id,
        'nextFollowUp', w.next_follow_up_date
      ) order by w.next_follow_up_date, w.id)
      from waiting w
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_leads_page_meta(text, uuid, text, text, text, text, text, text, date, boolean) from public;
grant execute on function public.get_leads_page_meta(text, uuid, text, text, text, text, text, text, date, boolean) to authenticated;

commit;
