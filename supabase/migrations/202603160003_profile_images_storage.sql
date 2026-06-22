begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-images',
  'profile-images',
  false,
  5242880,
  array[
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_images_storage_select" on storage.objects;
create policy "profile_images_storage_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-images'
  and private.is_active_workspace_member(nullif(split_part(name, '/', 1), '')::uuid)
);

drop policy if exists "profile_images_storage_insert" on storage.objects;
create policy "profile_images_storage_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-images'
  and private.is_active_workspace_member(nullif(split_part(name, '/', 1), '')::uuid)
  and (
    private.can_manage_workspace(nullif(split_part(name, '/', 1), '')::uuid)
    or nullif(split_part(name, '/', 2), '')::uuid = private.current_team_member_id(nullif(split_part(name, '/', 1), '')::uuid)
  )
);

drop policy if exists "profile_images_storage_delete" on storage.objects;
create policy "profile_images_storage_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-images'
  and private.is_active_workspace_member(nullif(split_part(name, '/', 1), '')::uuid)
  and (
    private.can_manage_workspace(nullif(split_part(name, '/', 1), '')::uuid)
    or nullif(split_part(name, '/', 2), '')::uuid = private.current_team_member_id(nullif(split_part(name, '/', 1), '')::uuid)
  )
);

commit;
