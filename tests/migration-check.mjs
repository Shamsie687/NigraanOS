// Optional isolated PostgreSQL regression check; no remote credentials required.
// npm install --prefix review/sql-check --no-save --package-lock=false @electric-sql/pglite
// node tests/migration-check.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../review/sql-check/node_modules/@electric-sql/pglite/dist/index.js';

const migration=await readFile(new URL('../supabase/migrations/003_fix_incident_categories.sql',import.meta.url),'utf8');
const db=new PGlite();
try {
  await db.exec(`create table public.incidents (
    id integer generated always as identity primary key,
    category text not null, status text not null default 'submitted',
    priority text not null default 'medium', latitude double precision,
    submission_state text not null default 'submitted',
    constraint incidents_category_check check(category in ('traffic','roads','other')),
    constraint incidents_status_check check(status in ('submitted','resolved')),
    constraint custom_legacy_priority_check check(priority in ('low','medium','high')),
    constraint latitude_bounds check(latitude between -90 and 90),
    constraint legacy_publication_check check(submission_state in ('submitted'))
  );
  insert into public.incidents(category,status,priority,latitude)
    values('roads','submitted','medium',24.8);
  alter table public.incidents add constraint nigraan_workflow_check
    check(status in ('reported','acknowledged','assigned','in_progress','resolved')) not valid;
  alter table public.incidents add constraint nigraan_priority_check
    check(priority in ('low','normal','medium','high','critical')) not valid;
  alter table public.incidents add constraint nigraan_submission_state_check
    check(submission_state in ('draft','submitted')) not valid;`);
  const before=(await db.query('select * from public.incidents')).rows;
  const results=await db.exec(migration);
  assert.deepEqual((await db.query('select * from public.incidents')).rows,before);
  assert.deepEqual(results.at(-1).rows,[{legacy_category_rows:1,legacy_status_rows:1,legacy_priority_rows:0}]);
  const categories=['traffic','flood','garbage','air_quality','water','power','road_damage','other'];
  const statuses=['reported','acknowledged','assigned','in_progress','resolved'];
  const priorities=['low','normal','medium','high','critical'];
  for(const category of categories)for(const status of statuses)for(const priority of priorities){
    await db.query('insert into public.incidents(category,status,priority) values($1,$2,$3)',[category,status,priority]);
  }
  for(const category of ['roads','electricity','air quality','Traffic','',null]){
    await assert.rejects(()=>db.query('insert into public.incidents(category) values($1)',[category]));
  }
  await assert.rejects(()=>db.exec("insert into public.incidents(category,status) values('water','submitted')"));
  await assert.rejects(()=>db.exec("insert into public.incidents(category,priority) values('water','urgent')"));
  await assert.rejects(()=>db.exec("insert into public.incidents(category,latitude) values('water',91)"));
  await db.exec("insert into public.incidents(category,submission_state) values('water','draft')");
  await assert.rejects(()=>db.exec("insert into public.incidents(category,submission_state) values('water','published')"));
  await assert.rejects(()=>db.exec('update public.incidents set latitude=25 where id=1'));
  const constraints=(await db.query("select conname from pg_constraint where conrelid='public.incidents'::regclass")).rows.map(row=>row.conname);
  for(const name of ['latitude_bounds','nigraan_workflow_check','nigraan_priority_check','nigraan_submission_state_check'])assert.ok(constraints.includes(name));
  for(const name of ['incidents_category_check','incidents_status_check','custom_legacy_priority_check','legacy_publication_check'])assert.ok(!constraints.includes(name));
  await db.exec(migration); // Safe to retry; legacy rows still remain untouched.
  assert.deepEqual((await db.query('select * from public.incidents where id=1')).rows,before);

  await db.exec("alter table public.incidents add constraint custom_cross_column check(category <> 'water' or priority <> 'low') not valid");
  await assert.rejects(()=>db.exec(migration),/Review multi-column CHECK/);
  await db.exec('rollback');
  assert.equal((await db.query("select count(*)::integer as count from pg_constraint where conname='custom_cross_column'")).rows[0].count,1);
  console.log('Migration passed: 200 canonical combinations, legacy row preservation, rejection of invalid values, unrelated constraints, retry, and atomic custom-rule safeguard.');
} finally {
  await db.close();
}
