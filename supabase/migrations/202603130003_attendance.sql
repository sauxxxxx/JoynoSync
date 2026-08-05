begin;

create table if not exists public.attendance_policies (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  shift_start time not null default time '09:00',
  shift_end time not null default time '18:00',
  late_after_minutes integer not null default 10,
  half_day_after_minutes integer not null default 120,
  auto_absent_after_minutes integer not null default 0,
  break_minutes integer not null default 60,
  timezone text not null default 'UTC',
  work_days smallint[] not null default array[1, 2, 3, 4, 5]::smallint[],
  created_by_member_id uuid references public.team_members(id) on delete set null,
  updated_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint attendance_policies_shift_window_check check (shift_end > shift_start),
  constraint attendance_policies_thresholds_check check (
    late_after_minutes >= 0
    and half_day_after_minutes >= late_after_minutes
    and auto_absent_after_minutes >= 0
    and (auto_absent_after_minutes = 0 or auto_absent_after_minutes >= half_day_after_minutes)
    and break_minutes >= 0
  ),
  constraint attendance_policies_work_days_check check (
    cardinality(work_days) > 0
    and work_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  )
);

create table if not exists public.attendance_break_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null,
  label text not null,
  sort_order smallint not null default 0,
  duration_minutes integer not null default 15,
  paid boolean not null default false,
  required boolean not null default false,
  max_per_day integer not null default 1,
  min_per_day integer not null default 0,
  window_start time not null,
  window_end time not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint attendance_break_rules_workspace_code_key unique (workspace_id, code),
  constraint attendance_break_rules_window_check check (window_end > window_start),
  constraint attendance_break_rules_usage_check check (
    duration_minutes > 0
    and max_per_day > 0
    and min_per_day >= 0
    and min_per_day <= max_per_day
  )
);

create table if not exists public.attendance_shifts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  work_date date not null,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  source text not null default 'manual',
  notes text not null default '',
  created_by_member_id uuid references public.team_members(id) on delete set null,
  updated_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint attendance_shifts_workspace_member_work_date_key unique (workspace_id, member_id, work_date),
  constraint attendance_shifts_clock_window_check check (clock_out_at is null or clock_out_at > clock_in_at)
);

create table if not exists public.attendance_breaks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shift_id uuid not null references public.attendance_shifts(id) on delete cascade,
  break_code text not null,
  label text not null default 'Break',
  paid boolean not null default false,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_by_member_id uuid references public.team_members(id) on delete set null,
  updated_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint attendance_breaks_window_check check (ended_at is null or ended_at > started_at)
);

create table if not exists public.attendance_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  shift_id uuid references public.attendance_shifts(id) on delete set null,
  work_date date not null,
  request_type text not null default 'Time Adjustment',
  reason text not null default '',
  status text not null default 'Pending',
  requested_clock_in_at timestamptz,
  requested_clock_out_at timestamptz,
  reviewed_by_member_id uuid references public.team_members(id) on delete set null,
  reviewed_at timestamptz,
  resolution_note text not null default '',
  applied_at timestamptz,
  created_by_member_id uuid references public.team_members(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  constraint attendance_adjustment_requests_status_check check (status in ('Pending', 'Approved', 'Rejected')),
  constraint attendance_adjustment_requests_type_check check (
    request_type in ('Missing Clock In', 'Missing Clock Out', 'Break Correction', 'Time Adjustment')
  ),
  constraint attendance_adjustment_requests_values_check check (
    requested_clock_in_at is not null or requested_clock_out_at is not null
  )
);

