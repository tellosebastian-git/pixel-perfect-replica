import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createAdminClient } from './subscription-billing.ts';
import {
  jsonResponse,
  getPlatformAdminContext,
  isRecord,
  parsePageRequest,
} from './platform-admin.ts';
import {
  PARTNER_TERMS_VERSION,
  normalizePartnerCode,
  validatePayoutDetails,
  partnerTier,
  type PartnerSummary,
} from './partner-domain.ts';
import {
  partnerStore,
  PartnerError,
  partnerBillingEnabled,
  partnerProgramEnabled,
} from './partner-store.ts';
import {
  instagramConnect,
  instagramEnabled,
  hashPartnerSecret,
} from './partner-instagram.ts';

const messages: Record<string, string> = {
  PROGRAM_UNAVAILABLE: 'El programa todavía no está disponible. Volvé a intentar más adelante.',
  STORAGE_UNAVAILABLE: 'No pudimos completar la operación. Probá nuevamente en unos minutos.',
  CODE_TAKEN: 'Ese código ya está en uso. Elegí otro.',
  INVALID_CODE: 'Usá entre 4 y 20 letras o números para tu código.',
  INVALID_REFERRAL: 'El código no está disponible. Revisalo antes de registrarte.',
  SELF_REFERRAL: 'No podés usar tu propio código.',
  NOT_OWNER: 'Solo el dueño de una barbería puede adherir su cuenta.',
  INVALID_HOLDER: 'Ingresá el nombre completo del titular.',
  INVALID_TAX_ID: 'Revisá el CUIT o CUIL.',
  INVALID_ACCOUNT: 'Revisá los 22 dígitos del CBU o CVU.',
  REVISION_CONFLICT: 'Los datos cambiaron. Actualizá antes de continuar.',
  ALREADY_PAID: 'Esta liquidación ya está registrada como pagada.',
  PAYOUT_NOT_VERIFIED: 'Primero verificá la titularidad de la cuenta.',
  RATE_LIMITED: 'Llegaste al límite de intentos. Volvé a intentar más adelante.',
  INSTAGRAM_UNAVAILABLE: 'La conexión con Instagram todavía no está disponible.',
};
function appOrigin() {
  const origin = Deno.env.get('APP_ORIGIN')?.replace(/\/$/, '');
  if (!origin || !/^https?:\/\//.test(origin)) throw new PartnerError('PROGRAM_UNAVAILABLE', 503);
  const url = new URL(origin);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new PartnerError('PROGRAM_UNAVAILABLE', 503);
  return url.origin;
}
function anonClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
async function publicLimit(req: Request, action: string, email = '') {
  const secret = Deno.env.get('PARTNER_RATE_LIMIT_SECRET');
  if (!secret || secret.length < 32) throw new PartnerError('PROGRAM_UNAVAILABLE', 503);
  const source =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const { allowed } = await partnerStore<{ allowed: boolean }>(
    createAdminClient(),
    'public_limit',
    null,
    {
      action,
      sourceHash: await hashPartnerSecret(`${secret}:source:${source}`),
      emailHash: email ? await hashPartnerSecret(`${secret}:email:${email.toLowerCase()}`) : null,
    },
  );
  if (!allowed) throw new PartnerError('RATE_LIMITED', 429);
}
function ownSummary(value: PartnerSummary, tier: ReturnType<typeof partnerTier>): PartnerSummary {
  // Explicit allowlist: storage responses cannot accidentally expose tenant or bank data.
  return {
    id: value.id,
    name: value.name,
    code: value.code,
    tier,
    registrations: value.registrations,
    pendingCents: value.pendingCents,
    availableCents: value.availableCents,
    paidCents: value.paidCents,
    adjustmentsCents: value.adjustmentsCents,
    // Backwards compatible shape for older cached clients; never expose
    // audience metrics after retiring follower-based levels.
    instagram: { connected: false, username: null, followers: null, verifiedAt: null },
    payout: {
      configured: value.payout.configured,
      verified: value.payout.verified,
      lastFour: value.payout.lastFour,
    },
    commissions: value.commissions.map((item) => ({
      id: item.id,
      amountCents: item.amountCents,
      status: item.status,
      createdAt: item.createdAt,
      availableAt: item.availableAt,
    })),
  };
}

export async function handlePartnerRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(req, {});
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Método no permitido.' }, 405);
  try {
    const origin = req.headers.get('origin');
    if (origin && origin !== appOrigin()) throw new PartnerError('FORBIDDEN', 403);
    const reader = req.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16_384) { await reader.cancel(); throw new PartnerError('INVALID_REQUEST', 413); }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder().decode(bytes);
    const body = JSON.parse(text);
    if (!isRecord(body) || typeof body.action !== 'string' || !isRecord(body.input ?? {}))
      throw new PartnerError('INVALID_REQUEST', 400);
    const input = (body.input ?? {}) as Record<string, unknown>;
    const action = body.action;
    const client = createAdminClient();
    if (action === 'status') {
      let ready = false;
      if (partnerProgramEnabled() && partnerBillingEnabled()) {
        try {
          const readiness = await partnerStore<{ ready: boolean }>(client, 'readiness', null);
          ready = readiness.ready === true;
        } catch {
          /* Absence of the Lovable migration never enables enrollment. */
        }
      }
      return jsonResponse(req, {
        enabled: ready,
        instagramEnabled: ready && instagramEnabled(),
        termsVersion: PARTNER_TERMS_VERSION,
      });
    }
    if (action === 'validate_code' || action === 'register' || action === 'resend') {
      if (!partnerProgramEnabled() || !partnerBillingEnabled())
        throw new PartnerError('PROGRAM_UNAVAILABLE', 503);
      const { ready } = await partnerStore<{ ready: boolean }>(client, 'readiness', null);
      if (!ready) throw new PartnerError('PROGRAM_UNAVAILABLE', 503);
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      await publicLimit(req, action, email);
      if (action === 'validate_code') {
        const code = normalizePartnerCode(input.code);
        const { valid } = await partnerStore<{ valid: boolean }>(client, 'validate_code', null, {
          code,
        });
        if (!valid) throw new PartnerError('INVALID_REFERRAL');
        return jsonResponse(req, { code, discountPercent: 10, firstPaidMonthOnly: true });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
        throw new PartnerError('INVALID_REQUEST', 400);
      if (action === 'register') {
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        if (
          name.length < 2 ||
          name.length > 80 ||
          input.country !== 'AR' ||
          input.accepted !== true ||
          input.termsVersion !== PARTNER_TERMS_VERSION ||
          typeof input.password !== 'string' ||
          input.password.length < 12 ||
          input.password.length > 128
        ) {
          throw new PartnerError('INVALID_REQUEST', 400);
        }
        // GoTrue writes app_metadata after INSERT; the Auth trigger needs a
        // server-issued one-use intent BEFORE it provisions any tenant.
        const intent = await client.rpc('partner_begin_identity', { _email: email });
        if (intent.error || typeof intent.data !== 'string') throw new PartnerError('REGISTRATION_FAILED', 503);
        try {
          const { error } = await client.auth.admin.createUser({
            email,
            password: input.password,
            email_confirm: false,
            app_metadata: { account_kind: 'partner' },
            user_metadata: { full_name: name, country: 'AR', partner_signup_nonce: intent.data },
          });
          if (error && !['email_exists', 'user_already_exists'].includes(error.code ?? ''))
            throw new PartnerError('REGISTRATION_FAILED', 503);
        } finally {
          // Successful INSERT already consumed it. Failed/duplicate attempts
          // are discarded; an interrupted cleanup expires automatically.
          await client.rpc('partner_cancel_identity', { _nonce: intent.data });
        }
      }
      // Native Auth sends the email; no access token or confirmation link reaches this response.
      const { error } = await anonClient().auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: `${appOrigin()}/aliados/panel` },
      });
      if (error) throw new PartnerError('CONFIRMATION_FAILED', 503);
      return jsonResponse(req, { confirmationSent: true });
    }
    if (action.startsWith('admin_')) {
      const auth = await getPlatformAdminContext(req);
      if (auth.error) return auth.error;
      const actor = auth.context!;
      if (action === 'admin_summary')
        return jsonResponse(
          req,
          await partnerStore(client, action, actor.userId, { ...parsePageRequest(input) }),
        );
      if (action === 'admin_payout_details' || action === 'admin_operation_status') {
        const key = action === 'admin_payout_details' ? 'partnerId' : 'requestId';
        if (typeof input[key] !== 'string' || !/^[0-9a-f-]{36}$/i.test(input[key] as string))
          throw new PartnerError('INVALID_REQUEST', 400);
        return jsonResponse(
          req,
          await partnerStore(client, action, actor.userId, { [key]: input[key] }),
        );
      }
      const allowed = [
        'admin_agreement',
        'admin_verify_payout',
        'admin_prepare_payouts',
        'admin_mark_paid',
        'admin_resolve_incident',
        'admin_suspend',
      ];
      if (!allowed.includes(action)) throw new PartnerError('INVALID_ACTION', 400);
      if (!partnerBillingEnabled()) throw new PartnerError('PROGRAM_UNAVAILABLE', 503);
      if (
        typeof input.password !== 'string' ||
        input.password.length > 1024 ||
        input.confirmed !== true ||
        typeof input.reason !== 'string' ||
        input.reason.trim().length < 10 ||
        input.reason.length > 500 ||
        typeof input.requestId !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(input.requestId)
      )
        throw new PartnerError('INVALID_REQUEST', 400);
      const reauth = anonClient();
      const { data, error } = await reauth.auth.signInWithPassword({
        email: actor.email,
        password: input.password,
      });
      if (
        error ||
        data.user?.id !== actor.userId ||
        data.user.app_metadata?.platform_role !== 'platform_admin'
      )
        throw new PartnerError('REAUTHENTICATION_FAILED', 403);
      await reauth.auth.signOut({ scope: 'local' });
      // Never store passwords; financial operation IDs are stable across retries.
      const { password: _password, confirmed: _confirmed, ...safeInput } = input;
      if (
        action === 'admin_agreement' &&
        (!Number.isInteger(input.percent) ||
          Number(input.percent) < 1 ||
          Number(input.percent) > 100 ||
          typeof input.startsAt !== 'string' ||
          typeof input.endsAt !== 'string' ||
          !(Date.parse(input.startsAt) < Date.parse(input.endsAt)))
      )
        throw new PartnerError('INVALID_AGREEMENT', 400);
      if (
        action === 'admin_mark_paid' &&
        (typeof input.reference !== 'string' ||
          input.reference.trim().length < 3 ||
          input.reference.length > 150 ||
          typeof input.receiptPath !== 'string' ||
          !input.receiptPath.startsWith('partner-payouts/') ||
          input.receiptPath.includes('..'))
      )
        throw new PartnerError('INVALID_RECEIPT', 400);
      return jsonResponse(req, await partnerStore(client, action, actor.userId, safeInput));
    }
    const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw new PartnerError('UNAUTHORIZED', 401);
    const {
      data: { user },
      error,
    } = await anonClient().auth.getUser(token);
    if (
      error ||
      !user?.email_confirmed_at ||
      user.app_metadata?.platform_role === 'platform_admin' ||
      (user.banned_until && Date.parse(user.banned_until) > Date.now())
    )
      throw new PartnerError('UNAUTHORIZED', 401);
    if (action === 'summary') {
      const result = await partnerStore<{
        summary: PartnerSummary | null;
        tierInput?: Parameters<typeof partnerTier>[0];
      }>(client, 'summary', user.id);
      return jsonResponse(req, {
        summary: result.summary
          ? ownSummary(result.summary, partnerTier(result.tierInput!, Date.now()))
          : null,
      });
    }
    if (action === 'enroll') {
      if (!partnerProgramEnabled() || !partnerBillingEnabled())
        throw new PartnerError('PROGRAM_UNAVAILABLE', 503);
      const { ready } = await partnerStore<{ ready: boolean }>(client, 'readiness', null);
      if (!ready) throw new PartnerError('PROGRAM_UNAVAILABLE', 503);
      if (
        input.accepted !== true ||
        input.termsVersion !== PARTNER_TERMS_VERSION ||
        input.country !== 'AR'
      )
        throw new PartnerError('INVALID_TERMS', 400);
      return jsonResponse(
        req,
        await partnerStore(client, 'enroll', user.id, {
          code: normalizePartnerCode(input.code),
          country: 'AR',
          termsVersion: PARTNER_TERMS_VERSION,
        }),
      );
    }
    if (action === 'save_payout') {
      const payout = validatePayoutDetails({
        holder: input.holder,
        taxId: input.taxId,
        account: input.account,
      });
      return jsonResponse(req, await partnerStore(client, 'save_payout', user.id, payout));
    }
    if (action === 'instagram_connect')
      return jsonResponse(req, await instagramConnect(client, user.id));
    if (action === 'instagram_disconnect')
      return jsonResponse(req, await partnerStore(client, 'instagram_disconnect', user.id));
    throw new PartnerError('INVALID_ACTION', 400);
  } catch (error) {
    const code =
      error instanceof PartnerError
        ? error.code
        : error instanceof SyntaxError
          ? 'INVALID_REQUEST'
          : error instanceof Error && messages[error.message]
            ? error.message
            : 'INTERNAL_ERROR';
    return jsonResponse(
      req,
      {
        code,
        error:
          messages[code] ??
          'No pudimos completar la operación. Revisá los datos y volvé a intentar.',
      },
      error instanceof PartnerError ? error.status : code === 'INVALID_REQUEST' ? 400 : 500,
    );
  }
}
