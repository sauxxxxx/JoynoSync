begin;

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

  if attempt_changed then
    if coalesce(new.status, '') not in ('Contacted', 'Qualified', 'Unqualified') then
      return new;
    end if;

    event_status := coalesce(new.status, '');
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
        'lastAttemptReason', new.meta ->> 'lastAttemptReason',
        'lastStatusChangedAt', new.meta ->> 'lastStatusChangedAt',
        'lastStatusChangedFrom', new.meta ->> 'lastStatusChangedFrom',
        'lastStatusChangedTo', new.meta ->> 'lastStatusChangedTo'
      )
    );
  elsif status_changed then
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

create or replace function public.get_calls_performance_shift_activity(
  p_workspace_id uuid,
  p_start_at timestamptz,
  p_end_before timestamptz,
  p_time_zone text default 'UTC',
  p_shift_start text default '09:00',
  p_shift_end text default '18:00'
)
returns table (
  id text,
  workspace_id text,
  lead_id text,
  lead_name text,
  from_status text,
  outcome text,
  agent_id text,
  agent_name text,
  department text,
  occurred_at timestamptz,
  occurred_date text,
  shift_date text,
  direction text,
  meta jsonb
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  normalized_time_zone text := nullif(trim(coalesce(p_time_zone, '')), '');
  shift_start_minutes integer := 540;
  shift_end_minutes integer := 1080;
  shift_start_match text[];
  shift_end_match text[];
begin
  if p_workspace_id is null or p_start_at is null or p_end_before is null then
    return;
  end if;

  if not private.is_active_workspace_member(p_workspace_id) then
    return;
  end if;

  if normalized_time_zone is null or lower(normalized_time_zone) = 'local' then
    normalized_time_zone := 'UTC';
  end if;

  begin
    perform timezone(normalized_time_zone, now());
  exception when others then
    normalized_time_zone := 'UTC';
  end;

  shift_start_match := regexp_match(trim(coalesce(p_shift_start, '09:00')), '^(\d{1,2}):(\d{2})');
  if shift_start_match is not null then
    shift_start_minutes := greatest(
      0,
      least(
        1439,
        coalesce(shift_start_match[1]::integer, 9) * 60 + coalesce(shift_start_match[2]::integer, 0)
      )
    );
  end if;

  shift_end_match := regexp_match(trim(coalesce(p_shift_end, '18:00')), '^(\d{1,2}):(\d{2})');
  if shift_end_match is not null then
    shift_end_minutes := greatest(
      0,
      least(
        1439,
        coalesce(shift_end_match[1]::integer, 18) * 60 + coalesce(shift_end_match[2]::integer, 0)
      )
    );
  end if;

  return query
  with scoped_events as (
    select
      e.id as event_id,
      e.workspace_id as event_workspace_id,
      e.lead_id as event_lead_id,
      e.lead_name as event_lead_name,
      e.from_status as event_from_status,
      e.to_status as event_outcome,
      e.member_id as event_member_id,
      e.member_name as event_member_name,
      e.department as event_department,
      e.occurred_at as event_occurred_at,
      e.meta as event_meta,
      lower(trim(coalesce(e.meta ->> 'source', ''))) as event_source,
      timezone(normalized_time_zone, e.occurred_at) as local_occurred_at
    from public.lead_status_events e
    where e.workspace_id = p_workspace_id
      and e.occurred_at >= p_start_at
      and e.occurred_at < p_end_before
      and e.to_status in ('New', 'Contacted', 'Qualified', 'Unqualified')
  ),
  shifted_events as (
    select
      scoped.*,
      scoped.event_source in ('lead-attempt-trigger', 'lead-attempt-history', 'lead-attempt-history-backfill') as event_is_attempt,
      case
        when shift_end_minutes < shift_start_minutes
          and (extract(hour from scoped.local_occurred_at)::integer * 60 + extract(minute from scoped.local_occurred_at)::integer) < shift_end_minutes
          then (scoped.local_occurred_at::date - 1)
        else scoped.local_occurred_at::date
      end as event_shift_date
    from scoped_events scoped
  ),
  latest_status_by_lead_shift as (
    select
      shifted.*,
      row_number() over (
        partition by shifted.event_lead_id, shifted.event_shift_date
        order by shifted.event_occurred_at desc, shifted.event_id desc
      ) as row_rank
    from shifted_events shifted
    where not shifted.event_is_attempt
  ),
  selected_events as (
    select
      shifted.event_id,
      shifted.event_workspace_id,
      shifted.event_lead_id,
      shifted.event_lead_name,
      shifted.event_from_status,
      shifted.event_outcome,
      shifted.event_member_id,
      shifted.event_member_name,
      shifted.event_department,
      shifted.event_occurred_at,
      shifted.event_meta,
      shifted.event_shift_date
    from shifted_events shifted
    where shifted.event_is_attempt
      and shifted.event_outcome in ('Contacted', 'Qualified', 'Unqualified')

    union all

    select
      latest.event_id,
      latest.event_workspace_id,
      latest.event_lead_id,
      latest.event_lead_name,
      latest.event_from_status,
      latest.event_outcome,
      latest.event_member_id,
      latest.event_member_name,
      latest.event_department,
      latest.event_occurred_at,
      latest.event_meta,
      latest.event_shift_date
    from latest_status_by_lead_shift latest
    where latest.row_rank = 1
      and latest.event_outcome in ('Contacted', 'Qualified', 'Unqualified')
  )
  select
    selected.event_id::text as id,
    selected.event_workspace_id::text as workspace_id,
    selected.event_lead_id::text as lead_id,
    coalesce(selected.event_lead_name, 'Lead') as lead_name,
    coalesce(selected.event_from_status, '') as from_status,
    selected.event_outcome as outcome,
    coalesce(selected.event_member_id::text, '') as agent_id,
    coalesce(nullif(trim(selected.event_member_name), ''), 'Unassigned') as agent_name,
    coalesce(selected.event_department, '') as department,
    selected.event_occurred_at as occurred_at,
    selected.event_occurred_at::date::text as occurred_date,
    selected.event_shift_date::text as shift_date,
    'Outbound'::text as direction,
    coalesce(selected.event_meta, '{}'::jsonb) as meta
  from selected_events selected
  order by selected.event_occurred_at desc, selected.event_id desc;
end;
$$;

with attempt_entries as (
  select
    l.workspace_id,
    l.id as lead_id,
    coalesce(l.name, '') as lead_name,
    entry.value as attempt,
    nullif(trim(coalesce(entry.value ->> 'createdAt', entry.value ->> 'loggedAt', '')), '')::timestamptz as occurred_at,
    nullif(trim(coalesce(entry.value ->> 'reason', entry.value ->> 'text', '')), '') as reason,
    nullif(trim(coalesce(entry.value ->> 'actor', '')), '') as actor_name,
    case
      when trim(coalesce(entry.value ->> 'outcome', '')) in ('Contacted', 'Qualified', 'Unqualified')
        then trim(coalesce(entry.value ->> 'outcome', ''))
      when lower(trim(coalesce(entry.value ->> 'reason', entry.value ->> 'text', ''))) in (
        'talk to author, not interested',
        'talked to author, not interested',
        'wrong number'
      )
        then 'Unqualified'
      else 'Contacted'
    end as outcome
  from public.leads l
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(l.meta -> 'attemptHistory') = 'array' then l.meta -> 'attemptHistory'
      else '[]'::jsonb
    end
  ) as entry(value)
  where nullif(trim(coalesce(entry.value ->> 'createdAt', entry.value ->> 'loggedAt', '')), '') is not null
    and nullif(trim(coalesce(entry.value ->> 'createdAt', entry.value ->> 'loggedAt', '')), '') ~ '^\d{4}-\d{2}-\d{2}'
),
matched_status_events as (
  select distinct on (e.id)
    e.id as event_id,
    attempts.occurred_at,
    attempts.reason,
    attempts.outcome
  from public.lead_status_events e
  join attempt_entries attempts
    on attempts.lead_id = e.lead_id
   and e.occurred_at between attempts.occurred_at - interval '2 seconds' and attempts.occurred_at + interval '2 seconds'
  where lower(trim(coalesce(e.meta ->> 'source', ''))) = 'lead-status-trigger'
  order by e.id, abs(extract(epoch from (e.occurred_at - attempts.occurred_at)))
)
update public.lead_status_events e
set
  to_status = matched.outcome,
  occurred_at = matched.occurred_at,
  meta = jsonb_strip_nulls(
    coalesce(e.meta, '{}'::jsonb) ||
    jsonb_build_object(
      'source', 'lead-attempt-trigger',
      'lastAttemptAt', matched.occurred_at,
      'lastAttemptReason', matched.reason,
      'backfilledAttemptSource', 'attemptHistory'
    )
  )