create table if not exists public.attendance_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_member_id uuid references public.team_members(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_attendance_policies_updated_at on public.attendance_policies;
create trigger set_attendance_policies_updated_at
before update on public.attendance_policies
for each row
execute function public.set_updated_at();

drop trigger if exists set_attendance_break_rules_updated_at on public.attendance_break_rules;
create trigger set_attendance_break_rules_updated_at
before update on public.attendance_break_rules
for each row
execute function public.set_updated_at();

drop trigger if exists set_attendance_shifts_updated_at on public.attendance_shifts;
create trigger set_attendance_shifts_updated_at
before update on public.attendance_shifts
for each row
execute function public.set_updated_at();

drop trigger if exists set_attendance_breaks_updated_at on public.attendance_breaks;
create trigger set_attendance_breaks_updated_at
before update on public.attendance_breaks
for each row
execute function public.set_updated_at();

drop trigger if exists set_attendance_adjustment_requests_updated_at on public.attendance_adjustment_requests;
create trigger set_attendance_adjustment_requests_updated_at
before update on public.attendance_adjustment_requests
for each row
execute function public.set_updated_at();

create index if not exists attendance_break_rules_workspace_sort_idx
on public.attendance_break_rules (workspace_id, sort_order, code);

create index if not exists attendance_shifts_workspace_work_date_idx
on public.attendance_shifts (workspace_id, work_date desc, member_id);

create index if not exists attendance_shifts_workspace_member_idx
on public.attendance_shifts (workspace_id, member_id, work_date desc);

create unique index if not exists attendance_shifts_single_open_shift_idx
on public.attendance_shifts (workspace_id, member_id)
where clock_out_at is null;

create index if not exists attendance_breaks_shift_started_idx
on public.attendance_breaks (shift_id, started_at asc);

create unique index if not exists attendance_breaks_single_open_break_idx
on public.attendance_breaks (shift_id)
where ended_at is null;

create index if not exists attendance_adjustment_requests_workspace_status_idx
on public.attendance_adjustment_requests (workspace_id, status, work_date desc, created_at desc);

create index if not exists attendance_adjustment_requests_workspace_member_idx
on public.attendance_adjustment_requests (workspace_id, member_id, work_date desc, created_at desc);

create index if not exists attendance_audit_events_workspace_created_idx
on public.attendance_audit_events (workspace_id, created_at desc);

create or replace function private.current_team_member_id(target_workspace_id uuid default private.current_workspace_id())
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select tm.id
  from public.team_members tm
  where tm.workspace_id = coalesce(target_workspace_id, private.current_workspace_id())
    and (tm.auth_user_id = auth.uid() or lower(tm.email) = private.current_user_email())
  order by
    case
      when tm.status = 'Active' then 0
      when tm.status = 'Pending Invite' then 1
      when tm.status = 'Inactive' then 2
      else 3
    end,
    coalesce(tm.updated_at, tm.invite_last_sent_at, tm.invited_at) desc
  limit 1;
$$;

create or replace function private.current_team_role_for_workspace(target_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select tm.role
  from public.team_members tm
  where tm.workspace_id = target_workspace_id
    and (tm.auth_user_id = auth.uid() or lower(tm.email) = private.current_user_email())
  order by
    case
      when tm.status = 'Active' then 0
      when tm.status = 'Pending Invite' then 1
      when tm.status = 'Inactive' then 2
      else 3
    end,
    coalesce(tm.updated_at, tm.invite_last_sent_at, tm.invited_at) desc
  limit 1;
$$;

create or replace function private.current_team_status_for_workspace(target_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select tm.status
  from public.team_members tm
  where tm.workspace_id = target_workspace_id
    and (tm.auth_user_id = auth.uid() or lower(tm.email) = private.current_user_email())
  order by
    case
      when tm.status = 'Active' then 0
      when tm.status = 'Pending Invite' then 1
      when tm.status = 'Inactive' then 2
      else 3
    end,
    coalesce(tm.updated_at, tm.invite_last_sent_at, tm.invited_at) desc
  limit 1;
$$;

create or replace function private.require_active_workspace_member(target_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  member_id uuid;
  member_status text;
begin
  if target_workspace_id is null then
    raise exception 'Workspace context is required.' using errcode = 'P0001';
  end if;

  member_id := private.current_team_member_id(target_workspace_id);
  member_status := coalesce(private.current_team_status_for_workspace(target_workspace_id), '');

  if member_id is null or member_status <> 'Active' then
    raise exception 'Active workspace membership is required.' using errcode = 'P0001';
  end if;

  return member_id;
end;
$$;

create or replace function private.require_attendance_manager(target_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  member_id uuid;
  member_role text;
begin
  member_id := private.require_active_workspace_member(target_workspace_id);
  member_role := coalesce(private.current_team_role_for_workspace(target_workspace_id), '');

  if member_role not in ('Owner', 'Admin', 'Manager') then
    raise exception 'Manager access is required for this attendance action.' using errcode = 'P0001';
  end if;

  return member_id;
end;
$$;

create or replace function private.attendance_effective_timezone(target_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select case
    when lower(coalesce(nullif(trim(ap.timezone), ''), '')) not in ('', 'local') then trim(ap.timezone)
    when lower(coalesce(nullif(trim(w.timezone), ''), '')) not in ('', 'local') then trim(w.timezone)
    else 'UTC'
  end
  from public.workspaces w
  left join public.attendance_policies ap on ap.workspace_id = w.id
  where w.id = target_workspace_id
  limit 1;
$$;

create or replace function private.attendance_reference_local_date(
  target_workspace_id uuid,
  reference_at timestamptz default timezone('utc', now())
)
returns date
language sql
stable
security definer
set search_path = public, private
as $$
  select ((coalesce(reference_at, timezone('utc', now())) at time zone private.attendance_effective_timezone(target_workspace_id))::date);
$$;

create or replace function private.ensure_attendance_policy_defaults(
  target_workspace_id uuid,
  actor_member_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if target_workspace_id is null then
    return;
  end if;

  insert into public.attendance_policies (
    workspace_id,
    shift_start,
    shift_end,
    late_after_minutes,
    half_day_after_minutes,
    auto_absent_after_minutes,
    break_minutes,
    timezone,
    work_days,
    created_by_member_id,
    updated_by_member_id
  )
  select
    w.id,
    time '09:00',
    time '18:00',
    10,
    120,
    0,
    60,
    case
      when lower(coalesce(nullif(trim(w.timezone), ''), '')) not in ('', 'local') then trim(w.timezone)
      else 'UTC'
    end,
    array[1, 2, 3, 4, 5]::smallint[],
    actor_member_id,
    actor_member_id
  from public.workspaces w
  where w.id = target_workspace_id
  on conflict (workspace_id) do nothing;

  insert into public.attendance_break_rules (
    workspace_id,
    code,
    label,
    sort_order,
    duration_minutes,
    paid,
    required,
    max_per_day,
    min_per_day,
    window_start,
    window_end
  )
  values
    (target_workspace_id, 'morning', 'Morning Break', 1, 15, true, false, 1, 0, time '09:30', time '11:30'),
    (target_workspace_id, 'lunch', 'Lunch Break', 2, 60, false, true, 1, 1, time '11:30', time '14:30'),
    (target_workspace_id, 'afternoon', 'Afternoon Break', 3, 15, true, false, 1, 0, time '14:30', time '17:30')
  on conflict (workspace_id, code) do nothing;
end;
$$;

create or replace function private.attendance_policy_json(target_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'shiftStart', to_char(ap.shift_start, 'HH24:MI'),
    'shiftEnd', to_char(ap.shift_end, 'HH24:MI'),
    'graceMinutes', ap.late_after_minutes,
    'lateAfterMinutes', ap.late_after_minutes,
    'halfDayAfterMinutes', ap.half_day_after_minutes,
    'autoAbsentAfterMinutes', ap.auto_absent_after_minutes,
    'breakMinutes', ap.break_minutes,
    'timezone', ap.timezone,
    'workDays', to_jsonb(ap.work_days),
    'breakTypes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', abr.code,
          'label', abr.label,
          'durationMinutes', abr.duration_minutes,
          'paid', abr.paid,
          'required', abr.required,
          'maxPerDay', abr.max_per_day,
          'minPerDay', abr.min_per_day,
          'windowStart', to_char(abr.window_start, 'HH24:MI'),
          'windowEnd', to_char(abr.window_end, 'HH24:MI')
        )
        order by abr.sort_order, abr.code
      )
      from public.attendance_break_rules abr
      where abr.workspace_id = ap.workspace_id
    ), '[]'::jsonb)
  )
  from public.attendance_policies ap
  where ap.workspace_id = target_workspace_id;
$$;

create or replace function private.insert_attendance_audit_event(
  target_workspace_id uuid,
  actor_member_id uuid,
  target_entity_type text,
  target_entity_id uuid,
  target_action text,
  target_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public, private
as $$
  insert into public.attendance_audit_events (
    workspace_id,
    actor_member_id,
    entity_type,
    entity_id,
    action,
    details
  )
  values (
    target_workspace_id,
    actor_member_id,
    coalesce(nullif(trim(target_entity_type), ''), 'attendance'),
    target_entity_id,
    coalesce(nullif(trim(target_action), ''), 'updated'),
    coalesce(target_details, '{}'::jsonb)
  );
$$;

revoke all on function private.current_team_member_id(uuid) from public;
revoke all on function private.current_team_role_for_workspace(uuid) from public;
revoke all on function private.current_team_status_for_workspace(uuid) from public;
revoke all on function private.require_active_workspace_member(uuid) from public;
revoke all on function private.require_attendance_manager(uuid) from public;
revoke all on function private.attendance_effective_timezone(uuid) from public;
revoke all on function private.attendance_reference_local_date(uuid, timestamptz) from public;
revoke all on function private.ensure_attendance_policy_defaults(uuid, uuid) from public;
revoke all on function private.attendance_policy_json(uuid) from public;
revoke all on function private.insert_attendance_audit_event(uuid, uuid, text, uuid, text, jsonb) from public;

grant execute on function private.current_team_member_id(uuid) to authenticated;
grant execute on function private.current_team_role_for_workspace(uuid) to authenticated;
grant execute on function private.current_team_status_for_workspace(uuid) to authenticated;
grant execute on function private.require_active_workspace_member(uuid) to authenticated;
grant execute on function private.require_attendance_manager(uuid) to authenticated;
grant execute on function private.attendance_effective_timezone(uuid) to authenticated;
grant execute on function private.attendance_reference_local_date(uuid, timestamptz) to authenticated;
grant execute on function private.ensure_attendance_policy_defaults(uuid, uuid) to authenticated;
grant execute on function private.attendance_policy_json(uuid) to authenticated;
grant execute on function private.insert_attendance_audit_event(uuid, uuid, text, uuid, text, jsonb) to authenticated;

alter table public.attendance_policies enable row level security;
alter table public.attendance_break_rules enable row level security;
alter table public.attendance_shifts enable row level security;
alter table public.attendance_breaks enable row level security;
alter table public.attendance_adjustment_requests enable row level security;
alter table public.attendance_audit_events enable row level security;

drop policy if exists "attendance_policies_member_select" on public.attendance_policies;
create policy "attendance_policies_member_select"
on public.attendance_policies
for select
to authenticated
using (private.is_active_workspace_member(workspace_id));

drop policy if exists "attendance_policies_manager_write" on public.attendance_policies;
create policy "attendance_policies_manager_write"
on public.attendance_policies
for all
to authenticated
using (private.can_manage_workspace(workspace_id))
with check (private.can_manage_workspace(workspace_id));

drop policy if exists "attendance_break_rules_member_select" on public.attendance_break_rules;
create policy "attendance_break_rules_member_select"
on public.attendance_break_rules
for select
to authenticated
using (private.is_active_workspace_member(workspace_id));

drop policy if exists "attendance_break_rules_manager_write" on public.attendance_break_rules;
create policy "attendance_break_rules_manager_write"
on public.attendance_break_rules
for all
to authenticated
using (private.can_manage_workspace(workspace_id))
with check (private.can_manage_workspace(workspace_id));

drop policy if exists "attendance_shifts_visible_scope_select" on public.attendance_shifts;
create policy "attendance_shifts_visible_scope_select"
on public.attendance_shifts
for select
to authenticated
using (
  private.is_active_workspace_member(workspace_id)
  and (
    private.can_manage_workspace(workspace_id)
    or member_id = private.current_team_member_id(workspace_id)
  )
);

drop policy if exists "attendance_breaks_visible_scope_select" on public.attendance_breaks;
create policy "attendance_breaks_visible_scope_select"
on public.attendance_breaks
for select
to authenticated
using (
  private.is_active_workspace_member(workspace_id)
  and (
    private.can_manage_workspace(workspace_id)
    or exists (
      select 1
      from public.attendance_shifts shift_scope
      where shift_scope.id = attendance_breaks.shift_id
        and shift_scope.member_id = private.current_team_member_id(workspace_id)
    )
  )
);

drop policy if exists "attendance_requests_visible_scope_select" on public.attendance_adjustment_requests;
create policy "attendance_requests_visible_scope_select"
on public.attendance_adjustment_requests
for select
to authenticated
using (
  private.is_active_workspace_member(workspace_id)
  and (
    private.can_manage_workspace(workspace_id)
    or member_id = private.current_team_member_id(workspace_id)
  )
);

drop policy if exists "attendance_audit_manager_select" on public.attendance_audit_events;
create policy "attendance_audit_manager_select"
on public.attendance_audit_events
for select
to authenticated
using (private.can_manage_workspace(workspace_id));

create or replace function public.get_attendance_snapshot(
  p_reference_at timestamptz default timezone('utc', now())
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  actor_role text;
  manager_mode boolean;
  reference_now timestamptz := coalesce(p_reference_at, timezone('utc', now()));
  local_date date;
  policy_payload jsonb;
  logs_payload jsonb;
  requests_payload jsonb;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);
  actor_role := coalesce(private.current_team_role_for_workspace(target_workspace_id), '');
  manager_mode := actor_role in ('Owner', 'Admin', 'Manager');

  perform private.ensure_attendance_policy_defaults(target_workspace_id, actor_member_id);
  local_date := private.attendance_reference_local_date(target_workspace_id, reference_now);
  policy_payload := coalesce(private.attendance_policy_json(target_workspace_id), '{}'::jsonb);

  select coalesce(
    jsonb_agg(log_entry order by sort_work_date desc, sort_clock_in desc),
    '[]'::jsonb
  )
  into logs_payload
  from (
    select
      shift_rows.work_date as sort_work_date,
      shift_rows.clock_in_at as sort_clock_in,
      jsonb_build_object(
        'id', shift_rows.id,
        'userId', shift_rows.member_id,
        'userName', shift_rows.member_name,
        'date', to_char(shift_rows.work_date, 'YYYY-MM-DD'),
        'clockInAt', shift_rows.clock_in_at,
        'clockOutAt', shift_rows.clock_out_at,
        'breaks', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', break_rows.id,
              'breakTypeId', break_rows.break_code,
              'breakTypeLabel', break_rows.label,
              'paid', break_rows.paid,
              'startAt', break_rows.started_at,
              'endAt', break_rows.ended_at
            )
            order by break_rows.started_at asc
          )
          from public.attendance_breaks break_rows
          where break_rows.shift_id = shift_rows.id
        ), '[]'::jsonb),
        'source', shift_rows.source,
        'createdAt', shift_rows.created_at,
        'updatedAt', shift_rows.updated_at
      ) as log_entry
    from (
      select
        shift_base.*,
        member_base.name as member_name
      from public.attendance_shifts shift_base
      join public.team_members member_base on member_base.id = shift_base.member_id
      where shift_base.workspace_id = target_workspace_id
        and shift_base.work_date >= (local_date - 30)
        and (manager_mode or shift_base.member_id = actor_member_id)
    ) as shift_rows
  ) as visible_logs;

  select coalesce(
    jsonb_agg(request_entry order by sort_created_at desc),
    '[]'::jsonb
  )
  into requests_payload
  from (
    select
      request_rows.created_at as sort_created_at,
      jsonb_build_object(
        'id', request_rows.id,
        'userId', request_rows.member_id,
        'userName', request_rows.member_name,
        'date', to_char(request_rows.work_date, 'YYYY-MM-DD'),
        'type', request_rows.request_type,
        'reason', request_rows.reason,
        'status', request_rows.status,
        'requestedClockInAt', request_rows.requested_clock_in_at,
        'requestedClockOutAt', request_rows.requested_clock_out_at,
        'resolutionNote', request_rows.resolution_note,
        'shiftId', request_rows.shift_id,
        'createdAt', request_rows.created_at,
        'reviewedBy', coalesce(request_rows.reviewed_by_name, ''),
        'reviewedAt', request_rows.reviewed_at
      ) as request_entry
    from (
      select
        request_base.*,
        member_base.name as member_name,
        reviewer_base.name as reviewed_by_name
      from public.attendance_adjustment_requests request_base
      join public.team_members member_base on member_base.id = request_base.member_id
      left join public.team_members reviewer_base on reviewer_base.id = request_base.reviewed_by_member_id
      where request_base.workspace_id = target_workspace_id
        and (manager_mode or request_base.member_id = actor_member_id)
      order by request_base.created_at desc
      limit 100
    ) as request_rows
  ) as visible_requests;

  return jsonb_build_object(
    'serverNow', reference_now,
    'policy', policy_payload,
    'logs', logs_payload,
    'requests', requests_payload
  );
