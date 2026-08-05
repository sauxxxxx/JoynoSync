begin;

alter table public.leads
  add column if not exists phone_digits text generated always as (regexp_replace(coalesce(phone, ''), '\D', '', 'g')) stored,
  add column if not exists secondary_phone_digits text generated always as (regexp_replace(coalesce(secondary_phone, ''), '\D', '', 'g')) stored,
  add column if not exists name_match text generated always as (lower(regexp_replace(trim(coalesce(name, '')), '\s+', ' ', 'g'))) stored,
  add column if not exists company_match text generated always as (lower(regexp_replace(trim(coalesce(company_name, '')), '\s+', ' ', 'g'))) stored;

create index if not exists leads_workspace_email_match_idx
  on public.leads (workspace_id, lower(email));
create index if not exists leads_workspace_phone_digits_idx
  on public.leads (workspace_id, phone_digits)
  where phone_digits <> '';
create index if not exists leads_workspace_secondary_phone_digits_idx
  on public.leads (workspace_id, secondary_phone_digits)
  where secondary_phone_digits <> '';
create index if not exists leads_workspace_name_company_match_idx
  on public.leads (workspace_id, name_match, company_match);
create unique index if not exists leads_workspace_import_key_idx
  on public.leads (workspace_id, (meta ->> 'importKey'))
  where nullif(meta ->> 'importKey', '') is not null;

alter table public.lead_import_jobs
  add column if not exists import_mode text not null default 'new',
  add column if not exists reset_blank_status boolean not null default false,
  add column if not exists restore_archived boolean not null default false,
  add column if not exists rolled_back_at timestamptz;

alter table public.lead_import_jobs
  drop constraint if exists lead_import_jobs_import_mode_check;
alter table public.lead_import_jobs
  add constraint lead_import_jobs_import_mode_check
  check (import_mode in ('new', 'update-exported'));

create table if not exists public.lead_import_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.lead_import_jobs(id) on delete cascade,
  row_number integer not null,
  operation text not null check (operation in ('created', 'updated', 'skipped')),
  lead_id uuid,
  before_data jsonb,
  reason text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  unique (job_id, row_number)
);

create index if not exists lead_import_changes_workspace_job_idx
  on public.lead_import_changes (workspace_id, job_id, row_number);

alter table public.lead_import_changes enable row level security;

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
    'reason', reason
  ) order by row_number), '[]'::jsonb)
  into result_rows
  from public.lead_import_changes
  where job_id = p_job_id and workspace_id = target_workspace_id;

  return jsonb_build_object('rows', result_rows);
end;
$$;

create or replace function public.rollback_lead_import_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  actor_role text;
  target_job public.lead_import_jobs%rowtype;
  change_row public.lead_import_changes%rowtype;
  restored_count integer := 0;
  removed_count integer := 0;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);
  select role into actor_role from public.team_members where id = actor_member_id;
  if actor_role not in ('Owner', 'Admin') then
    raise exception 'Only owners or admins can undo imports.' using errcode = 'P0001';
  end if;

  select * into target_job
  from public.lead_import_jobs
  where id = p_job_id and workspace_id = target_workspace_id
  for update;
  if target_job.id is null then
    raise exception 'Import job was not found.' using errcode = 'P0001';
  end if;
  if target_job.status <> 'completed' then
    raise exception 'Only completed imports can be undone.' using errcode = 'P0001';
  end if;
  if target_job.rolled_back_at is not null then
    raise exception 'This import has already been undone.' using errcode = 'P0001';
  end if;

  for change_row in
    select * from public.lead_import_changes
    where job_id = p_job_id and workspace_id = target_workspace_id
    order by row_number desc
  loop
    if change_row.operation = 'created' and change_row.lead_id is not null then
      delete from public.leads
      where id = change_row.lead_id and workspace_id = target_workspace_id;
      removed_count := removed_count + 1;
    elsif change_row.operation = 'updated' and change_row.lead_id is not null and change_row.before_data is not null then
      update public.leads set
        account_id = nullif(change_row.before_data ->> 'account_id', '')::uuid,
        name = coalesce(change_row.before_data ->> 'name', name),
        company_name = coalesce(change_row.before_data ->> 'company_name', ''),
        email = coalesce(change_row.before_data ->> 'email', ''),
        phone = coalesce(change_row.before_data ->> 'phone', ''),
        secondary_phone = coalesce(change_row.before_data ->> 'secondary_phone', ''),
        role = coalesce(change_row.before_data ->> 'role', ''),
        interest = coalesce(change_row.before_data ->> 'interest', ''),
        source = coalesce(change_row.before_data ->> 'source', ''),
        status = coalesce(change_row.before_data ->> 'status', 'New'),
        owner_member_id = nullif(change_row.before_data ->> 'owner_member_id', '')::uuid,
        next_follow_up_date = nullif(change_row.before_data ->> 'next_follow_up_date', '')::date,
        notes = coalesce(change_row.before_data ->> 'notes', ''),
        tags = coalesce(array(select jsonb_array_elements_text(change_row.before_data -> 'tags')), '{}'::text[]),
        meta = coalesce(change_row.before_data -> 'meta', '{}'::jsonb),
        active_pool = coalesce((change_row.before_data ->> 'active_pool')::boolean, false),
        archived_at = nullif(change_row.before_data ->> 'archived_at', '')::timestamptz
      where id = change_row.lead_id and workspace_id = target_workspace_id;
      restored_count := restored_count + 1;
    end if;
  end loop;

  update public.lead_import_jobs
  set rolled_back_at = timezone('utc', now())
  where id = p_job_id;

  return jsonb_build_object('ok', true, 'removed', removed_count, 'restored', restored_count);
end;
$$;

revoke all on function public.get_lead_import_results(uuid) from public;
revoke all on function public.rollback_lead_import_job(uuid) from public;
grant execute on function public.get_lead_import_results(uuid) to authenticated;
grant execute on function public.rollback_lead_import_job(uuid) to authenticated;

commit;
