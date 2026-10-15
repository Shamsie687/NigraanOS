-- READ ONLY: original project pmzbdrxedlthdqdpgigs; confirm Dashboard separately.
-- No account IDs, emails or row contents returned. 019 only; never replay 015-018.
with expected as(select $expected$[{"name":"nigraan_has_operations_access","hash":"f5b6d2c65158b5bfdae6034edca3095e"},{"name":"nigraan_operations_access_context","hash":"0b705106d3e9bff338203fa4e6a06cca"},{"name":"nigraan_decide_judge_access","hash":"664ca187390c4f9eb1363269227bd409"},{"name":"nigraan_list_judge_requests","hash":"6fdadc9e6985e57420155e83d9e81cea"},{"name":"nigraan_activate_judge_access","hash":"6d63fe7e2bd4c92b698a78312850e1c9"}]$expected$::jsonb j),
e as(select * from jsonb_to_recordset((select j from expected)) x(name text,hash text)),
checks as(
 select 'FUNCTION_'||e.name check_name,count(p.oid)=1 and bool_and(md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))=e.hash and p.prosecdef and p.proconfig @> array['search_path=""']) ok
 from e left join pg_proc p on p.pronamespace=(select oid from pg_namespace where nspname='public') and p.proname=e.name group by e.name
 union all select 'REQUEST_RLS',coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.nigraan_judge_requests')),false)

 union all select 'ACTIVATION_RPC_AUTHENTICATED_ONLY',exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.nigraan_activate_judge_access()') and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('service_role',p.oid,'EXECUTE') and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))g where g.grantee=0))
 union all select 'DEADLINE_CONSTRAINTS',(select count(*) from pg_constraint where conrelid='public.nigraan_judge_requests'::regclass and conname in('nigraan_judge_activation_deadline','nigraan_judge_session_deadline') and contype='c' and convalidated)=2
 union all select 'NEW_TIMESTAMP_COLUMNS',(select count(*) from pg_attribute where attrelid='public.nigraan_judge_requests'::regclass and attname in('started_at','activation_expires_at') and atttypid='timestamptz'::regtype and not attisdropped)=2
 union all select 'NO_DIRECT_JUDGE_WRITES',not exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))g where c.oid='public.nigraan_judge_requests'::regclass and g.grantee in(0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role')))

)
select case when coalesce(bool_and(coalesce(ok,false)),false) then 'PASS' else 'BLOCKED' end verdict,
 count(*) filter(where not coalesce(ok,false)) blocked_checks,
 coalesce(jsonb_agg(check_name order by check_name) filter(where not coalesce(ok,false)),'[]'::jsonb) mismatches
from checks;
