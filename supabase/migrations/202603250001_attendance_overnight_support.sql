alter table if exists public.attendance_policies
  drop constraint if exists attendance_policies_shift_window_check;

alter table if exists public.attendance_policies
  add constraint attendance_policies_shift_window_check
  check (shift_end <> shift_start);

alter table if exists public.attendance_break_rules
  drop constraint if exists attendance_break_rules_window_check;

alter table if exists public.attendance_break_rules
  add constraint attendance_break_rules_window_check
  check (window_end <> window_start);

create or replace function private.attendance_reference_shift_date(
  target_workspace_id uuid,
  reference_at timestamptz default timezone('utc', now())
)
returns date
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  local_timestamp timestamp;
  local_date date;
  local_time time;
  policy_shift_start time := time '09:00';
  policy_shift_end time := time '18:00';
begin
  local_timestamp := coalesce(reference_at, timezone('utc', now())) at time zone private.attendance_effective_timezone(target_workspace_id);
  local_date := local_timestamp::date;
  local_time := local_timestamp::time;

  select ap.shift_start, ap.shift_end
  into policy_shift_start, policy_shift_end
  from public.attendance_policies ap
  where ap.workspace_id = target_workspace_id
  limit 1;

  if policy_shift_end < policy_shift_start and local_time < policy_shift_end then
    return local_date - 1;
  end if;

  return local_date;
end;
$$;

create or replace function private.attendance_time_in_window(
  local_time time,
  window_start time,
  window_end time
)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select case
    when local_time is null or window_start is null or window_end is null then false
    when window_end > window_start then local_time >= window_start and local_time <= window_end
    when window_end < window_start then local_time >= window_start or local_time <= window_end
    else false
  end;
$$;

create or replace function private.attendance_requested_time_matches_work_date(
  target_workspace_id uuid,
  target_work_date date,
  requested_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  local_timestamp timestamp;
  local_date date;
  policy_shift_start time := time '09:00';
  policy_shift_end time := time '18:00';
begin
  if requested_at is null or target_work_date is null then
    return true;
  end if;

  local_timestamp := requested_at at time zone private.attendance_effective_timezone(target_workspace_id);
  local_date := local_timestamp::date;

  select ap.shift_start, ap.shift_end
  into policy_shift_start, policy_shift_end
  from public.attendance_policies ap
  where ap.workspace_id = target_workspace_id
  limit 1;

  if policy_shift_end < policy_shift_start then
    return local_date = target_work_date or local_date = target_work_date + 1;
  end if;

  return local_date = target_work_date;
end;
$$;

revoke all on function private.attendance_reference_shift_date(uuid, timestamptz) from public;
revoke all on function private.attendance_time_in_window(time, time, time) from public;
revoke all on function private.attendance_requested_time_matches_work_date(uuid, date, timestamptz) from public;

grant execute on function private.attendance_reference_shift_date(uuid, timestamptz) to authenticated;
grant execute on function private.attendance_time_in_window(time, time, time) to authenticated;
grant execute on function private.attendance_requested_time_matches_work_date(uuid, date, timestamptz) to authenticated;

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
  shift_date date;
  existing_shift public.attendance_shifts%rowtype;
  open_shift public.attendance_shifts%rowtype;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);
  perform private.ensure_attendance_policy_defaults(target_workspace_id, actor_member_id);
  shift_date := private.attendance_reference_shift_date(target_workspace_id, server_now);

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
    and work_date = shift_date
  limit 1;

  if existing_shift.id is not null then
    raise exception 'A shift already exists for the current shift day. Use an adjustment request instead.' using errcode = 'P0001';
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
    shift_date,
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

  if active_shift.work_date <> private.attendance_reference_shift_date(target_workspace_id, server_now) then
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

  if not private.attendance_time_in_window(local_time, break_rule.window_start, break_rule.window_end) then
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

  if p_requested_clock_in_at is not null
     and not private.attendance_requested_time_matches_work_date(target_workspace_id, p_work_date, p_requested_clock_in_at) then
    raise exception 'Requested clock-in time must fall on the selected shift day in the workspace timezone.' using errcode = 'P0001';
  end if;

  if p_requested_clock_out_at is not null
     and not private.attendance_requested_time_matches_work_date(target_workspace_id, p_work_date, p_requested_clock_out_at) then
    raise exception 'Requested clock-out time must fall on the selected shift day in the workspace timezone.' using errcode = 'P0001';
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
  target_request public.attendance_adjustment_requests%rowtype;
  target_shift public.attendance_shifts%rowtype;
  current_shift_date date;
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

  current_shift_date := private.attendance_reference_shift_date(target_workspace_id, server_now);

  if target_request.requested_clock_in_at is not null
     and not private.attendance_requested_time_matches_work_date(target_workspace_id, target_request.work_date, target_request.requested_clock_in_at) then
    raise exception 'Requested clock-in time no longer matches the request work date.' using errcode = 'P0001';
  end if;

  if target_request.requested_clock_out_at is not null
     and not private.attendance_requested_time_matches_work_date(target_workspace_id, target_request.work_date, target_request.requested_clock_out_at) then
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

    if target_request.work_date < current_shift_date and target_request.requested_clock_out_at is null then
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

    if target_request.work_date < current_shift_date and next_clock_out is null then
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

  if normalized_shift_end = normalized_shift_start then
    raise exception 'Shift start and end cannot be the same.' using errcode = 'P0001';
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
    break_code := lower(trim(coalesce(break_item ->> 'id', format('break_%s', break_index + 1))));
    break_label := trim(coalesce(break_item ->> 'label', format('Break %s', break_index + 1)));
    break_duration := greatest(1, coalesce((break_item ->> 'durationMinutes')::integer, 1));
    break_paid := coalesce((break_item ->> 'paid')::boolean, false);
    break_required := coalesce((break_item ->> 'required')::boolean, false);
    break_max := greatest(1, coalesce((break_item ->> 'maxPerDay')::integer, 1));
    break_min := greatest(0, coalesce((break_item ->> 'minPerDay')::integer, 0));
    break_window_start := trim(coalesce(break_item ->> 'windowStart', ''))::time;
    break_window_end := trim(coalesce(break_item ->> 'windowEnd', ''))::time;

    if break_code = '' then
      raise exception 'Attendance break rules must include an id.' using errcode = 'P0001';
    end if;

    if break_label = '' then
      raise exception 'Attendance break rules must include a label.' using errcode = 'P0001';
    end if;

    if break_min > break_max then
      raise exception 'Attendance break minimum usage cannot exceed the daily maximum.' using errcode = 'P0001';
    end if;

    if break_window_end = break_window_start then
      raise exception 'Attendance break window start and end cannot be the same.' using errcode = 'P0001';
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

    break_index := break_index + 1;
  end loop;

  perform private.insert_attendance_audit_event(
    target_workspace_id,
    reviewer_member_id,
    'policy',
    null,
    'policy-upserted',
    jsonb_build_object(
      'shiftStart', to_char(normalized_shift_start, 'HH24:MI'),
      'shiftEnd', to_char(normalized_shift_end, 'HH24:MI'),
      'lateAfterMinutes', normalized_late,
      'halfDayAfterMinutes', normalized_half_day,
      'autoAbsentAfterMinutes', normalized_auto_absent,
      'breakMinutes', normalized_break_minutes,
      'timezone', normalized_timezone,
      'workDays', to_jsonb(normalized_work_days)
    )
  );

  return public.get_attendance_snapshot(timezone('utc', now()));
end;
$$;
