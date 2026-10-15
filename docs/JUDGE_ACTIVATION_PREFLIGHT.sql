-- READ ONLY: original project pmzbdrxedlthdqdpgigs; confirm Dashboard separately.
-- No account IDs, emails or row contents returned. 019 only; never replay 015-018.
with expected as(select $expected$[{"name":"nigraan_has_operations_access","hash":"9160161efa2431ad44bef8587a25c73d"},{"name":"nigraan_operations_access_context","hash":"5dbcce719ea346332f2cdb69fa62daad"},{"name":"nigraan_decide_judge_access","hash":"634a18e4ccac34f6b565a74076219e77"},{"name":"nigraan_list_judge_requests","hash":"b604c2b80c46c0347d4eb4c822515759"}]$expected$::jsonb j),
e as(select * from jsonb_to_recordset((select j from expected)) x(name text,hash text)),
checks as(
 select 'FUNCTION_'||e.name check_name,count(p.oid)=1 and bool_and(md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))=e.hash and p.prosecdef and p.proconfig @> array['search_path=""']) ok
 from e left join pg_proc p on p.pronamespace=(select oid from pg_namespace where nspname='public') and p.proname=e.name group by e.name
 union all select 'REQUEST_RLS',coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.nigraan_judge_requests')),false)

 union all select 'NO_PARTIAL_019',to_regprocedure('public.nigraan_activate_judge_access()') is null and not exists(select 1 from pg_attribute where attrelid='public.nigraan_judge_requests'::regclass and attname in('started_at','activation_expires_at') and not attisdropped)
 union all select 'OLD_TIMING_CHECK',exists(select 1 from pg_constraint where conrelid='public.nigraan_judge_requests'::regclass and conname='nigraan_judge_requests_check' and contype='c' and convalidated)

)
select case when coalesce(bool_and(coalesce(ok,false)),false) then 'PASS' else 'BLOCKED' end verdict,
 count(*) filter(where not coalesce(ok,false)) blocked_checks,
 coalesce(jsonb_agg(check_name order by check_name) filter(where not coalesce(ok,false)),'[]'::jsonb) mismatches
from checks;
