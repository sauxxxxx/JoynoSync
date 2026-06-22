begin;

alter table public.lead_status_events
drop constraint if exists lead_status_events_to_status_check;

alter table public.lead_status_events
add constraint lead_status_events_to_status_check
check (to_status in ('New', 'Contacted', 'Qualified', 'Unqualified'));

create or replace function private.capture_lead_status_event()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  actor_member public.team_members%rowtype;
  actor_name text := '';
  actor_department text := '';
  meta_actor_name text := nullif(trim(coalesce(new.meta ->> 'lastStatusChangedByName', '')), '');
  status_changed boolean := coalesce(new.status, '') is distinct from coalesce(old.status, '');
  attempt_changed boolean := nullif(trim(coalesce(new.meta ->> 'lastAttemptAt', '')), '') is distinct from nullif(trim(coalesce(old.meta ->> 'lastAttemptAt', '')), '');
  event_status text := null;
  event_from_status text := '';
  event_occurred_at timestamptz := null;
  event_meta jsonb := '{}'::jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if status_changed then
    if coalesce(new.status, '') not in ('New', 'Contacted', 'Qualified', 'Unqualified') then
      return new;
    end if;

    event_status := coalesce(new.status, '');
    event_from_status := coalesce(old.status, '');
    event_occurred_at := coalesce(
      nullif(trim(coalesce(new.meta ->> 'lastStatusChangedAt', '')), '')::timestamptz,
      new.updated_at,
      timezone('utc', now())
    );
    event_meta := jsonb_strip_nulls(
      jsonb_build_object(
        'source', 'lead-status-trigger',
        'lastStatusChangedAt', new.meta ->> 'lastStatusChangedAt',
        'lastStatusChangedFrom', new.meta ->> 'lastStatusChangedFrom',
        'lastStatusChangedTo', new.meta ->> 'lastStatusChangedTo'
      )
    );
  elsif attempt_changed and coalesce(new.status, '') = 'Contacted' then
    event_status := 'Contacted';
    event_from_status := coalesce(old.status, '');
    event_occurred_at := coalesce(
      nullif(trim(coalesce(new.meta ->> 'lastAttemptAt', '')), '')::timestamptz,
      new.updated_at,
      timezone('utc', now())
    );
    event_meta := jsonb_strip_nulls(
      jsonb_build_object(
        'source', 'lead-attempt-trigger',
        'lastAttemptAt', new.meta ->> 'lastAttemptAt',
        'lastAttemptReason', new.meta ->> 'lastAttemptReason'
      )
    );
  else
    return new;
  end if;

  if new.updated_by_member_id is not null then
    select *
    into actor_member
    from public.team_members tm
    where tm.id = new.updated_by_member_id
    limit 1;

    actor_name := trim(coalesce(actor_member.name, ''));
    actor_department := trim(coalesce(actor_member.team, ''));
  end if;

  insert into public.lead_status_events (
    workspace_id,
    lead_id,
    member_id,
    from_status,
    to_status,
    lead_name,
    member_name,
    department,
    occurred_at,
    meta
  )
  values (
    new.workspace_id,
    new.id,
    new.updated_by_member_id,
    event_from_status,
    event_status,
    coalesce(new.name, ''),
    coalesce(nullif(actor_name, ''), meta_actor_name, ''),
    coalesce(actor_department, ''),
    coalesce(event_occurred_at, timezone('utc', now())),
    event_meta
  );

  return new;
end;
$$;

commit;
