begin;

create table if not exists public.lead_status_repair_backups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  import_job_id uuid not null references public.lead_import_jobs(id) on delete restrict,
  lead_id uuid not null references public.leads(id) on delete restrict,
  previous_status text not null,
  repaired_status text not null,
  lead_snapshot jsonb not null,
  reason text not null,
  repaired_at timestamptz not null default timezone('utc', now()),
  unique (import_job_id, lead_id)
);

alter table public.lead_status_repair_backups enable row level security;
drop policy if exists lead_status_repair_backups_no_direct_access on public.lead_status_repair_backups;
create policy lead_status_repair_backups_no_direct_access
on public.lead_status_repair_backups for all using (false) with check (false);

do $$
declare
  target_job public.lead_import_jobs%rowtype;
  matching_jobs integer := 0;
  repair_time timestamptz := timezone('utc', now());
begin
  select count(*) into matching_jobs
  from public.lead_import_jobs j
  where lower(trim(j.file_name)) = lower('TOBEIMPORT1.xlsx')
    and j.status = 'completed'
    and j.row_count = 99
    and j.updated_count = 99
    and j.created_count = 0
    and j.created_at >= timestamptz '2026-08-03 00:00:00+00'
    and j.created_at < timestamptz '2026-08-05 00:00:00+00';

  if matching_jobs <> 1 then
    raise exception 'Status repair stopped: expected exactly one matching import job, found %.', matching_jobs;
  end if;

  select * into target_job
  from public.lead_import_jobs j
  where lower(trim(j.file_name)) = lower('TOBEIMPORT1.xlsx')
    and j.status = 'completed'
    and j.row_count = 99
    and j.updated_count = 99
    and j.created_count = 0
    and j.created_at >= timestamptz '2026-08-03 00:00:00+00'
    and j.created_at < timestamptz '2026-08-05 00:00:00+00'
  limit 1;

  insert into public.lead_status_repair_backups (
    workspace_id, import_job_id, lead_id, previous_status, repaired_status, lead_snapshot, reason, repaired_at
  )
  select
    l.workspace_id,
    target_job.id,
    l.id,
    l.status,
    trim(c.before_data ->> 'status'),
    to_jsonb(l),
    'Blank import status incorrectly reset an existing lead to New.',
    repair_time
  from public.lead_import_changes c
  join public.leads l
    on l.id = c.lead_id and l.workspace_id = c.workspace_id
  where c.job_id = target_job.id
    and c.operation = 'updated'
    and l.status = 'New'
    and trim(coalesce(c.before_data ->> 'status', '')) in ('Contacted', 'Qualified', 'Unqualified', 'Converted')
    and coalesce(l.last_touch_at, '-infinity'::timestamptz) <= coalesce(target_job.completed_at, target_job.updated_at)
    and exists (
      select 1
      from public.lead_status_history h
      where h.workspace_id = target_job.workspace_id
        and h.lead_id = l.id
        and h.new_status = 'New'
        and h.changed_at >= coalesce(target_job.started_at, target_job.created_at) - interval '1 minute'
        and h.changed_at <= coalesce(target_job.completed_at, target_job.updated_at) + interval '5 minutes'
    )
    and not exists (
      select 1
      from public.lead_status_history h
      where h.workspace_id = target_job.workspace_id
        and h.lead_id = l.id
        and h.changed_at > coalesce(target_job.completed_at, target_job.updated_at) + interval '5 minutes'
    )
    and not exists (
      select 1
      from public.lead_activity_events e
      where e.workspace_id = target_job.workspace_id
        and e.lead_id = l.id
        and e.created_at > coalesce(target_job.completed_at, target_job.updated_at)
        and (e.is_sales_touch or e.event_type in ('call_attempted', 'call_connected'))
    )
  on conflict (import_job_id, lead_id) do nothing;

  update public.leads l
  set status = b.repaired_status,
      meta = coalesce(l.meta, '{}'::jsonb) || jsonb_build_object(
        'lastStatusChangedAt', repair_time,
        'lastStatusChangedByMemberId', target_job.created_by_member_id,
        'lastStatusChangedByName', 'JoynoSync repair',
        'lastStatusChangedFrom', l.status,
        'lastStatusChangedTo', b.repaired_status,
        'statusRepairImportJobId', target_job.id,
        'statusRepairAt', repair_time
      ),
      updated_by_member_id = target_job.created_by_member_id
  from public.lead_status_repair_backups b
  where b.import_job_id = target_job.id
    and b.lead_id = l.id
    and l.workspace_id = target_job.workspace_id
    and l.status = 'New';

  insert into public.lead_activity_events (
    workspace_id, lead_id, event_type, actor_member_id, old_value, new_value, metadata
  )
  select
    b.workspace_id,
    b.lead_id,
    'status_repaired',
    target_job.created_by_member_id,
    jsonb_build_object('status', b.previous_status),
    jsonb_build_object('status', b.repaired_status),
    jsonb_build_object('source', 'safe-import-status-repair', 'importJobId', b.import_job_id)
  from public.lead_status_repair_backups b
  where b.import_job_id = target_job.id
    and not exists (
      select 1 from public.lead_activity_events e
      where e.workspace_id = b.workspace_id
        and e.lead_id = b.lead_id
        and e.event_type = 'status_repaired'
        and e.metadata ->> 'importJobId' = b.import_job_id::text
    );
end;
$$;

create or replace function public.get_lead_status_repair_report()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  actor_role text;
  report_rows jsonb;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);
  select role into actor_role from public.team_members where id = actor_member_id;
  if actor_role not in ('Owner', 'Admin') then
    raise exception 'Only owners or admins can view repair results.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'leadId', b.lead_id,
    'leadName', b.lead_snapshot ->> 'name',
    'previousStatus', b.previous_status,
    'repairedStatus', b.repaired_status,
    'importJobId', b.import_job_id,
    'repairedAt', b.repaired_at
  ) order by b.repaired_at desc, b.lead_id), '[]'::jsonb)
  into report_rows
  from public.lead_status_repair_backups b
  where b.workspace_id = target_workspace_id;

  return jsonb_build_object('count', jsonb_array_length(report_rows), 'rows', report_rows);
end;
$$;

revoke all on table public.lead_status_repair_backups from public;
revoke all on function public.get_lead_status_repair_report() from public;
grant execute on function public.get_lead_status_repair_report() to authenticated;

commit;
