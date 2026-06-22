begin;

create index if not exists leads_workspace_active_updated_idx
on public.leads (workspace_id, updated_at desc, id)
where archived_at is null and status <> 'Archived';

create index if not exists leads_workspace_active_name_idx
on public.leads (workspace_id, name, id)
where archived_at is null and status <> 'Archived';

create index if not exists leads_workspace_active_owner_updated_idx
on public.leads (workspace_id, owner_member_id, updated_at desc, id)
where archived_at is null and status <> 'Archived';

create index if not exists leads_workspace_active_created_idx
on public.leads (workspace_id, created_at asc, id)
where archived_at is null and status <> 'Archived';

commit;
