begin;

create table if not exists public.telephony_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  provider text not null default 'ringcentral',
  caller_id text not null default '',
  direct_number text not null default '',
  provider_user_ref text not null default '',
  provider_extension_ref text not null default '',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint telephony_identities_provider_check check (provider in ('ringcentral')),
  constraint telephony_identities_workspace_member_provider_key unique (workspace_id, member_id, provider)
);

create table if not exists public.agent_presence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  provider text not null default 'ringcentral',
  presence_status text not null default 'Available',
  accepting_queue_calls boolean not null default true,
  telephony_status text not null default '',
  active_call_count integer not null default 0,
  last_provider_sync_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint agent_presence_provider_check check (provider in ('ringcentral')),
  constraint agent_presence_status_check check (presence_status in ('Available', 'Busy', 'Offline', 'Dnd')),
  constraint agent_presence_workspace_member_provider_key unique (workspace_id, member_id, provider)
);

create table if not exists public.call_queues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null default 'ringcentral',
  provider_queue_id text not null,
  name text not null,
  extension_number text not null default '',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint call_queues_provider_check check (provider in ('ringcentral')),
  constraint call_queues_workspace_provider_queue_key unique (workspace_id, provider, provider_queue_id)
);

create table if not exists public.queue_memberships (
  queue_id uuid not null references public.call_queues(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  provider_member_ref text not null default '',
  accepting_calls boolean not null default true,
  role text not null default 'agent',
  last_provider_sync_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (queue_id, member_id),
  constraint queue_memberships_role_check check (role in ('agent', 'supervisor'))
);

create table if not exists public.call_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_id uuid references public.team_members(id) on delete set null,
  provider text not null default 'ringcentral',
  provider_call_id text not null default '',
  provider_session_id text not null default '',
  provider_party_id text not null default '',
  provider_queue_id text not null default '',
  queue_name_snapshot text not null default '',
  direction text not null default 'outbound',
  from_number text not null default '',
  to_number text not null default '',
  counterparty_name text not null default '',
  status text not null default 'queued',
  muted boolean not null default false,
  on_hold boolean not null default false,
  recording_enabled boolean not null default false,
  recording_status text not null default 'off',
  transfer_target text not null default '',
  disposition text not null default '',
  wrapup_notes text not null default '',
  follow_up_action text not null default 'none',
  linked_entity_type text not null default '',
  linked_entity_id text not null default '',
  linked_label_snapshot text not null default '',
  popup_seen_at timestamptz,
  popup_dismissed_at timestamptz,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer not null default 0,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint call_logs_provider_check check (provider in ('ringcentral')),
  constraint call_logs_direction_check check (direction in ('inbound', 'outbound')),
  constraint call_logs_status_check check (
    status in (
      'queued',
      'dialing',
      'ringing',
      'inbound',
      'connected',
      'hold',
      'transferring',
      'wrapup',
      'completed',
      'missed',
      'voicemail',
      'failed',
      'canceled',
      'declined'
    )
  ),
  constraint call_logs_recording_status_check check (recording_status in ('off', 'pending', 'recording', 'completed', 'failed')),
  constraint call_logs_follow_up_action_check check (follow_up_action in ('none', 'task', 'callback', 'sms', 'email'))
);

create table if not exists public.call_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  call_log_id uuid references public.call_logs(id) on delete cascade,
  provider text not null default 'ringcentral',
  provider_event_id text not null default '',
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.call_recordings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  call_log_id uuid not null references public.call_logs(id) on delete cascade,
  provider text not null default 'ringcentral',
  provider_recording_id text not null default '',
  status text not null default 'pending',
  duration_seconds integer not null default 0,
  access_url text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint call_recordings_provider_check check (provider in ('ringcentral')),
  constraint call_recordings_status_check check (status in ('pending', 'recording', 'completed', 'failed'))
);