end;
$$;

create or replace function public.attendance_clock_in()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  server_now timestamptz := timezone('utc', now());
  local_date date;
  existing_shift public.attendance_shifts%rowtype;
  open_shift public.attendance_shifts%rowtype;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);
  perform private.ensure_attendance_policy_defaults(target_workspace_id, actor_member_id);
  local_date := private.attendance_reference_local_date(target_workspace_id, server_now);

  select *
  into open_shift
  from public.attendance_shifts
  where workspace_id = target_workspace_id
    and member_id = actor_member_id
    and clock_out_at is null
  order by clock_in_at desc
  limit 1;

  if open_shift.id is not null then
    raise exception 'You already have an open shift. Clock out before clocking in again.' using errcode = 'P0001';
  end if;

  select *
  into existing_shift
  from public.attendance_shifts
  where workspace_id = target_workspace_id
    and member_id = actor_member_id
    and work_date = local_date
  limit 1;

  if existing_shift.id is not null then
    raise exception 'A shift already exists for today. Use an adjustment request instead.' using errcode = 'P0001';
  end if;

  insert into public.attendance_shifts (
    workspace_id,
    member_id,
    work_date,
    clock_in_at,
    source,
    created_by_member_id,
    updated_by_member_id
  )
  values (
    target_workspace_id,
    actor_member_id,
    local_date,
    server_now,
    'manual',
    actor_member_id,
    actor_member_id
  )
  returning *
  into existing_shift;

  perform private.insert_attendance_audit_event(
    target_workspace_id,
    actor_member_id,
    'shift',
    existing_shift.id,
    'clock-in',
    jsonb_build_object(
      'workDate', to_char(existing_shift.work_date, 'YYYY-MM-DD'),
      'clockInAt', existing_shift.clock_in_at
    )
  );

  return public.get_attendance_snapshot(server_now);
