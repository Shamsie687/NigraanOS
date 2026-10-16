-- Local preparation only. Apply once AFTER reviewed 015-019, never replay them.
-- Started legacy grants retain their exact deadlines. New activations last 12 hours.
begin;
set local lock_timeout='10s';
lock table public.nigraan_judge_requests,public.nigraan_judge_audit,public.nigraan_judge_email_outbox in access exclusive mode;
do $guard$
begin
 if current_user<>'postgres' then raise exception 'Project-owner migration required'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nigraan_has_operations_access' and p.oid=to_regprocedure('public.nigraan_has_operations_access()') and p.proconfig @> array['search_path=""'] and p.prosecdef and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='f5b6d2c65158b5bfdae6034edca3095e') then raise exception '020 prerequisite drift: nigraan_has_operations_access'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nigraan_operations_access_context' and p.oid=to_regprocedure('public.nigraan_operations_access_context()') and p.proconfig @> array['search_path=""'] and p.prosecdef and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='0b705106d3e9bff338203fa4e6a06cca') then raise exception '020 prerequisite drift: nigraan_operations_access_context'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nigraan_decide_judge_access' and p.oid=to_regprocedure('public.nigraan_decide_judge_access(uuid,text)') and p.proconfig @> array['search_path=""'] and p.prosecdef and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='664ca187390c4f9eb1363269227bd409') then raise exception '020 prerequisite drift: nigraan_decide_judge_access'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nigraan_list_judge_requests' and p.oid=to_regprocedure('public.nigraan_list_judge_requests()') and p.proconfig @> array['search_path=""'] and p.prosecdef and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='6fdadc9e6985e57420155e83d9e81cea') then raise exception '020 prerequisite drift: nigraan_list_judge_requests'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nigraan_activate_judge_access' and p.oid=to_regprocedure('public.nigraan_activate_judge_access()') and p.proconfig @> array['search_path=""'] and p.prosecdef and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='6d63fe7e2bd4c92b698a78312850e1c9') then raise exception '020 prerequisite drift: nigraan_activate_judge_access'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nigraan_is_permanent_operations' and p.oid=to_regprocedure('public.nigraan_is_permanent_operations()') and p.proconfig @> array['search_path=""'] and p.prosecdef and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='f73ad124cf7222569038b63d7f7937f0') then raise exception '020 prerequisite drift: nigraan_is_permanent_operations'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nigraan_is_judge_admin' and p.oid=to_regprocedure('public.nigraan_is_judge_admin()') and p.proconfig @> array['search_path=""'] and p.prosecdef and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='1ac725896b70e5e9c83e2ed6ed3a3890') then raise exception '020 prerequisite drift: nigraan_is_judge_admin'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='is_approved_operations' and p.oid=to_regprocedure('public.is_approved_operations()') and p.proconfig @> array['search_path=""'] and p.prosecdef and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='e1fbe6f682f94c1b21c21ed5567dc0f5') then raise exception '020 prerequisite drift: is_approved_operations'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nigraan_retry_judge_email' and p.oid=to_regprocedure('public.nigraan_retry_judge_email(uuid)') and p.proconfig @> array['search_path=""'] and p.prosecdef and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='2ea81ae9fc6d0aa5f980c3a6e8eb10ec') then raise exception '020 prerequisite drift: nigraan_retry_judge_email'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nigraan_claim_judge_email' and p.oid=to_regprocedure('public.nigraan_claim_judge_email(uuid)') and p.proconfig @> array['search_path=""'] and p.prosecdef and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='e38abd5a4abd51e38af5a2f60f5310b6') then raise exception '020 prerequisite drift: nigraan_claim_judge_email'; end if;