create table if not exists public.voicemails (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_id uuid references public.team_members(id) on delete set null,
  call_log_id uuid references public.call_logs(id) on delete set null,
  provider text not null default 'ringcentral',
  provider_voicemail_id text not null default '',
  from_number text not null default '',
  to_number text not null default '',
  caller_name text not null default '',
  duration_seconds integer not null default 0,
  transcription text not null default '',
  access_url text not null default '',
  is_read boolean not null default false,
  raw_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint voicemails_provider_check check (provider in ('ringcentral')),
  constraint voicemails_workspace_provider_ref_key unique (workspace_id, provider, provider_voicemail_id)
);

drop trigger if exists set_telephony_identities_updated_at on public.telephony_identities;
create trigger set_telephony_identities_updated_at
before update on public.telephony_identities
for each row
execute function public.set_updated_at();

drop trigger if exists set_agent_presence_updated_at on public.agent_presence;
create trigger set_agent_presence_updated_at
before update on public.agent_presence
for each row
execute function public.set_updated_at();

drop trigger if exists set_call_queues_updated_at on public.call_queues;
create trigger set_call_queues_updated_at
before update on public.call_queues
for each row
execute function public.set_updated_at();

drop trigger if exists set_queue_memberships_updated_at on public.queue_memberships;
create trigger set_queue_memberships_updated_at
before update on public.queue_memberships
for each row
execute function public.set_updated_at();

drop trigger if exists set_call_logs_updated_at on public.call_logs;
create trigger set_call_logs_updated_at
before update on public.call_logs
for each row
execute function public.set_updated_at();

drop trigger if exists set_call_recordings_updated_at on public.call_recordings;
create trigger set_call_recordings_updated_at
before update on public.call_recordings
for each row
execute function public.set_updated_at();

drop trigger if exists set_voicemails_updated_at on public.voicemails;
create trigger set_voicemails_updated_at
before update on public.voicemails
for each row
execute function public.set_updated_at();

create index if not exists telephony_identities_workspace_member_idx
on public.telephony_identities (workspace_id, member_id, active);

create index if not exists telephony_identities_extension_idx
on public.telephony_identities (workspace_id, provider_extension_ref);

create index if not exists agent_presence_workspace_member_idx
on public.agent_presence (workspace_id, member_id, updated_at desc);

create index if not exists call_queues_workspace_idx
on public.call_queues (workspace_id, active, lower(name));

create index if not exists queue_memberships_member_idx
on public.queue_memberships (member_id, accepting_calls);

create index if not exists call_logs_workspace_member_idx
on public.call_logs (workspace_id, member_id, coalesce(answered_at, started_at, created_at) desc);

create index if not exists call_logs_workspace_status_idx
on public.call_logs (workspace_id, status, updated_at desc);

create index if not exists call_logs_provider_refs_idx
on public.call_logs (workspace_id, provider, provider_session_id, provider_party_id);

create index if not exists call_events_call_log_created_idx
on public.call_events (call_log_id, created_at desc);

create index if not exists call_recordings_call_log_idx
on public.call_recordings (call_log_id, created_at desc);

create index if not exists voicemails_workspace_member_received_idx
on public.voicemails (workspace_id, member_id, coalesce(received_at, created_at) desc);

create or replace function private.can_read_calls_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(private.current_team_status_for_workspace(target_workspace_id), '') = 'Active';
$$;

create or replace function private.can_manage_calls_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select lower(coalesce(private.current_team_role_for_workspace(target_workspace_id), '')) in ('owner', 'admin', 'manager');
$$;

create or replace function private.ensure_agent_presence_row(
  target_workspace_id uuid,
  target_member_id uuid
)
returns public.agent_presence
language plpgsql
security definer
set search_path = public, private
as $$
declare
  presence_row public.agent_presence%rowtype;
begin
  insert into public.agent_presence (
    workspace_id,
    member_id,
    provider,
    presence_status,
    accepting_queue_calls
  )
  values (
    target_workspace_id,
    target_member_id,
    'ringcentral',
    'Available',
    true
  )
  on conflict (workspace_id, member_id, provider) do nothing;

  select * into presence_row
  from public.agent_presence ap
  where ap.workspace_id = target_workspace_id
    and ap.member_id = target_member_id
    and ap.provider = 'ringcentral'
  limit 1;

  return presence_row;
