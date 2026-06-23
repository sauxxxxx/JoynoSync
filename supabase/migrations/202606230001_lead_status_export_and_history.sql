begin;

create table if not exists public.lead_status_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by_member_id uuid references public.team_members(id) on delete set null,
  changed_at timestamptz not null default timezone('utc', now())
);

create index if not exists lead_status_history_workspace_changed_idx
on public.lead_status_history (workspace_id, changed_at desc);

create index if not exists lead_status_history_lead_changed_idx
on public.lead_status_history (lead_id, changed_at desc);

alter table public.lead_status_history enable row level security;

drop policy if exists lead_status_history_no_direct_access on public.lead_status_history;
create policy lead_status_history_no_direct_access
on public.lead_status_history for all using (false) with check (false);

create or replace function public.record_lead_status_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.lead_status_history (
      workspace_id,
      lead_id,
      old_status,
      new_status,
      changed_by_member_id,
      changed_at
    )
    values (
      new.workspace_id,
      new.id,
      old.status,
      new.status,
      new.updated_by_member_id,
      timezone('utc', now())
    );
  end if;

  return new;
end;
$$;

drop trigger if exists record_lead_status_history on public.leads;
create trigger record_lead_status_history
after update of status on public.leads
for each row
execute function public.record_lead_status_history();

create or replace function private.normalize_lead_export_type(value text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(value, '')))
    when 'duplicates' then 'duplicates'
    when 'unqualified' then 'unqualified'
    when 'leads' then 'leads'
    else 'leads'
  end;
$$;

create or replace function private.normalize_lead_export_status(value text)
returns text
language sql
immutable
as $$
  select case trim(coalesce(value, ''))
    when 'New' then 'New'
    when 'Contacted' then 'Contacted'
    when 'Qualified' then 'Qualified'
    when 'Unqualified' then 'Unqualified'
    when 'Converted' then 'Converted'
    else 'all'
  end;
$$;

create or replace function public.get_lead_export_rows(
  p_export_type text,
  p_scope text default 'new',
  p_date_from date default null,
  p_date_to date default null,
  p_status text default 'all'
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
  normalized_status text := private.normalize_lead_export_status(p_status);
  rows_json jsonb := '[]'::jsonb;
  last_batch jsonb := null;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if not private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'view') then
    raise exception 'You do not have permission to export leads.' using errcode = 'P0001';
  end if;

  if normalized_type = 'duplicates' then
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
  else
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
        and (
          normalized_type <> 'unqualified'
          or l.status = 'Unqualified'
        )
        and (
          normalized_type <> 'leads'
          or normalized_status = 'all'
          or l.status = normalized_status
        )
        and (
          normalized_scope <> 'date-range'
          or (
            case
              when normalized_type = 'leads' then l.created_at::date
              else coalesce(l.updated_at::date, l.created_at::date)
            end >= coalesce(
              p_date_from,
              case
                when normalized_type = 'leads' then l.created_at::date
                else coalesce(l.updated_at::date, l.created_at::date)
              end
            )
            and case
              when normalized_type = 'leads' then l.created_at::date
              else coalesce(l.updated_at::date, l.created_at::date)
            end <= coalesce(
              p_date_to,
              case
                when normalized_type = 'leads' then l.created_at::date
                else coalesce(l.updated_at::date, l.created_at::date)
              end
            )
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

create or replace function public.record_lead_export(
  p_export_type text,
  p_scope text,
  p_date_from date default null,
  p_date_to date default null,
  p_items jsonb default '[]'::jsonb
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
  batch_id uuid;
  inserted_count integer := 0;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if not private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'view') then
    raise exception 'You do not have permission to export leads.' using errcode = 'P0001';
  end if;

  insert into public.lead_export_batches (workspace_id, exported_by_member_id, export_type, scope, date_from, date_to)
  values (target_workspace_id, actor_member_id, normalized_type, normalized_scope, p_date_from, p_date_to)
  returning id into batch_id;

  insert into public.lead_export_items (workspace_id, batch_id, export_type, export_key, lead_id)
  select
    target_workspace_id,
    batch_id,
    normalized_type,
    trim(item ->> 'exportKey'),
    nullif(trim(item ->> 'leadId'), '')::uuid
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
  where trim(item ->> 'exportKey') <> ''
  on conflict (workspace_id, export_type, export_key) do nothing;

  get diagnostics inserted_count = row_count;

  update public.lead_export_batches
  set exported_count = inserted_count
  where id = batch_id;

  return jsonb_build_object('batchId', batch_id, 'exportedCount', inserted_count);
end;
$$;

revoke all on table public.lead_status_history from public;
revoke all on function public.record_lead_status_history() from public;
revoke all on function public.get_lead_export_rows(text, text, date, date, text) from public;
revoke all on function public.record_lead_export(text, text, date, date, jsonb) from public;
grant execute on function public.get_lead_export_rows(text, text, date, date, text) to authenticated;
grant execute on function public.record_lead_export(text, text, date, date, jsonb) to authenticated;

commit;
