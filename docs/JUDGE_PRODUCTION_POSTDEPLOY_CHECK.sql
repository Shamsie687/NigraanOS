-- READ ONLY. After all four migrations, before bootstrap/secrets/webhook activation.
-- Dashboard must independently confirm pmzbdrxedlthdqdpgigs. No application data selected.
with expected as(select $functions$[{"name":"nigraan_is_permanent_operations","hash":"f73ad124cf7222569038b63d7f7937f0","definer":true},{"name":"nigraan_is_judge_admin","hash":"1ac725896b70e5e9c83e2ed6ed3a3890","definer":true},{"name":"nigraan_has_operations_access","hash":"9160161efa2431ad44bef8587a25c73d","definer":true},{"name":"is_approved_operations","hash":"e1fbe6f682f94c1b21c21ed5567dc0f5","definer":true},{"name":"nigraan_operations_access_context","hash":"5dbcce719ea346332f2cdb69fa62daad","definer":true},{"name":"nigraan_request_judge_access","hash":"857ea74d5ed8920d1c65eea4361a17ce","definer":true},{"name":"nigraan_decide_judge_access","hash":"634a18e4ccac34f6b565a74076219e77","definer":true},{"name":"nigraan_list_judge_requests","hash":"b604c2b80c46c0347d4eb4c822515759","definer":true},{"name":"nigraan_guard_operations_write","hash":"c970bd08f66dabc1437a1ede15284776","definer":true},{"name":"nigraan_claim_judge_email","hash":"e38abd5a4abd51e38af5a2f60f5310b6","definer":true},{"name":"nigraan_finish_judge_email","hash":"4074d95e365f5f973dc9810c0db3b14d","definer":true},{"name":"nigraan_retry_judge_email","hash":"2ea81ae9fc6d0aa5f980c3a6e8eb10ec","definer":true},{"name":"nigraan_storage_access_base","hash":"a3706624582e7759d656042e57c0d2d5","definer":true},{"name":"nigraan_storage_access","hash":"c06b4fe9d28d46d6eb29f0dd8ca490b8","definer":true},{"name":"nigraan_record_workflow","hash":"c356f53a73c4f863329c0a552d72e72c","definer":true}]$functions$::jsonb j),
ef as(select * from jsonb_to_recordset((select j from expected)) x(name text,hash text,definer boolean)),
af as(select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
checks as(
 select 'JUDGE_FUNCTION_'||e.name check_name, count(p.oid)=1 and bool_and(md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))=e.hash and p.prosecdef=e.definer and p.proconfig @> array['search_path=""']) ok
 from ef e left join af p on p.proname=e.name group by e.name
 union all
 select 'TIMESTAMP_BODY_OWNER_CONFIG',exists(select 1 from af where proname='handle_updated_at' and prorettype='trigger'::regtype and pronargs=0 and prosecdef and provolatile='v' and pg_get_userbyid(proowner)='postgres' and prolang=(select oid from pg_language where lanname='plpgsql') and md5(trim(regexp_replace(prosrc,'\s+',' ','g')))='8d0d99f0f246f51e6e468e02e03e428b' and proconfig=array['search_path=pg_catalog'])
 union all
 select 'TIMESTAMP_PRIVILEGES_UNCHANGED',coalesce((select coalesce(jsonb_agg(jsonb_build_object('role',case when g.grantee=0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,'privilege',g.privilege_type,'grantable',g.is_grantable) order by case when g.grantee=0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,g.privilege_type,g.is_grantable),'[]'::jsonb)=$acl$[{"role":"PUBLIC","grantable":false,"privilege":"EXECUTE"},{"role":"anon","grantable":false,"privilege":"EXECUTE"},{"role":"authenticated","grantable":false,"privilege":"EXECUTE"},{"role":"postgres","grantable":false,"privilege":"EXECUTE"},{"role":"service_role","grantable":false,"privilege":"EXECUTE"}]$acl$::jsonb from af p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))g where p.proname='handle_updated_at'),false)
 union all
 select 'TIMESTAMP_TRIGGER_DEPENDENCIES',(select count(*) from pg_trigger t join af p on t.tgfoid=p.oid where p.proname='handle_updated_at')=2 and (select count(*) from pg_trigger t join af p on t.tgfoid=p.oid join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where p.proname='handle_updated_at' and t.tgtype=19 and t.tgenabled='O' and not t.tgisinternal and t.tgqual is null and t.tgnargs=0 and t.tgattr::text='' and n.nspname='public' and((c.relname='profiles' and t.tgname='on_profile_updated')or(c.relname='incidents' and t.tgname='on_incident_updated')))=2
 union all
 select 'JUDGE_TABLE_'||e.name,coalesce(c.relrowsecurity,false) and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))g where g.grantee in(0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role')))
 from (values('nigraan_judge_admins'),('nigraan_judge_requests'),('nigraan_judge_audit'),('nigraan_judge_email_outbox'))e(name) left join pg_class c on c.oid=to_regclass('public.'||e.name)
 union all
 select 'SERVICE_ROLE_BOUNDARY_'||e.name,coalesce(has_function_privilege('service_role',p.oid,'EXECUTE')=(e.name in('nigraan_claim_judge_email','nigraan_finish_judge_email')),false)
 from ef e left join af p on p.proname=e.name where e.name not in('is_approved_operations','nigraan_storage_access','nigraan_record_workflow')
 union all
 select 'ANON_PUBLIC_NEW_HELPERS_'||e.name,coalesce(not has_function_privilege('anon',p.oid,'EXECUTE') and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))g where g.grantee=0),false)
 from ef e left join af p on p.proname=e.name where e.name not in('is_approved_operations','nigraan_storage_access','nigraan_record_workflow')
 union all
 select 'NEW_EXPIRY_TRIGGERS',(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join af p on t.tgfoid=p.oid where not t.tgisinternal and t.tgenabled='O' and n.nspname='public' and p.proname='nigraan_guard_operations_write' and((t.tgname='nigraan_expiring_workflow_write' and c.relname='incidents' and t.tgtype=19)or(t.tgname='nigraan_expiring_public_update' and c.relname='nigraan_operations_public_updates' and t.tgtype=7)))=2
)
select case when coalesce(bool_and(coalesce(ok,false)),false) then 'PASS' else 'BLOCKED' end verdict,
 count(*) filter(where not coalesce(ok,false)) blocked_checks,
 coalesce(jsonb_agg(check_name order by check_name) filter(where not coalesce(ok,false)),'[]'::jsonb) mismatches,
 'Catalog postcheck only; full hosted Citizen/permanent Operations/60-minute/email/MCP acceptance remains required.' scope
from checks;
