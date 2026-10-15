import { handlePartnerRequest } from '../_shared/partner-program-handler.ts';

Deno.env.set('SUPABASE_URL', 'https://synthetic.invalid');
Deno.env.set('SUPABASE_ANON_KEY', 'synthetic-key');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
Deno.env.set('APP_ORIGIN', 'http://localhost:8080');
Deno.env.delete('PARTNER_PROGRAM_ENABLED');
Deno.env.delete('PARTNER_BILLING_ENABLED');
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/partner-program', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test('disabled status is safe with no DB schema or external network', async () => {
  const response = await handlePartnerRequest(request({ action: 'status' }));
  const status = await response.json();
  assert(
    response.status === 200 && status.enabled === false && status.instagramEnabled === false,
    'Disabled feature exposed',
  );
});
Deno.test('public registration and code validation cannot bypass the kill switch', async () => {
  for (const action of ['register', 'resend', 'validate_code']) {
    const response = await handlePartnerRequest(
      request({ action, input: { country: 'AR', accepted: true } }),
    );
    assert(
      response.status === 503 && (await response.json()).code === 'PROGRAM_UNAVAILABLE',
      'Public action bypassed switch',
    );
  }
});
Deno.test('an actor id or platform role in body grants no authenticated access', async () => {
  for (const action of [
    'summary',
    'enroll',
    'save_payout',
    'instagram_connect',
    'instagram_disconnect',
  ]) {
    const response = await handlePartnerRequest(
      request({ action, input: { actorId: 'someone-else', platform_role: 'platform_admin' } }),
    );
    assert(response.status === 401, `Unauthorized ${action} reached storage`);
  }
});
Deno.test(
  'administrative operations require admin authentication before reading password or financial input',
  async () => {
    for (const action of [
      'admin_summary',
      'admin_mark_paid',
      'admin_agreement',
      'admin_payout_details',
      'admin_operation_status',
    ]) {
      const response = await handlePartnerRequest(
        request({ action, input: { password: 'synthetic', confirmed: true } }),
      );
      assert(response.status === 401, `Unauthorized ${action} was accepted`);
      assert(
        !JSON.stringify(await response.json()).includes('synthetic'),
        'Sensitive input leaked',
      );
    }
  },
);
Deno.test('untrusted origin cannot operate public actions', async () => {
  const response = await handlePartnerRequest(
    request({ action: 'status' }, { origin: 'https://untrusted.invalid' }),
  );
  assert(response.status === 403, 'Untrusted origin accepted');
});
Deno.test('malformed and oversized payloads are rejected', async () => {
  const malformed = await handlePartnerRequest(
    new Request('http://localhost/test', { method: 'POST', body: '{' }),
  );
  assert(malformed.status === 400, 'Malformed request accepted');
  const large = await handlePartnerRequest(
    request({ action: 'status', input: { value: 'a'.repeat(20_000) } }),
  );
  assert(large.status === 413, 'Oversized request accepted');
});
