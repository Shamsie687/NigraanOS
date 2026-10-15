-- PRIVATE BOOTSTRAP TEMPLATE: original project pmzbdrxedlthdqdpgigs only.
-- Later, after explicit migration/bootstrap approval, privately replace this UUID
-- from Authentication > Users. Never populate this repository file.
-- No email-based authorization and no change to permanent approval.
begin;
do $bootstrap$
#variable_conflict error
declare v_admin uuid:='PRIVATELY_VERIFIED_ADMIN_AUTH_UUID'::uuid;
begin
  if current_user<>'postgres' then raise exception 'Project-owner SQL Editor required'; end if;
  if not exists(select 1 from auth.users u join public.operations_profiles o on o.user_id=u.id
    where u.id=v_admin and u.email_confirmed_at is not null and o.verification_status='approved') then
    raise exception 'Verified Auth identity with existing permanent Operations approval required'; end if;
  if exists(select 1 from public.nigraan_judge_admins a where a.user_id<>v_admin) then
    raise exception 'Different administrator already configured; stop for review'; end if;
  insert into public.nigraan_judge_admins(user_id) values(v_admin) on conflict(user_id) do nothing;
end $bootstrap$;
commit;
select count(*) as configured_administrators from public.nigraan_judge_admins;
