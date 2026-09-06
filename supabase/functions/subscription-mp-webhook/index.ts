/**
 * Mercado Pago webhook for Vittro subscriptions.
 *
 * Public endpoint. It fails closed unless Mercado Pago's x-signature validates,
 * persists the event before processing, and only acknowledges durable state.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createAdminClient } from '../_shared/subscription-billing.ts';
import { mpPlatformFetch, readMpError } from '../_shared/mp-client.ts';

const webhookCorsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature, x-request-id',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...webhookCorsHeaders, 'Content-Type': 'application/json' },
  });
}

type SignatureValidation = 'valid' | 'invalid' | 'misconfigured';

function signaturesMatch(expected: string, received: string): boolean {
  if (expected.length !== received.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  }
  return mismatch === 0;
}

async function validateMpSignature(req: Request): Promise<SignatureValidation> {
  const secret = Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET');
  if (!secret) {
    const unsignedSandboxEnabled =
      Deno.env.get('MERCADOPAGO_ALLOW_UNSIGNED_WEBHOOKS')?.toLowerCase() === 'true' &&
      Deno.env.get('MERCADOPAGO_ENVIRONMENT')?.toLowerCase() === 'sandbox';
    if (unsignedSandboxEnabled) {
      console.warn('[subscription-mp-webhook] unsigned webhooks explicitly enabled for sandbox');
      return 'valid';
    }
    console.error('[subscription-mp-webhook] MERCADOPAGO_WEBHOOK_SECRET not configured');
    return 'misconfigured';
  }

  const xSignature = req.headers.get('x-signature');
  const xRequestId = req.headers.get('x-request-id');
  if (!xSignature || !xRequestId) return 'invalid';

  const parts: Record<string, string> = {};
  for (const part of xSignature.split(',')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key && value) parts[key] = value;
  }

  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return 'invalid';

  const rawTimestamp = Number(ts);
  const timestampMs = rawTimestamp > 1_000_000_000_000
    ? rawTimestamp
    : rawTimestamp * 1000;
  const configuredTolerance = Number(Deno.env.get('MERCADOPAGO_WEBHOOK_TOLERANCE_SECONDS'));
  const toleranceMs = Number.isFinite(configuredTolerance)
    ? Math.min(Math.max(configuredTolerance, 60), 3600) * 1000
    : 15 * 60 * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > toleranceMs) {
    return 'invalid';
  }

  const url = new URL(req.url);
  const dataId = url.searchParams.get('data.id')?.trim() ?? '';
  if (!dataId) return 'invalid';
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(manifest);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const computed = Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return signaturesMatch(computed, v1.toLowerCase()) ? 'valid' : 'invalid';
}

function payloadDataId(payload: Record<string, unknown>, req: Request): string | null {
  const url = new URL(req.url);
  const queryId = url.searchParams.get('data.id')?.trim();
  if (!queryId) return null;

  const data = isRecord(payload.data) ? payload.data : null;
  const nestedId = data?.id == null ? null : String(data.id);
  return nestedId && nestedId !== queryId ? null : queryId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function firstValidDate(...values: unknown[]): Date | null {
  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) {
      continue;
    }
    const candidate = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isFinite(candidate.getTime())) return candidate;
  }
  return null;
}

function pendingPreapprovalId(
  subscription: { metadata?: unknown; mercadopago_preapproval_id?: unknown; mercadopago_status?: unknown },
): string | null {
  const metadata = isRecord(subscription.metadata) ? subscription.metadata : {};
  const metadataId = asNonEmptyString(metadata.pending_mercadopago_preapproval_id);
  if (metadataId) return metadataId;

  return subscription.mercadopago_status === 'pending'
    ? asNonEmptyString(subscription.mercadopago_preapproval_id)
    : null;
}

function withoutPendingCheckoutMetadata(value: unknown): Record<string, unknown> {
  const metadata = isRecord(value) ? { ...value } : {};
  delete metadata.pending_mercadopago_preapproval_id;
  delete metadata.pending_mercadopago_external_reference;
  delete metadata.pending_checkout_amount_ars;
  delete metadata.pending_checkout_price_version;
  delete metadata.checkout_requested_at;
  delete metadata.checkout_requested_by;
  delete metadata.previous_mercadopago_preapproval_id;
  delete metadata.previous_mercadopago_external_reference;
  return metadata;
}

function withoutScheduledRenewalMetadata(value: unknown): Record<string, unknown> {
  const metadata = isRecord(value) ? { ...value } : {};
  delete metadata.scheduled_renewal_amount_ars;
  delete metadata.scheduled_renewal_price_version;
  return metadata;
}

function withoutSupersededPreapprovalMetadata(value: unknown): Record<string, unknown> {
  const metadata = isRecord(value) ? { ...value } : {};
  delete metadata.superseded_mercadopago_preapproval_id;
  delete metadata.superseded_mercadopago_external_reference;
  return metadata;
}

function finiteAmount(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function positiveVersion(value: unknown): number | null {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
}

async function cancelSupersededPreapproval(
  preapprovalId: string,
  organizationId: string,
  expectedExternalReference: string | null,
): Promise<boolean> {
  const path = `/preapproval/${encodeURIComponent(preapprovalId)}`;
  const currentResponse = await mpPlatformFetch(path);
  if (currentResponse.status === 404) return true;
  if (!currentResponse.ok) {
    const providerError = await readMpError(currentResponse);
    console.warn('[subscription-mp-webhook] superseded preapproval verification failed:', currentResponse.status, providerError.code);
    return false;
  }

  const current = await currentResponse.json() as Record<string, unknown>;
  const providerReference = asNonEmptyString(current.external_reference);
  const parsedReference = parseSubscriptionExternalReference(providerReference);
  if (
    String(current.id ?? '') !== preapprovalId ||
    !parsedReference ||
    parsedReference.organizationId.toLowerCase() !== organizationId.toLowerCase() ||
    (expectedExternalReference !== null && providerReference !== expectedExternalReference)
  ) {
    console.error('[subscription-mp-webhook] superseded preapproval ownership mismatch');
    return false;
  }
  const status = asNonEmptyString(current.status)?.toLowerCase();
  if (status === 'cancelled' || status === 'canceled') return true;

  const cancelResponse = await mpPlatformFetch(path, {
    method: 'PUT',
    body: JSON.stringify({ status: 'cancelled' }),
  });
  if (!cancelResponse.ok) {
    const providerError = await readMpError(cancelResponse);
    console.warn('[subscription-mp-webhook] superseded preapproval cancellation failed:', cancelResponse.status, providerError.code);
    return false;
  }
  return true;
}

async function findExistingEvent(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  topic: string,
  action: string | null,
  dataId: string | null,
  providerEventId: string | null,
): Promise<{ id: string; processed_at: string | null } | null> {
  let query = supabaseAdmin
    .from('mercadopago_subscription_events')
    .select('id,processed_at')
    .eq('topic', topic);
  query = action ? query.eq('action', action) : query.is('action', null);
  query = dataId ? query.eq('data_id', dataId) : query.is('data_id', null);
  query = providerEventId
    ? query.eq('provider_event_id', providerEventId)
    : query.is('provider_event_id', null);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) return null;
  return data as { id: string; processed_at: string | null } | null;
}

function parseSubscriptionExternalReference(value: string | null | undefined): {
  organizationId: string;
  planCode: string;
} | null {
  if (!value) return null;

  const match = value.match(/^sub_([0-9a-fA-F-]{36})_(basico|profesional|premium)_/);
  if (!match) return null;

  return {
    organizationId: match[1],
    planCode: match[2],
  };
}

function externalReferenceMatches(
  parsed: { organizationId: string; planCode: string } | null,
  actualReference: string | null | undefined,
  organizationId: string,
  expectedStoredReference: string | null | undefined,
  expectedPlanCode?: string | null,
): boolean {
  return Boolean(
    parsed &&
    actualReference &&
    expectedStoredReference &&
    parsed.organizationId === organizationId &&
    actualReference === expectedStoredReference &&
    (!expectedPlanCode || parsed.planCode === expectedPlanCode),
  );
}

function eventTopic(payload: Record<string, unknown>): string {
  return String(payload.type ?? payload.topic ?? payload.action ?? 'unknown');
}

function isPreapprovalEvent(topic: string, action?: string | null): boolean {
  const value = `${topic} ${action ?? ''}`.toLowerCase();
  return value.includes('preapproval') || value.includes('subscription_preapproval');
}

function isAuthorizedPaymentEvent(topic: string, action?: string | null): boolean {
  const value = `${topic} ${action ?? ''}`.toLowerCase();
  return value.includes('authorized_payment') || value.includes('subscription_authorized_payment');
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function mapSubscriptionStatus(mpStatus: string | null | undefined, fallback: string | null): string {
  switch ((mpStatus ?? '').toLowerCase()) {
    case 'authorized':
    case 'active':
      return 'active';
    case 'paused':
      return 'past_due';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'pending':
      return fallback ?? 'expired';
    default:
      return fallback ?? 'expired';
  }
}

function mapPaymentStatus(mpStatus: string | null | undefined): string {
  switch ((mpStatus ?? '').toLowerCase()) {
    case 'approved':
    case 'accredited':
      return 'approved';
    case 'in_process':
      return 'in_process';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'refunded':
      return 'refunded';
    case 'charged_back':
      return 'charged_back';
    default:
      return 'pending';
  }
}

type PaymentOwnership = {
  organization_id: string;
  subscription_id: string | null;
  mercadopago_preapproval_id: string;
  mercadopago_authorized_payment_id: string;
};

type ExistingPayment = PaymentOwnership & { id: string };

function paymentOwnershipMatches(
  existing: ExistingPayment,
  expected: PaymentOwnership,
): boolean {
  return existing.organization_id === expected.organization_id &&
    existing.subscription_id === expected.subscription_id &&
    existing.mercadopago_preapproval_id === expected.mercadopago_preapproval_id &&
    existing.mercadopago_authorized_payment_id === expected.mercadopago_authorized_payment_id;
}

async function persistAuthorizedPayment(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  ownership: PaymentOwnership,
  mutableFields: Record<string, unknown>,
): Promise<{ id: string } | null> {
  const readExisting = async (): Promise<ExistingPayment | null> => {
    const { data, error } = await supabaseAdmin
      .from('subscription_payments')
      .select('id,organization_id,subscription_id,mercadopago_preapproval_id,mercadopago_authorized_payment_id')
      .eq('mercadopago_authorized_payment_id', ownership.mercadopago_authorized_payment_id)
      .maybeSingle();
    if (error) {
      console.error('[subscription-mp-webhook] payment lookup failed:', error.code);
      throw error;
    }
    return data as ExistingPayment | null;
  };

  const updateExisting = async (existing: ExistingPayment): Promise<{ id: string } | null> => {
    if (!paymentOwnershipMatches(existing, ownership)) {
      console.error('[subscription-mp-webhook] payment ownership mismatch');
      return null;
    }

    let update = supabaseAdmin
      .from('subscription_payments')
      .update(mutableFields)
      .eq('id', existing.id)
      .eq('organization_id', ownership.organization_id)
      .eq('mercadopago_preapproval_id', ownership.mercadopago_preapproval_id);
    update = ownership.subscription_id
      ? update.eq('subscription_id', ownership.subscription_id)
      : update.is('subscription_id', null);
    const { data, error } = await update.select('id').maybeSingle();
    if (error || !data) {
      console.error('[subscription-mp-webhook] payment update failed:', error?.code ?? 'ownership_changed');
      return null;
    }
    return data as { id: string };
  };

  let existing: ExistingPayment | null;
  try {
    existing = await readExisting();
  } catch {
    return null;
  }
  if (existing) return updateExisting(existing);

  const { data, error } = await supabaseAdmin
    .from('subscription_payments')
    .insert({ ...ownership, ...mutableFields })
    .select('id')
    .maybeSingle();

  if (!error && data) return data as { id: string };
  if (error?.code !== '23505') {
    console.error('[subscription-mp-webhook] payment insert failed:', error?.code ?? 'missing_row');
    return null;
  }

  // A duplicate notification can race the first insert. Re-read the winner and
  // update only after its immutable tenant/subscription ownership is identical.
  try {
    existing = await readExisting();
  } catch {
    return null;
  }
  return existing ? updateExisting(existing) : null;
}

type PreviousPriceTransition = {
  itemId: string;
  batchId: string;
  nextAmountArs: number;
  nextPriceVersion: number;
};

async function acceptedPreviousPriceTransition(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  input: {
    preapprovalId: string;
    planCode: string;
    actualAmountArs: number;
    targetAmountArs: number | null;
    targetPriceVersion: number | null;
  },
): Promise<PreviousPriceTransition | null> {
  if (
    input.actualAmountArs <= 0 ||
    input.targetAmountArs === null ||
    input.targetPriceVersion === null ||
    input.actualAmountArs === input.targetAmountArs
  ) return null;

  const { data: latestItem, error: itemError } = await supabaseAdmin
    .from('subscription_price_change_items')
    .select('id,batch_id,completed_at')
    .eq('preapproval_id', input.preapprovalId)
    .eq('provider_mutation_kind', 'set_amount')
    .eq('status', 'succeeded')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (itemError || !latestItem) return null;

  const { data: latestBatch, error: batchError } = await supabaseAdmin
    .from('subscription_price_change_batches')
    .select('id,plan_code,old_amount_ars,new_amount_ars,new_price_version')
    .eq('id', latestItem.batch_id)
    .maybeSingle();
  if (
    batchError ||
    !latestBatch ||
    latestBatch.plan_code !== input.planCode ||
    finiteAmount(latestBatch.old_amount_ars) !== input.actualAmountArs ||
    finiteAmount(latestBatch.new_amount_ars) !== input.targetAmountArs ||
    positiveVersion(latestBatch.new_price_version) !== input.targetPriceVersion
  ) return null;

  return {
    itemId: String(latestItem.id),
    batchId: String(latestBatch.id),
    nextAmountArs: input.targetAmountArs,
    nextPriceVersion: input.targetPriceVersion,
  };
}

async function syncPreapproval(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  preapprovalId: string,
  eventRowId: string | null,
): Promise<boolean> {
  const mpRes = await mpPlatformFetch(`/preapproval/${preapprovalId}`);
  if (!mpRes.ok) {
    const mpError = await readMpError(mpRes);
    console.warn('[subscription-mp-webhook] preapproval fetch failed:', mpRes.status, mpError.code);
    return false;
  }

  const preapproval = await mpRes.json();
  if (String(preapproval.id ?? '') !== String(preapprovalId)) {
    console.error('[subscription-mp-webhook] preapproval identity mismatch');
    return false;
  }
  const externalReference = preapproval.external_reference as string | undefined;
  const parsedExternalReference = parseSubscriptionExternalReference(externalReference);

  let { data: subscription } = await supabaseAdmin
    .from('organization_subscriptions')
    .select('id, organization_id, status, current_plan_code, pending_plan_code, effective_plan_code, billing_plan_code, billing_amount_ars, billing_price_version, pending_checkout_amount_ars, pending_checkout_price_version, current_period_start, current_period_end, next_payment_date, mercadopago_preapproval_id, mercadopago_external_reference, mercadopago_status, metadata, updated_at')
    .eq('mercadopago_preapproval_id', String(preapprovalId))
    .maybeSingle();

  if (!subscription) {
    const pendingFallback = await supabaseAdmin
      .from('organization_subscriptions')
      .select('id, organization_id, status, current_plan_code, pending_plan_code, effective_plan_code, billing_plan_code, billing_amount_ars, billing_price_version, pending_checkout_amount_ars, pending_checkout_price_version, current_period_start, current_period_end, next_payment_date, mercadopago_preapproval_id, mercadopago_external_reference, mercadopago_status, metadata, updated_at')
      .contains('metadata', { pending_mercadopago_preapproval_id: String(preapprovalId) })
      .maybeSingle();
    subscription = pendingFallback.data;
  }

  if (!subscription && externalReference) {
    const referenceFallback = await supabaseAdmin
      .from('organization_subscriptions')
      .select('id, organization_id, status, current_plan_code, pending_plan_code, effective_plan_code, billing_plan_code, billing_amount_ars, billing_price_version, pending_checkout_amount_ars, pending_checkout_price_version, current_period_start, current_period_end, next_payment_date, mercadopago_preapproval_id, mercadopago_external_reference, mercadopago_status, metadata, updated_at')
      .eq('mercadopago_external_reference', externalReference)
      .maybeSingle();
    subscription = referenceFallback.data;
  }

  if (!subscription && parsedExternalReference) {
    const fallback = await supabaseAdmin
      .from('organization_subscriptions')
      .select('id, organization_id, status, current_plan_code, pending_plan_code, effective_plan_code, billing_plan_code, billing_amount_ars, billing_price_version, pending_checkout_amount_ars, pending_checkout_price_version, current_period_start, current_period_end, next_payment_date, mercadopago_preapproval_id, mercadopago_external_reference, mercadopago_status, metadata, updated_at')
      .eq('organization_id', parsedExternalReference.organizationId)
      .maybeSingle();
    subscription = fallback.data;
  }

  if (!subscription) {
    console.warn('[subscription-mp-webhook] subscription not found for preapproval:', preapprovalId);
    return false;
  }

  const localPendingPreapprovalId = pendingPreapprovalId(subscription);
  const isPendingCheckout = localPendingPreapprovalId === String(preapprovalId);
  const isCurrentPreapproval = subscription.mercadopago_preapproval_id === String(preapprovalId);

  if (!isPendingCheckout && !isCurrentPreapproval) {
    console.warn('[subscription-mp-webhook] ignored stale preapproval:', preapprovalId);
    if (eventRowId) {
      const { error: ignoredEventError } = await supabaseAdmin
        .from('mercadopago_subscription_events')
        .update({
          organization_id: subscription.organization_id,
          subscription_id: subscription.id,
          processed_at: new Date().toISOString(),
        })
        .eq('id', eventRowId);
      if (ignoredEventError) return false;
    }
    return true;
  }

  const subscriptionMetadata = isRecord(subscription.metadata) ? subscription.metadata : {};
  const expectedStoredReference = isPendingCheckout
    ? asNonEmptyString(subscriptionMetadata.pending_mercadopago_external_reference) ??
      (isCurrentPreapproval ? asNonEmptyString(subscription.mercadopago_external_reference) : null)
    : asNonEmptyString(subscription.mercadopago_external_reference);
  if (!externalReferenceMatches(
    parsedExternalReference,
    externalReference,
    subscription.organization_id,
    expectedStoredReference,
    isPendingCheckout ? subscription.pending_plan_code : null,
  )) {
    console.error('[subscription-mp-webhook] preapproval reference mismatch');
    return false;
  }

  const nextStatus = mapSubscriptionStatus(preapproval.status as string | undefined, subscription.status);
  const nextPaymentDate = preapproval.next_payment_date
    ? new Date(preapproval.next_payment_date as string)
    : null;
  const preservesCurrentProvider = isPendingCheckout && !isCurrentPreapproval && Boolean(subscription.current_plan_code);
  const pendingCheckoutTerminated = isPendingCheckout && (
    nextStatus === 'cancelled' || nextStatus === 'past_due'
  );
  const subscriptionUpdate: Record<string, unknown> = {
    // A preapproval becoming authorized is not proof of an approved debit.
    // Plan, billing snapshot and paid period are promoted only by the
    // authorized_payment branch below.
    status: isPendingCheckout ? subscription.status : nextStatus,
    pending_plan_code: pendingCheckoutTerminated ? null : subscription.pending_plan_code,
    next_payment_date: isPendingCheckout
      ? subscription.next_payment_date
      : nextPaymentDate?.toISOString() ?? null,
  };

  if (!preservesCurrentProvider) {
    subscriptionUpdate.mercadopago_status = preapproval.status ?? null;
    subscriptionUpdate.mercadopago_init_point = preapproval.init_point ?? preapproval.sandbox_init_point ?? null;
    subscriptionUpdate.mercadopago_external_reference = externalReference ?? null;
  }

  if (pendingCheckoutTerminated) {
    subscriptionUpdate.pending_checkout_amount_ars = null;
    subscriptionUpdate.pending_checkout_price_version = null;
    subscriptionUpdate.mercadopago_init_point = null;
    subscriptionUpdate.metadata = withoutPendingCheckoutMetadata(subscription.metadata);
  }

  const { data: updatedSubscription, error: subscriptionUpdateError } = await supabaseAdmin
    .from('organization_subscriptions')
    .update(subscriptionUpdate)
    .eq('id', subscription.id)
    .eq('updated_at', subscription.updated_at)
    .select('id')
    .maybeSingle();

  if (subscriptionUpdateError || !updatedSubscription) {
    console.error('[subscription-mp-webhook] preapproval sync failed:', subscriptionUpdateError?.code ?? 'concurrent_change');
    return false;
  }

  if (eventRowId) {
    const { error: eventUpdateError } = await supabaseAdmin
      .from('mercadopago_subscription_events')
      .update({
        organization_id: subscription.organization_id,
        subscription_id: subscription.id,
        processed_at: new Date().toISOString(),
      })
      .eq('id', eventRowId);
    if (eventUpdateError) return false;
  }
  return true;
}

async function syncAuthorizedPayment(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  authorizedPaymentId: string,
  eventRowId: string | null,
): Promise<boolean> {
  const mpRes = await mpPlatformFetch(`/authorized_payments/${authorizedPaymentId}`);
  if (!mpRes.ok) {
    const mpError = await readMpError(mpRes);
    console.warn('[subscription-mp-webhook] authorized payment fetch failed:', mpRes.status, mpError.code);
    return false;
  }

  const authorizedPayment = await mpRes.json();
  if (String(authorizedPayment.id ?? '') !== String(authorizedPaymentId)) {
    console.error('[subscription-mp-webhook] authorized payment identity mismatch');
    return false;
  }
  const preapprovalId =
    authorizedPayment.preapproval_id ??
    authorizedPayment.subscription_id ??
    authorizedPayment.preapproval?.id;

  if (!preapprovalId) {
    console.warn('[subscription-mp-webhook] authorized payment without preapproval:', authorizedPaymentId);
    return false;
  }

  let externalReference =
    typeof authorizedPayment.external_reference === 'string'
      ? authorizedPayment.external_reference
      : null;

  if (!externalReference) {
    const preapprovalRes = await mpPlatformFetch(`/preapproval/${preapprovalId}`);
    if (preapprovalRes.ok) {
      const preapproval = await preapprovalRes.json();
      externalReference = typeof preapproval.external_reference === 'string'
        ? preapproval.external_reference
        : null;
    }
  }

  const parsedExternalReference = parseSubscriptionExternalReference(externalReference);

  let { data: subscription } = await supabaseAdmin
    .from('organization_subscriptions')
    .select('id, organization_id, status, current_plan_code, effective_plan_code, pending_plan_code, billing_plan_code, billing_amount_ars, billing_price_version, pending_checkout_amount_ars, pending_checkout_price_version, current_period_start, current_period_end, last_payment_at, mercadopago_preapproval_id, mercadopago_external_reference, mercadopago_status, metadata, updated_at')
    .eq('mercadopago_preapproval_id', String(preapprovalId))
    .maybeSingle();

  if (!subscription) {
    const pendingFallback = await supabaseAdmin
      .from('organization_subscriptions')
      .select('id, organization_id, status, current_plan_code, effective_plan_code, pending_plan_code, billing_plan_code, billing_amount_ars, billing_price_version, pending_checkout_amount_ars, pending_checkout_price_version, current_period_start, current_period_end, last_payment_at, mercadopago_preapproval_id, mercadopago_external_reference, mercadopago_status, metadata, updated_at')
      .contains('metadata', { pending_mercadopago_preapproval_id: String(preapprovalId) })
      .maybeSingle();
    subscription = pendingFallback.data;
  }

  if (!subscription && parsedExternalReference) {
    const fallback = await supabaseAdmin
      .from('organization_subscriptions')
      .select('id, organization_id, status, current_plan_code, effective_plan_code, pending_plan_code, billing_plan_code, billing_amount_ars, billing_price_version, pending_checkout_amount_ars, pending_checkout_price_version, current_period_start, current_period_end, last_payment_at, mercadopago_preapproval_id, mercadopago_external_reference, mercadopago_status, metadata, updated_at')
      .eq('organization_id', parsedExternalReference.organizationId)
      .maybeSingle();
    subscription = fallback.data;
  }

  if (!subscription) {
    console.warn('[subscription-mp-webhook] subscription not found for authorized payment:', authorizedPaymentId);
    return false;
  }

  const localPendingPreapprovalId = pendingPreapprovalId(subscription);
  const isPendingCheckout = localPendingPreapprovalId === String(preapprovalId);
  const isCurrentPreapproval = subscription.mercadopago_preapproval_id === String(preapprovalId);
  const subscriptionMetadata = isRecord(subscription.metadata) ? subscription.metadata : {};
  const recordedSupersededPreapprovalId = asNonEmptyString(
    subscriptionMetadata.superseded_mercadopago_preapproval_id,
  );
  const recordedSupersededExternalReference = asNonEmptyString(
    subscriptionMetadata.superseded_mercadopago_external_reference,
  );
  const isScheduledRenewal = Boolean(
    !isPendingCheckout &&
    isCurrentPreapproval &&
    subscription.pending_plan_code &&
    !asNonEmptyString(subscriptionMetadata.pending_mercadopago_preapproval_id) &&
    subscription.mercadopago_status !== 'pending' &&
    subscription.pending_checkout_amount_ars == null &&
    subscription.pending_checkout_price_version == null,
  );

  if (!isPendingCheckout && !isCurrentPreapproval) {
    const { data: tombstone, error: tombstoneError } = await supabaseAdmin
      .from('subscription_price_change_items')
      .select('id,batch_id,organization_id,subscription_id,expected_external_reference,created_at')
      .eq('preapproval_id', String(preapprovalId))
      .eq('item_type', 'pending_checkout')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tombstoneError) return false;

    let tombstonePlanCode: string | null = null;
    if (tombstone?.batch_id) {
      const { data: tombstoneBatch, error: tombstoneBatchError } = await supabaseAdmin
        .from('subscription_price_change_batches')
        .select('plan_code')
        .eq('id', tombstone.batch_id)
        .maybeSingle();
      if (tombstoneBatchError) return false;
      tombstonePlanCode = asNonEmptyString(tombstoneBatch?.plan_code);
    }

    const frozenReference = asNonEmptyString(tombstone?.expected_external_reference);
    const tombstoneOrganizationId = asNonEmptyString(tombstone?.organization_id) ??
      parsedExternalReference?.organizationId ?? null;
    const isInvalidatedPriceCheckout = Boolean(
      tombstone &&
      frozenReference &&
      frozenReference === externalReference &&
      parsedExternalReference &&
      tombstoneOrganizationId &&
      parsedExternalReference.organizationId.toLowerCase() === tombstoneOrganizationId.toLowerCase() &&
      tombstonePlanCode === parsedExternalReference.planCode,
    );
    const isOwnedStaleCheckout = Boolean(
      parsedExternalReference &&
      externalReference &&
      parsedExternalReference.organizationId.toLowerCase() ===
        subscription.organization_id.toLowerCase(),
    );

    if (!isInvalidatedPriceCheckout && !isOwnedStaleCheckout) {
      console.warn('[subscription-mp-webhook] ignored stale authorized payment:', authorizedPaymentId);
      if (eventRowId) {
        const { error: ignoredEventError } = await supabaseAdmin
          .from('mercadopago_subscription_events')
          .update({
            organization_id: subscription.organization_id,
            subscription_id: subscription.id,
            processed_at: new Date().toISOString(),
          })
          .eq('id', eventRowId);
        if (ignoredEventError) return false;
      }
      return true;
    }

    const incidentOrganizationId = isInvalidatedPriceCheckout && tombstoneOrganizationId
      ? tombstoneOrganizationId
      : subscription.organization_id;
    const incidentSubscriptionId = isInvalidatedPriceCheckout
      ? asNonEmptyString(tombstone?.subscription_id) ?? subscription.id
      : subscription.id;
    const incidentPlanCode = isInvalidatedPriceCheckout && tombstonePlanCode
      ? tombstonePlanCode
      : parsedExternalReference?.planCode ?? null;
    const incidentReference = isInvalidatedPriceCheckout && frozenReference
      ? frozenReference
      : externalReference;

    const stalePaymentStatus = mapPaymentStatus(authorizedPayment.status as string | undefined);
    const staleAmount = finiteAmount(
      authorizedPayment.transaction_amount ??
      authorizedPayment.amount ??
      authorizedPayment.payment?.transaction_amount ??
      0,
    ) ?? 0;
    const staleCurrencyId = String(authorizedPayment.currency_id ?? 'ARS');
    const stalePaidAt = stalePaymentStatus === 'approved'
      ? (firstValidDate(
        authorizedPayment.date_approved,
        authorizedPayment.last_modified,
        authorizedPayment.date_created,
      ) ?? new Date()).toISOString()
      : null;
    const staleDueAt = firstValidDate(
      authorizedPayment.payment_date,
      authorizedPayment.date_created,
    )?.toISOString() ?? null;
    const stalePeriodStart = stalePaidAt ? new Date(stalePaidAt) : null;
    const stalePeriodEnd = stalePeriodStart ? addMonths(stalePeriodStart, 1) : null;
    const stalePayment = await persistAuthorizedPayment(
      supabaseAdmin,
      {
        organization_id: incidentOrganizationId,
        subscription_id: incidentSubscriptionId,
        mercadopago_preapproval_id: String(preapprovalId),
        mercadopago_authorized_payment_id: String(authorizedPaymentId),
      },
      {
        plan_code: incidentPlanCode,
        billing_plan_code: incidentPlanCode,
        amount_ars: staleAmount,
        currency_id: staleCurrencyId,
        status: stalePaymentStatus,
        provider: 'mercadopago',
        mercadopago_payment_id: authorizedPayment.payment_id
          ? String(authorizedPayment.payment_id)
          : null,
        period_start: stalePeriodStart?.toISOString() ?? null,
        period_end: stalePeriodEnd?.toISOString() ?? null,
        due_at: staleDueAt,
        paid_at: stalePaidAt,
        raw_payload: authorizedPayment,
      },
    );
    if (!stalePayment) return false;

    if (
      (stalePaymentStatus === 'approved' || stalePaymentStatus === 'in_process') &&
      !(await cancelSupersededPreapproval(
        String(preapprovalId),
        incidentOrganizationId,
        incidentReference,
      ))
    ) {
      return false;
    }

    const auditRequestId = eventRowId ?? crypto.randomUUID();
    const { error: auditError } = await supabaseAdmin
      .from('platform_admin_audit_log')
      .insert({
        actor_user_id: null,
        actor_alias: 'mercadopago_webhook',
        action: isInvalidatedPriceCheckout
          ? 'subscription_price_change.invalidated_checkout_payment'
          : 'subscription.stale_preapproval_payment',
        target_type: isInvalidatedPriceCheckout
          ? 'subscription_price_change_item'
          : 'organization_subscription',
        target_id: isInvalidatedPriceCheckout ? tombstone?.id ?? null : subscription.id,
        reason: isInvalidatedPriceCheckout
          ? 'Mercado Pago informo un cobro para un checkout invalidado por cambio de precio.'
          : 'Mercado Pago informo un cobro para un preapproval que ya no pertenece al estado local vigente.',
        previous_state: {},
        next_state: {
          batchId: isInvalidatedPriceCheckout ? tombstone?.batch_id ?? null : null,
          planCode: incidentPlanCode,
          amountArs: staleAmount,
          status: stalePaymentStatus,
        },
        result_status: stalePaymentStatus === 'approved' ? 'failed' : 'partial',
        result_detail: { paymentId: stalePayment.id },
        request_id: auditRequestId,
      });
    if (auditError && auditError.code !== '23505') return false;

    if (eventRowId) {
      const { error: ignoredEventError } = await supabaseAdmin
        .from('mercadopago_subscription_events')
        .update({
          organization_id: incidentOrganizationId,
          subscription_id: incidentSubscriptionId,
          payment_id: stalePayment.id,
          processed_at: new Date().toISOString(),
        })
        .eq('id', eventRowId);
      if (ignoredEventError) return false;
    }
    return true;
  }

  const expectedStoredReference = isPendingCheckout
    ? asNonEmptyString(subscriptionMetadata.pending_mercadopago_external_reference) ??
      (isCurrentPreapproval ? asNonEmptyString(subscription.mercadopago_external_reference) : null)
    : asNonEmptyString(subscription.mercadopago_external_reference);
  if (!externalReferenceMatches(
    parsedExternalReference,
    externalReference,
    subscription.organization_id,
    expectedStoredReference,
    isPendingCheckout ? subscription.pending_plan_code : null,
  )) {
    console.error('[subscription-mp-webhook] authorized payment reference mismatch');
    return false;
  }

  const paymentStatus = mapPaymentStatus(authorizedPayment.status as string | undefined);
  const amount = finiteAmount(
    authorizedPayment.transaction_amount ??
    authorizedPayment.amount ??
    authorizedPayment.payment?.transaction_amount ??
    0,
  ) ?? 0;
  const paidAt = paymentStatus === 'approved'
    ? (firstValidDate(
      authorizedPayment.date_approved,
      authorizedPayment.last_modified,
      authorizedPayment.date_created,
    ) ?? new Date()).toISOString()
    : null;
  const dueAt = firstValidDate(
    authorizedPayment.payment_date,
    authorizedPayment.date_created,
  )?.toISOString() ?? null;
  const planCode =
    (isPendingCheckout ? parsedExternalReference?.planCode : null) ??
    ((isPendingCheckout || isScheduledRenewal) ? subscription.pending_plan_code : null) ??
    subscription.billing_plan_code ??
    subscription.current_plan_code ??
    subscription.effective_plan_code ??
    'basico';
  const pendingAmount = finiteAmount(subscription.pending_checkout_amount_ars);
  const pendingPriceVersion = positiveVersion(subscription.pending_checkout_price_version);
  const currencyId = String(authorizedPayment.currency_id ?? 'ARS');
  const pendingCheckoutMatchesStoredPrice =
    !isPendingCheckout ||
    (
      pendingAmount !== null &&
      pendingPriceVersion !== null &&
      amount > 0 &&
      amount === pendingAmount &&
      currencyId === 'ARS'
    );
  const scheduledAmount = finiteAmount(subscriptionMetadata.scheduled_renewal_amount_ars);
  const scheduledPriceVersion = positiveVersion(subscriptionMetadata.scheduled_renewal_price_version);
  const scheduledRenewalMatchesStoredPrice = !isScheduledRenewal || (
    scheduledAmount !== null &&
    scheduledPriceVersion !== null &&
    amount > 0 &&
    amount === scheduledAmount &&
    currencyId === 'ARS'
  );
  const currentRenewalMatchesStoredPrice = isPendingCheckout || isScheduledRenewal || (
    finiteAmount(subscription.billing_amount_ars) !== null &&
    positiveVersion(subscription.billing_price_version) !== null &&
    amount > 0 &&
    amount === finiteAmount(subscription.billing_amount_ars) &&
    currencyId === 'ARS'
  );
  const renewalTargetAmount = isScheduledRenewal
    ? scheduledAmount
    : finiteAmount(subscription.billing_amount_ars);
  const renewalTargetPriceVersion = isScheduledRenewal
    ? scheduledPriceVersion
    : positiveVersion(subscription.billing_price_version);
  const previousPriceTransition = paymentStatus === 'approved' &&
      !isPendingCheckout &&
      currencyId === 'ARS' &&
      (!scheduledRenewalMatchesStoredPrice || !currentRenewalMatchesStoredPrice)
    ? await acceptedPreviousPriceTransition(supabaseAdmin, {
      preapprovalId: String(preapprovalId),
      planCode,
      actualAmountArs: amount,
      targetAmountArs: renewalTargetAmount,
      targetPriceVersion: renewalTargetPriceVersion,
    })
    : null;

  const rawNextPaymentDate = authorizedPayment.next_payment_date
    ? new Date(authorizedPayment.next_payment_date as string)
    : null;
  const nextPaymentDate = rawNextPaymentDate && Number.isFinite(rawNextPaymentDate.getTime())
    ? rawNextPaymentDate
    : null;
  const approvedPeriodStart = paymentStatus === 'approved' && paidAt
    ? new Date(paidAt)
    : null;
  const approvedPeriodEnd = approvedPeriodStart
    ? nextPaymentDate ?? addMonths(approvedPeriodStart, 1)
    : null;

  const payment = await persistAuthorizedPayment(
    supabaseAdmin,
    {
      organization_id: subscription.organization_id,
      subscription_id: subscription.id,
      mercadopago_preapproval_id: String(preapprovalId),
      mercadopago_authorized_payment_id: String(authorizedPaymentId),
    },
    {
      plan_code: planCode,
      billing_plan_code: planCode,
      amount_ars: amount,
      currency_id: currencyId,
      status: paymentStatus,
      provider: 'mercadopago',
      mercadopago_payment_id: authorizedPayment.payment_id ? String(authorizedPayment.payment_id) : null,
      period_start: approvedPeriodStart?.toISOString() ?? subscription.current_period_start,
      period_end: approvedPeriodEnd?.toISOString() ?? subscription.current_period_end,
      due_at: dueAt,
      paid_at: paidAt,
      raw_payload: authorizedPayment,
    },
  );

  if (!payment) return false;

  if (
    recordedSupersededPreapprovalId &&
    recordedSupersededPreapprovalId !== String(preapprovalId) &&
    !(await cancelSupersededPreapproval(
      recordedSupersededPreapprovalId,
      subscription.organization_id,
      recordedSupersededExternalReference,
    ))
  ) {
    return false;
  }

  if (previousPriceTransition) {
    const { error: transitionAuditError } = await supabaseAdmin
      .from('platform_admin_audit_log')
      .insert({
        actor_user_id: null,
        actor_alias: 'mercadopago_webhook',
        action: 'subscription_price_change.previous_amount_payment',
        target_type: 'subscription_price_change_item',
        target_id: previousPriceTransition.itemId,
        reason: 'Mercado Pago informo un cobro aprobado con el importe anterior durante una transicion de precio.',
        previous_state: {
          amountArs: amount,
          paymentId: payment.id,
        },
        next_state: {
          batchId: previousPriceTransition.batchId,
          billingAmountArs: previousPriceTransition.nextAmountArs,
          billingPriceVersion: previousPriceTransition.nextPriceVersion,
        },
        result_status: 'partial',
        result_detail: { authorizedPaymentId: String(authorizedPaymentId) },
        request_id: eventRowId ?? crypto.randomUUID(),
      });
    if (transitionAuditError && transitionAuditError.code !== '23505') return false;
  }

  if (
    paymentStatus === 'approved' &&
    !previousPriceTransition &&
    (
      !pendingCheckoutMatchesStoredPrice ||
      !scheduledRenewalMatchesStoredPrice ||
      !currentRenewalMatchesStoredPrice
    )
  ) {
    console.error('[subscription-mp-webhook] subscription price mismatch:', {
      authorizedPaymentId,
      preapprovalId: String(preapprovalId),
      planCode,
    });

    if (eventRowId) {
      await supabaseAdmin
        .from('mercadopago_subscription_events')
        .update({
          organization_id: subscription.organization_id,
          subscription_id: subscription.id,
          payment_id: payment?.id ?? null,
        })
        .eq('id', eventRowId);
    }
    return false;
  }

  if (
    paymentStatus === 'approved' &&
    paidAt &&
    subscription.last_payment_at &&
    Date.parse(paidAt) <= Date.parse(subscription.last_payment_at)
  ) {
    if (eventRowId) {
      const { error: staleEventError } = await supabaseAdmin
        .from('mercadopago_subscription_events')
        .update({
          organization_id: subscription.organization_id,
          subscription_id: subscription.id,
          payment_id: payment?.id ?? null,
          processed_at: new Date().toISOString(),
        })
        .eq('id', eventRowId);
      if (staleEventError) return false;
    }
    return true;
  }

  if (paymentStatus === 'approved') {
    const periodStart = approvedPeriodStart ?? new Date();
    const periodEnd = approvedPeriodEnd ?? addMonths(periodStart, 1);

    const metadata = subscriptionMetadata;
    const previousPreapprovalId = isPendingCheckout && typeof metadata.previous_mercadopago_preapproval_id === 'string'
      ? metadata.previous_mercadopago_preapproval_id
      : null;
    const previousExternalReference = isPendingCheckout &&
        typeof metadata.previous_mercadopago_external_reference === 'string'
      ? metadata.previous_mercadopago_external_reference
      : null;
    let confirmedPriceVersion = previousPriceTransition
      ? previousPriceTransition.nextPriceVersion
      : isPendingCheckout
        ? pendingPriceVersion
        : isScheduledRenewal
          ? scheduledPriceVersion
          : positiveVersion(subscription.billing_price_version);
    const confirmedBillingAmount = previousPriceTransition
      ? previousPriceTransition.nextAmountArs
      : isPendingCheckout && pendingAmount !== null
        ? pendingAmount
        : amount;

    if (
      !isPendingCheckout &&
      !previousPriceTransition &&
      (!confirmedPriceVersion || finiteAmount(subscription.billing_amount_ars) !== amount)
    ) {
      const { data: catalogPlan } = await supabaseAdmin
        .from('subscription_plans')
        .select('amount_ars, price_version')
        .eq('code', planCode)
        .maybeSingle();

      confirmedPriceVersion = catalogPlan && finiteAmount(catalogPlan.amount_ars) === amount
        ? positiveVersion(catalogPlan.price_version)
        : null;
    }

    const confirmedMetadata = {
      ...withoutSupersededPreapprovalMetadata(isPendingCheckout
        ? withoutPendingCheckoutMetadata(metadata)
        : isScheduledRenewal
          ? withoutScheduledRenewalMetadata(metadata)
          : metadata),
      last_confirmed_mercadopago_preapproval_id: String(preapprovalId),
      last_confirmed_mercadopago_external_reference: externalReference,
      last_confirmed_plan_code: planCode,
      last_confirmed_payment_at: paidAt,
      last_confirmed_amount_ars: amount,
      last_confirmed_price_version: confirmedPriceVersion,
      ...(previousPreapprovalId && previousPreapprovalId !== String(preapprovalId)
        ? {
          superseded_mercadopago_preapproval_id: previousPreapprovalId,
          superseded_mercadopago_external_reference: previousExternalReference,
        }
        : {}),
    };

    const subscriptionUpdate: Record<string, unknown> = {
      status: 'active',
      current_plan_code: planCode,
      effective_plan_code: planCode,
      billing_plan_code: planCode,
      billing_amount_ars: confirmedBillingAmount,
      billing_price_version: confirmedPriceVersion,
      mercadopago_preapproval_id: String(preapprovalId),
      mercadopago_external_reference: externalReference ?? subscription.mercadopago_external_reference,
      mercadopago_status: 'authorized',
      next_payment_date: nextPaymentDate?.toISOString() ?? null,
      current_period_start: periodStart.toISOString(),
      current_period_end: periodEnd.toISOString(),
      last_payment_at: paidAt,
      metadata: confirmedMetadata,
    };

    if (isPendingCheckout || isScheduledRenewal) {
      subscriptionUpdate.pending_plan_code = null;
    }
    if (isPendingCheckout) {
      subscriptionUpdate.pending_checkout_amount_ars = null;
      subscriptionUpdate.pending_checkout_price_version = null;
    }

    const { data: updatedSubscription, error: subscriptionUpdateError } = await supabaseAdmin
      .from('organization_subscriptions')
      .update(subscriptionUpdate)
      .eq('id', subscription.id)
      .eq('updated_at', subscription.updated_at)
      .select('id')
      .maybeSingle();

    if (subscriptionUpdateError || !updatedSubscription) {
      console.error('[subscription-mp-webhook] approved payment sync failed:', subscriptionUpdateError?.code ?? 'concurrent_change');
      return false;
    }

    if (
      previousPreapprovalId &&
      previousPreapprovalId !== String(preapprovalId) &&
      !(await cancelSupersededPreapproval(
        previousPreapprovalId,
        subscription.organization_id,
        previousExternalReference,
      ))
    ) {
      // The durable metadata marker above makes a retry idempotently finish
      // this cleanup without rolling back the already-authorized payment.
      return false;
    }

  } else if (paymentStatus === 'rejected' || paymentStatus === 'cancelled') {
    const hasCurrentPaidAccess = Boolean(
      subscription.current_plan_code &&
      subscription.current_period_end &&
      Number.isFinite(Date.parse(subscription.current_period_end)) &&
      Date.parse(subscription.current_period_end) > Date.now(),
    );

    const failureUpdate: Record<string, unknown> = {
      status: hasCurrentPaidAccess
        ? (subscription.status === 'active' ? 'active' : subscription.status)
        : 'past_due',
      ...(recordedSupersededPreapprovalId
        ? { metadata: withoutSupersededPreapprovalMetadata(subscriptionMetadata) }
        : {}),
    };

    // A rejected/cancelled authorized-payment is an attempt outcome, not a
    // terminal preapproval state. Keep the immutable pending intent so a later
    // Mercado Pago retry is still resolved to the same plan/amount/version.

    const { data: updatedSubscription, error: subscriptionUpdateError } = await supabaseAdmin
      .from('organization_subscriptions')
      .update(failureUpdate)
      .eq('id', subscription.id)
      .eq('updated_at', subscription.updated_at)
      .select('id')
      .maybeSingle();

    if (subscriptionUpdateError || !updatedSubscription) {
      console.error('[subscription-mp-webhook] failed payment sync failed:', subscriptionUpdateError?.code ?? 'concurrent_change');
      return false;
    }
  }

  if (eventRowId) {
    const { error: eventUpdateError } = await supabaseAdmin
      .from('mercadopago_subscription_events')
      .update({
        organization_id: subscription.organization_id,
        subscription_id: subscription.id,
        payment_id: payment?.id ?? null,
        processed_at: new Date().toISOString(),
      })
      .eq('id', eventRowId);
    if (eventUpdateError) return false;
  }
  return true;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: webhookCorsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const signatureValidation = await validateMpSignature(req);
  if (signatureValidation === 'misconfigured') {
    return jsonResponse({ error: 'Webhook signature validation is not configured' }, 503);
  }
  if (signatureValidation !== 'valid') {
    console.warn('[subscription-mp-webhook] invalid signature');
    return jsonResponse({ error: 'Invalid signature' }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json() as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const topic = eventTopic(payload);
  const action = typeof payload.action === 'string' ? payload.action : null;
  const dataId = payloadDataId(payload, req);
  if (!dataId) {
    return jsonResponse({ error: 'Signed data identifier does not match the payload' }, 400);
  }
  const providerEventId = payload.id ? String(payload.id) : null;
  const supabaseAdmin = createAdminClient();

  const { data: eventRow, error: eventError } = await supabaseAdmin
    .from('mercadopago_subscription_events')
    .insert({
      topic,
      action,
      data_id: dataId,
      provider_event_id: providerEventId,
      payload,
    })
    .select('id')
    .maybeSingle();

  let eventRowId = eventRow?.id ?? null;
  if (eventError?.code === '23505') {
    const existingEvent = await findExistingEvent(
      supabaseAdmin,
      topic,
      action,
      dataId,
      providerEventId,
    );
    if (!existingEvent) {
      return jsonResponse({ error: 'Could not recover webhook event' }, 503);
    }
    if (existingEvent.processed_at) {
      return jsonResponse({ received: true, duplicate: true });
    }
    eventRowId = existingEvent.id;
  } else if (eventError) {
    console.warn('[subscription-mp-webhook] event log insert failed:', eventError.code);
    return jsonResponse({ error: 'Could not persist webhook event' }, 503);
  }

  let synchronized = true;
  try {
    if (dataId && isPreapprovalEvent(topic, action)) {
      synchronized = await syncPreapproval(supabaseAdmin, dataId, eventRowId);
    } else if (dataId && isAuthorizedPaymentEvent(topic, action)) {
      synchronized = await syncAuthorizedPayment(supabaseAdmin, dataId, eventRowId);
    } else if (eventRowId) {
      const { error: ignoredEventError } = await supabaseAdmin
        .from('mercadopago_subscription_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', eventRowId);
      synchronized = !ignoredEventError;
    }
  } catch (err) {
    console.error('[subscription-mp-webhook] sync error:', err instanceof Error ? err.message : 'unknown');
    synchronized = false;
  }

  if (!synchronized) {
    return jsonResponse({ error: 'Webhook synchronization is pending' }, 503);
  }
  return jsonResponse({ received: true });
});
