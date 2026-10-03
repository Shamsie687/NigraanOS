-- OPTIONAL project-owner setup. Not a schema/data/RLS migration.
-- Run only if public.incidents is not enabled in the existing Realtime publication.
-- Publish incidents only: evidence and Storage objects do not need publication.
begin;
do $$
begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    raise exception 'Supabase Realtime publication is missing. Configure Realtime for this project first';
  end if;
  if not exists(select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='incidents') then
    alter publication supabase_realtime add table public.incidents;
  end if;
end;
$$;
commit;
select pubname,schemaname,tablename from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public' and tablename='incidents';
