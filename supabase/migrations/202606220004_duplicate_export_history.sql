begin;

create table if not exists public.lead_duplicate_export_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  exported_by_member_id uuid references public.team_members(id) on delete set null,
  scope text not null default 'new',
  date_from date,
  date_to date,
  exported_count integer not null default 0,
  filter_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_duplicate_export_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  batch_id uuid not null references public.lead_duplicate_export_batches(id) on delete cascade,
  duplicate_fingerprint text not null,
  duplicate_lead_id uuid,
  source_row_number integer,
  created_at timestamptz not null default now(),
  unique (workspace_id, duplicate_fingerprint)
);

create index if not exists lead_duplicate_export_batches_workspace_created_idx
on public.lead_duplicate_export_batches (workspace_id, created_at desc);

create index if not exists lead_duplicate_export_items_workspace_created_idx
on public.lead_duplicate_export_items (workspace_id, created_at desc);

alter table public.lead_duplicate_export_batches enable row level security;
alter table public.lead_duplicate_export_items enable row level security;

drop policy if exists lead_duplicate_export_batches_no_direct_access on public.lead_duplicate_export_batches;
create policy lead_duplicate_export_batches_no_direct_access
on public.lead_duplicate_export_batches
for all
using (false)
with check (false);

drop policy if exists lead_duplicate_export_items_no_direct_access on public.lead_duplicate_export_items;
create policy lead_duplicate_export_items_no_direct_access
on public.lead_duplicate_export_items
for all
using (false)
with check (false);

create or replace function public.get_lead_duplicate_export_state(p_fingerprints text[] default array[]::text[])
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  exported_fingerprints jsonb := '[]'::jsonb;
  last_batch jsonb := null;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if not private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'view') then
    raise exception 'You do not have permission to export duplicate leads.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(item.duplicate_fingerprint), '[]'::jsonb)
  into exported_fingerprints
  from public.lead_duplicate_export_items item
  where item.workspace_id = target_workspace_id
    and item.duplicate_fingerprint = any(coalesce(p_fingerprints, array[]::text[]));

  select to_jsonb(batch)
  into last_batch
  from (
    select id, scope, date_from, date_to, exported_count, created_at
    from public.lead_duplicate_export_batches
    where workspace_id = target_workspace_id
    order by created_at desc
    limit 1
  ) batch;

  return jsonb_build_object(
    'exportedFingerprints', exported_fingerprints,
    'lastBatch', last_batch
  );
end;
$$;

create or replace function public.record_lead_duplicate_export(
  p_scope text,
  p_date_from date default null,
  p_date_to date default null,
  p_filter_snapshot jsonb default '{}'::jsonb,
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
  normalized_scope text := lower(trim(coalesce(p_scope, 'new')));
  batch_id uuid;
  inserted_count integer := 0;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if not (
    private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'export')
    or private.team_member_has_permission(target_workspace_id, actor_member_id, 'leads', 'view')
  ) then
    raise exception 'You do not have permission to export duplicate leads.' using errcode = 'P0001';
  end if;

  if normalized_scope not in ('new', 'date-range', 'all') then
    normalized_scope := 'new';
  end if;

  insert into public.lead_duplicate_export_batches (
    workspace_id,
    exported_by_member_id,
    scope,
    date_from,
    date_to,
    filter_snapshot,
    exported_count
  )
  values (
    target_workspace_id,
    actor_member_id,
    normalized_scope,
    p_date_from,
    p_date_to,
    coalesce(p_filter_snapshot, '{}'::jsonb),
    0
  )
  returning id into batch_id;

  insert into public.lead_duplicate_export_items (
    workspace_id,
    batch_id,
    duplicate_fingerprint,
    duplicate_lead_id,
    source_row_number
  )
  select
    target_workspace_id,
    batch_id,
    trim(item ->> 'fingerprint'),
    nullif(trim(item ->> 'duplicateLeadId'), '')::uuid,
    nullif(trim(item ->> 'rowNumber'), '')::integer
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
  where trim(item ->> 'fingerprint') <> ''
  on conflict (workspace_id, duplicate_fingerprint) do nothing;

  get diagnostics inserted_count = row_count;

  update public.lead_duplicate_export_batches
  set exported_count = inserted_count
  where id = batch_id;

  return jsonb_build_object(
    'batchId', batch_id,
    'exportedCount', inserted_count
  );
end;
$$;

revoke all on table public.lead_duplicate_export_batches from public;
revoke all on table public.lead_duplicate_export_items from public;
revoke all on function public.get_lead_duplicate_export_state(text[]) from public;
revoke all on function public.record_lead_duplicate_export(text, date, date, jsonb, jsonb) from public;
grant execute on function public.get_lead_duplicate_export_state(text[]) to authenticated;
grant execute on function public.record_lead_duplicate_export(text, date, date, jsonb, jsonb) to authenticated;

commit;
