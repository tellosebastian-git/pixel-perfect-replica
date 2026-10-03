/**
 * Creates a Mercado Pago subscription checkout for Vittro billing.
 *
 * Body: { plan_code: 'basico' | 'profesional' | 'premium' }
 * Response: { init_point, preapproval_id, status, external_reference }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
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
      .select('code, name, amount_ars')
      .eq('code', body.plan_code)
      .eq('is_active', true)
      .maybeSingle();

    if (planError || !plan) {
      return jsonResponse({ error: 'Plan no encontrado' }, 404);
    }

    const { data: existingSubscription } = await supabaseAdmin
      .from('organization_subscriptions')
      .select('id, status, current_plan_code, effective_plan_code, pending_plan_code, current_period_start, current_period_end, mercadopago_status, mercadopago_init_point, mercadopago_preapproval_id, mercadopago_external_reference, metadata')
      .eq('organization_id', context.organizationId)
      .maybeSingle();

    if (
      existingSubscription?.mercadopago_status === 'pending' &&
      existingSubscription.pending_plan_code === plan.code &&
      existingSubscription.mercadopago_init_point
    ) {
      return jsonResponse({
        init_point: existingSubscription.mercadopago_init_point,
        preapproval_id: existingSubscription.mercadopago_preapproval_id,
        status: existingSubscription.mercadopago_status,
        reused: true,
      });
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
        transaction_amount: Number(plan.amount_ars),
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
      console.error('[subscription-create-checkout] MP error:', mpRes.status, mpError.payload);
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
      console.error('[subscription-create-checkout] unexpected MP payload:', preapproval);
      return jsonResponse({ error: 'Mercado Pago no devolvio un checkout valido' }, 502);
    }

    const existingMetadata = isRecord(existingSubscription?.metadata)
      ? existingSubscription.metadata
      : {};
    const shouldPreserveCurrentProviderReference =
      existingSubscription?.status === 'active' &&
      Boolean(existingSubscription.current_plan_code) &&
      Boolean(existingSubscription.mercadopago_preapproval_id) &&
      hasPaidAccess(existingSubscription.current_period_end);

    const metadata: Record<string, unknown> = {
      ...existingMetadata,
      checkout_requested_at: new Date().toISOString(),
      checkout_requested_by: context.userId,
      pending_mercadopago_preapproval_id: preapprovalId,
      pending_mercadopago_external_reference: externalReference,
    };

    if (shouldPreserveCurrentProviderReference) {
      metadata.previous_mercadopago_preapproval_id = existingSubscription?.mercadopago_preapproval_id ?? null;
      metadata.previous_mercadopago_external_reference = existingSubscription?.mercadopago_external_reference ?? null;
    }

    const subscriptionPatch: Record<string, unknown> = {
      organization_id: context.organizationId,
      provider: 'mercadopago',
      pending_plan_code: plan.code,
      mercadopago_init_point: initPoint,
      payer_email: context.userEmail,
      metadata,
    };

    if (!shouldPreserveCurrentProviderReference) {
      subscriptionPatch.mercadopago_preapproval_id = preapprovalId;
      subscriptionPatch.mercadopago_status = mpStatus;
      subscriptionPatch.mercadopago_external_reference = externalReference;
    }

    const { data: savedSubscription, error: saveError } = await supabaseAdmin
      .from('organization_subscriptions')
      .upsert(subscriptionPatch, { onConflict: 'organization_id' })
      .select('id, current_plan_code, current_period_start, current_period_end')
      .maybeSingle();

    if (saveError) {
      console.error('[subscription-create-checkout] save error:', saveError);
      return jsonResponse({ error: 'No se pudo guardar la suscripcion local' }, 500);
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
      amount_ars: Number(plan.amount_ars),
      metadata: {
        mercadopago_preapproval_id: preapprovalId,
        mercadopago_external_reference: externalReference,
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
    });
  } catch (err) {
    console.error('[subscription-create-checkout] error:', err);
    const message = err instanceof Error && err.message.includes('MERCADOPAGO_SUBSCRIPTIONS_ACCESS_TOKEN')
      ? 'Falta configurar el Access Token de Mercado Pago para suscripciones.'
      : 'Error interno';

    return jsonResponse({ error: message }, 500);
  }
});
