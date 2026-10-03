-- Run once in the existing project's Supabase SQL Editor, after deployed 002.
-- No incident rows are updated or deleted. No earlier migration is rerun.
begin;
set local lock_timeout = '10s';
lock table public.incidents in access exclusive mode;

-- Inspect the installed database, including legacy CHECKs absent from this repo.
-- Replace only single-column CHECKs that reject an application value. Compatible
-- CHECKs and all unrelated constraints, grants, RLS policies and RPCs stay intact.
do $$
declare
  field record;
  installed record;
  candidate text;
  accepted boolean;
  conflicts boolean;
  column_number smallint;
begin
  for field in
    select * from (values
      ('category', array['traffic','flood','garbage','air_quality','water','power','road_damage','other']),
      ('status', array['reported','acknowledged','assigned','in_progress','resolved']),
      ('priority', array['low','normal','medium','high','critical']),
      ('submission_state', array['draft','submitted'])
    ) as domains(column_name, allowed_values)
  loop
    select attnum into strict column_number from pg_attribute
      where attrelid = 'public.incidents'::regclass
        and attname = field.column_name and not attisdropped;

    for installed in
      select conname, conkey, pg_get_constraintdef(oid) as definition,
        pg_get_expr(conbin, conrelid) as expression
      from pg_constraint
      where conrelid = 'public.incidents'::regclass and contype = 'c'
        and column_number = any(conkey)
    loop
      raise notice 'Inspecting %: %', installed.conname, installed.definition;
      -- Never silently remove a rule involving another column. Abort atomically
      -- and show its exact definition so an unexpected custom rule can be reviewed.
      if cardinality(installed.conkey) <> 1 then
        raise exception 'Review multi-column CHECK % before applying 003: %',
          installed.conname, installed.definition;
      end if;
      conflicts := false;
      foreach candidate in array field.allowed_values loop
        -- Evaluate the real expression against a typed synthetic record, without
        -- inserting test incidents or reading/changing any existing records.
        execute format(
          'select (%s) is not false from jsonb_populate_record(null::public.incidents, $1)',
          installed.expression
        ) into accepted using jsonb_build_object(field.column_name, candidate);
        if not accepted then
          conflicts := true;
          raise notice 'CHECK % rejects canonical %.% = %',
            installed.conname, 'incidents', field.column_name, candidate;
        end if;
      end loop;
      if conflicts then
        execute format('alter table public.incidents drop constraint %I', installed.conname);
      end if;
    end loop;
  end loop;
end;
$$;

-- NOT VALID preserves legacy rows even if their values are outside these domains.
-- PostgreSQL still enforces these checks on every subsequent INSERT or UPDATE.
-- A legacy row with noncanonical values must be normalized before it is updated.
alter table public.incidents drop constraint if exists nigraan_incidents_category_canonical_check;
alter table public.incidents add constraint nigraan_incidents_category_canonical_check
  check (category is not null and category in
    ('traffic','flood','garbage','air_quality','water','power','road_damage','other')) not valid;
alter table public.incidents drop constraint if exists nigraan_incidents_status_canonical_check;
alter table public.incidents add constraint nigraan_incidents_status_canonical_check
  check (status is not null and status in
    ('reported','acknowledged','assigned','in_progress','resolved')) not valid;
alter table public.incidents drop constraint if exists nigraan_incidents_priority_canonical_check;
alter table public.incidents add constraint nigraan_incidents_priority_canonical_check
  check (priority is not null and priority in
    ('low','normal','medium','high','critical')) not valid;

-- Match the server-owned initial values in nigraan_begin_incident (deployed 002).
alter table public.incidents alter column status set default 'reported';
alter table public.incidents alter column priority set default 'normal';
commit;

-- SQL Editor results show every remaining incident CHECK, including unrelated ones.
select conname, pg_get_constraintdef(oid) as definition, convalidated
from pg_constraint
where conrelid = 'public.incidents'::regclass and contype = 'c'
order by conname;

-- Read-only counts: legacy exceptions remain unchanged; no automatic remapping.
select
  count(*) filter (where category is null or category not in
    ('traffic','flood','garbage','air_quality','water','power','road_damage','other')) as legacy_category_rows,
  count(*) filter (where status is null or status not in
    ('reported','acknowledged','assigned','in_progress','resolved')) as legacy_status_rows,
  count(*) filter (where priority is null or priority not in
    ('low','normal','medium','high','critical')) as legacy_priority_rows
from public.incidents;
