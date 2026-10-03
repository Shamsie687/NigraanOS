-- PROJECT OWNER ONLY, in Supabase SQL Editor. Never execute from the browser.
-- First apply 005 and submit the application from your existing Citizen account.
-- Replace BOTH email literals below with that account's email, privately here.
-- No account_type or Auth identity changes; only a pending application is approved.
begin;
do $$
declare target_id uuid; application_status text;
begin
  select id into strict target_id from auth.users
    where lower(email)=lower('YOUR_EXISTING_ACCOUNT_EMAIL');
  select verification_status into application_status from public.operations_profiles
    where user_id=target_id for update;
  if application_status is distinct from 'pending' then
    raise exception 'A pending application is required; current status: %',coalesce(application_status,'none');
  end if;
  update public.operations_profiles set verification_status='approved' where user_id=target_id;
end;
$$;
commit;
select u.id,u.email,o.organization_name,o.verification_status
from auth.users u join public.operations_profiles o on o.user_id=u.id
where lower(u.email)=lower('YOUR_EXISTING_ACCOUNT_EMAIL');
