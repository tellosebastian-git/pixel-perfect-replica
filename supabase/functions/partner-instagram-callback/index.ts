import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createAdminClient } from '../_shared/subscription-billing.ts';
import { instagramCallback } from '../_shared/partner-instagram.ts';

serve(async (req) => {
  if (req.method !== 'GET') return new Response(null, { status: 405 });
  const origin = Deno.env.get('APP_ORIGIN')?.replace(/\/$/, '');
  if (!origin || !/^https:\/\//.test(origin))
    return new Response('No disponible.', { status: 503 });
  const url = new URL(req.url);
  let result = 'failed';
  try {
    await instagramCallback(
      createAdminClient(),
      url.searchParams.get('state') ?? '',
      url.searchParams.get('code') ?? '',
    );
    result = 'connected';
  } catch {
    /* No OAuth code, token, nonce or provider payload is logged. */
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${origin}/aliados/panel?instagram=${result}`,
      'Cache-Control': 'no-store',
    },
  });
});
