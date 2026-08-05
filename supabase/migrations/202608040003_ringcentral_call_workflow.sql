begin;

alter table public.call_logs
  add column if not exists follow_up_at timestamptz,
  add column if not exists follow_up_task_id uuid references public.tasks(id) on delete set null,
  add column if not exists outcome_submitted_at timestamptz;

alter table public.leads
  add column if not exists last_touch_at timestamptz,
  add column if not exists last_call_outcome text not null default '';

create index if not exists call_logs_pending_reconciliation_idx
  on public.call_logs (workspace_id, member_id, direction, to_number, started_at desc)
  where provider_session_id = '';

create index if not exists leads_workspace_last_touch_idx
  on public.leads (workspace_id, last_touch_at desc, id);

create or replace function private.call_log_json(target_call_log_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'id', cl.id,
    'workspaceId', cl.workspace_id,
    'memberId', cl.member_id,
    'provider', cl.provider,
    'providerCallId', cl.provider_call_id,
    'providerSessionId', cl.provider_session_id,
    'providerPartyId', cl.provider_party_id,
    'providerQueueId', cl.provider_queue_id,
    'queueName', cl.queue_name_snapshot,
    'direction', cl.direction,
    'fromNumber', cl.from_number,
    'toNumber', cl.to_number,
    'counterpartyName', cl.counterparty_name,
    'status', cl.status,
    'muted', cl.muted,
    'onHold', cl.on_hold,
    'recordingEnabled', cl.recording_enabled,
    'recordingStatus', cl.recording_status,
    'transferTarget', cl.transfer_target,
    'disposition', cl.disposition,
    'wrapupNotes', cl.wrapup_notes,
    'followUpAction', cl.follow_up_action,
    'followUpAt', cl.follow_up_at,
    'followUpTaskId', cl.follow_up_task_id,
    'outcomeSubmittedAt', cl.outcome_submitted_at,
    'linkedEntityType', cl.linked_entity_type,
    'linkedEntityId', cl.linked_entity_id,
    'linkedLabel', cl.linked_label_snapshot,
    'popupSeenAt', cl.popup_seen_at,
    'popupDismissedAt', cl.popup_dismissed_at,
    'startedAt', cl.started_at,
    'answeredAt', cl.answered_at,
    'endedAt', cl.ended_at,
    'durationSeconds', cl.duration_seconds,
    'createdAt', cl.created_at,
    'updatedAt', cl.updated_at,
    'recordings', private.call_recordings_json(cl.id)
  )
  from public.call_logs cl
  where cl.id = target_call_log_id
  limit 1;
$$;

