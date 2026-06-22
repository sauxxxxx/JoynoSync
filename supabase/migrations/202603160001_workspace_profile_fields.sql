begin;

alter table public.workspaces
  add column if not exists legal_name text not null default '',
  add column if not exists logo_url text not null default '',
  add column if not exists brand_color text not null default '#2f68df',
  add column if not exists app_label text not null default '',
  add column if not exists date_format text not null default 'YYYY-MM-DD',
  add column if not exists currency text not null default 'USD',
  add column if not exists week_start text not null default 'Mon',
  add column if not exists business_start text not null default '09:00',
  add column if not exists business_end text not null default '18:00',
  add column if not exists business_days integer[] not null default array[1, 2, 3, 4, 5],
  add column if not exists website text not null default '',
  add column if not exists support_email text not null default '',
  add column if not exists support_phone text not null default '',
  add column if not exists business_address text not null default '',
  add column if not exists crm_default_stage text not null default 'Prospecting',
  add column if not exists crm_default_owner text not null default '',
  add column if not exists crm_sla_hours integer not null default 24,
  add column if not exists crm_follow_up_days integer not null default 2,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.workspaces
set
  legal_name = coalesce(nullif(trim(legal_name), ''), trim(name), 'Workspace LLC'),
  app_label = coalesce(nullif(trim(app_label), ''), trim(name), 'Workspace'),
  brand_color = case
    when trim(coalesce(brand_color, '')) = '' then '#2f68df'
    else trim(brand_color)
  end,
  date_format = coalesce(nullif(trim(date_format), ''), 'YYYY-MM-DD'),
  currency = coalesce(nullif(trim(currency), ''), 'USD'),
  week_start = coalesce(nullif(trim(week_start), ''), 'Mon'),
  business_start = coalesce(nullif(trim(business_start), ''), '09:00'),
  business_end = coalesce(nullif(trim(business_end), ''), '18:00'),
  business_days = case
    when business_days is null or cardinality(business_days) = 0 then array[1, 2, 3, 4, 5]
    else business_days
  end,
  crm_default_stage = coalesce(nullif(trim(crm_default_stage), ''), 'Prospecting'),
  crm_sla_hours = greatest(0, coalesce(crm_sla_hours, 24)),
  crm_follow_up_days = greatest(0, coalesce(crm_follow_up_days, 2)),
  updated_at = timezone('utc', now());

drop trigger if exists set_workspaces_updated_at on public.workspaces;
create trigger set_workspaces_updated_at
before update on public.workspaces
for each row
execute function public.set_updated_at();

drop policy if exists "owner_admin can update own workspace" on public.workspaces;
create policy "owner_admin can update own workspace"
on public.workspaces
for update
to authenticated
using (
  id = private.current_workspace_id()
  and private.current_team_status() = 'Active'
  and private.current_team_role() in ('Owner', 'Admin')
)
with check (
  id = private.current_workspace_id()
  and private.current_team_status() = 'Active'
  and private.current_team_role() in ('Owner', 'Admin')
);

commit;
