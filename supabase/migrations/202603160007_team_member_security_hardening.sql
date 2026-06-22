begin;

create or replace function private.guard_team_member_write()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  target_workspace_id uuid;
  actor_role text := '';
  actor_member_id uuid;
  target_member_id uuid;
  remaining_owner_count integer := 0;
  is_self boolean := false;
begin
  if tg_op = 'DELETE' then
    target_workspace_id := old.workspace_id;
    target_member_id := old.id;
  else
    target_workspace_id := new.workspace_id;
    target_member_id := new.id;
  end if;

  if target_workspace_id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if coalesce(auth.role(), '') = 'service_role'
    or current_user in ('postgres', 'supabase_admin', 'service_role') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  actor_role := coalesce(private.current_team_role_for_workspace(target_workspace_id), '');
  actor_member_id := private.current_team_member_id(target_workspace_id);
  is_self := target_member_id = actor_member_id;

  if tg_op = 'INSERT' then
    if coalesce(new.role, 'Member') = 'Owner' and actor_role <> 'Owner' then
      raise exception 'Only workspace owners can create another owner.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if coalesce(old.role, '') = 'Owner' then
      if actor_role <> 'Owner' then
        raise exception 'Only workspace owners can remove an owner.' using errcode = 'P0001';
      end if;

      select count(*)
      into remaining_owner_count
      from public.team_members tm
      where tm.workspace_id = old.workspace_id
        and tm.id <> old.id
        and tm.role = 'Owner'
        and tm.status in ('Active', 'Pending Invite');

      if remaining_owner_count = 0 then
        raise exception 'Workspace must keep at least one owner.' using errcode = 'P0001';
      end if;
    end if;

    return old;
  end if;

  if coalesce(old.role, '') = 'Owner' and actor_role <> 'Owner' then
    raise exception 'Only workspace owners can update an owner account.' using errcode = 'P0001';
  end if;

  if coalesce(new.role, '') = 'Owner' and actor_role <> 'Owner' then
    raise exception 'Only workspace owners can assign the owner role.' using errcode = 'P0001';
  end if;

  if coalesce(old.role, '') = 'Owner'
    and (
      new.role is distinct from old.role
      or (
        old.status in ('Active', 'Pending Invite')
        and new.status not in ('Active', 'Pending Invite')
      )
    ) then
    select count(*)
    into remaining_owner_count
    from public.team_members tm
    where tm.workspace_id = old.workspace_id
      and tm.id <> old.id
      and tm.role = 'Owner'
      and tm.status in ('Active', 'Pending Invite');

    if remaining_owner_count = 0 then
      raise exception 'Workspace must keep at least one owner.' using errcode = 'P0001';
    end if;
  end if;

  if is_self and old.status = 'Pending Invite' and new.status = 'Active' then
    if new.workspace_id is distinct from old.workspace_id
      or new.name is distinct from old.name
      or new.email is distinct from old.email
      or new.phone is distinct from old.phone
      or new.title is distinct from old.title
      or new.avatar_url is distinct from old.avatar_url
      or new.role is distinct from old.role
      or new.team is distinct from old.team
      or new.timezone is distinct from old.timezone
      or new.language is distinct from old.language
      or new.availability is distinct from old.availability
      or new.manager is distinct from old.manager
      or new.shift is distinct from old.shift
      or new.workload is distinct from old.workload
      or new.scope is distinct from old.scope
      or new.queue_eligible is distinct from old.queue_eligible
      or new.default_owner is distinct from old.default_owner
      or new.notifications is distinct from old.notifications
      or new.communication is distinct from old.communication
      or new.permissions is distinct from old.permissions
      or new.invite_token is distinct from old.invite_token
      or new.invited_at is distinct from old.invited_at
      or new.invite_last_sent_at is distinct from old.invite_last_sent_at then
      raise exception 'Invite activation can only update your access session fields.' using errcode = 'P0001';
    end if;

    if new.auth_user_id is distinct from auth.uid() then
      raise exception 'Invite activation must bind to the signed-in user.' using errcode = 'P0001';
    end if;

    return new;
  end if;

  if is_self and actor_role not in ('Owner', 'Admin') then

    if new.workspace_id is distinct from old.workspace_id
      or new.role is distinct from old.role
      or new.team is distinct from old.team
      or new.status is distinct from old.status
      or new.manager is distinct from old.manager
      or new.shift is distinct from old.shift
      or new.workload is distinct from old.workload
      or new.scope is distinct from old.scope
      or new.queue_eligible is distinct from old.queue_eligible
      or new.default_owner is distinct from old.default_owner
      or new.permissions is distinct from old.permissions
      or new.invite_token is distinct from old.invite_token
      or new.invited_at is distinct from old.invited_at
      or new.invite_last_sent_at is distinct from old.invite_last_sent_at then
      raise exception 'You do not have permission to change protected team settings.' using errcode = 'P0001';
    end if;

    if new.auth_user_id is distinct from old.auth_user_id and new.auth_user_id is distinct from auth.uid() then
      raise exception 'Auth binding must match the signed-in user.' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_team_member_write on public.team_members;
create trigger guard_team_member_write
before insert or update or delete on public.team_members
for each row
execute function private.guard_team_member_write();

commit;
