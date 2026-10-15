-- Release 002–013 prerequisite. Local preparation ONLY; deploy separately after review.
-- Does not apply/reuse M4E migration 014. No administrator UUID is embedded.
begin;
set local lock_timeout='10s';

create table public.nigraan_judge_admins (
  user_id uuid primary key references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
create table public.nigraan_judge_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id),
  registered_email text not null,
  requested_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending' check(status in ('pending','approved','rejected','revoked')),
  approved_at timestamptz,
  expires_at timestamptz,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  check((approved_at is null and expires_at is null) or
        (approved_at is not null and expires_at=approved_at+interval '60 minutes')),
  check(status not in ('approved','revoked') or approved_at is not null)
);
create table public.nigraan_judge_audit (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.nigraan_judge_requests(id),
  actor_id uuid not null references public.profiles(id),
  action text not null check(action in ('requested','approved','rejected','revoked','email_retry')),
  recorded_at timestamptz not null default clock_timestamp()
);
create table public.nigraan_judge_email_outbox (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.nigraan_judge_requests(id),
  event text not null check(event in ('requested','approved','rejected','revoked')),
  recipient text not null,
  requested_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  state text not null default 'pending' check(state in ('pending','sending','sent','failed')),
  attempts integer not null default 0,
  lease uuid,
  lease_until timestamptz,
  provider_id text,
  failure_code text,
  unique(request_id,event)
);
alter table public.nigraan_judge_admins enable row level security;
alter table public.nigraan_judge_requests enable row level security;
alter table public.nigraan_judge_audit enable row level security;
alter table public.nigraan_judge_email_outbox enable row level security;
revoke all on public.nigraan_judge_admins,public.nigraan_judge_requests,
  public.nigraan_judge_audit,public.nigraan_judge_email_outbox from public,anon,authenticated,service_role;
revoke all on sequence public.nigraan_judge_audit_id_seq from public,anon,authenticated,service_role;

-- Never broaden this helper: permanent approval remains separate from judge grants.
create function public.nigraan_is_permanent_operations()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.operations_profiles o join public.profiles p on p.id=o.user_id
    where o.user_id=(select auth.uid()) and o.verification_status='approved');
$$;
create function public.nigraan_is_judge_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select public.nigraan_is_permanent_operations() and exists(
    select 1 from public.nigraan_judge_admins a where a.user_id=(select auth.uid()));
$$;
create function public.nigraan_has_operations_access()
returns boolean language sql volatile security definer set search_path='' as $$
  select public.nigraan_is_permanent_operations() or exists(
    select 1 from public.nigraan_judge_requests r where r.user_id=(select auth.uid())
      and r.status='approved' and r.approved_at<=clock_timestamp() and r.expires_at>clock_timestamp());
$$;
-- Existing RLS, Storage helpers, AI/city-context/Agent and write RPCs all use this
-- compatibility entry point. No judge is made permanently approved.
create or replace function public.is_approved_operations()
returns boolean language sql volatile security definer set search_path='' as $$
  select public.nigraan_has_operations_access();
$$;

create function public.nigraan_operations_access_context()
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r public.nigraan_judge_requests; permanent boolean; at_time timestamptz:=clock_timestamp();
begin
  if auth.uid() is null then raise exception using errcode='PT401',message='Sign in required'; end if;
  permanent:=public.nigraan_is_permanent_operations();
  select * into r from public.nigraan_judge_requests where user_id=auth.uid();
  at_time:=clock_timestamp();
  return jsonb_build_object('server_now',at_time,'permanent',permanent,
    'admin',public.nigraan_is_judge_admin(),
    'allowed',permanent or coalesce(r.status='approved' and r.expires_at>at_time,false),
    'request_id',r.id,'requested_at',r.requested_at,'approved_at',r.approved_at,
    'expires_at',r.expires_at,
    'status',case when r.status='approved' and r.expires_at<=at_time then 'expired' else r.status end);
end;
$$;

create function public.nigraan_request_judge_access()
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); mail text; result uuid; submitted_at timestamptz;
begin
  if actor is null then raise exception using errcode='PT401',message='Sign in required'; end if;
  if public.nigraan_is_permanent_operations() then raise exception using errcode='PT409',message='Permanent Operations access already available'; end if;
  select email into mail from auth.users where id=actor and email_confirmed_at is not null;
  if mail is null then raise exception using errcode='PT403',message='Verified registered email required'; end if;
  -- Serialize global admission and per-user duplication. One request/window per account.
  perform pg_advisory_xact_lock(158600);
  if exists(select 1 from public.nigraan_judge_requests where user_id=actor) then
    raise exception using errcode='PT409',message='A judge request already exists'; end if;
  if (select count(*) from public.nigraan_judge_requests where requested_at>clock_timestamp()-interval '24 hours')>=25 then
    raise exception using errcode='PT429',message='Judge request limit reached; contact the organizer'; end if;
  insert into public.nigraan_judge_requests(user_id,registered_email) values(actor,mail)
    returning id,requested_at into result,submitted_at;
  insert into public.nigraan_judge_audit(request_id,actor_id,action) values(result,actor,'requested');
  insert into public.nigraan_judge_email_outbox(request_id,event,recipient,requested_at)
    values(result,'requested',mail,submitted_at);
  return result;