create or replace function public.complete_call_wrapup(p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  target_call_id uuid;
  target_workspace_id uuid;
  actor_member_id uuid;
  current_call public.call_logs%rowtype;
  outcome_value text := trim(coalesce(payload ->> 'outcome', ''));
  notes_value text := trim(coalesce(payload ->> 'notes', ''));
  follow_up_value text := lower(trim(coalesce(payload ->> 'followUpAction', 'none')));
  follow_up_at_value timestamptz;
  follow_up_local_value timestamp;
  next_task_id uuid;
  source_task_id uuid;
  linked_lead_id uuid;
  touch_at timestamptz;
begin
  begin
    target_call_id := nullif(trim(coalesce(payload ->> 'callLogId', '')), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid call record is required.' using errcode = 'P0001';
  end;

  if target_call_id is null then
    raise exception 'Call record is required.' using errcode = 'P0001';
  end if;

  select * into current_call
  from public.call_logs
  where id = target_call_id
  for update;

  if current_call.id is null then
    raise exception 'Call record not found.' using errcode = 'P0001';
  end if;

  target_workspace_id := current_call.workspace_id;
  actor_member_id := private.require_active_workspace_member(target_workspace_id);
  if current_call.member_id is distinct from actor_member_id
     and not private.can_manage_calls_workspace(target_workspace_id) then
    raise exception 'Only the assigned agent or a manager can complete this call.' using errcode = 'P0001';
  end if;

  if current_call.outcome_submitted_at is not null then
    return private.calls_snapshot_json(target_workspace_id, actor_member_id);
  end if;

  if outcome_value not in (
    'Connected', 'No Answer', 'Voicemail', 'Busy', 'Callback Requested',
    'Wrong Number', 'Not Interested', 'Qualified', 'Call Failed'
  ) then
    raise exception 'Select a valid call outcome.' using errcode = 'P0001';
  end if;

  if outcome_value in ('Connected', 'Callback Requested', 'Wrong Number', 'Not Interested', 'Qualified', 'Call Failed')
     and length(notes_value) < 3 then
    raise exception 'Add a short note explaining the call result.' using errcode = 'P0001';
  end if;

  if follow_up_value not in ('none', 'task', 'callback') then
    raise exception 'Select a valid next step.' using errcode = 'P0001';
  end if;
  if outcome_value not in ('Wrong Number', 'Not Interested') and follow_up_value = 'none' then
    raise exception 'Choose the next task for this lead.' using errcode = 'P0001';
  end if;

  if follow_up_value <> 'none' then
    begin
      follow_up_at_value := nullif(trim(coalesce(payload ->> 'followUpAt', '')), '')::timestamptz;
      follow_up_local_value := nullif(trim(coalesce(payload ->> 'followUpLocal', '')), '')::timestamp;
    exception when others then
      raise exception 'Choose a valid follow-up date and time.' using errcode = 'P0001';
    end;
    if follow_up_at_value is null or follow_up_local_value is null or follow_up_at_value <= timezone('utc', now()) then
      raise exception 'The next task must be scheduled in the future.' using errcode = 'P0001';
    end if;
  end if;

  if follow_up_value <> 'none' then
    insert into public.tasks (
      workspace_id, title, description, status, priority, assignee_member_id,
      due_date, start_time, reminder_minutes, recurrence, linked_entity_type,
      linked_entity_id, linked_label_snapshot, task_type, call_phone_snapshot,
      backlog_state, client_request_id, created_by_member_id, updated_by_member_id
    ) values (
      target_workspace_id,
      case when follow_up_value = 'callback' then 'Callback: ' else 'Follow up: ' end ||
        coalesce(nullif(current_call.linked_label_snapshot, ''), nullif(current_call.counterparty_name, ''), current_call.to_number),
      notes_value,
      'Scheduled',
      case when outcome_value in ('Qualified', 'Callback Requested') then 'high' else 'medium' end,
      coalesce(current_call.member_id, actor_member_id),
      follow_up_local_value::date,
      follow_up_local_value::time,
      15,
      'none',
      current_call.linked_entity_type,
      current_call.linked_entity_id,
      current_call.linked_label_snapshot,
      case when follow_up_value = 'callback' then 'Callback' else 'Call' end,
      current_call.to_number,
      'scheduled',
      'call-wrapup:' || current_call.id::text,
      actor_member_id,
      actor_member_id
    )
    returning id into next_task_id;
  end if;

  begin
    source_task_id := nullif(trim(coalesce(current_call.raw_payload -> 'request' ->> 'sourceTaskId', '')), '')::uuid;
  exception when invalid_text_representation then
    source_task_id := null;
  end;
  if source_task_id is not null then
    update public.tasks
    set status = 'Completed', completed_at = timezone('utc', now()), updated_by_member_id = actor_member_id
    where id = source_task_id
      and workspace_id = target_workspace_id
      and status <> 'Completed'
      and (assignee_member_id = actor_member_id or private.can_manage_calls_workspace(target_workspace_id));
  end if;

  touch_at := coalesce(current_call.ended_at, current_call.answered_at, current_call.started_at, timezone('utc', now()));
  if lower(current_call.linked_entity_type) = 'lead' then
    begin
      linked_lead_id := nullif(trim(current_call.linked_entity_id), '')::uuid;
    exception when invalid_text_representation then
      linked_lead_id := null;
    end;
  end if;

  if linked_lead_id is not null then
    update public.leads
    set last_touch_at = greatest(coalesce(last_touch_at, touch_at), touch_at),
        last_call_outcome = outcome_value
    where id = linked_lead_id and workspace_id = target_workspace_id;

    insert into public.lead_activity_events (
      workspace_id, lead_id, event_type, actor_member_id, new_value, metadata
    ) values (
      target_workspace_id,
      linked_lead_id,
      case when outcome_value in ('Connected', 'Callback Requested', 'Qualified') then 'call_connected' else 'call_attempted' end,
      actor_member_id,
      jsonb_build_object('outcome', outcome_value, 'notes', notes_value),
      jsonb_build_object(
        'source', 'ringcentral',
        'callLogId', current_call.id,
        'providerSessionId', current_call.provider_session_id,
        'durationSeconds', current_call.duration_seconds,
        'nextTaskId', next_task_id
      )
    );
  end if;

  update public.call_logs
  set disposition = outcome_value,
      wrapup_notes = notes_value,
      follow_up_action = follow_up_value,
      follow_up_at = follow_up_at_value,
      follow_up_task_id = next_task_id,
      outcome_submitted_at = timezone('utc', now()),
      wrapup_dismissed_at = null,
      status = case when status in ('connected', 'hold', 'transferring') then 'wrapup' else status end
  where id = current_call.id;

  return private.calls_snapshot_json(target_workspace_id, actor_member_id);
end;
$$;

revoke all on function public.complete_call_wrapup(jsonb) from public;
grant execute on function public.complete_call_wrapup(jsonb) to authenticated;
revoke execute on function public.save_call_wrapup(uuid, text, text, text) from authenticated;
revoke execute on function public.dismiss_call_wrapup(uuid) from authenticated;

commit;