end;
$$;

create or replace function private.telephony_identity_json(
  target_workspace_id uuid,
  target_member_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'id', ti.id,
    'provider', ti.provider,
    'callerId', ti.caller_id,
    'directNumber', ti.direct_number,
    'providerUserRef', ti.provider_user_ref,
    'providerExtensionRef', ti.provider_extension_ref,
    'active', ti.active,
    'updatedAt', ti.updated_at
  )
  from public.telephony_identities ti
  where ti.workspace_id = target_workspace_id
    and ti.member_id = target_member_id
    and ti.provider = 'ringcentral'
    and ti.active = true
  order by ti.updated_at desc, ti.created_at desc
  limit 1;
$$;

create or replace function private.agent_presence_json(
  target_workspace_id uuid,
  target_member_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'id', ap.id,
    'memberId', ap.member_id,
    'presenceStatus', ap.presence_status,
    'acceptingQueueCalls', ap.accepting_queue_calls,
    'telephonyStatus', ap.telephony_status,
    'activeCallCount', ap.active_call_count,
    'lastProviderSyncAt', ap.last_provider_sync_at,
    'updatedAt', ap.updated_at
  )
  from public.agent_presence ap
  where ap.workspace_id = target_workspace_id
    and ap.member_id = target_member_id
    and ap.provider = 'ringcentral'
  limit 1;
$$;

create or replace function private.call_recordings_json(target_call_log_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', cr.id,
        'providerRecordingId', cr.provider_recording_id,
        'status', cr.status,
        'durationSeconds', cr.duration_seconds,
        'accessUrl', cr.access_url,
        'createdAt', cr.created_at,
        'updatedAt', cr.updated_at
      )
      order by cr.created_at desc
    ),
    '[]'::jsonb
  )
  from public.call_recordings cr
  where cr.call_log_id = target_call_log_id;
$$;

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

create or replace function private.voicemail_json(target_voicemail_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'id', vm.id,
    'workspaceId', vm.workspace_id,
    'memberId', vm.member_id,
    'callLogId', vm.call_log_id,
    'providerVoicemailId', vm.provider_voicemail_id,
    'fromNumber', vm.from_number,
    'toNumber', vm.to_number,
    'callerName', vm.caller_name,
    'durationSeconds', vm.duration_seconds,
    'transcription', vm.transcription,
    'accessUrl', vm.access_url,
    'isRead', vm.is_read,
    'receivedAt', vm.received_at,
    'createdAt', vm.created_at,
    'updatedAt', vm.updated_at
  )
  from public.voicemails vm
  where vm.id = target_voicemail_id
  limit 1;
$$;

create or replace function private.call_queue_json(
  target_queue_id uuid,
  target_member_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'id', cq.id,
    'providerQueueId', cq.provider_queue_id,
    'name', cq.name,
    'extensionNumber', cq.extension_number,
    'active', cq.active,
    'acceptingCalls', coalesce(qm.accepting_calls, true),
    'role', coalesce(qm.role, 'agent'),
    'updatedAt', cq.updated_at
  )
  from public.call_queues cq
  left join public.queue_memberships qm
    on qm.queue_id = cq.id
   and qm.member_id = target_member_id
  where cq.id = target_queue_id
  limit 1;
$$;

