const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const file = '.impeccable/partner-runtime-secrets.json.local';
const mode = process.argv[2];
if (!fs.existsSync(file)) {
  if (mode !== 'configure') throw new Error('Missing rollout secrets');
  fs.writeFileSync(file, JSON.stringify({ job: randomBytes(32).toString('hex'), rate: randomBytes(32).toString('hex'),
    token: randomBytes(32).toString('base64') }), { mode: 0o600 });
}
const secrets = JSON.parse(fs.readFileSync(file, 'utf8'));
if (mode === 'configure' || mode === 'enable') {
  const enabled = mode === 'enable';
  const envfile = '.impeccable/partner-secrets.env.local';
  fs.writeFileSync(envfile, Object.entries({ APP_ORIGIN: 'https://www.vittro.com.ar', PARTNER_JOB_SECRET: secrets.job,
    PARTNER_RATE_LIMIT_SECRET: secrets.rate, PARTNER_TOKEN_ENCRYPTION_KEY: secrets.token,
    PARTNER_PROGRAM_ENABLED: String(enabled), PARTNER_BILLING_ENABLED: String(enabled),
    PARTNER_INSTAGRAM_ENABLED: 'false', PARTNER_INSTAGRAM_VERIFIED: 'false' }).map(([key,val]) => `${key}=${val}`).join('\n'));
  const result = spawnSync('cmd.exe', ['/d','/c','npx supabase secrets set --env-file .impeccable/partner-secrets.env.local --project-ref azqpyfoobpovqosbayvz'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Secret configuration failed; captured output withheld');
  console.log(JSON.stringify({ configured: true, programEnabled: enabled, billingEnabled: enabled, instagramEnabled: false }));
} else if (mode === 'cron') {
  const sql = `BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
DO $vault$ BEGIN
  IF EXISTS(SELECT 1 FROM vault.secrets WHERE name='partner_worker_secret') THEN
    PERFORM vault.update_secret((SELECT id FROM vault.secrets WHERE name='partner_worker_secret'), '${secrets.job}');
  ELSE PERFORM vault.create_secret('${secrets.job}','partner_worker_secret','Partner worker HMAC signing key'); END IF;
END $vault$;
SELECT cron.schedule('partner-program-worker','* * * * *',$cron$
  WITH invocation AS (SELECT floor(extract(epoch FROM now()))::bigint::text AS stamp, gen_random_uuid()::text AS nonce),
    credential AS (SELECT decrypted_secret AS secret FROM vault.decrypted_secrets WHERE name='partner_worker_secret')
  SELECT net.http_post(url:='https://azqpyfoobpovqosbayvz.supabase.co/functions/v1/partner-program-worker',
    headers:=jsonb_build_object('Content-Type','application/json','x-partner-job-time',stamp,'x-partner-job-nonce',nonce,
      'x-partner-job-signature',encode(extensions.hmac('partner-worker:'||stamp||':'||nonce,secret,'sha256'),'hex')),
    body:='{}'::jsonb, timeout_milliseconds:=60000)
  FROM invocation CROSS JOIN credential;
$cron$);
COMMIT; SELECT jobname,schedule,active FROM cron.job WHERE jobname='partner-program-worker';`;
  fs.writeFileSync('.impeccable/partner-cron.sql.local', sql);
  const result = spawnSync('cmd.exe', ['/d','/c','npx supabase db query --linked --file .impeccable/partner-cron.sql.local --output json'], { encoding:'utf8', windowsHide:true });
  if (result.status !== 0) throw new Error('Cron setup failed; captured output withheld');
  const parsed = JSON.parse(result.stdout);
  console.log(JSON.stringify(parsed.rows));
} else if (mode === 'worker') {
  fetch('https://azqpyfoobpovqosbayvz.supabase.co/functions/v1/partner-program-worker', {
    method:'POST', headers:{Authorization:`Bearer ${secrets.job}`, 'Content-Type':'application/json'}, body:'{}'
  }).then(async response => console.log(JSON.stringify({ status:response.status, result: await response.json() })));
} else throw new Error('Unsupported phase');