end $guard$;
alter table public.nigraan_judge_requests add column cycle integer not null default 1 check(cycle>0);
alter table public.nigraan_judge_requests add column session_seconds integer not null default 3600 check(session_seconds in(3600,43200));
-- Never extend an existing started/expired session. Unstarted approvals use new duration.
update public.nigraan_judge_requests set session_seconds=43200 where started_at is null;
alter table public.nigraan_judge_requests alter column session_seconds set default 43200;
alter table public.nigraan_judge_requests drop constraint nigraan_judge_activation_deadline;
alter table public.nigraan_judge_requests add constraint nigraan_judge_activation_deadline check(
 (approved_at is null and activation_expires_at is null and started_at is null and expires_at is null)
 or (approved_at is not null and activation_expires_at is not null and activation_expires_at>approved_at and activation_expires_at<=approved_at+interval '45 days'));
alter table public.nigraan_judge_requests drop constraint nigraan_judge_session_deadline;
alter table public.nigraan_judge_requests add constraint nigraan_judge_session_deadline check(
 (started_at is null and expires_at is null) or
 (started_at is not null and expires_at is not null and approved_at is not null and started_at>=approved_at and started_at<activation_expires_at
 and expires_at=started_at+make_interval(secs=>session_seconds)));
alter table public.nigraan_judge_audit add column cycle integer not null default 1 check(cycle>0);
alter table public.nigraan_judge_audit add column previous_grant jsonb;
alter table public.nigraan_judge_audit drop constraint nigraan_judge_audit_action_check;
alter table public.nigraan_judge_audit add constraint nigraan_judge_audit_action_check check(action in('requested','approved','activated','rejected','revoked','renewed','email_retry'));
alter table public.nigraan_judge_email_outbox add column cycle integer not null default 1 check(cycle>0);
alter table public.nigraan_judge_email_outbox add column session_seconds integer not null default 3600 check(session_seconds in(3600,43200));
alter table public.nigraan_judge_email_outbox alter column session_seconds set default 43200;
alter table public.nigraan_judge_email_outbox drop constraint nigraan_judge_email_outbox_request_id_event_key;
alter table public.nigraan_judge_email_outbox add constraint nigraan_judge_email_cycle_event_key unique(request_id,cycle,event);

