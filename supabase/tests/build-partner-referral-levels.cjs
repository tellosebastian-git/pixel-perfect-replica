const fs=require('node:fs');
const source=fs.readFileSync('supabase/migrations/20261014130300_partner_auth_lock.sql','utf8');
let command=source.match(/CREATE OR REPLACE FUNCTION public\.partner_program_command\([\s\S]*?END \$function\$;/)[0];
command=command.replaceAll('2026-10-14-v1','2026-10-14-v2');
command=command.replace("  IF _action='readiness'", "  IF _action LIKE 'instagram_%' AND _action<>'instagram_disconnect' THEN RAISE EXCEPTION 'INSTAGRAM_RETIRED'; END IF;\n  IF _action='readiness'");
const igJobs=/    INSERT INTO partner_jobs\(kind,input,dedupe_key\)\r?\n      SELECT 'instagram',[\s\S]*?WHERE partner_jobs.status='completed' AND partner_jobs.due_at<=now\(\);\r?\n/;
if(!igJobs.test(command)) throw new Error('Job source drift');
command=command.replace(igJobs,'');
command=command.replace("WHERE status='pending' AND due_at<=now()", "WHERE status='pending' AND kind<>'instagram' AND due_at<=now()");
command=command.replace('_rate, _partner.terms_version','_rate, (SELECT terms_version FROM partner_program_config)');
// Quote version records the current program rules; historical bound quotes stay immutable.
command=command.replace('partner_rate(_ref.partner_id),_partner.terms_version', 'partner_rate(_ref.partner_id),(SELECT terms_version FROM partner_program_config)');
const auth=fs.readFileSync('supabase/migrations/20261014130100_partner_auth.sql','utf8');
const referral=auth.match(/CREATE FUNCTION public\.partner_register_referral\([\s\S]*?END \$function\$;/)[0]
  .replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace("'2026-10-14-v1'","(SELECT terms_version FROM partner_program_config)");
const sql=`-- User requested referral-only levels, unified eligibility and terms v2.
-- All changes INVOKER; no Auth DEFINER or historical commission/quote mutation.
DO $guard$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='partner_program_command' AND NOT p.prosecdef
      AND md5(p.prosrc)='63e20adf147c7092fe7c4a40df12072b') THEN RAISE EXCEPTION 'PARTNER_COMMAND_DRIFT'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.partner_tier_input(_partner_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $function$
  SELECT jsonb_build_object('qualifiedOrganizations',(SELECT count(*) FROM partner_referrals WHERE partner_id=_partner_id AND qualified),
    'agreement',(SELECT jsonb_build_object('percent',percent,'startsAt',starts_at,'endsAt',ends_at,'suspended',suspended)
      FROM partner_agreements WHERE partner_id=_partner_id AND NOT suspended AND starts_at<=now() AND ends_at>now()
      ORDER BY starts_at DESC LIMIT 1));
$function$;
CREATE OR REPLACE FUNCTION public.partner_rate(_partner_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $function$
  SELECT coalesce((SELECT percent FROM partner_agreements WHERE partner_id=_partner_id AND NOT suspended
    AND starts_at<=now() AND ends_at>now() ORDER BY starts_at DESC LIMIT 1),
    CASE WHEN (SELECT count(*) FROM partner_referrals WHERE partner_id=_partner_id AND qualified)>=20 THEN 30
         WHEN (SELECT count(*) FROM partner_referrals WHERE partner_id=_partner_id AND qualified)>=5 THEN 20 ELSE 10 END);
$function$;
${command}
${referral}
UPDATE partner_program_config SET terms_version='2026-10-14-v2' WHERE singleton;
UPDATE partner_jobs SET status='completed',lease=NULL,lease_until=NULL,completed_at=now(),error_code='INSTAGRAM_RETIRED'
  WHERE kind='instagram' AND status<>'completed';
REVOKE ALL ON FUNCTION public.partner_tier_input(uuid),public.partner_rate(uuid),public.partner_register_referral(uuid),public.partner_program_command(integer,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.partner_tier_input(uuid),public.partner_rate(uuid),public.partner_register_referral(uuid),public.partner_program_command(integer,text,uuid,jsonb) TO service_role;
`;
fs.writeFileSync('supabase/migrations/20261014230000_partner_referral_levels.sql',sql);
console.log('Prepared referral-only levels and terms v2');
