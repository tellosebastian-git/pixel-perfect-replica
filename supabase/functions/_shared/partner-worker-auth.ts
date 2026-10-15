/** Cron sends an expiring HMAC; its queue never contains the permanent secret. */
export async function authorizePartnerWorker(req: Request, secret: string | undefined, now = Date.now()): Promise<boolean> {
  if (!secret || secret.length < 32) return false;
  const encoder = new TextEncoder();
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (bearer) {
    const a = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(secret)));
    const b = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(bearer)));
    let different = 0;
    for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
    return different === 0;
  }
  const time = req.headers.get('x-partner-job-time') ?? '';
  const nonce = req.headers.get('x-partner-job-nonce') ?? '';
  const signature = req.headers.get('x-partner-job-signature') ?? '';
  if (!/^\d{10}$/.test(time) || !/^[0-9a-f-]{36}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)
    || Math.abs(now - Number(time) * 1000) > 120_000) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(signature.match(/../g)!, part => parseInt(part, 16));
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`partner-worker:${time}:${nonce}`));
}