create function public.nigraan_review_judge_access(request_id uuid,decision text,expected_cycle integer default null,activation_deadline timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.nigraan_judge_requests; previous jsonb; actor uuid:=auth.uid(); at_time timestamptz; deadline timestamptz; mail text; approving boolean;
begin
 if not public.nigraan_is_judge_admin() then raise exception using errcode='PT403',message='Administrator access required'; end if;
 if decision is null or decision not in('approved','rejected','revoked','renewed') then raise exception using errcode='PT400',message='Unsupported decision'; end if;
 select * into r from public.nigraan_judge_requests q where q.id=request_id for update;
 if not found or r.user_id=actor then raise exception using errcode='PT403',message='Request unavailable or self-approval forbidden'; end if;
 -- All authorization/state/time checks repeat after lock acquisition.
 if not public.nigraan_is_judge_admin() then raise exception using errcode='PT403',message='Administrator access changed'; end if;
 at_time:=clock_timestamp();approving:=decision in('approved','renewed');
 if expected_cycle is not null and expected_cycle<>r.cycle then raise exception using errcode='PT409',message='Cycle changed; refresh requests'; end if;
 if decision='renewed' then
   if expected_cycle is null or expected_cycle<>r.cycle or r.status<>'approved'
     or not ((r.started_at is not null and r.expires_at<=at_time) or (r.started_at is null and r.activation_expires_at<=at_time)) then
     raise exception using errcode='PT409',message='Only the expected expired cycle can be renewed'; end if;
 elsif decision in('approved','rejected') and r.status<>'pending' then
   raise exception using errcode='PT409',message='Request already decided';
 elsif decision='revoked' and (r.status<>'approved' or (r.started_at is null and r.activation_expires_at<=at_time) or (r.started_at is not null and r.expires_at<=at_time)) then
   raise exception using errcode='PT409',message='Access already ended';
 end if;
 if not approving and activation_deadline is not null then raise exception using errcode='PT400',message='Deadline applies to approval only'; end if;
 if approving then
   if exists(select 1 from public.operations_profiles o where o.user_id=r.user_id and o.verification_status='approved') then
     raise exception using errcode='PT409',message='Permanent Operations already available'; end if;
   select u.email into mail from auth.users u where u.id=r.user_id and u.email_confirmed_at is not null;
   if mail is null then raise exception using errcode='PT403',message='Verified registered email required'; end if;
   deadline:=coalesce(activation_deadline,at_time+interval '48 hours');
   if not isfinite(deadline) or deadline<=at_time or deadline>at_time+interval '45 days' then
     raise exception using errcode='PT400',message='Activation deadline must be future and within 45 days'; end if;
   insert into public.operations_profiles(user_id,organization_name,organization_type,verification_status)
     values(r.user_id,'Temporary hackathon judge','other','pending') on conflict(user_id) do nothing;
 end if;
 previous:=case when decision='renewed' then to_jsonb(r) else null end;
 update public.nigraan_judge_requests q set
   cycle=case when decision='renewed' then q.cycle+1 else q.cycle end,
   status=case when approving then 'approved' else decision end,decided_by=actor,decided_at=at_time,
   registered_email=case when approving then mail else q.registered_email end,
   approved_at=case when approving then at_time else q.approved_at end,
   activation_expires_at=case when approving then deadline else q.activation_expires_at end,
   started_at=case when approving then null else q.started_at end,
   expires_at=case when approving then null else q.expires_at end,
   session_seconds=case when approving then 43200 else q.session_seconds end
   where q.id=r.id returning * into r;
 insert into public.nigraan_judge_audit(request_id,actor_id,action,cycle,previous_grant) values(r.id,actor,decision,r.cycle,previous);
 insert into public.nigraan_judge_email_outbox(request_id,event,recipient,requested_at,expires_at,activation_expires_at,cycle,session_seconds)
   values(r.id,case when approving then 'approved' else decision end,r.registered_email,r.requested_at,r.expires_at,r.activation_expires_at,r.cycle,r.session_seconds);
end;
$$;
-- Retain the old RPC signature/default for older administrators; it cannot renew.
create or replace function public.nigraan_decide_judge_access(request_id uuid,decision text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if decision='renewed' then raise exception using errcode='PT400',message='Renewal requires expected cycle'; end if;
 perform public.nigraan_review_judge_access(request_id,decision,null,null);
end;
$$;

create or replace function public.nigraan_operations_access_context()
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r public.nigraan_judge_requests; permanent boolean; at_time timestamptz:=clock_timestamp();
begin
  if auth.uid() is null then raise exception using errcode='PT401',message='Sign in required'; end if;
  permanent:=public.nigraan_is_permanent_operations();
  select * into r from public.nigraan_judge_requests where user_id=auth.uid();
  at_time:=clock_timestamp();
  return jsonb_build_object('server_now',at_time,'permanent',permanent,
    'admin',public.nigraan_is_judge_admin(),
    'allowed',permanent or coalesce(r.status='approved' and r.started_at<=at_time and r.expires_at>at_time,false),
    'session_seconds',r.session_seconds,'cycle',r.cycle,'request_id',r.id,'requested_at',r.requested_at,'approved_at',r.approved_at,
    'started_at',r.started_at,'activation_expires_at',r.activation_expires_at,'expires_at',r.expires_at,
    'status',case when r.status='approved' and r.started_at is null and r.activation_expires_at<=at_time then 'expired' when r.status='approved' and r.started_at is not null then case when r.expires_at<=at_time then 'expired' else 'active' end else r.status end);
end;
$$;
create or replace function public.nigraan_activate_judge_access()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_request public.nigraan_judge_requests; v_now timestamptz;
begin
 if v_actor is null then raise exception using errcode='PT401',message='Sign in required'; end if;
 if public.nigraan_is_permanent_operations() then raise exception using errcode='PT409',message='Permanent Operations already available'; end if;
 select * into v_request from public.nigraan_judge_requests r where r.user_id=v_actor for update;
 if not found or v_request.status<>'approved' or v_request.decided_by is null or v_request.decided_by=v_actor then
   raise exception using errcode='PT403',message='Approved access required'; end if;
 if not exists(select 1 from auth.users u where u.id=v_actor and u.email_confirmed_at is not null) then
   raise exception using errcode='PT403',message='Verified account required'; end if;
 -- Re-evaluate identity/state and clock AFTER waiting on the row lock.
 if public.nigraan_is_permanent_operations() then raise exception using errcode='PT409',message='Permanent Operations already available'; end if;
 if v_request.started_at is not null then return public.nigraan_operations_access_context(); end if;
 v_now:=clock_timestamp();
 if v_request.activation_expires_at is null or v_request.activation_expires_at<=v_now then
   raise exception using errcode='PT410',message='Approval activation window expired'; end if;
 update public.nigraan_judge_requests r set started_at=v_now,expires_at=v_now+make_interval(secs=>v_request.session_seconds)
   where r.id=v_request.id and r.started_at is null;
 insert into public.nigraan_judge_audit(request_id,actor_id,action,cycle) values(v_request.id,v_actor,'activated',v_request.cycle);
 return public.nigraan_operations_access_context();
end;
$$;
create or replace function public.nigraan_list_judge_requests()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.nigraan_is_judge_admin() then raise exception using errcode='PT403',message='Administrator access required'; end if;
  return jsonb_build_object('requests',coalesce((select jsonb_agg(to_jsonb(x)) from (
    select r.id,r.cycle,r.session_seconds,r.registered_email,r.requested_at,r.approved_at,r.started_at,r.activation_expires_at,r.expires_at,
      case when r.status='approved' and r.started_at is null and r.activation_expires_at<=clock_timestamp() then 'expired' when r.status='approved' and r.started_at is not null then case when r.expires_at<=clock_timestamp() then 'expired' else 'active' end else r.status end status
    from public.nigraan_judge_requests r order by requested_at desc limit 100)x),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select request_id,cycle,action,recorded_at,previous_grant from public.nigraan_judge_audit order by id desc limit 200)x),'[]'::jsonb),
    'emails',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id,request_id,cycle,event,state,attempts,failure_code from public.nigraan_judge_email_outbox order by created_at desc limit 200)x),'[]'::jsonb));
