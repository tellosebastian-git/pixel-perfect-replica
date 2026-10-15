import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PartnerError, partnerStore } from './partner-store.ts';

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
export async function hashPartnerSecret(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return b64(new Uint8Array(bytes));
}
async function encryptionKey() {
  const raw = unb64(Deno.env.get('PARTNER_TOKEN_ENCRYPTION_KEY') ?? '');
  if (raw.length !== 32) throw new PartnerError('INSTAGRAM_CONFIGURATION', 503);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(),
    new TextEncoder().encode(token),
  );
  return `v1.${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}
async function unseal(value: string) {
  const [version, iv, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !ciphertext) throw new PartnerError('INVALID_TOKEN');
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv) },
    await encryptionKey(),
    unb64(ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}
export function instagramEnabled() {
  // Retired by the program owner: changing an environment switch cannot
  // restore follower-based levels or connect a new account.
  return false;
}
function callbackUrl() {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) throw new PartnerError('INSTAGRAM_CONFIGURATION', 503);
  return `${url}/functions/v1/partner-instagram-callback`;
}
export async function instagramConnect(client: SupabaseClient, actorId: string) {
  if (!instagramEnabled()) throw new PartnerError('INSTAGRAM_UNAVAILABLE', 503);
  const state = b64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  await partnerStore(client, 'instagram_state', actorId, { hash: await hashPartnerSecret(state) });
  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: Deno.env.get('INSTAGRAM_APP_ID')!,
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: 'instagram_business_basic',
    state,
  }).toString();
  return { url: url.toString() };
}
async function readProfile(token: string, expectedAccountId: string) {
  const url = new URL(`https://graph.instagram.com/${Deno.env.get('INSTAGRAM_API_VERSION')}/me`);
  url.searchParams.set('fields', 'user_id,username,followers_count');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new PartnerError('INSTAGRAM_VERIFICATION_FAILED', 503);
  const profile = await response.json();
  if (
    String(profile.user_id ?? profile.id) !== expectedAccountId ||
    !Number.isSafeInteger(profile.followers_count) ||
    profile.followers_count < 0 ||
    typeof profile.username !== 'string' ||
    !profile.username
  )
    throw new PartnerError('INSTAGRAM_METRIC_UNAVAILABLE', 503);
  return {
    accountId: expectedAccountId,
    username: profile.username,
    followers: profile.followers_count,
  };
}
export async function instagramCallback(client: SupabaseClient, state: string, code: string) {
  if (!instagramEnabled() || !/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 4096)
    throw new PartnerError('INVALID_OAUTH_STATE');
  // Atomic consumption binds the nonce to one enrolled actor, expires in 10 minutes and prevents replay.
  const { actorId } = await partnerStore<{ actorId: string }>(
    client,
    'instagram_consume_state',
    null,
    { hash: await hashPartnerSecret(state) },
  );
  const response = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: Deno.env.get('INSTAGRAM_APP_ID')!,
      client_secret: Deno.env.get('INSTAGRAM_APP_SECRET')!,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl(),
      code,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new PartnerError('INSTAGRAM_VERIFICATION_FAILED', 503);
  const short = await response.json();
  if (!short.access_token || !short.user_id)
    throw new PartnerError('INSTAGRAM_VERIFICATION_FAILED', 503);
  const exchange = new URL('https://graph.instagram.com/access_token');
  exchange.search = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: Deno.env.get('INSTAGRAM_APP_SECRET')!,
    access_token: short.access_token,
  }).toString();
  const longResponse = await fetch(exchange, { signal: AbortSignal.timeout(15_000) });
  if (!longResponse.ok) throw new PartnerError('INSTAGRAM_VERIFICATION_FAILED', 503);
  const long = await longResponse.json();
  if (
    typeof long.access_token !== 'string' ||
    !Number.isFinite(long.expires_in) ||
    long.expires_in <= 0
  )
    throw new PartnerError('INVALID_TOKEN');
  const profile = await readProfile(long.access_token, String(short.user_id));
  await partnerStore(client, 'instagram_verified', actorId, {
    ...profile,
    encryptedToken: await seal(long.access_token),
    expiresAt: new Date(Date.now() + long.expires_in * 1000).toISOString(),
  });
}
export async function refreshPartnerInstagram(
  client: SupabaseClient,
  jobId: string,
  lease: string,
) {
  if (!instagramEnabled()) throw new PartnerError('INSTAGRAM_UNAVAILABLE', 503);
  const credential = await partnerStore<{ accountId: string; encryptedToken: string }>(
    client,
    'instagram_job_credential',
    null,
    { jobId, lease },
  );
  const refreshUrl = new URL('https://graph.instagram.com/refresh_access_token');
  refreshUrl.search = new URLSearchParams({
    grant_type: 'ig_refresh_token',
    access_token: await unseal(credential.encryptedToken),
  }).toString();
  const response = await fetch(refreshUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new PartnerError('INSTAGRAM_VERIFICATION_FAILED', 503);
  const refreshed = await response.json();
  if (
    typeof refreshed.access_token !== 'string' ||
    !Number.isFinite(refreshed.expires_in) ||
    refreshed.expires_in <= 0
  )
    throw new PartnerError('INVALID_TOKEN');
  const profile = await readProfile(refreshed.access_token, credential.accountId);
  await partnerStore(client, 'instagram_job_verified', null, {
    jobId,
    lease,
    ...profile,
    encryptedToken: await seal(refreshed.access_token),
    expiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
  });
}