end;
$$;

create function public.nigraan_decide_judge_access(request_id uuid,decision text)
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
    or (decision='revoked' and (r.status<>'approved' or r.expires_at<=at_time)) then
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
    expires_at=case when decision='approved' then at_time+interval '60 minutes' else q.expires_at end
    where q.id=r.id returning * into r;
  insert into public.nigraan_judge_audit(request_id,actor_id,action) values(r.id,actor,decision);
  insert into public.nigraan_judge_email_outbox(request_id,event,recipient,requested_at,expires_at)
    values(r.id,decision,r.registered_email,r.requested_at,r.expires_at);
end;
$$;

create function public.nigraan_list_judge_requests()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.nigraan_is_judge_admin() then raise exception using errcode='PT403',message='Administrator access required'; end if;
  return jsonb_build_object('requests',coalesce((select jsonb_agg(to_jsonb(x)) from (
    select r.id,r.registered_email,r.requested_at,r.approved_at,r.expires_at,
      case when r.status='approved' and r.expires_at<=clock_timestamp() then 'expired' else r.status end status
    from public.nigraan_judge_requests r order by requested_at desc limit 100)x),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select request_id,action,recorded_at from public.nigraan_judge_audit order by id desc limit 200)x),'[]'::jsonb),
    'emails',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id,request_id,event,state,attempts,failure_code from public.nigraan_judge_email_outbox order by created_at desc limit 200)x),'[]'::jsonb));
end;
$$;

-- Check at the actual write too: a waiting workflow RPC cannot bypass expiry.
create function public.nigraan_guard_operations_write()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and
    (tg_table_name='nigraan_operations_public_updates' or
      (to_jsonb(new)->'status' is distinct from to_jsonb(old)->'status') or
      (to_jsonb(new)->'assigned_organization_id' is distinct from to_jsonb(old)->'assigned_organization_id'))
    and not public.nigraan_has_operations_access() then
    raise exception using errcode='PT403',message='Operations access expired or revoked'; end if;
  return new;
end;
$$;
create trigger nigraan_expiring_workflow_write before update on public.incidents
  for each row execute function public.nigraan_guard_operations_write();
create trigger nigraan_expiring_public_update before insert on public.nigraan_operations_public_updates
  for each row execute function public.nigraan_guard_operations_write();

