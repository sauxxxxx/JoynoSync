begin;

create or replace function public.upsert_attendance_manual_entry(
  p_member_id uuid,
  p_work_date date,
  p_clock_in_at timestamptz,
  p_clock_out_at timestamptz default null,
  p_break_start_at timestamptz default null,
  p_break_end_at timestamptz default null,
  p_break_code text default null,
  p_break_label text default null,
  p_break_paid boolean default null
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
  current_shift_date date;
  target_member public.team_members%rowtype;
  target_shift public.attendance_shifts%rowtype;
  existing_break public.attendance_breaks%rowtype;
  break_rule public.attendance_break_rules%rowtype;
  resolved_break_code text := '';
  resolved_break_label text := '';
  resolved_break_paid boolean := false;
  before_payload jsonb := '{}'::jsonb;
  after_payload jsonb := '{}'::jsonb;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_attendance_manager(target_workspace_id);
  perform private.ensure_attendance_policy_defaults(target_workspace_id, actor_member_id);
  current_shift_date := private.attendance_reference_shift_date(target_workspace_id, server_now);

  if p_member_id is null then
    raise exception 'A team member is required.' using errcode = 'P0001';
  end if;

  if p_work_date is null then
    raise exception 'A work date is required.' using errcode = 'P0001';
  end if;

  if p_clock_in_at is null then
    raise exception 'A clock-in time is required.' using errcode = 'P0001';
  end if;

  if p_clock_out_at is not null and p_clock_out_at <= p_clock_in_at then
    raise exception 'Clock-out time must be later than clock-in time.' using errcode = 'P0001';
  end if;

  if (p_break_start_at is null and p_break_end_at is not null)
     or (p_break_start_at is not null and p_break_end_at is null) then
    raise exception 'Break start and break end must both be provided.' using errcode = 'P0001';
  end if;

  if p_break_start_at is not null and p_break_end_at <= p_break_start_at then
    raise exception 'Break end must be later than break start.' using errcode = 'P0001';
  end if;

  if p_break_start_at is not null and p_break_start_at < p_clock_in_at then
    raise exception 'Break must start after clock-in.' using errcode = 'P0001';
  end if;

  if p_clock_out_at is not null and p_break_end_at is not null and p_break_end_at > p_clock_out_at then
    raise exception 'Break must end before clock-out.' using errcode = 'P0001';
  end if;

  if not private.attendance_requested_time_matches_work_date(target_workspace_id, p_work_date, p_clock_in_at) then
    raise exception 'Clock-in time does not match the selected work date.' using errcode = 'P0001';
  end if;

  if p_clock_out_at is not null
     and not private.attendance_requested_time_matches_work_date(target_workspace_id, p_work_date, p_clock_out_at) then
    raise exception 'Clock-out time does not match the selected work date.' using errcode = 'P0001';
  end if;

  if p_break_start_at is not null
     and not private.attendance_requested_time_matches_work_date(target_workspace_id, p_work_date, p_break_start_at) then
    raise exception 'Break start does not match the selected work date.' using errcode = 'P0001';
  end if;

  if p_break_end_at is not null
     and not private.attendance_requested_time_matches_work_date(target_workspace_id, p_work_date, p_break_end_at) then
    raise exception 'Break end does not match the selected work date.' using errcode = 'P0001';
  end if;

  if p_work_date < current_shift_date and p_clock_out_at is null then
    raise exception 'Past-date adjustments cannot leave a shift open.' using errcode = 'P0001';
  end if;

  select *
  into target_member
  from public.team_members
  where id = p_member_id
    and workspace_id = target_workspace_id
  limit 1;

  if target_member.id is null then
    raise exception 'Team member not found in this workspace.' using errcode = 'P0001';
  end if;

  select *
  into target_shift
  from public.attendance_shifts
  where workspace_id = target_workspace_id
    and member_id = p_member_id
    and work_date = p_work_date
  for update;

  if target_shift.id is not null then
    select *
    into existing_break
    from public.attendance_breaks
    where shift_id = target_shift.id
    order by started_at asc
    limit 1;
  end if;

  before_payload := jsonb_build_object(
    'shiftId', target_shift.id,
    'clockInAt', target_shift.clock_in_at,
    'clockOutAt', target_shift.clock_out_at,
    'breakId', existing_break.id,
    'breakCode', existing_break.break_code,
    'breakStartAt', existing_break.started_at,
    'breakEndAt', existing_break.ended_at
  );

  if target_shift.id is null then
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
      p_member_id,
      p_work_date,
      p_clock_in_at,
      p_clock_out_at,
      'manual-admin',
      actor_member_id,
      actor_member_id
    )
    returning *
    into target_shift;
  else
    update public.attendance_shifts
    set clock_in_at = p_clock_in_at,
        clock_out_at = p_clock_out_at,
        source = 'manual-admin',
        updated_by_member_id = actor_member_id
    where id = target_shift.id
    returning *
    into target_shift;
  end if;

  delete from public.attendance_breaks
  where shift_id = target_shift.id;

  if p_break_start_at is not null and p_break_end_at is not null then
    resolved_break_code := lower(trim(coalesce(nullif(p_break_code, ''), nullif(existing_break.break_code, ''))));

    if resolved_break_code <> '' then
      select *
      into break_rule
      from public.attendance_break_rules
      where workspace_id = target_workspace_id
        and code = resolved_break_code
      limit 1;
    end if;

    if break_rule.id is null then
      select *
      into break_rule
      from public.attendance_break_rules
      where workspace_id = target_workspace_id
        and private.attendance_time_in_window(
          (p_break_start_at at time zone private.attendance_effective_timezone(target_workspace_id))::time,
          window_start,
          window_end
        )
      order by sort_order, code
      limit 1;
    end if;

    if break_rule.id is null then
      select *
      into break_rule
      from public.attendance_break_rules
      where workspace_id = target_workspace_id
      order by sort_order, code
      limit 1;
    end if;

    resolved_break_code := coalesce(nullif(resolved_break_code, ''), break_rule.code, 'manual');
    resolved_break_label := coalesce(nullif(trim(coalesce(p_break_label, '')), ''), nullif(existing_break.label, ''), break_rule.label, 'Manual Break');
    resolved_break_paid := coalesce(p_break_paid, existing_break.paid, break_rule.paid, false);

    insert into public.attendance_breaks (
      workspace_id,
      shift_id,
      break_code,
      label,
      paid,
      started_at,
      ended_at,
      created_by_member_id,
      updated_by_member_id
    )
    values (
      target_workspace_id,
      target_shift.id,
      resolved_break_code,
      resolved_break_label,
      resolved_break_paid,
      p_break_start_at,
      p_break_end_at,
      actor_member_id,
      actor_member_id
    );
  end if;

  after_payload := jsonb_build_object(
    'shiftId', target_shift.id,
    'memberId', p_member_id,
    'workDate', to_char(p_work_date, 'YYYY-MM-DD'),
    'clockInAt', target_shift.clock_in_at,
    'clockOutAt', target_shift.clock_out_at,
    'breakStartAt', p_break_start_at,
    'breakEndAt', p_break_end_at,
    'breakCode', nullif(resolved_break_code, ''),
    'breakLabel', nullif(resolved_break_label, '')
  );

  perform private.insert_attendance_audit_event(
    target_workspace_id,
    actor_member_id,
    'shift',
    target_shift.id,
    'manager-upsert',
    jsonb_build_object(
      'before', before_payload,
      'after', after_payload
    )
  );

  return public.get_attendance_snapshot(server_now);
end;
$$;

revoke all on function public.upsert_attendance_manual_entry(uuid, date, timestamptz, timestamptz, timestamptz, timestamptz, text, text, boolean) from public;
grant execute on function public.upsert_attendance_manual_entry(uuid, date, timestamptz, timestamptz, timestamptz, timestamptz, text, text, boolean) to authenticated;

commit;
