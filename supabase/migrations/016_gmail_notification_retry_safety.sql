-- Gmail has no send idempotency guarantee. Never reclaim uncertain sends.
-- Notification RPCs only; judge authorization and historical migrations unchanged.
begin;
create or replace function public.nigraan_claim_judge_email(job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.nigraan_judge_email_outbox;
begin
  select * into r from public.nigraan_judge_email_outbox where id=job_id for update;
  if not found or r.state='sent' or r.attempts>=5 or r.created_at<clock_timestamp()-interval '23 hours'
    or r.state='sending' or r.state='failed' then return null; end if;
  update public.nigraan_judge_email_outbox set state='sending',attempts=attempts+1,
    lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds'
    where id=r.id returning * into r;
  return to_jsonb(r);
end;
$$;
create or replace function public.nigraan_finish_judge_email(job_id uuid,lease_id uuid,sent_id text,error_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.nigraan_judge_email_outbox set state=case when sent_id is not null then 'sent' else 'failed' end,
    provider_id=sent_id,failure_code=case when sent_id is not null then null else
      case when error_code in ('configuration','provider_failure','timeout','delivery_unknown') then error_code else 'provider_failure' end end,
    lease_until=null
    where id=job_id and lease=lease_id and state='sending';
end;
$$;
create or replace function public.nigraan_retry_judge_email(job_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.nigraan_judge_email_outbox;
begin
  if not public.nigraan_is_judge_admin() then raise exception using errcode='PT403',message='Administrator access required'; end if;
  select * into r from public.nigraan_judge_email_outbox where id=job_id for update;
  if not found or r.state='sent' or r.attempts>=5 or r.created_at<clock_timestamp()-interval '23 hours'
    or r.state='sending' or r.failure_code in ('delivery_unknown','timeout') then
    raise exception using errcode='PT409',message='Email cannot be retried safely'; end if;
  update public.nigraan_judge_email_outbox set state='pending',lease=null,lease_until=null where id=r.id;
  insert into public.nigraan_judge_audit(request_id,actor_id,action) values(r.request_id,auth.uid(),'email_retry');
end;
$$;

commit;
