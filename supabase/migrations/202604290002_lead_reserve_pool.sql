begin;

alter table public.leads
add column if not exists active_pool boolean not null default true;

update public.leads
set active_pool = true
where active_pool is distinct from true
  and owner_member_id is not null;

create or replace function private.ensure_assigned_leads_are_active()
returns trigger
language plpgsql
as $$
begin
  if new.owner_member_id is not null then
    new.active_pool := true;
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_assigned_leads_are_active on public.leads;
create trigger ensure_assigned_leads_are_active
before insert or update of owner_member_id, active_pool
on public.leads
for each row
execute function private.ensure_assigned_leads_are_active();

create index if not exists leads_workspace_active_pool_idx
on public.leads (workspace_id, active_pool, archived_at, status);

create index if not exists leads_workspace_reserve_count_idx
on public.leads (workspace_id)
where active_pool = false
  and owner_member_id is null
  and archived_at is null
  and status <> 'Archived';

commit;
