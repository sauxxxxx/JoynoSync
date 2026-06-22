begin;

create or replace function public.delete_attendance_manual_entry(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  server_now timestamptz := timezone('utc', now());
  target_shift public.attendance_shifts%rowtype;
  break_payload jsonb := '[]'::jsonb;
  before_payload jsonb := '{}'::jsonb;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_attendance_manager(target_workspace_id);
  perform private.ensure_attendance_policy_defaults(target_workspace_id, actor_member_id);

  if p_shift_id is null then
    raise exception 'An attendance record is required.' using errcode = 'P0001';
  end if;

  select *
  into target_shift
  from public.attendance_shifts
  where id = p_shift_id
    and workspace_id = target_workspace_id
  for update;

  if target_shift.id is null then
    raise exception 'Attendance record not found in this workspace.' using errcode = 'P0001';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'breakId', break_row.id,
        'breakCode', break_row.break_code,
        'breakLabel', break_row.label,
        'paid', break_row.paid,
        'breakStartAt', break_row.started_at,
        'breakEndAt', break_row.ended_at
      )
      order by break_row.started_at asc
    ),
    '[]'::jsonb
  )
  into break_payload
  from public.attendance_breaks break_row
  where break_row.shift_id = target_shift.id;

  before_payload := jsonb_build_object(
    'shiftId', target_shift.id,
    'memberId', target_shift.member_id,
    'workDate', to_char(target_shift.work_date, 'YYYY-MM-DD'),
    'clockInAt', target_shift.clock_in_at,
    'clockOutAt', target_shift.clock_out_at,
    'breaks', break_payload
  );

  delete from public.attendance_shifts
  where id = target_shift.id;

  perform private.insert_attendance_audit_event(
    target_workspace_id,
    actor_member_id,
    'shift',
    target_shift.id,
    'manager-delete',
    jsonb_build_object('before', before_payload)
  );

  return public.get_attendance_snapshot(server_now);
end;
$$;

revoke all on function public.delete_attendance_manual_entry(uuid) from public;
grant execute on function public.delete_attendance_manual_entry(uuid) to authenticated;

commit;