end;
$$;
create or replace function public.nigraan_retry_judge_email(job_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.nigraan_judge_email_outbox;
begin
  if not public.nigraan_is_judge_admin() then raise exception using errcode='PT403',message='Administrator access required'; end if;
  select * into r from public.nigraan_judge_email_outbox where id=job_id for update;
  if not found then raise exception using errcode='PT409',message='Notification unavailable'; end if;
  if not exists(select 1 from public.nigraan_judge_requests q where q.id=r.request_id and q.cycle=r.cycle) then raise exception using errcode='PT409',message='Notification belongs to an earlier cycle'; end if;
  if r.state='sent' or r.attempts>=5 or r.created_at<clock_timestamp()-interval '23 hours'
    or r.state='sending' or r.failure_code in ('delivery_unknown','timeout') then
    raise exception using errcode='PT409',message='Email cannot be retried safely'; end if;
  update public.nigraan_judge_email_outbox set state='pending',lease=null,lease_until=null where id=r.id;
  insert into public.nigraan_judge_audit(request_id,actor_id,action,cycle) values(r.request_id,auth.uid(),'email_retry',r.cycle);
end;
$$;
create or replace function public.nigraan_claim_judge_email(job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.nigraan_judge_email_outbox;
begin
  select * into r from public.nigraan_judge_email_outbox where id=job_id for update;
  if not found then return null; end if;
  if not exists(select 1 from public.nigraan_judge_requests q where q.id=r.request_id and q.cycle=r.cycle) then return null; end if;
  if r.state='sent' or r.attempts>=5 or r.created_at<clock_timestamp()-interval '23 hours'
    or r.state='sending' or r.state='failed' then return null; end if;
  update public.nigraan_judge_email_outbox set state='sending',attempts=attempts+1,
    lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds'
    where id=r.id returning * into r;
  return to_jsonb(r);
end;
$$;
-- Existing tables remain private and their RLS policies are not broadened.
revoke all on function public.nigraan_review_judge_access(uuid,text,integer,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.nigraan_review_judge_access(uuid,text,integer,timestamptz) to authenticated;
commit;
