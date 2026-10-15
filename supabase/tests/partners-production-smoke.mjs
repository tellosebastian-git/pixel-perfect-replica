// Read-only endpoint probes. No registration/email, checkout or financial write.
import assert from 'node:assert/strict';
const base='https://azqpyfoobpovqosbayvz.supabase.co/functions/v1';
const origin='https://www.vittro.com.ar';
const activated=process.argv.includes('--enabled');
async function probe(name, path, options, expected) {
  const response=await fetch(`${base}/${path}`,options);
  assert.equal(response.status,expected,name);
  console.log(`${name}: ${response.status}`);
  return response;
}
const post=(action,input={},extra={})=>({method:'POST',headers:{'content-type':'application/json',origin,...extra},body:JSON.stringify({action,input})});
const status=await (await probe('public status','partner-program',post('status'),200)).json();
assert.equal(status.enabled,activated); assert.equal(status.instagramEnabled,false);
await probe('own panel without session','partner-program',post('summary'),401);
await probe('admin spoof rejected','partner-program',post('admin_summary',{actorId:crypto.randomUUID(),platform_role:'platform_admin'}),401);
await probe('untrusted origin','partner-program',post('status',{}, {origin:'https://untrusted.invalid'}),403);
await probe('worker missing credential','partner-program-worker',{method:'POST',body:'{}'},401);
await probe('worker incorrect credential','partner-program-worker',{method:'POST',headers:{authorization:'Bearer invalid'},body:'{}'},401);
await probe('checkout missing JWT','subscription-create-checkout',post('checkout'),401);
await probe('invalid referral','partner-program',post('validate_code',{code:'QAUNREGISTERED999'}),activated?409:503);
const cors=await probe('CORS','partner-program',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST'}},200);
assert.equal(cors.headers.get('access-control-allow-origin'),origin);
console.log(JSON.stringify({enabled:status.enabled,instagramEnabled:status.instagramEnabled,checks:9}));
