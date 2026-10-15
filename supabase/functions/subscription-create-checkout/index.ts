/**
 * Creates a Mercado Pago subscription checkout for Vittro billing.
 *
 * Body: { plan_code: 'basico' | 'profesional' | 'premium' }
 * Response: { init_point, preapproval_id, status, external_reference }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { partnerCheckoutQuote } from '../_shared/partner-billing.ts';
import {
  corsHeaders,
  jsonResponse,
  mpErrorMessage,
  mpPlatformFetch,
  readMpError,
} from '../_shared/mp-client.ts';
import {
  appOrigin,
  getBillingContext,
  isBillingPlanCode,
  sanitizeExternalReference,
} from '../_shared/subscription-billing.ts';

interface CreatePreapprovalPayload {
  reason: string;
  external_reference: string;
  payer_email: string;
  auto_recurring: {
    frequency: number;
    frequency_type: 'months';
    transaction_amount: number;
    currency_id: 'ARS';
  };
  back_url: string;
  status: 'pending';
  notification_url?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasPaidAccess(currentPeriodEnd: string | null | undefined): boolean {
  if (!currentPeriodEnd) return true;
  return new Date(currentPeriodEnd).getTime() > Date.now();
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function sameAmount(left: unknown, right: unknown): boolean {
  const leftAmount = Number(left);
  const rightAmount = Number(right);
  return Number.isFinite(leftAmount) && Number.isFinite(rightAmount) && leftAmount === rightAmount;
}

function pendingPreapprovalId(subscription: Record<string, unknown> | null): string | null {
  if (!subscription) return null;
  const metadata = asRecord(subscription.metadata);
  const metadataId = asNonEmptyString(metadata.pending_mercadopago_preapproval_id);
  if (metadataId) return metadataId;

  return subscription.mercadopago_status === 'pending'
    ? asNonEmptyString(subscription.mercadopago_preapproval_id)
    : null;
}

function pendingExternalReference(subscription: Record<string, unknown> | null): string | null {
  if (!subscription) return null;
  const metadata = asRecord(subscription.metadata);
  return asNonEmptyString(metadata.pending_mercadopago_external_reference) ?? (
    subscription.mercadopago_status === 'pending'
      ? asNonEmptyString(subscription.mercadopago_external_reference)
      : null
  );
}

interface PreapprovalSnapshot {
  state: 'available' | 'missing' | 'unavailable';
  status: string | null;
  amount: number | null;
  currency: string | null;
  externalReference: string | null;
}

async function readPreapproval(preapprovalId: string): Promise<PreapprovalSnapshot> {
  const response = await mpPlatformFetch(`/preapproval/${preapprovalId}`);
  if (response.status === 404) {
    return { state: 'missing', status: null, amount: null, currency: null, externalReference: null };
  }

  if (!response.ok) {
    const error = await readMpError(response);
    console.warn('[subscription-create-checkout] pending checkout verification failed:', response.status, error.code);
    return { state: 'unavailable', status: null, amount: null, currency: null, externalReference: null };
  }

  const payload = await response.json() as Record<string, unknown>;
  const autoRecurring = asRecord(payload.auto_recurring);
  const amount = Number(autoRecurring.transaction_amount);

  return {
    state: 'available',
    status: asNonEmptyString(payload.status)?.toLowerCase() ?? null,
    amount: Number.isFinite(amount) ? amount : null,
    currency: asNonEmptyString(autoRecurring.currency_id),
    externalReference: asNonEmptyString(payload.external_reference),
  };
}

async function invalidatePendingPreapproval(preapprovalId: string): Promise<Response | null> {
  const snapshot = await readPreapproval(preapprovalId);
  if (snapshot.state === 'unavailable') {
    return jsonResponse({ error: 'No pudimos verificar el checkout pendiente. Reintenta en unos segundos.' }, 502);
  }

  if (snapshot.state === 'missing' || snapshot.status === 'cancelled' || snapshot.status === 'canceled') {
    return null;
  }

  if (snapshot.status !== 'pending') {
    return jsonResponse({
      error: 'El checkout pendiente cambio de estado. Actualiza la suscripcion antes de volver a intentar.',
    }, 409);
  }

  const response = await mpPlatformFetch(`/preapproval/${preapprovalId}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'cancelled' }),
  });

  if (!response.ok) {
    const error = await readMpError(response);
    console.warn('[subscription-create-checkout] pending checkout cancellation failed:', response.status, error.code);
    return jsonResponse({ error: 'No pudimos invalidar el checkout anterior. Reintenta en unos segundos.' }, 502);
  }

  return null;
}

async function cancelNewPreapproval(preapprovalId: string): Promise<void> {
  const response = await mpPlatformFetch(`/preapproval/${preapprovalId}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'cancelled' }),
  });

  if (!response.ok) {
    const error = await readMpError(response);
    console.warn('[subscription-create-checkout] orphan checkout cancellation failed:', response.status, error.code);
  }
}

async function createMercadoPagoPreapproval(payload: CreatePreapprovalPayload) {
  let mpRes = await mpPlatformFetch('/preapproval', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (mpRes.ok || !payload.notification_url) {
    return mpRes;
  }

  const firstError = await readMpError(mpRes);
  const mayRetryWithoutNotificationUrl =
    mpRes.status === 400 ||
    mpRes.status === 422 ||
    firstError.code === 'unsupported_properties' ||
    firstError.code === 'invalid_payload';

  if (!mayRetryWithoutNotificationUrl) {
    return new Response(JSON.stringify(firstError.payload), {
      status: mpRes.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const retryPayload = { ...payload };
  delete retryPayload.notification_url;

  mpRes = await mpPlatformFetch('/preapproval', {
    method: 'POST',
    body: JSON.stringify(retryPayload),
  });

  return mpRes;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const { supabaseAdmin, context, error } = await getBillingContext(req);
  if (error) return error;

  try {
    const body = await req.json() as { plan_code?: unknown };
    if (!isBillingPlanCode(body.plan_code)) {
      return jsonResponse({ error: 'plan_code invalido' }, 400);
    }

    if (!context.userEmail) {
      return jsonResponse({ error: 'El usuario no tiene email para asociar al pago' }, 400);
    }

    const { data: plan, error: planError } = await supabaseAdmin
      .from('subscription_plans')
      .select('code, name, amount_ars, price_version, updated_at')
      .eq('code', body.plan_code)
      .eq('is_active', true)
      .maybeSingle();

    if (planError || !plan) {
      return jsonResponse({ error: 'Plan no encontrado' }, 404);
    }

    const catalogPlanAmount = Number(plan.amount_ars);
    const planPriceVersion = Number(plan.price_version);
    if (
      !Number.isFinite(catalogPlanAmount) ||
      catalogPlanAmount <= 0 ||
      !Number.isInteger(planPriceVersion) ||
      planPriceVersion < 1
    ) {
      console.error('[subscription-create-checkout] invalid catalog price:', plan.code);
      return jsonResponse({ error: 'El precio del plan no esta disponible' }, 409);
    }

    const { data: existingSubscription, error: subscriptionError } = await supabaseAdmin
      .from('organization_subscriptions')
      .select('id, status, current_plan_code, effective_plan_code, pending_plan_code, current_period_start, current_period_end, billing_amount_ars, billing_price_version, pending_checkout_amount_ars, pending_checkout_price_version, mercadopago_status, mercadopago_init_point, mercadopago_preapproval_id, mercadopago_external_reference, metadata, updated_at')
      .eq('organization_id', context.organizationId)
      .maybeSingle();

    if (subscriptionError) {
      console.error('[subscription-create-checkout] subscription query error:', subscriptionError.code);
      return jsonResponse({ error: 'No se pudo cargar la suscripcion local' }, 500);
    }

    const partnerQuote = await partnerCheckoutQuote(supabaseAdmin, context.userId, context.organizationId, plan);
    const planAmount = partnerQuote?.amountArs ?? catalogPlanAmount;
    const previousPendingPreapprovalId = pendingPreapprovalId(existingSubscription);
    const previousPendingExternalReference = pendingExternalReference(existingSubscription);
    const shouldPreserveCurrentProviderReference =
      existingSubscription?.status === 'active' &&
      Boolean(existingSubscription.current_plan_code) &&
      Boolean(existingSubscription.mercadopago_preapproval_id) &&
      hasPaidAccess(existingSubscription.current_period_end);
    const localCheckoutMatches = Boolean(
      existingSubscription &&
      previousPendingPreapprovalId &&
      existingSubscription.mercadopago_init_point &&
      existingSubscription.pending_plan_code === plan.code &&
      (!partnerQuote || asRecord(existingSubscription.metadata).pending_partner_quote_id === partnerQuote.id) &&
      sameAmount(existingSubscription.pending_checkout_amount_ars, planAmount) &&
      Number(existingSubscription.pending_checkout_price_version) === planPriceVersion
    );

    if (localCheckoutMatches && previousPendingPreapprovalId) {
      const snapshot = await readPreapproval(previousPendingPreapprovalId);
      if (snapshot.state === 'unavailable') {
        return jsonResponse({ error: 'No pudimos verificar el checkout pendiente. Reintenta en unos segundos.' }, 502);
      }

      const providerCheckoutMatches =
        snapshot.state === 'available' &&
        snapshot.status === 'pending' &&
        sameAmount(snapshot.amount, planAmount) &&
        (!snapshot.currency || snapshot.currency === 'ARS') &&
        (!previousPendingExternalReference || snapshot.externalReference === previousPendingExternalReference);

      if (providerCheckoutMatches) {
        return jsonResponse({
          init_point: existingSubscription?.mercadopago_init_point,
          preapproval_id: previousPendingPreapprovalId,
          status: snapshot.status,
          amount_ars: planAmount,
          price_version: planPriceVersion,
          reused: true,
        });
      }
    }

    if (previousPendingPreapprovalId) {
      const invalidationError = await invalidatePendingPreapproval(previousPendingPreapprovalId);
      if (invalidationError) return invalidationError;
    }

    const previousCurrentPreapprovalId = asNonEmptyString(existingSubscription?.mercadopago_preapproval_id);
    if (
      !shouldPreserveCurrentProviderReference &&
      previousCurrentPreapprovalId &&
      previousCurrentPreapprovalId !== previousPendingPreapprovalId
    ) {
      const invalidationError = await invalidatePendingPreapproval(previousCurrentPreapprovalId);
      if (invalidationError) return invalidationError;
    }

    const origin = appOrigin(req);
    const externalReference = sanitizeExternalReference(
      `sub_${context.organizationId}_${plan.code}_${crypto.randomUUID()}`,
    );
    const notificationUrl =
      Deno.env.get('MERCADOPAGO_SUBSCRIPTION_WEBHOOK_URL') ||
      (Deno.env.get('SUPABASE_URL')
        ? `${Deno.env.get('SUPABASE_URL')}/functions/v1/subscription-mp-webhook`
        : undefined);

    const preapprovalPayload: CreatePreapprovalPayload = {
      reason: `Vittro - Plan ${plan.name}`,
      external_reference: externalReference,
      payer_email: context.userEmail,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: planAmount,
        currency_id: 'ARS',
      },
      back_url: `${origin}/app/${context.organizationSlug}?billing=return`,
      status: 'pending',
    };

    if (notificationUrl) {
      preapprovalPayload.notification_url = notificationUrl;
    }

    const mpRes = await createMercadoPagoPreapproval(preapprovalPayload);

    if (!mpRes.ok) {
      const mpError = await readMpError(mpRes);
      console.error('[subscription-create-checkout] MP error:', mpRes.status, mpError.code);
      return jsonResponse({
        error: mpErrorMessage(mpError, mpRes.status, 'No se pudo crear la suscripcion'),
        code: mpError.code,
      }, mpRes.status >= 500 ? 502 : 422);
    }

    const preapproval = await mpRes.json();
    const preapprovalId = preapproval.id as string;
    const initPoint = (preapproval.init_point ?? preapproval.sandbox_init_point) as string | undefined;
    const mpStatus = (preapproval.status as string | undefined) ?? 'pending';

    if (!preapprovalId || !initPoint) {
      if (preapprovalId) await cancelNewPreapproval(preapprovalId);
      console.error('[subscription-create-checkout] MP response missing required checkout fields');
      return jsonResponse({ error: 'Mercado Pago no devolvio un checkout valido' }, 502);
    }

    const existingMetadata = isRecord(existingSubscription?.metadata)
      ? existingSubscription.metadata
      : {};
    const metadata: Record<string, unknown> = {
      ...existingMetadata,
      checkout_requested_at: new Date().toISOString(),
      checkout_requested_by: context.userId,
      pending_mercadopago_preapproval_id: preapprovalId,
      pending_mercadopago_external_reference: externalReference,
      pending_checkout_amount_ars: planAmount,
      pending_checkout_price_version: planPriceVersion,
      pending_partner_quote_id: partnerQuote?.id ?? null,
    };

    if (shouldPreserveCurrentProviderReference) {
      metadata.previous_mercadopago_preapproval_id = existingSubscription?.mercadopago_preapproval_id ?? null;
      metadata.previous_mercadopago_external_reference = existingSubscription?.mercadopago_external_reference ?? null;
    }

    const { data: savedData, error: saveError } = await supabaseAdmin.rpc(
      partnerQuote ? 'partner_finalize_checkout' : 'subscription_finalize_checkout',
      {
        ...(partnerQuote ? { _partner_quote_id: partnerQuote.id, _expected_catalog_amount_ars: catalogPlanAmount } : {}),
        _organization_id: context.organizationId,
        _plan_code: plan.code,
        _expected_amount_ars: planAmount,
        _expected_price_version: planPriceVersion,
        _expected_plan_updated_at: plan.updated_at,
        _existing_subscription_id: existingSubscription?.id ?? null,
        _expected_subscription_updated_at: existingSubscription?.updated_at ?? null,
        _preapproval_id: preapprovalId,
        _external_reference: externalReference,
        _init_point: initPoint,
        _payer_email: context.userEmail,
        _provider_status: mpStatus,
        _metadata: metadata,
        _preserve_current_provider: shouldPreserveCurrentProviderReference,
      },
    );
    const savedSubscription = isRecord(savedData) ? savedData : null;

    if (saveError || !savedSubscription) {
      await cancelNewPreapproval(preapprovalId);
      const conflict = saveError?.code === '40001' ||
        saveError?.message?.includes('CATALOG_CONFLICT') ||
        saveError?.message?.includes('SUBSCRIPTION_CONFLICT');
      console.error('[subscription-create-checkout] finalize error:', saveError?.code ?? 'empty_result');
      return jsonResponse({
        error: conflict
          ? 'El precio o la suscripcion cambiaron mientras se creaba el checkout. Actualiza y volve a intentar.'
          : 'No se pudo guardar la suscripcion local',
      }, conflict ? 409 : 500);
    }

    const changeType = existingSubscription?.current_plan_code
      ? existingSubscription.current_plan_code === plan.code
        ? 'renewal'
        : 'upgrade'
      : 'initial_selection';

    await supabaseAdmin.from('subscription_plan_changes').insert({
      organization_id: context.organizationId,
      subscription_id: savedSubscription?.id ?? existingSubscription?.id ?? null,
      from_plan_code: savedSubscription?.current_plan_code ?? null,
      to_plan_code: plan.code,
      change_type: changeType,
      requested_by: context.userId,
      effective_at: null,
      period_start: savedSubscription?.current_period_start ?? null,
      period_end: savedSubscription?.current_period_end ?? null,
      amount_ars: planAmount,
      metadata: {
        mercadopago_preapproval_id: preapprovalId,
        mercadopago_external_reference: externalReference,
        price_version: planPriceVersion,
        previous_mercadopago_preapproval_id: shouldPreserveCurrentProviderReference
          ? existingSubscription?.mercadopago_preapproval_id ?? null
          : null,
      },
    });

    return jsonResponse({
      init_point: initPoint,
      preapproval_id: preapprovalId,
      status: mpStatus,
      external_reference: externalReference,
      amount_ars: planAmount,
      price_version: planPriceVersion,
    });
  } catch (err) {
    console.error('[subscription-create-checkout] error:', err);
    const message = err instanceof Error && err.message.includes('MERCADOPAGO_SUBSCRIPTIONS_ACCESS_TOKEN')
      ? 'Falta configurar el Access Token de Mercado Pago para suscripciones.'
      : 'Error interno';

    return jsonResponse({ error: message }, 500);
  }
});
