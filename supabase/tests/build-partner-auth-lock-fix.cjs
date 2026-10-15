const fs = require('node:fs');
const source = fs.readFileSync('supabase/migrations/20261014130000_partner_program.sql', 'utf8');
const original = source.match(/CREATE FUNCTION public\.partner_program_command\([\s\S]*?END \$function\$;/)[0];
const fixed = original.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
  .replace('PERFORM 1 FROM auth.users WHERE id=_actor_id FOR UPDATE;',
    "PERFORM pg_advisory_xact_lock(hashtextextended('partner-enroll:'||_actor_id::text,0));");
if (fixed === original || !fixed.includes('partner-enroll:')) throw new Error('Fix drift');
fs.writeFileSync('supabase/migrations/20261014130300_partner_auth_lock.sql',
  '-- Real Supabase service_role has SELECT on auth.users, not UPDATE.\n' +
  '-- Serialize enrollment by identity without granting write access to Auth.\n' + fixed + '\n');
const marker = '$lock_fix$';
fs.writeFileSync('.impeccable/partner-lock-fix.sql.local', `BEGIN; SET LOCAL lock_timeout='10s';\n${fixed}\n
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
  VALUES('20261014130300','partner_auth_lock',ARRAY[${marker}${fixed}${marker}]);
COMMIT; SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='20261014130300';`);
console.log('Prepared invoker Auth permission correction');