end;
$$;

create or replace function public.attendance_start_break(p_break_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  server_now timestamptz := timezone('utc', now());
  timezone_name text;
  active_shift public.attendance_shifts%rowtype;
  open_break public.attendance_breaks%rowtype;
  break_rule public.attendance_break_rules%rowtype;
  break_count integer := 0;
  local_time time;
  normalized_break_code text := lower(trim(coalesce(p_break_code, '')));
  inserted_break public.attendance_breaks%rowtype;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);
  perform private.ensure_attendance_policy_defaults(target_workspace_id, actor_member_id);

  if normalized_break_code = '' then
    raise exception 'Break type is required.' using errcode = 'P0001';
  end if;

  select *
  into active_shift
  from public.attendance_shifts
  where workspace_id = target_workspace_id
    and member_id = actor_member_id
    and clock_out_at is null
  order by clock_in_at desc
  limit 1;

  if active_shift.id is null then
    raise exception 'Clock in before starting a break.' using errcode = 'P0001';
  end if;

  if active_shift.work_date <> private.attendance_reference_local_date(target_workspace_id, server_now) then
    raise exception 'You have an older open shift. Ask a manager to correct it before starting a new break.' using errcode = 'P0001';
  end if;

  select *
  into open_break
  from public.attendance_breaks
  where shift_id = active_shift.id
    and ended_at is null
  limit 1;

  if open_break.id is not null then
    raise exception 'You already have an active break.' using errcode = 'P0001';
  end if;

  select *
  into break_rule
  from public.attendance_break_rules
  where workspace_id = target_workspace_id
    and code = normalized_break_code
  limit 1;

  if break_rule.id is null then
    raise exception 'The selected break type is not configured for this workspace.' using errcode = 'P0001';
  end if;

  timezone_name := private.attendance_effective_timezone(target_workspace_id);
  local_time := (server_now at time zone timezone_name)::time;

  if local_time < break_rule.window_start or local_time > break_rule.window_end then
    raise exception 'The selected break is outside its allowed time window.' using errcode = 'P0001';
  end if;

  select count(*)
  into break_count
  from public.attendance_breaks
  where shift_id = active_shift.id
    and break_code = break_rule.code;

  if break_count >= break_rule.max_per_day then
    raise exception 'The daily limit for this break type has been reached.' using errcode = 'P0001';
  end if;

  insert into public.attendance_breaks (
    workspace_id,
    shift_id,
    break_code,
    label,
    paid,
    started_at,
    created_by_member_id,
    updated_by_member_id
  )
  values (
    target_workspace_id,
    active_shift.id,
    break_rule.code,
    break_rule.label,
    break_rule.paid,
    server_now,
    actor_member_id,
    actor_member_id
  )
  returning *
  into inserted_break;

  update public.attendance_shifts
  set updated_by_member_id = actor_member_id
  where id = active_shift.id;

  perform private.insert_attendance_audit_event(
    target_workspace_id,
    actor_member_id,
    'break',
    inserted_break.id,
    'start-break',
    jsonb_build_object(
      'shiftId', active_shift.id,
      'breakTypeId', inserted_break.break_code,
      'startedAt', inserted_break.started_at
    )
  );

  return public.get_attendance_snapshot(server_now);
