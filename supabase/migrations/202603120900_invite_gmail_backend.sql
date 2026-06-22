create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.public_invites (
  invite_id text primary key,
  workspace_id text,
  workspace text not null default 'Workspace',
  email text not null,
  name text not null default '',
  role text not null default 'Member',
  team text not null default 'General',
  invited_by text not null default 'Workspace admin',
  token text not null,
  status text not null default 'Pending Invite',
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists public_invites_token_key on public.public_invites (token);
create index if not exists public_invites_workspace_email_idx on public.public_invites (workspace_id, email);
create index if not exists public_invites_active_idx on public.public_invites (active, status);

drop trigger if exists set_public_invites_updated_at on public.public_invites;
create trigger set_public_invites_updated_at
before update on public.public_invites
for each row
execute function public.set_updated_at();

alter table public.public_invites enable row level security;

create table if not exists public.email_integrations (
  integration_id text primary key,
  provider text not null default 'gmail',
  workspace_id text,
  user_id text,
  email text,
  refresh_token_encrypted text not null,
  connected boolean not null default true,
  scope text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists email_integrations_provider_workspace_user_key
on public.email_integrations (provider, workspace_id, user_id);

create index if not exists email_integrations_connected_idx
on public.email_integrations (provider, workspace_id, user_id, connected);

drop trigger if exists set_email_integrations_updated_at on public.email_integrations;
create trigger set_email_integrations_updated_at
before update on public.email_integrations
for each row
execute function public.set_updated_at();

alter table public.email_integrations enable row level security;

create table if not exists public.communication_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text,
  user_id text,
  channel text not null,
  provider text not null,
  direction text not null default 'outbound',
  recipient_addresses text[] default '{}',
  sender_address text,
  subject text,
  body text,
  entity_type text,
  entity_id text,
  external_id text,
  status text not null default 'sent',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists communication_logs_workspace_created_idx
on public.communication_logs (workspace_id, created_at desc);

alter table public.communication_logs enable row level security;

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text,
  actor_id text not null default 'system',
  action text not null,
  entity_type text,
  entity_id text,
  summary text not null default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists activity_logs_workspace_created_idx
on public.activity_logs (workspace_id, created_at desc);

alter table public.activity_logs enable row level security;
