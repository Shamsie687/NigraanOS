-- Reviewed original-project timestamp helper only. Apply after 015 -> 016 -> 017.
-- No body/signature/owner/SECURITY DEFINER/volatility/ACL/trigger replacement.
-- Fingerprints contain no private definitions or identifiers.
begin;
set local lock_timeout='10s';
do $guard$
#variable_conflict error
declare v_function oid:=to_regprocedure('public.handle_updated_at()'); v_acl jsonb;
begin
  if current_user<>'postgres' then raise exception 'Project-owner SQL Editor required'; end if;
  if v_function is null then raise exception 'Reviewed timestamp function missing'; end if;
  if not exists(select 1 from pg_proc p where p.oid=v_function and p.prorettype='trigger'::regtype
    and p.prosecdef and p.provolatile='v' and p.pronargs=0 and p.prokind='f'
    and p.prolang=(select oid from pg_language where lanname='plpgsql')
    and pg_get_userbyid(p.proowner)='postgres'
    and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='8d0d99f0f246f51e6e468e02e03e428b'
    and (coalesce(p.proconfig,array[]::text[])=array[]::text[] or p.proconfig=array['search_path=pg_catalog'])) then
    raise exception 'Timestamp definition/security/owner/config drift; stop'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
    'privilege',a.privilege_type,'grantable',a.is_grantable) order by case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable),'[]'::jsonb)
    into v_acl from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where p.oid=v_function;
  if v_acl is distinct from $acl$[{"role":"PUBLIC","grantable":false,"privilege":"EXECUTE"},{"role":"anon","grantable":false,"privilege":"EXECUTE"},{"role":"authenticated","grantable":false,"privilege":"EXECUTE"},{"role":"postgres","grantable":false,"privilege":"EXECUTE"},{"role":"service_role","grantable":false,"privilege":"EXECUTE"}]$acl$::jsonb then raise exception 'Timestamp privilege drift; stop'; end if;
  if (select count(*) from pg_trigger t where t.tgfoid=v_function)<>2 or
    (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
     where t.tgfoid=v_function and not t.tgisinternal and t.tgenabled='O' and t.tgtype=19
       and t.tgattr::text='' and t.tgnargs=0 and t.tgqual is null and t.tgconstraint=0 and n.nspname='public'
       and ((c.relname='incidents' and t.tgname='on_incident_updated') or (c.relname='profiles' and t.tgname='on_profile_updated')))<>2 then
    raise exception 'Timestamp trigger dependency drift; stop'; end if;
end $guard$;
alter function public.handle_updated_at() set search_path=pg_catalog;
do $guard$
#variable_conflict error
declare v_function oid:=to_regprocedure('public.handle_updated_at()'); v_acl jsonb;
begin
  if current_user<>'postgres' then raise exception 'Project-owner SQL Editor required'; end if;
  if v_function is null then raise exception 'Reviewed timestamp function missing'; end if;
  if not exists(select 1 from pg_proc p where p.oid=v_function and p.prorettype='trigger'::regtype
    and p.prosecdef and p.provolatile='v' and p.pronargs=0 and p.prokind='f'
    and p.prolang=(select oid from pg_language where lanname='plpgsql')
    and pg_get_userbyid(p.proowner)='postgres'
    and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='8d0d99f0f246f51e6e468e02e03e428b'
    and (coalesce(p.proconfig,array[]::text[])=array[]::text[] or p.proconfig=array['search_path=pg_catalog'])) then
    raise exception 'Timestamp definition/security/owner/config drift; stop'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
    'privilege',a.privilege_type,'grantable',a.is_grantable) order by case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable),'[]'::jsonb)
    into v_acl from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where p.oid=v_function;
  if v_acl is distinct from $acl$[{"role":"PUBLIC","grantable":false,"privilege":"EXECUTE"},{"role":"anon","grantable":false,"privilege":"EXECUTE"},{"role":"authenticated","grantable":false,"privilege":"EXECUTE"},{"role":"postgres","grantable":false,"privilege":"EXECUTE"},{"role":"service_role","grantable":false,"privilege":"EXECUTE"}]$acl$::jsonb then raise exception 'Timestamp privilege drift; stop'; end if;
  if (select count(*) from pg_trigger t where t.tgfoid=v_function)<>2 or
    (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
     where t.tgfoid=v_function and not t.tgisinternal and t.tgenabled='O' and t.tgtype=19
       and t.tgattr::text='' and t.tgnargs=0 and t.tgqual is null and t.tgconstraint=0 and n.nspname='public'
       and ((c.relname='incidents' and t.tgname='on_incident_updated') or (c.relname='profiles' and t.tgname='on_profile_updated')))<>2 then
    raise exception 'Timestamp trigger dependency drift; stop'; end if;
  if not exists(select 1 from pg_proc where oid=v_function and proconfig=array['search_path=pg_catalog']) then raise exception 'Timestamp hardening postcheck failed'; end if;
end $guard$;
commit;
