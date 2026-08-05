begin;

do $$
declare
  test_auth_user_id uuid;
  test_email text;
  dashboard_result jsonb;
  leads_page_result jsonb;
  leads_meta_result jsonb;
begin
  select tm.auth_user_id, lower(tm.email)
  into test_auth_user_id, test_email
  from public.team_members tm
  where tm.status = 'Active'
    and lower(tm.role) in ('owner', 'admin', 'manager')
    and tm.auth_user_id is not null
  order by case lower(tm.role) when 'owner' then 0 when 'admin' then 1 else 2 end,
    tm.updated_at desc
  limit 1;

  if test_auth_user_id is null then
    raise exception 'Runtime verification requires an active leadership member linked to authentication.';
  end if;

  perform set_config('request.jwt.claim.sub', test_auth_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', test_auth_user_id,
      'email', test_email,
      'role', 'authenticated'
    )::text,
    true
  );

  dashboard_result := public.get_dashboard_snapshot('30d');
  if dashboard_result is null or dashboard_result ->> 'schemaVersion' <> 'command-sections-v3' then
    raise exception 'Dashboard runtime verification returned an invalid snapshot.';
  end if;

  leads_page_result := public.get_leads_cursor_page(
    p_page_size => 25,
    p_sort_key => 'lasttouch',
    p_sort_dir => 'desc',
    p_today => timezone('utc', now())::date
  );
  if leads_page_result is null or jsonb_typeof(leads_page_result -> 'rows') <> 'array' then
    raise exception 'Leads cursor runtime verification returned an invalid page.';
  end if;

  leads_meta_result := public.get_leads_page_meta(
    p_current_user_id => private.current_team_member_id(),
    p_today => timezone('utc', now())::date,
    p_include_reserve => true
  );
  if leads_meta_result is null or not (leads_meta_result ? 'totalCount') then
    raise exception 'Leads metadata runtime verification returned an invalid result.';
  end if;
end;
$$;

commit;
