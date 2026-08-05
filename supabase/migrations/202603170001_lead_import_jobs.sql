begin;

create table if not exists public.lead_import_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by_member_id uuid not null references public.team_members(id) on delete cascade,
  file_name text not null default '',
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  duplicate_mode text not null default 'skip' check (duplicate_mode in ('skip', 'update', 'create')),
  distribution_mode text not null default 'auto-assign' check (distribution_mode in ('auto-assign', 'unassigned')),
  distribution_method text not null default 'round-robin',
  assignee_ids uuid[] not null default '{}'::uuid[],
  rows jsonb not null default '[]'::jsonb,
  row_count integer not null default 0,
  processed_count integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  assigned_count integer not null default 0,
  left_unassigned_count integer not null default 0,
  last_error text not null default '',
  started_at timestamptz,
  completed_at timestamptz,
  heartbeat_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists lead_import_jobs_workspace_created_idx
  on public.lead_import_jobs (workspace_id, created_at desc);

create index if not exists lead_import_jobs_status_heartbeat_idx
  on public.lead_import_jobs (status, heartbeat_at);

drop trigger if exists handle_lead_import_jobs_updated_at on public.lead_import_jobs;
create trigger handle_lead_import_jobs_updated_at
before update on public.lead_import_jobs
for each row
execute function public.set_updated_at();

alter table public.lead_import_jobs enable row level security;

commit;
