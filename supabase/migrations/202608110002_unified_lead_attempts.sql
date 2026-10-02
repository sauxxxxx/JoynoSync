begin;

alter table public.lead_activity_events
  drop constraint if exists lead_activity_events_type_check;
alter table public.lead_activity_events
  add constraint lead_activity_events_type_check check (
    event_type in (
      'owner_changed', 'archived', 'unarchived', 'field_changed', 'bulk_reassigned',
      'call_attempted', 'call_connected', 'status_restarted', 'status_repaired'
    )
  );

create or replace function private.next_lead_attempt_cleanup_at(p_touch_at timestamptz)
returns timestamptz
language sql
stable
set search_path = public, private
as $$
  with local_touch as (
    select timezone('Asia/Manila', coalesce(p_touch_at, timezone('utc', now()))) as value
  ), target_date as (
    select
      value,
      value::date +
        case
          when extract(dow from value)::integer = 5 and value::time > time '08:00' then 7
          else (5 - extract(dow from value)::integer + 7) % 7
        end as friday
    from local_touch
  )
  select (friday + time '08:00') at time zone 'Asia/Manila'
  from target_date;
$$;

create or replace function private.apply_lead_attempt_state(
  p_workspace_id uuid,
  p_lead_id uuid,
  p_actor_member_id uuid,
  p_reason text,
  p_note text default '',
  p_touch_at timestamptz default timezone('utc', now()),
  p_source text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_lead public.leads%rowtype;
  actor_name text;
  current_meta jsonb;
  current_history jsonb;
  current_count integer := 0;
  next_count integer;
  next_status text;
  normalized_reason text := trim(coalesce(p_reason, ''));
  normalized_reason_key text := lower(trim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')));
  touch_at timestamptz := coalesce(p_touch_at, timezone('utc', now()));
  status_changed boolean := false;
begin
  if normalized_reason = '' then
    raise exception 'Choose an attempt reason.' using errcode = 'P0001';
  end if;

  select * into target_lead
  from public.leads
  where id = p_lead_id and workspace_id = p_workspace_id
  for update;
  if target_lead.id is null then
    raise exception 'Lead was not found.' using errcode = 'P0001';
  end if;

  if target_lead.owner_member_id is distinct from p_actor_member_id
     and not private.team_member_has_permission(p_workspace_id, p_actor_member_id, 'leads', 'edit') then
    raise exception 'You can only log attempts for leads assigned to you.' using errcode = 'P0001';
  end if;

  select name into actor_name
  from public.team_members
  where id = p_actor_member_id and workspace_id = p_workspace_id;

  current_meta := coalesce(target_lead.meta, '{}'::jsonb);
  if coalesce(current_meta ->> 'attemptCount', '') ~ '^\d+$' then
    current_count := least(3, greatest(0, (current_meta ->> 'attemptCount')::integer));
  end if;
  next_count := least(3, current_count + 1);
  current_history := case
    when jsonb_typeof(current_meta -> 'attemptHistory') = 'array' then current_meta -> 'attemptHistory'
    else '[]'::jsonb
  end;

  next_status := coalesce(nullif(target_lead.status, ''), 'New');
  if normalized_reason_key = 'qualified' then
    next_status := 'Qualified';
  elsif normalized_reason_key in (
    'wrong number', 'not interested', 'talk to author, not interested', 'talked to author, not interested'
  ) then
    next_status := 'Unqualified';
  elsif next_status = 'New' then
    next_status := 'Contacted';
  end if;
  status_changed := next_status is distinct from target_lead.status;

  current_meta := current_meta || jsonb_build_object(
    'attemptCount', next_count,
    'lastAttemptAt', touch_at,
    'lastAttemptReason', normalized_reason,
    'assignedAt', coalesce(nullif(current_meta ->> 'assignedAt', ''), target_lead.created_at::text, touch_at::text),
    'attemptHistory', current_history || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(),
      'createdAt', touch_at,
      'reason', normalized_reason,
      'note', trim(coalesce(p_note, '')),
      'actor', coalesce(actor_name, ''),
      'outcome', next_status,
      'source', trim(coalesce(p_source, 'manual'))
    ))
  );

  if next_count >= 3 and next_status not in ('Qualified', 'Unqualified', 'Converted') then
    current_meta := current_meta || jsonb_build_object(
      'attemptLimitAt', coalesce(nullif(current_meta ->> 'attemptLimitAt', ''), touch_at::text),
      'attemptLimitRemovalDueAt', coalesce(
        nullif(current_meta ->> 'attemptLimitRemovalDueAt', ''),
        private.next_lead_attempt_cleanup_at(touch_at)::text
      ),
      'attemptLimitRemovalState', coalesce(nullif(current_meta ->> 'attemptLimitRemovalState', ''), 'pending'),
      'attemptLimitRemovedFromActiveAt', '',
      'attemptLimitRemovedFromActiveReason', ''
    );
  end if;

  if status_changed then
    current_meta := current_meta || jsonb_build_object(
      'lastStatusChangedAt', touch_at,
      'lastStatusChangedByMemberId', p_actor_member_id,
      'lastStatusChangedByName', coalesce(actor_name, ''),
      'lastStatusChangedFrom', coalesce(target_lead.status, ''),
      'lastStatusChangedTo', next_status
    );
  end if;

  update public.leads
  set status = next_status,
      meta = current_meta,
      last_touch_at = greatest(coalesce(last_touch_at, touch_at), touch_at),
      last_call_outcome = normalized_reason,
      updated_by_member_id = p_actor_member_id
  where id = p_lead_id and workspace_id = p_workspace_id;

  return jsonb_build_object(
    'leadId', p_lead_id,
    'status', next_status,
    'attemptCount', next_count,
    'lastTouchAt', touch_at,
    'lastCallOutcome', normalized_reason,
    'meta', current_meta,
    'statusChanged', status_changed
  );
