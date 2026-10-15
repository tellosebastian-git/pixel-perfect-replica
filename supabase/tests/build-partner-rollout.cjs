// Prepare an explicitly authorized, targeted transaction. Never uses db push.
const fs = require('node:fs');
const names = ['20261014130000_partner_program', '20261014130100_partner_auth', '20261014130200_partner_checkout_storage'];
let sql = `BEGIN;
SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='90s';
DO $preflight$ BEGIN
  IF to_regclass('public.partners') IS NOT NULL OR EXISTS(
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN ('20261014130000','20261014130100','20261014130200')
  ) THEN RAISE EXCEPTION 'PARTNER_ALREADY_APPLIED'; END IF;
END $preflight$;
`;
for (const name of names) {
  const source = fs.readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
  const version = name.slice(0, 14);
  const marker = `$source_${version}$`;
  if (source.includes(marker)) throw new Error('Unexpected SQL delimiter');
  sql += `${source}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES('${version}','${name.slice(15)}',ARRAY[${marker}${source}${marker}]);\n`;
}
sql += `COMMIT;
SELECT version,name FROM supabase_migrations.schema_migrations
  WHERE version IN ('20261014130000','20261014130100','20261014130200') ORDER BY version;`;
fs.writeFileSync('.impeccable/partner-apply.sql.local', sql);
console.log('Prepared three targeted migrations in one transaction');
