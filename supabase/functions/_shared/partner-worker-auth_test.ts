import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { authorizePartnerWorker } from './partner-worker-auth.ts';
const secret = 'synthetic-test-secret-with-more-than-32-characters';
const stamp = 1791986400000;
async function signed(time = String(stamp / 1000), nonce = 'd65b35bc-1c64-4211-9a0a-41d39c13a2b0') {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`partner-worker:${time}:${nonce}`)));
  return new Request('https://fixture.invalid', { headers: { 'x-partner-job-time': time, 'x-partner-job-nonce': nonce,
    'x-partner-job-signature': Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') } });
}
Deno.test('worker accepts only a matching, recent HMAC', async () => {
  const req = await signed();
  assertEquals(await authorizePartnerWorker(req, secret, stamp), true);
  assertEquals(await authorizePartnerWorker(req, secret + 'wrong', stamp), false);
  assertEquals(await authorizePartnerWorker(req, secret, stamp + 120001), false);
  assertEquals(await authorizePartnerWorker(await signed(String(stamp / 1000 + 121)), secret, stamp), false);
  assertEquals(await authorizePartnerWorker(req, undefined, stamp), false);
});
Deno.test('worker rejects nonce tampering, anonymous and incorrect bearer requests', async () => {
  const original = await signed();
  const headers = new Headers(original.headers);
  headers.set('x-partner-job-nonce', 'd65b35bc-1c64-4211-9a0a-41d39c13a2b1');
  assertEquals(await authorizePartnerWorker(new Request(original.url, { headers }), secret, stamp), false);
  assertEquals(await authorizePartnerWorker(new Request(original.url), secret, stamp), false);
  assertEquals(await authorizePartnerWorker(new Request(original.url, { headers: { authorization: 'Bearer incorrect' } }), secret), false);
  assertEquals(await authorizePartnerWorker(new Request(original.url, { headers: { authorization: `Bearer ${secret}` } }), secret), true);
});
