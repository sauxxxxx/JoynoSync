begin;

alter table public.call_logs
add column if not exists wrapup_dismissed_at timestamptz;

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
        and cl.wrapup_dismissed_at is null
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
    wrapup_dismissed_at = null,
    status = case
      when status in ('connected', 'hold', 'transferring') then 'wrapup'
      else status
    end
  where id = p_call_log_id;

  return private.calls_snapshot_json(target_workspace_id, actor_member_id);
end;
$$;

create or replace function public.dismiss_call_wrapup(p_call_log_id uuid)
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
    raise exception 'Call record not found.' using errcode = 'P0001';
  end if;

  target_workspace_id := current_call.workspace_id;
  actor_member_id := private.require_active_workspace_member(target_workspace_id);

  if current_call.member_id is distinct from actor_member_id
     and not private.can_manage_calls_workspace(target_workspace_id) then
    raise exception 'Only the assigned agent or a manager can dismiss wrap-up.' using errcode = 'P0001';
  end if;

  update public.call_logs
  set wrapup_dismissed_at = timezone('utc', now())
  where id = p_call_log_id
    and trim(coalesce(disposition, '')) = '';

  return private.calls_snapshot_json(target_workspace_id, actor_member_id);
end;
$$;

revoke all on function public.dismiss_call_wrapup(uuid) from public;
grant execute on function public.dismiss_call_wrapup(uuid) to authenticated;

commit;