from matched_status_events matched
where e.id = matched.event_id;

with attempt_entries as (
  select
    l.workspace_id,
    l.id as lead_id,
    coalesce(l.name, '') as lead_name,
    entry.value as attempt,
    nullif(trim(coalesce(entry.value ->> 'createdAt', entry.value ->> 'loggedAt', '')), '')::timestamptz as occurred_at,
    nullif(trim(coalesce(entry.value ->> 'reason', entry.value ->> 'text', '')), '') as reason,
    nullif(trim(coalesce(entry.value ->> 'note', '')), '') as note,
    nullif(trim(coalesce(entry.value ->> 'actor', '')), '') as actor_name,
    case
      when trim(coalesce(entry.value ->> 'outcome', '')) in ('Contacted', 'Qualified', 'Unqualified')
        then trim(coalesce(entry.value ->> 'outcome', ''))
      when lower(trim(coalesce(entry.value ->> 'reason', entry.value ->> 'text', ''))) in (
        'talk to author, not interested',
        'talked to author, not interested',
        'wrong number'
      )
        then 'Unqualified'
      else 'Contacted'
    end as outcome
  from public.leads l
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(l.meta -> 'attemptHistory') = 'array' then l.meta -> 'attemptHistory'
      else '[]'::jsonb
    end
  ) as entry(value)
  where nullif(trim(coalesce(entry.value ->> 'createdAt', entry.value ->> 'loggedAt', '')), '') is not null
    and nullif(trim(coalesce(entry.value ->> 'createdAt', entry.value ->> 'loggedAt', '')), '') ~ '^\d{4}-\d{2}-\d{2}'
)
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
select
  attempts.workspace_id,
  attempts.lead_id,
  tm.id,
  '',
  attempts.outcome,
  attempts.lead_name,
  coalesce(attempts.actor_name, ''),
  coalesce(tm.team, ''),
  attempts.occurred_at,
  jsonb_strip_nulls(
    jsonb_build_object(
      'source', 'lead-attempt-history-backfill',
      'lastAttemptAt', attempts.occurred_at,
      'lastAttemptReason', attempts.reason,
      'note', attempts.note
    )
  )
from attempt_entries attempts
left join public.team_members tm
  on tm.workspace_id = attempts.workspace_id
 and lower(trim(tm.name)) = lower(trim(attempts.actor_name))
where attempts.outcome in ('Contacted', 'Qualified', 'Unqualified')
  and not exists (
    select 1
    from public.lead_status_events existing
    where existing.lead_id = attempts.lead_id
      and existing.occurred_at between attempts.occurred_at - interval '2 seconds' and attempts.occurred_at + interval '2 seconds'
      and lower(trim(coalesce(existing.meta ->> 'source', ''))) in (
        'lead-attempt-trigger',
        'lead-attempt-history',
        'lead-attempt-history-backfill'
      )
  );

commit;