end;
$$;

create or replace function public.attendance_end_break()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  server_now timestamptz := timezone('utc', now());
  active_shift public.attendance_shifts%rowtype;
  open_break public.attendance_breaks%rowtype;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  select *
  into active_shift
  from public.attendance_shifts
  where workspace_id = target_workspace_id
    and member_id = actor_member_id
    and clock_out_at is null
  order by clock_in_at desc
  limit 1;

  if active_shift.id is null then
    raise exception 'There is no active shift to resume.' using errcode = 'P0001';
  end if;

  select *
  into open_break
  from public.attendance_breaks
  where shift_id = active_shift.id
    and ended_at is null
  limit 1;

  if open_break.id is null then
    raise exception 'There is no active break to end.' using errcode = 'P0001';
  end if;

  update public.attendance_breaks
  set ended_at = server_now,
      updated_by_member_id = actor_member_id
  where id = open_break.id;

  update public.attendance_shifts
  set updated_by_member_id = actor_member_id
  where id = active_shift.id;

  perform private.insert_attendance_audit_event(
    target_workspace_id,
    actor_member_id,
    'break',
    open_break.id,
    'end-break',
    jsonb_build_object(
      'shiftId', active_shift.id,
      'endedAt', server_now
    )
  );

  return public.get_attendance_snapshot(server_now);
end;
$$;

create or replace function public.attendance_clock_out()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  server_now timestamptz := timezone('utc', now());
  active_shift public.attendance_shifts%rowtype;
  open_break public.attendance_breaks%rowtype;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  select *
  into active_shift
  from public.attendance_shifts
  where workspace_id = target_workspace_id
    and member_id = actor_member_id
    and clock_out_at is null
  order by clock_in_at desc
  limit 1;

  if active_shift.id is null then
    raise exception 'There is no active shift to clock out.' using errcode = 'P0001';
  end if;

  select *
  into open_break
  from public.attendance_breaks
  where shift_id = active_shift.id
    and ended_at is null
  limit 1;

  if open_break.id is not null then
    update public.attendance_breaks
    set ended_at = server_now,
        updated_by_member_id = actor_member_id
    where id = open_break.id;
  end if;

  update public.attendance_shifts
  set clock_out_at = server_now,
      updated_by_member_id = actor_member_id
  where id = active_shift.id;

  perform private.insert_attendance_audit_event(
    target_workspace_id,
    actor_member_id,
    'shift',
    active_shift.id,
    'clock-out',
    jsonb_build_object(
      'clockOutAt', server_now,
      'autoClosedBreakId', open_break.id
    )
  );

  return public.get_attendance_snapshot(server_now);
