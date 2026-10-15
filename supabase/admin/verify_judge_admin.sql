-- READ-ONLY PRIVATE TEMPLATE. Original project pmzbdrxedlthdqdpgigs only.
-- Put the verified Auth UUID into a PRIVATE copy, never this repository file.
-- Run before bootstrap and again afterward. Only counts/statuses returned.
with selected as (
  select 'PRIVATELY_VERIFIED_ADMIN_AUTH_UUID'::uuid as user_id
), counts as (
  select
    (select count(*) from auth.users u join selected s on s.user_id=u.id
      where u.email_confirmed_at is not null) as verified_auth_accounts,
    (select count(*) from public.profiles p join selected s on s.user_id=p.id) as matching_profiles,
    (select count(*) from public.operations_profiles o join selected s on s.user_id=o.user_id
      where o.verification_status='approved') as permanent_approved_accounts,
    (select count(*) from public.nigraan_judge_admins) as configured_administrators,
    (select count(*) from public.nigraan_judge_admins a join selected s on s.user_id=a.user_id) as selected_administrators
)
select case
  when verified_auth_accounts<>1 or matching_profiles<>1 or permanent_approved_accounts<>1 then 'BLOCKED'
  when configured_administrators=0 then 'READY_FOR_BOOTSTRAP'
  when configured_administrators=1 and selected_administrators=1 then 'PASS'
  else 'BLOCKED'
end as verdict, verified_auth_accounts, matching_profiles, permanent_approved_accounts,
configured_administrators, selected_administrators,
(verified_auth_accounts=1 and matching_profiles=1 and permanent_approved_accounts=1
 and configured_administrators=1 and selected_administrators=1) as administrator_database_condition
from counts;