create or replace function private.calls_snapshot_json(
  target_workspace_id uuid,
  actor_member_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'telephonyIdentity', coalesce(private.telephony_identity_json(target_workspace_id, actor_member_id), 'null'::jsonb),
    'agentPresence', coalesce(private.agent_presence_json(target_workspace_id, actor_member_id), jsonb_build_object(
      'id', null,
      'memberId', actor_member_id,
      'presenceStatus', 'Available',
      'acceptingQueueCalls', true,
      'telephonyStatus', '',
      'activeCallCount', 0,
      'lastProviderSyncAt', null,
      'updatedAt', timezone('utc', now())
    )),
    'callLogs', coalesce((
      select jsonb_agg(private.call_log_json(item.id) order by item.sort_at desc, item.created_at desc)
      from (
        select cl.id, coalesce(cl.answered_at, cl.started_at, cl.created_at) as sort_at, cl.created_at
        from public.call_logs cl
        where cl.workspace_id = target_workspace_id
          and cl.member_id = actor_member_id
        order by coalesce(cl.answered_at, cl.started_at, cl.created_at) desc, cl.created_at desc
        limit 150
      ) item
    ), '[]'::jsonb),
    'voicemails', coalesce((
      select jsonb_agg(private.voicemail_json(item.id) order by item.sort_at desc, item.created_at desc)
      from (
        select vm.id, coalesce(vm.received_at, vm.created_at) as sort_at, vm.created_at
        from public.voicemails vm
        where vm.workspace_id = target_workspace_id
          and vm.member_id = actor_member_id
        order by coalesce(vm.received_at, vm.created_at) desc, vm.created_at desc
        limit 100
      ) item
    ), '[]'::jsonb),
    'queues', coalesce((
      select jsonb_agg(private.call_queue_json(item.id, actor_member_id) order by lower(item.name), item.id)
      from (
        select cq.id, cq.name
        from public.call_queues cq
        left join public.queue_memberships qm
          on qm.queue_id = cq.id
         and qm.member_id = actor_member_id
        where cq.workspace_id = target_workspace_id
          and cq.active = true
          and (qm.member_id is not null or private.can_manage_calls_workspace(target_workspace_id))
        order by lower(cq.name), cq.id
      ) item
    ), '[]'::jsonb),
    'activeCall', coalesce((
      select private.call_log_json(cl.id)
      from public.call_logs cl
      where cl.workspace_id = target_workspace_id
        and cl.member_id = actor_member_id
        and cl.status in ('queued', 'dialing', 'ringing', 'inbound', 'connected', 'hold', 'transferring')
      order by coalesce(cl.answered_at, cl.started_at, cl.created_at) desc, cl.created_at desc
      limit 1
    ), 'null'::jsonb),
    'wrapupCall', coalesce((
      select private.call_log_json(cl.id)
      from public.call_logs cl
      where cl.workspace_id = target_workspace_id
        and cl.member_id = actor_member_id
        and cl.status in ('completed', 'missed', 'voicemail', 'failed', 'canceled', 'declined', 'wrapup')
        and trim(coalesce(cl.disposition, '')) = ''
      order by coalesce(cl.ended_at, cl.updated_at, cl.created_at) desc, cl.created_at desc
      limit 1
    ), 'null'::jsonb),
    'inboundPopup', coalesce((
      select private.call_log_json(cl.id)
      from public.call_logs cl
      where cl.workspace_id = target_workspace_id
        and cl.member_id = actor_member_id
        and cl.direction = 'inbound'
        and cl.status in ('ringing', 'inbound')
        and cl.popup_dismissed_at is null
      order by coalesce(cl.updated_at, cl.created_at) desc
      limit 1
    ), 'null'::jsonb),
    'serverNow', timezone('utc', now())
  );
$$;

create or replace function public.get_calls_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);
  perform private.ensure_agent_presence_row(target_workspace_id, actor_member_id);
  return private.calls_snapshot_json(target_workspace_id, actor_member_id);
end;
$$;

