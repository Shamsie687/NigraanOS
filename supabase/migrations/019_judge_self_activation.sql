-- Additive change AFTER already deployed 015 -> 016 -> 017 -> 018.
-- Existing started/expired legacy grants retain original deadlines. No timer reset.
-- New approval: activate once within 48 hours; DB-clock session lasts 60 minutes.
begin;
set local lock_timeout='10s';
lock table public.nigraan_judge_requests in access exclusive mode;
do $guard$
begin
  if current_user<>'postgres' then raise exception 'Project-owner SQL Editor required'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.nigraan_judge_requests'::regclass
    and conname='nigraan_judge_requests_check' and contype='c') then raise exception '015 timing constraint prerequisite missing'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.nigraan_judge_audit'::regclass
    and conname='nigraan_judge_audit_action_check' and contype='c') then raise exception '015 audit constraint prerequisite missing'; end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nigraan_has_operations_access' and p.prosecdef and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='9160161efa2431ad44bef8587a25c73d') then raise exception '019 function prerequisite drift; stop'; end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nigraan_operations_access_context' and p.prosecdef and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='5dbcce719ea346332f2cdb69fa62daad') then raise exception '019 function prerequisite drift; stop'; end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nigraan_decide_judge_access' and p.prosecdef and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='634a18e4ccac34f6b565a74076219e77') then raise exception '019 function prerequisite drift; stop'; end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nigraan_list_judge_requests' and p.prosecdef and md5(trim(regexp_replace(p.prosrc,'\s+',' ','g')))='b604c2b80c46c0347d4eb4c822515759') then raise exception '019 function prerequisite drift; stop'; end if;
end $guard$;
alter table public.nigraan_judge_requests add column started_at timestamptz;
alter table public.nigraan_judge_requests add column activation_expires_at timestamptz;
alter table public.nigraan_judge_email_outbox add column activation_expires_at timestamptz;
-- Preserve legacy grants rather than converting an existing hour into a new one.
update public.nigraan_judge_requests set started_at=approved_at,
 activation_expires_at=approved_at+interval '48 hours' where approved_at is not null;
alter table public.nigraan_judge_requests drop constraint nigraan_judge_requests_check;
alter table public.nigraan_judge_requests add constraint nigraan_judge_activation_deadline check(
 (approved_at is null and activation_expires_at is null and started_at is null and expires_at is null)
 or (approved_at is not null and activation_expires_at is not null
 and activation_expires_at=approved_at+interval '48 hours'));
alter table public.nigraan_judge_requests add constraint nigraan_judge_session_deadline check(
 (started_at is null and expires_at is null) or
 (started_at is not null and expires_at is not null and approved_at is not null
 and started_at>=approved_at and started_at<activation_expires_at
 and expires_at=started_at+interval '60 minutes'));
alter table public.nigraan_judge_audit drop constraint nigraan_judge_audit_action_check;
alter table public.nigraan_judge_audit add constraint nigraan_judge_audit_action_check
 check(action in('requested','approved','activated','rejected','revoked','email_retry'));
create or replace function public.nigraan_has_operations_access()
returns boolean language sql volatile security definer set search_path='' as $$
 select public.nigraan_is_permanent_operations() or exists(
 select 1 from public.nigraan_judge_requests r where r.user_id=(select auth.uid())
 and r.status='approved' and r.started_at<=clock_timestamp() and r.expires_at>clock_timestamp());
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
    'request_id',r.id,'requested_at',r.requested_at,'approved_at',r.approved_at,
    'started_at',r.started_at,'activation_expires_at',r.activation_expires_at,'expires_at',r.expires_at,
    'status',case when r.status='approved' and r.started_at is null and r.activation_expires_at<=at_time then 'expired' when r.status='approved' and r.started_at is not null then case when r.expires_at<=at_time then 'expired' else 'active' end else r.status end);
