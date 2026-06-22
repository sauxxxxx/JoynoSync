begin;

create extension if not exists pgcrypto;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  industry text not null default '',
  health text not null default 'Healthy',
  owner_member_id uuid references public.team_members(id) on delete set null,
  crm_conversation_id text,
  notes text not null default '',
  tags text[] not null default '{}',
  meta jsonb not null default '{}'::jsonb,
  created_by_member_id uuid references public.team_members(id) on delete set null,
  updated_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  constraint accounts_health_check check (health in ('Healthy', 'Growing', 'At Risk'))
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  name text not null,
  email text not null default '',
  phone text not null default '',
  secondary_phone text not null default '',
  role text not null default '',
  owner_member_id uuid references public.team_members(id) on delete set null,
  notes text not null default '',
  tags text[] not null default '{}',
  meta jsonb not null default '{}'::jsonb,
  created_by_member_id uuid references public.team_members(id) on delete set null,
  updated_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  name text not null,
  stage text not null default 'Prospecting',
  value_amount numeric(12,2),
  currency text not null default 'USD',
  close_date date,
  owner_member_id uuid references public.team_members(id) on delete set null,
  crm_conversation_id text,
  notes text not null default '',
  tags text[] not null default '{}',
  meta jsonb not null default '{}'::jsonb,
  created_by_member_id uuid references public.team_members(id) on delete set null,
  updated_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  constraint deals_stage_check check (stage in ('Prospecting', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'))
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  name text not null,
  company_name text not null default '',
  email text not null default '',
  phone text not null default '',
  secondary_phone text not null default '',
  role text not null default '',
  interest text not null default '',
  source text not null default 'Inbound',
  status text not null default 'New',
  owner_member_id uuid references public.team_members(id) on delete set null,
  next_follow_up_date date,
  crm_conversation_id text,
  notes text not null default '',
  tags text[] not null default '{}',
  converted_at timestamptz,
  converted_account_id uuid references public.accounts(id) on delete set null,
  converted_contact_id uuid references public.contacts(id) on delete set null,
  converted_deal_id uuid references public.deals(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_by_member_id uuid references public.team_members(id) on delete set null,
  updated_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  constraint leads_status_check check (status in ('New', 'Contacted', 'Qualified', 'Unqualified', 'Converted'))
);

drop trigger if exists set_accounts_updated_at on public.accounts;
create trigger set_accounts_updated_at
before update on public.accounts
for each row
execute function public.set_updated_at();

drop trigger if exists set_contacts_updated_at on public.contacts;
create trigger set_contacts_updated_at
before update on public.contacts
for each row
execute function public.set_updated_at();

drop trigger if exists set_deals_updated_at on public.deals;
create trigger set_deals_updated_at
before update on public.deals
for each row
execute function public.set_updated_at();

drop trigger if exists set_leads_updated_at on public.leads;
create trigger set_leads_updated_at
before update on public.leads
for each row
execute function public.set_updated_at();

create unique index if not exists accounts_workspace_name_active_key
on public.accounts (workspace_id, lower(name))
where archived_at is null;

create unique index if not exists contacts_workspace_email_active_key
on public.contacts (workspace_id, lower(email))
where archived_at is null and nullif(email, '') is not null;

create index if not exists accounts_workspace_owner_idx
on public.accounts (workspace_id, owner_member_id, archived_at);

create index if not exists contacts_workspace_account_idx
on public.contacts (workspace_id, account_id, owner_member_id, archived_at);

create index if not exists deals_workspace_stage_idx
on public.deals (workspace_id, stage, owner_member_id, close_date, archived_at);

create index if not exists leads_workspace_status_idx
on public.leads (workspace_id, status, owner_member_id, next_follow_up_date, archived_at);

alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.deals enable row level security;
alter table public.leads enable row level security;

drop policy if exists "accounts_member_select" on public.accounts;
create policy "accounts_member_select"
on public.accounts
for select
to authenticated
using (private.is_active_workspace_member(workspace_id));

drop policy if exists "accounts_member_insert" on public.accounts;
create policy "accounts_member_insert"
on public.accounts
for insert
to authenticated
with check (private.is_active_workspace_member(workspace_id));

drop policy if exists "accounts_member_update" on public.accounts;
create policy "accounts_member_update"
on public.accounts
for update
to authenticated
using (private.is_active_workspace_member(workspace_id))
with check (private.is_active_workspace_member(workspace_id));

drop policy if exists "accounts_manager_delete" on public.accounts;
create policy "accounts_manager_delete"
on public.accounts
for delete
to authenticated
using (private.can_manage_workspace(workspace_id));

drop policy if exists "contacts_member_select" on public.contacts;
create policy "contacts_member_select"
on public.contacts
for select
to authenticated
using (private.is_active_workspace_member(workspace_id));

drop policy if exists "contacts_member_insert" on public.contacts;
create policy "contacts_member_insert"
on public.contacts
for insert
to authenticated
with check (private.is_active_workspace_member(workspace_id));

drop policy if exists "contacts_member_update" on public.contacts;
create policy "contacts_member_update"
on public.contacts
for update
to authenticated
using (private.is_active_workspace_member(workspace_id))
with check (private.is_active_workspace_member(workspace_id));

drop policy if exists "contacts_manager_delete" on public.contacts;
create policy "contacts_manager_delete"
on public.contacts
for delete
to authenticated
using (private.can_manage_workspace(workspace_id));

drop policy if exists "deals_member_select" on public.deals;
create policy "deals_member_select"
on public.deals
for select
to authenticated
using (private.is_active_workspace_member(workspace_id));

drop policy if exists "deals_member_insert" on public.deals;
create policy "deals_member_insert"
on public.deals
for insert
to authenticated
with check (private.is_active_workspace_member(workspace_id));

drop policy if exists "deals_member_update" on public.deals;
create policy "deals_member_update"
on public.deals
for update
to authenticated
using (private.is_active_workspace_member(workspace_id))
with check (private.is_active_workspace_member(workspace_id));

drop policy if exists "deals_manager_delete" on public.deals;
create policy "deals_manager_delete"
on public.deals
for delete
to authenticated
using (private.can_manage_workspace(workspace_id));

drop policy if exists "leads_member_select" on public.leads;
create policy "leads_member_select"
on public.leads
for select
to authenticated
using (private.is_active_workspace_member(workspace_id));

drop policy if exists "leads_member_insert" on public.leads;
create policy "leads_member_insert"
on public.leads
for insert
to authenticated
with check (private.is_active_workspace_member(workspace_id));

drop policy if exists "leads_member_update" on public.leads;
create policy "leads_member_update"
on public.leads
for update
to authenticated
using (private.is_active_workspace_member(workspace_id))
with check (private.is_active_workspace_member(workspace_id));

drop policy if exists "leads_manager_delete" on public.leads;
create policy "leads_manager_delete"
on public.leads
for delete
to authenticated
using (private.can_manage_workspace(workspace_id));

commit;
