-- Close unused legacy browser access; preserve all tables, rows and sequences.
begin;
set local lock_timeout = '10s';

DROP FUNCTION IF EXISTS public.get_map_incidents();

revoke all privileges on table public.reports from public, anon, authenticated;
-- Table revocation does not remove independently granted column privileges.
do $$
declare col record;
begin
  for col in select attname from pg_catalog.pg_attribute
    where attrelid = 'public.reports'::regclass and attnum > 0 and not attisdropped
  loop
    execute format('revoke all privileges (%I) on table public.reports from public, anon, authenticated', col.attname);
  end loop;
end;
$$;

drop policy if exists "Allow public inserts" on public.reports;
drop policy if exists "Allow public reads" on public.reports;
drop policy if exists "Backend can create reports" on public.reports;
drop policy if exists "Community can read reports" on public.reports;
drop policy if exists "Allow public inserts on reports" on public.reports;
drop policy if exists "Allow public select on reports" on public.reports;

-- Audited browser roles had SELECT/UPDATE/USAGE on this identity sequence.
revoke all privileges on sequence public.reports_id_seq from public, anon, authenticated;
commit;
