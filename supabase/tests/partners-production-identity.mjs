// Authorized production smoke with a disposable external identity. No emails or charges.
// Requires a Supabase CLI Management token in the environment; never emits credentials.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
const ref='azqpyfoobpovqosbayvz';
const management=`https://api.supabase.com/v1/projects/${ref}`;
const backend=`https://${ref}.supabase.co`;
const token=process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('Missing Management credential');
async function request(url, options, label, expected=200) {
  const response=await fetch(url,options);
  if (response.status!==expected) throw new Error(`${label}: HTTP ${response.status}`);
  return response.json();
}
const mgmt={authorization:`Bearer ${token}`,'content-type':'application/json'};
const keys=await request(`${management}/api-keys`,{headers:mgmt},'keys');
const service=keys.find(key=>key.name==='service_role').api_key;
const anon=keys.find(key=>key.name==='anon').api_key;
const serviceHeaders={authorization:`Bearer ${service}`,apikey:service,'content-type':'application/json'};
async function cleanup(id) {
  assert.match(id,/^[0-9a-f-]{36}$/);
  const fixture=await request(`${backend}/auth/v1/admin/users/${id}`,{headers:serviceHeaders},'verify fixture identity');
  assert.equal(fixture.user_metadata.full_name,'QA Ephemeral Partner');
  assert.equal(fixture.app_metadata.account_kind,'partner');
  assert.match(fixture.email,/^qa-partner-[0-9a-f-]{36}@synthetic\.invalid$/);
  await request(`${management}/database/query`,{method:'POST',headers:mgmt,body:JSON.stringify({query:
    `DELETE FROM public.partners WHERE user_id='${id}'::uuid AND name='QA Ephemeral Partner' AND left(code,2)='QA';`})},'remove partner fixture',201);
  await request(`${backend}/auth/v1/admin/users/${id}`,{method:'DELETE',headers:serviceHeaders},'remove Auth fixture');
  await request(`${backend}/auth/v1/admin/users/${id}`,{headers:serviceHeaders},'verify fixture removal',404);
  console.log(JSON.stringify({fixtureRemoved:true}));
}
if(process.argv[2]==='--cleanup') { await cleanup(process.argv[3]); process.exit(0); }
const password=randomBytes(32).toString('hex');
const email=`qa-partner-${randomUUID()}@synthetic.invalid`;
const code=`QA${randomBytes(8).toString('hex').toUpperCase()}`;
let userId;
let nonce;
try {
  nonce=await request(`${backend}/rest/v1/rpc/partner_begin_identity`,{method:'POST',headers:serviceHeaders,body:JSON.stringify({_email:email})},'reserve identity');
  const user=await request(`${backend}/auth/v1/admin/users`,{method:'POST',headers:serviceHeaders,
    body:JSON.stringify({email,password,email_confirm:true,app_metadata:{account_kind:'partner'},
      user_metadata:{full_name:'QA Ephemeral Partner',country:'AR',partner_signup_nonce:nonce}})},'create external fixture');
  userId=user.id;
  assert.match(userId,/^[0-9a-f-]{36}$/);
  const login=await request(`${backend}/auth/v1/token?grant_type=password`,{method:'POST',
    headers:{apikey:anon,'content-type':'application/json'},body:JSON.stringify({email,password})},'native login');
  assert.equal(login.user.app_metadata.account_kind,'partner');
  const sessionHeaders={apikey:anon,authorization:`Bearer ${login.access_token}`,'content-type':'application/json',origin:'https://www.vittro.com.ar'};
  const command=(action,input={})=>request(`${backend}/functions/v1/partner-program`,{method:'POST',headers:sessionHeaders,
    body:JSON.stringify({action,input})},action);
  const enrolled=await command('enroll',{code,country:'AR',termsVersion:'2026-10-14-v2',accepted:true});
  assert.equal(enrolled.code,code);
  const retry=await command('enroll',{code,country:'AR',termsVersion:'2026-10-14-v2',accepted:true});
  assert.equal(retry.id,enrolled.id);
  const summary=await command('summary');
  assert.equal(summary.summary.code,code); assert.equal(summary.summary.registrations,0);
  assert.equal(summary.summary.tier.percent,10);
  assert.equal(summary.summary.payout.configured,false);
  const publicCode=await request(`${backend}/functions/v1/partner-program`,{method:'POST',headers:{apikey:anon,'content-type':'application/json',origin:'https://www.vittro.com.ar'},
    body:JSON.stringify({action:'validate_code',input:{code:code.toLowerCase()}})},'public code');
  assert.equal(publicCode.code,code); assert.equal(publicCode.discountPercent,10);
  const forbidden=await fetch(`${backend}/functions/v1/partner-program`,{method:'POST',headers:sessionHeaders,body:JSON.stringify({action:'admin_summary',input:{}})});
  assert.equal(forbidden.status,403);
  const raw=await fetch(`${backend}/rest/v1/partner_payout_accounts?select=*`,{headers:sessionHeaders});
  assert.equal(raw.status,403);
  const profile=await request(`${backend}/rest/v1/profiles?id=eq.${userId}&select=organization_id,default_sucursal_id`,{headers:serviceHeaders},'fixture profile');
  assert.equal(profile.length,1); assert.equal(profile[0].organization_id,null); assert.equal(profile[0].default_sucursal_id,null);
  console.log(JSON.stringify({externalWithoutTenant:true,nativeLogin:true,enrollment:true,idempotentIdentity:true,
    initialRate:10,caseInsensitiveCode:true,tenantAdminDenied:true,rawBankDenied:true}));
} finally {
  if (userId) {
    await cleanup(userId);
  }
  if(nonce) {
    const response=await fetch(`${backend}/rest/v1/rpc/partner_cancel_identity`,{method:'POST',headers:serviceHeaders,body:JSON.stringify({_nonce:nonce})});
    assert([200,204].includes(response.status));
  }
}