-- Worker-only transactional lease; provider idempotency persists across retries.
create function public.nigraan_claim_judge_email(job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.nigraan_judge_email_outbox;
begin
  select * into r from public.nigraan_judge_email_outbox where id=job_id for update;
  if not found or r.state='sent' or r.attempts>=5 or r.created_at<clock_timestamp()-interval '23 hours'
    or (r.state='sending' and r.lease_until>clock_timestamp()) or r.state='failed' then return null; end if;
  update public.nigraan_judge_email_outbox set state='sending',attempts=attempts+1,
    lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds'
    where id=r.id returning * into r;
  return to_jsonb(r);
end;
$$;
create function public.nigraan_finish_judge_email(job_id uuid,lease_id uuid,sent_id text,error_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.nigraan_judge_email_outbox set state=case when sent_id is not null then 'sent' else 'failed' end,
    provider_id=sent_id,failure_code=case when sent_id is not null then null else
      case when error_code in ('configuration','provider_failure','timeout','delivery_unknown') then error_code else 'provider_failure' end end,
    lease_until=null
    where id=job_id and lease=lease_id and state='sending';
end;
$$;
create function public.nigraan_retry_judge_email(job_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.nigraan_judge_email_outbox;
begin
  if not public.nigraan_is_judge_admin() then raise exception using errcode='PT403',message='Administrator access required'; end if;
  select * into r from public.nigraan_judge_email_outbox where id=job_id for update;
  if not found or r.state='sent' or r.attempts>=5 or r.created_at<clock_timestamp()-interval '23 hours'
    or (r.state='sending' and r.lease_until>clock_timestamp()) then
    raise exception using errcode='PT409',message='Email cannot be retried safely'; end if;
  update public.nigraan_judge_email_outbox set state='pending',lease=null,lease_until=null where id=r.id;
  insert into public.nigraan_judge_audit(request_id,actor_id,action) values(r.request_id,auth.uid(),'email_retry');
end;
$$;

revoke all on function public.nigraan_is_permanent_operations(),public.nigraan_is_judge_admin(),
  public.nigraan_has_operations_access(),public.nigraan_operations_access_context(),
  public.nigraan_request_judge_access(),public.nigraan_decide_judge_access(uuid,text),
  public.nigraan_list_judge_requests(),public.nigraan_guard_operations_write(),
  public.nigraan_claim_judge_email(uuid),public.nigraan_finish_judge_email(uuid,uuid,text,text),
  public.nigraan_retry_judge_email(uuid) from public,anon,authenticated;
grant execute on function public.nigraan_is_permanent_operations(),public.nigraan_is_judge_admin(),
  public.nigraan_has_operations_access(),public.nigraan_operations_access_context(),
  public.nigraan_request_judge_access(),public.nigraan_decide_judge_access(uuid,text),
  public.nigraan_list_judge_requests(),public.nigraan_retry_judge_email(uuid) to authenticated;
grant execute on function public.nigraan_claim_judge_email(uuid),
  public.nigraan_finish_judge_email(uuid,uuid,text,text) to service_role;
-- is_approved_operations retains existing authenticated grants and restrictive RLS.
create function public.nigraan_storage_access_base(object_name text,mode text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare entity uuid; parts text[];
begin
  parts:=string_to_array(object_name,'/');
  if array_length(parts,1) not in (3,4) or parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or parts[3]='' then return false; end if;
  entity:=parts[2]::uuid;
  if array_length(parts,1)=3 then
    if mode='write' then return parts[1]=(select auth.uid())::text and public.nigraan_owns_draft(entity);
    elsif mode='read' then return exists(select 1 from public.incidents i where i.id=entity and i.reporter_id::text=parts[1] and public.nigraan_can_read_incident(i.id));
    end if;
    return false;
  end if;
  if parts[3] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or parts[4]='' then return false; end if;
  if mode='write' then
    return parts[1]=(select auth.uid())::text and exists(
      select 1 from public.nigraan_citizen_changes c join public.incidents i on i.id=c.incident_id
      where c.id=parts[3]::uuid and c.incident_id=entity and c.citizen_id=(select auth.uid()) and i.reporter_id=c.citizen_id and c.submission_state='draft');
  elsif mode='read' then
    return exists(select 1 from public.nigraan_citizen_changes c where c.id=parts[3]::uuid and c.incident_id=entity and c.citizen_id::text=parts[1]
        and ((c.submission_state='published' and public.nigraan_can_read_incident(c.incident_id)) or (c.submission_state='draft' and c.citizen_id=(select auth.uid()))));
  end if;
  return false;
end;
$$;
revoke all on function public.nigraan_storage_access_base(text,text) from public,anon,authenticated,service_role;
-- Temporary judges cannot mint signed URLs that would survive their grant.
-- Their other-citizen evidence is served through the expiring authenticated proxy.
create or replace function public.nigraan_storage_access(object_name text,mode text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
  if mode='read' and not public.nigraan_is_permanent_operations()
    and split_part(object_name,'/',1) is distinct from auth.uid()::text then return false; end if;
  return public.nigraan_storage_access_base(object_name,mode);
end;
$$;


-- Preserve original workflow audit; fail closed if access expires during the write.
create or replace function public.nigraan_record_workflow() returns trigger
language plpgsql security definer set search_path='' as $$
declare event_kind text; actor uuid;
begin
  if new.submission_state<>'submitted' then return new; end if;
  if tg_op='INSERT' then event_kind:='publication';
  elsif old.submission_state is distinct from 'submitted' then event_kind:='publication';
  elsif new.status is distinct from old.status then event_kind:='transition';
  elsif new.assigned_organization_id is distinct from old.assigned_organization_id then event_kind:='assignment';
  else return new; end if;
  if new.status not in ('reported','acknowledged','assigned','in_progress','resolved') then return new; end if;
  if event_kind<>'publication' and auth.uid() is not null and not public.nigraan_has_operations_access() then
    raise exception using errcode='PT403',message='Operations access expired before workflow audit'; end if;
  actor:=case when event_kind<>'publication' and public.is_approved_operations() then auth.uid() else null end;
  insert into public.nigraan_incident_workflow_events(incident_id,kind,previous_status,status,actor_id)
    values(new.id,event_kind,case when tg_op='UPDATE' and event_kind<>'publication' then old.status else null end,new.status,actor);
  return new;
end;
$$;
commit;
