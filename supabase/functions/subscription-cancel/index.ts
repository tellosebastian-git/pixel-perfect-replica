/**
 * Cancels future subscription renewals.
 * Local access remains available until current_period_end.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  jsonResponse,
  mpErrorMessage,
  mpPlatformFetch,
  readMpError,
} from '../_shared/mp-client.ts';
import { getBillingContext } from '../_shared/subscription-billing.ts';
import { reconcileOwnedPreapproval } from '../_shared/subscription-reconciliation.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseReference(value: unknown): { organizationId: string } | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^sub_([0-9a-fA-F-]{36})_(?:basico|profesional|premium)_/);
  return match ? { organizationId: match[1] } : null;
}

function withoutPendingIntent(value: unknown): Record<string, unknown> {
  const metadata = isRecord(value) ? { ...value } : {};
  delete metadata.pending_mercadopago_preapproval_id;
  delete metadata.pending_mercadopago_external_reference;
  delete metadata.pending_checkout_amount_ars;
  delete metadata.pending_checkout_price_version;
  delete metadata.checkout_requested_at;
  delete metadata.checkout_requested_by;
  delete metadata.previous_mercadopago_preapproval_id;
  delete metadata.previous_mercadopago_external_reference;
  delete metadata.scheduled_renewal_amount_ars;
  delete metadata.scheduled_renewal_price_version;
  return metadata;
}

async function verifyOwnedPreapproval(
  preapprovalId: string,
  externalReference: string,
  organizationId: string,
): Promise<{ status: string } | null> {
  const response = await mpPlatformFetch(`/preapproval/${encodeURIComponent(preapprovalId)}`);
  if (response.status === 404) return { status: 'missing' };
  if (!response.ok) return null;
  const provider = await response.json() as Record<string, unknown>;
  const parsed = parseReference(provider.external_reference);
  if (
    String(provider.id ?? '') !== preapprovalId ||
    provider.external_reference !== externalReference ||
    parsed?.organizationId !== organizationId
  ) return null;
  return { status: String(provider.status ?? '').toLowerCase() };
}

async function cancelOwnedPending(
  preapprovalId: string,
  externalReference: string,
  organizationId: string,
): Promise<boolean> {
  const provider = await verifyOwnedPreapproval(preapprovalId, externalReference, organizationId);
  if (!provider) return false;
  if (provider.status === 'missing') return true;
  if (provider.status === 'cancelled' || provider.status === 'canceled') return true;
  if (provider.status !== 'pending') return false;
  const response = await mpPlatformFetch(`/preapproval/${encodeURIComponent(preapprovalId)}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'cancelled' }),
  });
  return response.ok || response.status === 404;
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
    const { data: subscription, error: subscriptionError } = await supabaseAdmin
      .from('organization_subscriptions')
      .select('id,status,provider,current_plan_code,effective_plan_code,billing_plan_code,billing_amount_ars,current_period_start,current_period_end,mercadopago_preapproval_id,mercadopago_external_reference,metadata,updated_at')
      .eq('organization_id', context.organizationId)
      .maybeSingle();

    if (subscriptionError || !subscription) {
      return jsonResponse({ error: 'Suscripcion no encontrada' }, 404);
    }

    const metadata = isRecord(subscription.metadata) ? subscription.metadata : {};
    const pendingPreapprovalId = typeof metadata.pending_mercadopago_preapproval_id === 'string'
      ? metadata.pending_mercadopago_preapproval_id
      : null;
    const pendingExternalReference = typeof metadata.pending_mercadopago_external_reference === 'string'
      ? metadata.pending_mercadopago_external_reference
      : null;
    const hasSeparatePendingCheckout = Boolean(
      pendingPreapprovalId && pendingPreapprovalId !== subscription.mercadopago_preapproval_id,
    );
    if (subscription.status === 'cancelled' && !hasSeparatePendingCheckout) {
      return jsonResponse({ ok: true, already_cancelled: true });
    }

    if (
      subscription.provider !== 'mercadopago' ||
      !subscription.mercadopago_preapproval_id ||
      !subscription.mercadopago_external_reference
    ) {
      return jsonResponse({ error: 'La suscripcion no tiene una referencia de Mercado Pago' }, 409);
    }

    const cleanedMetadata = withoutPendingIntent(metadata);
    let expectedSubscriptionUpdatedAt = subscription.updated_at;

    if (hasSeparatePendingCheckout && pendingPreapprovalId) {
      if (!pendingExternalReference || !(await cancelOwnedPending(
        pendingPreapprovalId,
        pendingExternalReference,
        context.organizationId,
      ))) {
        return jsonResponse({ error: 'No se pudo invalidar el checkout pendiente' }, 409);
      }

      const currentPlanCode = subscription.effective_plan_code ??
        subscription.current_plan_code ??
        subscription.billing_plan_code ??
        null;
      if (!currentPlanCode) {
        return jsonResponse({ error: 'No se pudo determinar el plan vigente' }, 409);
      }
      const { data: clearedPending, error: clearPendingError } = await supabaseAdmin.rpc(
        'subscription_finalize_pending_plan_cancellation',
        {
          _organization_id: context.organizationId,
          _subscription_id: subscription.id,
          _expected_subscription_updated_at: subscription.updated_at,
          _expected_current_preapproval_id: subscription.mercadopago_preapproval_id,
          _expected_pending_preapproval_id: pendingPreapprovalId,
          _current_plan_code: currentPlanCode,
          _mode: subscription.status === 'cancelled' ? 'reactivation' : 'pending_checkout',
          _expected_billing_amount_ars: subscription.billing_amount_ars,
          _metadata: cleanedMetadata,
        },
      );
      const clearedPendingRow = isRecord(clearedPending) ? clearedPending : null;
      const clearedUpdatedAt = typeof clearedPendingRow?.updated_at === 'string'
        ? clearedPendingRow.updated_at
        : null;
      if (clearPendingError || !clearedUpdatedAt) {
        const compensated = await reconcileOwnedPreapproval(supabaseAdmin, {
          organizationId: context.organizationId,
          preapprovalId: pendingPreapprovalId,
          expectedExternalReference: pendingExternalReference,
          logPrefix: 'subscription-cancel',
        });
        return jsonResponse({
          error: compensated
            ? 'La suscripcion cambio mientras se invalidaba el checkout. Actualiza y reintenta.'
            : 'El checkout pendiente requiere conciliacion manual.',
        }, compensated ? 409 : 502);
      }
      expectedSubscriptionUpdatedAt = clearedUpdatedAt;
    }

    if (subscription.status === 'cancelled') {
      return jsonResponse({ ok: true, already_cancelled: true });
    }

    const ownedCurrent = await verifyOwnedPreapproval(
      subscription.mercadopago_preapproval_id,
      subscription.mercadopago_external_reference,
      context.organizationId,
    );
    if (!ownedCurrent) {
      return jsonResponse({ error: 'La referencia de Mercado Pago no coincide con la suscripcion' }, 409);
    }

    let mpRes: Response;
    try {
      mpRes = await mpPlatformFetch(`/preapproval/${encodeURIComponent(subscription.mercadopago_preapproval_id)}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'cancelled' }),
      });
    } catch {
      const compensated = await reconcileOwnedPreapproval(supabaseAdmin, {
        organizationId: context.organizationId,
        preapprovalId: subscription.mercadopago_preapproval_id,
        expectedExternalReference: subscription.mercadopago_external_reference,
        logPrefix: 'subscription-cancel',
      });
      return jsonResponse({
        error: compensated
          ? 'No se pudo confirmar la cancelacion. Actualiza y reintenta.'
          : 'La cancelacion requiere conciliacion manual con Mercado Pago.',
      }, 502);
    }

    if (!mpRes.ok && mpRes.status !== 404) {
      const mpError = await readMpError(mpRes);
      console.error('[subscription-cancel] MP error:', mpRes.status, mpError.code);
      const compensated = await reconcileOwnedPreapproval(supabaseAdmin, {
        organizationId: context.organizationId,
        preapprovalId: subscription.mercadopago_preapproval_id,
        expectedExternalReference: subscription.mercadopago_external_reference,
        logPrefix: 'subscription-cancel',
      });
      if (!compensated) {
        return jsonResponse({
          error: 'La cancelacion requiere conciliacion manual con Mercado Pago.',
          code: mpError.code,
        }, 502);
      }
      return jsonResponse({
        error: mpErrorMessage(mpError, mpRes.status, 'No se pudo cancelar la suscripcion'),
        code: mpError.code,
      }, mpRes.status >= 500 ? 502 : 422);
    }

    const now = new Date().toISOString();
    const accessUntil = subscription.current_period_end ?? now;

    const { data: updatedSubscription, error: updateError } = await supabaseAdmin.rpc(
      'subscription_finalize_cancellation',
      {
        _organization_id: context.organizationId,
        _subscription_id: subscription.id,
        _expected_subscription_updated_at: expectedSubscriptionUpdatedAt,
        _expected_preapproval_id: subscription.mercadopago_preapproval_id,
        _cancelled_at: now,
        _metadata: cleanedMetadata,
      },
    );

    if (updateError || !updatedSubscription) {
      const compensated = await reconcileOwnedPreapproval(supabaseAdmin, {
        organizationId: context.organizationId,
        preapprovalId: subscription.mercadopago_preapproval_id,
        expectedExternalReference: subscription.mercadopago_external_reference,
        logPrefix: 'subscription-cancel',
      });
      console.error('[subscription-cancel] update error:', updateError?.code ?? 'empty_result');
      return jsonResponse({
        error: compensated
          ? 'La suscripcion cambio durante la cancelacion. Actualiza y reintenta.'
          : 'La cancelacion requiere conciliacion manual con Mercado Pago.',
      }, compensated ? 409 : 502);
    }

    await supabaseAdmin.from('subscription_plan_changes').insert({
      organization_id: context.organizationId,
      subscription_id: subscription.id,
      from_plan_code: subscription.effective_plan_code ?? subscription.current_plan_code,
      to_plan_code: subscription.effective_plan_code ?? subscription.current_plan_code,
      change_type: 'cancel_requested',
      requested_by: context.userId,
      effective_at: accessUntil,
      period_start: subscription.current_period_start,
      period_end: accessUntil,
      metadata: {
        mercadopago_preapproval_id: subscription.mercadopago_preapproval_id,
      },
    });

    return jsonResponse({ ok: true, access_until: accessUntil });
  } catch (err) {
    console.error('[subscription-cancel] error:', err);
    return jsonResponse({ error: 'Error interno' }, 500);
  }
});