end;
$$;

create or replace function public.create_attendance_adjustment_request(
  p_work_date date,
  p_request_type text,
  p_reason text,
  p_requested_clock_in_at timestamptz default null,
  p_requested_clock_out_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  server_now timestamptz := timezone('utc', now());
  timezone_name text;
  normalized_type text := coalesce(nullif(trim(p_request_type), ''), 'Time Adjustment');
  normalized_reason text := trim(coalesce(p_reason, ''));
  target_shift_id uuid;
  inserted_request public.attendance_adjustment_requests%rowtype;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if p_work_date is null then
    raise exception 'A valid work date is required.' using errcode = 'P0001';
  end if;

  if normalized_reason = '' then
    raise exception 'A reason is required for attendance adjustments.' using errcode = 'P0001';
  end if;

  if p_requested_clock_in_at is null and p_requested_clock_out_at is null then
    raise exception 'Provide at least one requested time change.' using errcode = 'P0001';
  end if;

  if p_requested_clock_in_at is not null and p_requested_clock_out_at is not null and p_requested_clock_out_at <= p_requested_clock_in_at then
    raise exception 'Requested clock-out must be later than requested clock-in.' using errcode = 'P0001';
  end if;

  timezone_name := private.attendance_effective_timezone(target_workspace_id);

  if p_requested_clock_in_at is not null and ((p_requested_clock_in_at at time zone timezone_name)::date <> p_work_date) then
    raise exception 'Requested clock-in time must match the selected work date in the workspace timezone.' using errcode = 'P0001';
  end if;

  if p_requested_clock_out_at is not null and ((p_requested_clock_out_at at time zone timezone_name)::date <> p_work_date) then
    raise exception 'Requested clock-out time must match the selected work date in the workspace timezone.' using errcode = 'P0001';
  end if;

  select id
  into target_shift_id
  from public.attendance_shifts
  where workspace_id = target_workspace_id
    and member_id = actor_member_id
    and work_date = p_work_date
  limit 1;

  insert into public.attendance_adjustment_requests (
    workspace_id,
    member_id,
    shift_id,
    work_date,
    request_type,
    reason,
    status,
    requested_clock_in_at,
    requested_clock_out_at,
    created_by_member_id
  )
  values (
    target_workspace_id,
    actor_member_id,
    target_shift_id,
    p_work_date,
    normalized_type,
    normalized_reason,
    'Pending',
    p_requested_clock_in_at,
    p_requested_clock_out_at,
    actor_member_id
  )
  returning *
  into inserted_request;

  perform private.insert_attendance_audit_event(
    target_workspace_id,
    actor_member_id,
    'adjustment-request',
    inserted_request.id,
    'request-created',
    jsonb_build_object(
      'workDate', to_char(inserted_request.work_date, 'YYYY-MM-DD'),
      'type', inserted_request.request_type,
      'requestedClockInAt', inserted_request.requested_clock_in_at,
      'requestedClockOutAt', inserted_request.requested_clock_out_at
    )
  );

  return public.get_attendance_snapshot(server_now);
end;
$$;

create or replace function public.review_attendance_adjustment_request(
  p_request_id uuid,
  p_decision text,
  p_resolution_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  reviewer_member_id uuid;
  server_now timestamptz := timezone('utc', now());
  timezone_name text;
  target_request public.attendance_adjustment_requests%rowtype;
  target_shift public.attendance_shifts%rowtype;
  current_local_date date;
  normalized_decision text := case
    when lower(trim(coalesce(p_decision, ''))) = 'approve' then 'Approved'
    when lower(trim(coalesce(p_decision, ''))) = 'approved' then 'Approved'
    when lower(trim(coalesce(p_decision, ''))) = 'reject' then 'Rejected'
    when lower(trim(coalesce(p_decision, ''))) = 'rejected' then 'Rejected'
    else ''
  end;
  next_clock_in timestamptz;
  next_clock_out timestamptz;
  before_payload jsonb := '{}'::jsonb;
  after_payload jsonb := '{}'::jsonb;
begin
  target_workspace_id := private.current_workspace_id();
  reviewer_member_id := private.require_attendance_manager(target_workspace_id);

  if p_request_id is null then
    raise exception 'An attendance request id is required.' using errcode = 'P0001';
  end if;

  if normalized_decision = '' then
    raise exception 'Attendance review decision must be approve or reject.' using errcode = 'P0001';
  end if;

  select *
  into target_request
  from public.attendance_adjustment_requests
  where id = p_request_id
    and workspace_id = target_workspace_id
  for update;

  if target_request.id is null then
    raise exception 'Attendance request not found.' using errcode = 'P0001';
  end if;

  if target_request.status <> 'Pending' then
    raise exception 'Attendance request has already been reviewed.' using errcode = 'P0001';
  end if;

  if normalized_decision = 'Rejected' then
    update public.attendance_adjustment_requests
    set status = 'Rejected',
        reviewed_by_member_id = reviewer_member_id,
        reviewed_at = server_now,
        resolution_note = trim(coalesce(p_resolution_note, ''))
    where id = target_request.id;

    perform private.insert_attendance_audit_event(
      target_workspace_id,
      reviewer_member_id,
      'adjustment-request',
      target_request.id,
      'request-rejected',
      jsonb_build_object(
        'reason', target_request.reason,
        'resolutionNote', trim(coalesce(p_resolution_note, ''))
      )
    );

    return public.get_attendance_snapshot(server_now);
  end if;

  timezone_name := private.attendance_effective_timezone(target_workspace_id);
  current_local_date := private.attendance_reference_local_date(target_workspace_id, server_now);

  if target_request.requested_clock_in_at is not null
     and ((target_request.requested_clock_in_at at time zone timezone_name)::date <> target_request.work_date) then
    raise exception 'Requested clock-in time no longer matches the request work date.' using errcode = 'P0001';
  end if;

  if target_request.requested_clock_out_at is not null
     and ((target_request.requested_clock_out_at at time zone timezone_name)::date <> target_request.work_date) then
    raise exception 'Requested clock-out time no longer matches the request work date.' using errcode = 'P0001';
  end if;

  select *
  into target_shift
  from public.attendance_shifts
  where workspace_id = target_workspace_id
    and member_id = target_request.member_id
    and work_date = target_request.work_date
  limit 1;

  before_payload := jsonb_build_object(
    'shiftId', target_shift.id,
    'clockInAt', target_shift.clock_in_at,
    'clockOutAt', target_shift.clock_out_at
  );

  if target_shift.id is null then
    if target_request.requested_clock_in_at is null or target_request.requested_clock_out_at is null then
      raise exception 'Approving a missing shift requires both clock-in and clock-out times.' using errcode = 'P0001';
    end if;

    if target_request.work_date < current_local_date and target_request.requested_clock_out_at is null then
      raise exception 'Past-date adjustments cannot create an open shift.' using errcode = 'P0001';
    end if;

    insert into public.attendance_shifts (
      workspace_id,
      member_id,
      work_date,
      clock_in_at,
      clock_out_at,
      source,
      created_by_member_id,
      updated_by_member_id
    )
    values (
      target_workspace_id,
      target_request.member_id,
      target_request.work_date,
      target_request.requested_clock_in_at,
      target_request.requested_clock_out_at,
      'adjustment',
      reviewer_member_id,
      reviewer_member_id
    )
    returning *
    into target_shift;
  else
    next_clock_in := coalesce(target_request.requested_clock_in_at, target_shift.clock_in_at);
    next_clock_out := coalesce(target_request.requested_clock_out_at, target_shift.clock_out_at);

    if next_clock_in is null then
      raise exception 'A shift must have a clock-in time.' using errcode = 'P0001';
    end if;

    if target_request.work_date < current_local_date and next_clock_out is null then
      raise exception 'Past-date adjustments cannot leave a shift open.' using errcode = 'P0001';
    end if;

    if next_clock_out is not null and next_clock_out <= next_clock_in then
      raise exception 'Clock-out time must be later than clock-in time.' using errcode = 'P0001';
    end if;

    if exists (
      select 1
      from public.attendance_breaks existing_break
      where existing_break.shift_id = target_shift.id
        and (
          existing_break.started_at < next_clock_in
          or (next_clock_out is not null and coalesce(existing_break.ended_at, existing_break.started_at) > next_clock_out)
        )
    ) then
      raise exception 'This adjustment conflicts with existing break entries. Review break history first.' using errcode = 'P0001';
    end if;

    update public.attendance_shifts
    set clock_in_at = next_clock_in,
        clock_out_at = next_clock_out,
        source = case when source = 'manual' then 'adjustment' else source end,
        updated_by_member_id = reviewer_member_id
    where id = target_shift.id
    returning *
    into target_shift;

    if next_clock_out is not null then
      update public.attendance_breaks
      set ended_at = coalesce(ended_at, next_clock_out),
          updated_by_member_id = reviewer_member_id
      where shift_id = target_shift.id
        and ended_at is null;
    end if;
  end if;

  update public.attendance_adjustment_requests
  set status = 'Approved',
      shift_id = target_shift.id,
      reviewed_by_member_id = reviewer_member_id,
      reviewed_at = server_now,
      resolution_note = trim(coalesce(p_resolution_note, '')),
      applied_at = server_now
  where id = target_request.id;

  after_payload := jsonb_build_object(
    'shiftId', target_shift.id,
    'clockInAt', target_shift.clock_in_at,
    'clockOutAt', target_shift.clock_out_at
  );

  perform private.insert_attendance_audit_event(
    target_workspace_id,
    reviewer_member_id,
    'adjustment-request',
    target_request.id,
    'request-approved',
    jsonb_build_object(
      'before', before_payload,
      'after', after_payload,
      'resolutionNote', trim(coalesce(p_resolution_note, ''))
    )
  );

  return public.get_attendance_snapshot(server_now);
end;
$$;

create or replace function public.upsert_attendance_policy(
  p_shift_start text,
  p_shift_end text,
  p_late_after_minutes integer,
  p_half_day_after_minutes integer,
  p_auto_absent_after_minutes integer,
  p_break_minutes integer,
  p_timezone text,
  p_work_days smallint[],
  p_break_types jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  reviewer_member_id uuid;
  normalized_shift_start time;
  normalized_shift_end time;
  normalized_late integer := greatest(0, coalesce(p_late_after_minutes, 0));
  normalized_half_day integer := greatest(0, coalesce(p_half_day_after_minutes, 0));
  normalized_auto_absent integer := greatest(0, coalesce(p_auto_absent_after_minutes, 0));
  normalized_break_minutes integer := greatest(0, coalesce(p_break_minutes, 0));
  normalized_timezone text;
  normalized_work_days smallint[];
  break_item jsonb;
  break_code text;
  break_label text;
  break_duration integer;
  break_paid boolean;
  break_required boolean;
  break_max integer;
  break_min integer;
  break_window_start time;
  break_window_end time;
  break_index integer := 0;
begin
  target_workspace_id := private.current_workspace_id();
  reviewer_member_id := private.require_attendance_manager(target_workspace_id);
  perform private.ensure_attendance_policy_defaults(target_workspace_id, reviewer_member_id);

  normalized_shift_start := trim(coalesce(p_shift_start, ''))::time;
  normalized_shift_end := trim(coalesce(p_shift_end, ''))::time;

  if normalized_shift_end <= normalized_shift_start then
    raise exception 'Shift end must be later than shift start.' using errcode = 'P0001';
  end if;

  if normalized_half_day < normalized_late then
    raise exception 'Half-day threshold must be greater than or equal to late threshold.' using errcode = 'P0001';
  end if;

  if normalized_auto_absent > 0 and normalized_auto_absent < normalized_half_day then
    raise exception 'Auto-absent threshold must be greater than or equal to half-day threshold.' using errcode = 'P0001';
  end if;

  normalized_timezone := trim(coalesce(p_timezone, ''));
  if normalized_timezone = '' or lower(normalized_timezone) = 'local' then
    normalized_timezone := private.attendance_effective_timezone(target_workspace_id);
  end if;

  select coalesce(
    array_agg(distinct work_day order by work_day),
    array[]::smallint[]
  )
  into normalized_work_days
  from unnest(coalesce(p_work_days, array[]::smallint[])) as selected_day(work_day)
  where work_day between 0 and 6;

  if cardinality(normalized_work_days) = 0 then
    raise exception 'Select at least one attendance work day.' using errcode = 'P0001';
  end if;

  if coalesce(jsonb_typeof(p_break_types), '') <> 'array' or jsonb_array_length(coalesce(p_break_types, '[]'::jsonb)) = 0 then
    raise exception 'Attendance break rules are required.' using errcode = 'P0001';
  end if;

  insert into public.attendance_policies (
    workspace_id,
    shift_start,
    shift_end,
    late_after_minutes,
    half_day_after_minutes,
    auto_absent_after_minutes,
    break_minutes,
    timezone,
    work_days,
    created_by_member_id,
    updated_by_member_id
  )
  values (
    target_workspace_id,
    normalized_shift_start,
    normalized_shift_end,
    normalized_late,
    normalized_half_day,
    normalized_auto_absent,
    normalized_break_minutes,
    normalized_timezone,
    normalized_work_days,
    reviewer_member_id,
    reviewer_member_id
  )
  on conflict (workspace_id) do update
  set shift_start = excluded.shift_start,
      shift_end = excluded.shift_end,
      late_after_minutes = excluded.late_after_minutes,
      half_day_after_minutes = excluded.half_day_after_minutes,
      auto_absent_after_minutes = excluded.auto_absent_after_minutes,
      break_minutes = excluded.break_minutes,
      timezone = excluded.timezone,
      work_days = excluded.work_days,
      updated_by_member_id = reviewer_member_id;

  delete from public.attendance_break_rules
  where workspace_id = target_workspace_id;

  for break_item in
    select value
    from jsonb_array_elements(p_break_types)
  loop
    break_index := break_index + 1;
    break_code := lower(trim(coalesce(break_item ->> 'id', '')));
    break_label := trim(coalesce(break_item ->> 'label', ''));
    break_duration := greatest(1, coalesce((break_item ->> 'durationMinutes')::integer, 1));
    break_paid := coalesce((break_item ->> 'paid')::boolean, false);
    break_required := coalesce((break_item ->> 'required')::boolean, false);
    break_max := greatest(1, coalesce((break_item ->> 'maxPerDay')::integer, 1));
    break_min := greatest(0, coalesce((break_item ->> 'minPerDay')::integer, 0));
    break_window_start := trim(coalesce(break_item ->> 'windowStart', ''))::time;
    break_window_end := trim(coalesce(break_item ->> 'windowEnd', ''))::time;

    if break_code = '' then
      raise exception 'Each attendance break rule requires an id.' using errcode = 'P0001';
    end if;

    if break_label = '' then
      break_label := initcap(replace(break_code, '_', ' '));
    end if;

    if break_window_end <= break_window_start then
      raise exception 'Attendance break window end must be later than the start.' using errcode = 'P0001';
    end if;

    if break_min > break_max then
      raise exception 'Attendance break minimum usage cannot exceed the maximum.' using errcode = 'P0001';
    end if;

    insert into public.attendance_break_rules (
      workspace_id,
      code,
      label,
      sort_order,
      duration_minutes,
      paid,
      required,
      max_per_day,
      min_per_day,
      window_start,
      window_end
    )
    values (
      target_workspace_id,
      break_code,
      break_label,
      break_index,
      break_duration,
      break_paid,
      break_required,
      break_max,
      break_min,
      break_window_start,
      break_window_end
    );
  end loop;

  perform private.insert_attendance_audit_event(
    target_workspace_id,
    reviewer_member_id,
    'policy',
    target_workspace_id,
    'policy-upserted',
    jsonb_build_object(
      'shiftStart', to_char(normalized_shift_start, 'HH24:MI'),
      'shiftEnd', to_char(normalized_shift_end, 'HH24:MI'),
      'lateAfterMinutes', normalized_late,
      'halfDayAfterMinutes', normalized_half_day,
      'autoAbsentAfterMinutes', normalized_auto_absent,
      'timezone', normalized_timezone,
      'workDays', to_jsonb(normalized_work_days)
    )
  );

  return public.get_attendance_snapshot(timezone('utc', now()));
end;
$$;

grant execute on function public.get_attendance_snapshot(timestamptz) to authenticated;
grant execute on function public.attendance_clock_in() to authenticated;
grant execute on function public.attendance_start_break(text) to authenticated;
grant execute on function public.attendance_end_break() to authenticated;
grant execute on function public.attendance_clock_out() to authenticated;
grant execute on function public.create_attendance_adjustment_request(date, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.review_attendance_adjustment_request(uuid, text, text) to authenticated;
grant execute on function public.upsert_attendance_policy(text, text, integer, integer, integer, integer, text, smallint[], jsonb) to authenticated;

commit;