end;
$$;
create or replace function public.nigraan_decide_judge_access(request_id uuid,decision text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.nigraan_judge_requests; actor uuid:=auth.uid(); at_time timestamptz;
begin
  if not public.nigraan_is_judge_admin() then raise exception using errcode='PT403',message='Administrator access required'; end if;
  if decision not in ('approved','rejected','revoked') or decision is null then raise exception using errcode='PT400',message='Unsupported decision'; end if;
  select * into r from public.nigraan_judge_requests q where q.id=request_id for update;
  if not found or r.user_id=actor then raise exception using errcode='PT403',message='Request unavailable or self-approval forbidden'; end if;
  if not public.nigraan_is_judge_admin() then raise exception using errcode='PT403',message='Administrator access changed'; end if;
  at_time:=clock_timestamp();
  if (decision in ('approved','rejected') and r.status<>'pending')
    or (decision='revoked' and (r.status<>'approved' or (r.started_at is null and r.activation_expires_at<=at_time) or (r.started_at is not null and r.expires_at<=at_time))) then
    raise exception using errcode='PT409',message='Request already decided or expired'; end if;
  if decision='approved' then
    if exists(select 1 from public.operations_profiles o where o.user_id=r.user_id and o.verification_status='approved') then
      raise exception using errcode='PT409',message='This account already has permanent Operations access'; end if;
    -- Existing FKs require an Operations identity for assignment/public updates.
    -- Pending identity ONLY: never change existing status or approve permanently.
    insert into public.operations_profiles(user_id,organization_name,organization_type,verification_status)
      values(r.user_id,'Temporary hackathon judge','other','pending') on conflict(user_id) do nothing;
  end if;
  update public.nigraan_judge_requests q set status=decision,decided_by=actor,decided_at=at_time,
    approved_at=case when decision='approved' then at_time else q.approved_at end,
    activation_expires_at=case when decision='approved' then at_time+interval '48 hours' else q.activation_expires_at end,
    expires_at=case when decision='approved' then null else q.expires_at end
    where q.id=r.id returning * into r;
  insert into public.nigraan_judge_audit(request_id,actor_id,action) values(r.id,actor,decision);
  insert into public.nigraan_judge_email_outbox(request_id,event,recipient,requested_at,expires_at,activation_expires_at)
    values(r.id,decision,r.registered_email,r.requested_at,r.expires_at,r.activation_expires_at);
end;
$$;
create or replace function public.nigraan_list_judge_requests()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.nigraan_is_judge_admin() then raise exception using errcode='PT403',message='Administrator access required'; end if;
  return jsonb_build_object('requests',coalesce((select jsonb_agg(to_jsonb(x)) from (
    select r.id,r.registered_email,r.requested_at,r.approved_at,r.started_at,r.activation_expires_at,r.expires_at,
      case when r.status='approved' and r.started_at is null and r.activation_expires_at<=clock_timestamp() then 'expired' when r.status='approved' and r.started_at is not null then case when r.expires_at<=clock_timestamp() then 'expired' else 'active' end else r.status end status
    from public.nigraan_judge_requests r order by requested_at desc limit 100)x),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select request_id,action,recorded_at from public.nigraan_judge_audit order by id desc limit 200)x),'[]'::jsonb),
    'emails',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id,request_id,event,state,attempts,failure_code from public.nigraan_judge_email_outbox order by created_at desc limit 200)x),'[]'::jsonb));
end;
$$;

create function public.nigraan_activate_judge_access()
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
 update public.nigraan_judge_requests r set started_at=v_now,expires_at=v_now+interval '60 minutes'
   where r.id=v_request.id and r.started_at is null;
 insert into public.nigraan_judge_audit(request_id,actor_id,action) values(v_request.id,v_actor,'activated');
 return public.nigraan_operations_access_context();
end;
$$;
revoke all on function public.nigraan_activate_judge_access() from public,anon,authenticated,service_role;
grant execute on function public.nigraan_activate_judge_access() to authenticated;
-- Replaced functions keep existing authenticated grants and 017 service-role restrictions.
commit;