create or replace function public.save_call_wrapup(
  p_call_log_id uuid,
  p_disposition text,
  p_wrapup_notes text default '',
  p_follow_up text default 'none'
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  current_call public.call_logs%rowtype;
  follow_up_value text;
begin
  if p_call_log_id is null then
    raise exception 'Call log is required.' using errcode = 'P0001';
  end if;

  select * into current_call
  from public.call_logs
  where id = p_call_log_id;

  if current_call.id is null then
    raise exception 'Call record not found.' using errcode = 'P0001';
  end if;

  target_workspace_id := current_call.workspace_id;
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if current_call.member_id is distinct from actor_member_id
     and not private.can_manage_calls_workspace(target_workspace_id) then
    raise exception 'Only the assigned agent or a manager can save wrap-up.' using errcode = 'P0001';
  end if;

  follow_up_value := trim(coalesce(p_follow_up, 'none'));
  if follow_up_value not in ('none', 'task', 'callback', 'sms', 'email') then
    follow_up_value := 'none';
  end if;

  update public.call_logs
  set
    disposition = trim(coalesce(p_disposition, '')),
    wrapup_notes = trim(coalesce(p_wrapup_notes, '')),
    follow_up_action = follow_up_value,
    status = case
      when status in ('connected', 'hold', 'transferring') then 'wrapup'
      else status
    end
  where id = p_call_log_id;

  return private.calls_snapshot_json(target_workspace_id, actor_member_id);
end;
$$;

create or replace function public.set_agent_presence(p_presence_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  next_status text;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);
  perform private.ensure_agent_presence_row(target_workspace_id, actor_member_id);

  next_status := trim(coalesce(p_presence_status, 'Available'));
  if next_status not in ('Available', 'Busy', 'Offline', 'Dnd') then
    next_status := 'Available';
  end if;

  update public.agent_presence
  set
    presence_status = next_status
  where workspace_id = target_workspace_id
    and member_id = actor_member_id
    and provider = 'ringcentral';

  return private.calls_snapshot_json(target_workspace_id, actor_member_id);
end;
$$;

create or replace function public.set_queue_availability(
  p_accepting_queue_calls boolean,
  p_queue_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
begin
  target_workspace_id := private.current_workspace_id();
  actor_member_id := private.require_active_workspace_member(target_workspace_id);
  perform private.ensure_agent_presence_row(target_workspace_id, actor_member_id);

  update public.agent_presence
  set accepting_queue_calls = coalesce(p_accepting_queue_calls, true)
  where workspace_id = target_workspace_id
    and member_id = actor_member_id
    and provider = 'ringcentral';

  if p_queue_id is null then
    update public.queue_memberships qm
    set accepting_calls = coalesce(p_accepting_queue_calls, true)
    from public.call_queues cq
    where qm.queue_id = cq.id
      and qm.member_id = actor_member_id
      and cq.workspace_id = target_workspace_id;
  else
    update public.queue_memberships qm
    set accepting_calls = coalesce(p_accepting_queue_calls, true)
    from public.call_queues cq
    where qm.queue_id = cq.id
      and qm.member_id = actor_member_id
      and qm.queue_id = p_queue_id
      and cq.workspace_id = target_workspace_id;
  end if;

  return private.calls_snapshot_json(target_workspace_id, actor_member_id);
end;
$$;

create or replace function public.acknowledge_inbound_popup(
  p_call_log_id uuid,
  p_dismiss boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_member_id uuid;
  current_call public.call_logs%rowtype;
begin
  if p_call_log_id is null then
    raise exception 'Call log is required.' using errcode = 'P0001';
  end if;

  select * into current_call
  from public.call_logs
  where id = p_call_log_id;

  if current_call.id is null then
    raise exception 'Incoming call not found.' using errcode = 'P0001';
  end if;

  target_workspace_id := current_call.workspace_id;
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if current_call.member_id is distinct from actor_member_id
     and not private.can_manage_calls_workspace(target_workspace_id) then
    raise exception 'This incoming call is not assigned to you.' using errcode = 'P0001';
  end if;

  update public.call_logs
  set
    popup_seen_at = coalesce(popup_seen_at, timezone('utc', now())),
    popup_dismissed_at = case when coalesce(p_dismiss, false) then timezone('utc', now()) else popup_dismissed_at end
  where id = p_call_log_id;

  return private.calls_snapshot_json(target_workspace_id, actor_member_id);
end;
$$;

alter table public.telephony_identities enable row level security;
alter table public.agent_presence enable row level security;
alter table public.call_queues enable row level security;
alter table public.queue_memberships enable row level security;
alter table public.call_logs enable row level security;
alter table public.call_events enable row level security;
alter table public.call_recordings enable row level security;
alter table public.voicemails enable row level security;

drop policy if exists telephony_identities_select_policy on public.telephony_identities;
create policy telephony_identities_select_policy
on public.telephony_identities
for select
to authenticated
using (
  private.can_read_calls_workspace(workspace_id)
  and (
    member_id = private.current_team_member_id(workspace_id)
    or private.can_manage_calls_workspace(workspace_id)
  )
);

drop policy if exists agent_presence_select_policy on public.agent_presence;
create policy agent_presence_select_policy
on public.agent_presence
for select
to authenticated
using (
  private.can_read_calls_workspace(workspace_id)
);

drop policy if exists call_queues_select_policy on public.call_queues;
create policy call_queues_select_policy
on public.call_queues
for select
to authenticated
using (
  private.can_read_calls_workspace(workspace_id)
);

drop policy if exists queue_memberships_select_policy on public.queue_memberships;
create policy queue_memberships_select_policy
on public.queue_memberships
for select
to authenticated
using (
  exists (
    select 1
    from public.call_queues cq
    where cq.id = queue_memberships.queue_id
      and private.can_read_calls_workspace(cq.workspace_id)
  )
);

drop policy if exists call_logs_select_policy on public.call_logs;
create policy call_logs_select_policy
on public.call_logs
for select
to authenticated
using (
  private.can_read_calls_workspace(workspace_id)
  and (
    member_id = private.current_team_member_id(workspace_id)
    or private.can_manage_calls_workspace(workspace_id)
  )
);

drop policy if exists call_events_select_policy on public.call_events;
create policy call_events_select_policy
on public.call_events
for select
to authenticated
using (
  private.can_read_calls_workspace(workspace_id)
  and private.can_manage_calls_workspace(workspace_id)
);

drop policy if exists call_recordings_select_policy on public.call_recordings;
create policy call_recordings_select_policy
on public.call_recordings
for select
to authenticated
using (
  private.can_read_calls_workspace(workspace_id)
);

drop policy if exists voicemails_select_policy on public.voicemails;
create policy voicemails_select_policy
on public.voicemails
for select
to authenticated
using (
  private.can_read_calls_workspace(workspace_id)
  and (
    member_id = private.current_team_member_id(workspace_id)
    or private.can_manage_calls_workspace(workspace_id)
  )
);

revoke all on function private.can_read_calls_workspace(uuid) from public;
revoke all on function private.can_manage_calls_workspace(uuid) from public;
revoke all on function private.ensure_agent_presence_row(uuid, uuid) from public;
revoke all on function private.telephony_identity_json(uuid, uuid) from public;
revoke all on function private.agent_presence_json(uuid, uuid) from public;
revoke all on function private.call_recordings_json(uuid) from public;
revoke all on function private.call_log_json(uuid) from public;
revoke all on function private.voicemail_json(uuid) from public;
revoke all on function private.call_queue_json(uuid, uuid) from public;
revoke all on function private.calls_snapshot_json(uuid, uuid) from public;

grant execute on function private.can_read_calls_workspace(uuid) to authenticated;
grant execute on function private.can_manage_calls_workspace(uuid) to authenticated;
grant execute on function private.ensure_agent_presence_row(uuid, uuid) to authenticated;
grant execute on function private.telephony_identity_json(uuid, uuid) to authenticated;
grant execute on function private.agent_presence_json(uuid, uuid) to authenticated;
grant execute on function private.call_recordings_json(uuid) to authenticated;
grant execute on function private.call_log_json(uuid) to authenticated;
grant execute on function private.voicemail_json(uuid) to authenticated;
grant execute on function private.call_queue_json(uuid, uuid) to authenticated;
grant execute on function private.calls_snapshot_json(uuid, uuid) to authenticated;

grant execute on function public.get_calls_snapshot() to authenticated;
grant execute on function public.save_call_wrapup(uuid, text, text, text) to authenticated;
grant execute on function public.set_agent_presence(text) to authenticated;
grant execute on function public.set_queue_availability(boolean, uuid) to authenticated;
grant execute on function public.acknowledge_inbound_popup(uuid, boolean) to authenticated;

commit;
