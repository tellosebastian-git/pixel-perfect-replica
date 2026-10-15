const fs=require('node:fs');
const source=fs.readFileSync('supabase/migrations/20261014230000_partner_referral_levels.sql','utf8');
fs.writeFileSync('.impeccable/partner-referral-apply.sql.local',`BEGIN;
SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='60s';
${source}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
  VALUES('20261014230000','partner_referral_levels',ARRAY[$referral_source$${source}$referral_source$]);
COMMIT;
SELECT terms_version,enrollment_enabled,billing_ready FROM partner_program_config;`);
console.log('Prepared one targeted referral-level migration');
