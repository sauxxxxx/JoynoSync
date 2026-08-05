begin;

alter table public.telephony_identities
  add column if not exists extension_number text not null default '',
  add column if not exists display_name text not null default '',
  add column if not exists extension_status text not null default '';

create unique index if not exists telephony_identities_active_extension_key
  on public.telephony_identities (workspace_id, provider, provider_extension_ref)
  where active = true and provider_extension_ref <> '';

create table if not exists public.ringcentral_workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  active boolean not null default false,
  task_owner_policy text not null default 'calling-agent',
  unknown_number_policy text not null default 'unlinked-calls',
  multiple_match_policy text not null default 'manual-selection',
  activated_at timestamptz,
  activated_by_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ringcentral_task_owner_policy_check
    check (task_owner_policy in ('calling-agent', 'lead-owner')),
  constraint ringcentral_unknown_number_policy_check
    check (unknown_number_policy in ('unlinked-calls', 'confirm-create')),
  constraint ringcentral_multiple_match_policy_check
    check (multiple_match_policy in ('manual-selection'))
);

drop trigger if exists set_ringcentral_workspace_settings_updated_at
  on public.ringcentral_workspace_settings;
create trigger set_ringcentral_workspace_settings_updated_at
before update on public.ringcentral_workspace_settings
for each row execute function public.set_updated_at();

alter table public.ringcentral_workspace_settings enable row level security;
revoke all on table public.ringcentral_workspace_settings from anon, authenticated;

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
    'extensionNumber', ti.extension_number,
    'displayName', ti.display_name,
    'extensionStatus', ti.extension_status,
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

revoke all on function private.telephony_identity_json(uuid, uuid) from public;
grant execute on function private.telephony_identity_json(uuid, uuid) to authenticated;

commit;