end;
$$;

create or replace function public.record_lead_attempt(
  p_lead_id uuid,
  p_reason text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  result jsonb;
  touch_at timestamptz := timezone('utc', now());
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);
  result := private.apply_lead_attempt_state(
    target_workspace_id, p_lead_id, actor_member_id, p_reason, p_note, touch_at, 'manual'
  );

  insert into public.lead_activity_events (
    workspace_id, lead_id, event_type, actor_member_id, new_value, metadata, is_sales_touch
  ) values (
    target_workspace_id,
    p_lead_id,
    case when lower(trim(coalesce(p_reason, ''))) in ('spoke, follow-up needed', 'qualified')
      then 'call_connected' else 'call_attempted' end,
    actor_member_id,
    jsonb_build_object('outcome', trim(coalesce(p_reason, '')), 'notes', trim(coalesce(p_note, ''))),
    jsonb_build_object('source', 'manual'),
    true
  );

  return result;
end;
$$;

create or replace function private.capture_call_wrapup_lead_attempt()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  linked_lead_id uuid;
begin
  if old.outcome_submitted_at is not null or new.outcome_submitted_at is null
     or lower(coalesce(new.linked_entity_type, '')) <> 'lead' then
    return new;
  end if;
  begin
    linked_lead_id := nullif(trim(new.linked_entity_id), '')::uuid;
  exception when invalid_text_representation then
    linked_lead_id := null;
  end;
  if linked_lead_id is not null and new.member_id is not null then
    perform private.apply_lead_attempt_state(
      new.workspace_id,
      linked_lead_id,
      new.member_id,
      new.disposition,
      new.wrapup_notes,
      coalesce(new.ended_at, new.answered_at, new.started_at, new.outcome_submitted_at),
      'ringcentral'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists capture_call_wrapup_lead_attempt on public.call_logs;
create trigger capture_call_wrapup_lead_attempt
after update of outcome_submitted_at on public.call_logs
for each row
execute function private.capture_call_wrapup_lead_attempt();

revoke all on function private.next_lead_attempt_cleanup_at(timestamptz) from public;
revoke all on function private.apply_lead_attempt_state(uuid, uuid, uuid, text, text, timestamptz, text) from public;
revoke all on function private.capture_call_wrapup_lead_attempt() from public;
revoke all on function public.record_lead_attempt(uuid, text, text) from public;
grant execute on function public.record_lead_attempt(uuid, text, text) to authenticated;

commit;
