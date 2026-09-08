/**
 * Changes the active subscription plan.
 *
 * Upgrade: requires a Mercado Pago checkout and is applied after payment confirmation.
 * Downgrade: stores pending_plan_code and applies after current_period_end.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  jsonResponse,
  mpPlatformFetch,
  readMpError,
} from '../_shared/mp-client.ts';
import {
  getBillingContext,
  isBillingPlanCode,
} from '../_shared/subscription-billing.ts';
import { reconcileOwnedPreapproval } from '../_shared/subscription-reconciliation.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseSubscriptionExternalReference(value: unknown): {
  organizationId: string;
  planCode: string;
} | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^sub_([0-9a-fA-F-]{36})_(basico|profesional|premium)_/);
  return match ? { organizationId: match[1], planCode: match[2] } : null;
}

type OwnedPreapproval = {
  id: string;
  status: string;
  external_reference: string;
};

async function loadOwnedPreapproval(
  preapprovalId: string,
  organizationId: string,
  expectedExternalReference: string,
): Promise<{ preapproval: OwnedPreapproval | null; error: Response | null }> {
  const currentResponse = await mpPlatformFetch(`/preapproval/${encodeURIComponent(preapprovalId)}`);
  if (!currentResponse.ok) {
    const providerError = await readMpError(currentResponse);
    console.warn('[subscription-change-plan] preapproval verification failed:', currentResponse.status, providerError.code);
    return {
      preapproval: null,
      error: jsonResponse({ error: 'No pudimos verificar la suscripcion en Mercado Pago' }, 502),
    };
  }

  const current = await currentResponse.json() as Record<string, unknown>;
  const parsedReference = parseSubscriptionExternalReference(current.external_reference);
  if (
    String(current.id ?? '') !== preapprovalId ||
    !parsedReference ||
    parsedReference.organizationId !== organizationId ||
    current.external_reference !== expectedExternalReference
  ) {
    console.error('[subscription-change-plan] preapproval ownership mismatch');
    return {
      preapproval: null,
      error: jsonResponse({ error: 'La referencia de Mercado Pago no coincide con la suscripcion' }, 409),
    };
  }

  return {
    preapproval: {
      id: preapprovalId,
      status: String(current.status ?? '').toLowerCase(),
      external_reference: String(current.external_reference),
    },
    error: null,
  };
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

async function cancelPendingCheckout(
  preapprovalId: string,
  organizationId: string,
  expectedExternalReference: string,
): Promise<Response | null> {
  const { preapproval, error } = await loadOwnedPreapproval(
    preapprovalId,
    organizationId,
    expectedExternalReference,
  );
  if (error) return error;

  const status = preapproval?.status;
  if (status === 'cancelled' || status === 'canceled') return null;
  if (status !== 'pending') {
    return jsonResponse({
      error: 'El checkout pendiente cambio de estado. Actualiza la suscripcion antes de continuar.',
    }, 409);
  }

  const cancelResponse = await mpPlatformFetch(`/preapproval/${encodeURIComponent(preapprovalId)}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'cancelled' }),
  });

  if (!cancelResponse.ok) {
    const providerError = await readMpError(cancelResponse);
    console.warn('[subscription-change-plan] pending checkout cancellation failed:', cancelResponse.status, providerError.code);
    return jsonResponse({ error: 'No pudimos invalidar el checkout pendiente' }, 502);
  }

  return null;
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

    const { data: subscription, error: subscriptionError } = await supabaseAdmin
      .from('organization_subscriptions')
      .select('id, status, provider, current_plan_code, effective_plan_code, pending_plan_code, billing_plan_code, billing_amount_ars, billing_price_version, current_period_start, current_period_end, mercadopago_preapproval_id, mercadopago_external_reference, mercadopago_init_point, metadata, updated_at')
      .eq('organization_id', context.organizationId)
      .maybeSingle();

    if (subscriptionError || !subscription) {
      return jsonResponse({ error: 'Suscripcion no encontrada' }, 404);
    }

    if (subscription.status !== 'active') {
      return jsonResponse({
        error: 'Para cambiar de plan primero se necesita una suscripcion activa',
        requires_checkout: true,
      }, 409);
    }

    const planCodes = [
      subscription.effective_plan_code,
      subscription.current_plan_code,
      body.plan_code,
    ].filter(Boolean);

    const { data: plans, error: plansError } = await supabaseAdmin
      .from('subscription_plans')
      .select('code, name, amount_ars, price_version, sort_order, is_active, updated_at')
      .in('code', planCodes);

    if (plansError || !plans) {
      return jsonResponse({ error: 'No se pudieron cargar los planes' }, 500);
    }

    const planByCode = new Map(
      (plans as Array<{ code: string; name: string; amount_ars: number; price_version: number; sort_order: number; is_active: boolean; updated_at: string }>)
        .map((plan) => [plan.code, plan]),
    );

    const fromPlanCode = subscription.effective_plan_code ?? subscription.current_plan_code;
    const fromPlan = fromPlanCode ? planByCode.get(fromPlanCode) : null;
    const toPlan = planByCode.get(body.plan_code);

    if (!toPlan) {
      return jsonResponse({ error: 'Plan no encontrado' }, 404);
    }

    if (!toPlan.is_active) {
      return jsonResponse({ error: 'El plan seleccionado no esta disponible' }, 409);
    }

    if (!fromPlan) {
      return jsonResponse({
        error: 'No hay un plan activo para cambiar',
        requires_checkout: true,
      }, 409);
    }

    const metadata = isRecord(subscription.metadata) ? subscription.metadata : {};
    const pendingPreapprovalId = typeof metadata.pending_mercadopago_preapproval_id === 'string'
      ? metadata.pending_mercadopago_preapproval_id
      : null;
    const pendingExternalReference = typeof metadata.pending_mercadopago_external_reference === 'string'
      ? metadata.pending_mercadopago_external_reference
      : null;

    if (fromPlan.code === toPlan.code) {
      if (!subscription.pending_plan_code) {
        return jsonResponse({ ok: true, unchanged: true });
      }

      const cleanedMetadata = withoutPendingCheckoutMetadata(metadata);
      delete cleanedMetadata.scheduled_renewal_amount_ars;
      delete cleanedMetadata.scheduled_renewal_price_version;
      const hasSeparatePendingCheckout = Boolean(
        pendingPreapprovalId &&
        pendingPreapprovalId !== subscription.mercadopago_preapproval_id,
      );

      if (hasSeparatePendingCheckout && pendingPreapprovalId) {
        if (!pendingExternalReference) {
          return jsonResponse({ error: 'El checkout pendiente no tiene una referencia verificable' }, 409);
        }
        const cancellationError = await cancelPendingCheckout(
          pendingPreapprovalId,
          context.organizationId,
          pendingExternalReference,
        );
        if (cancellationError) return cancellationError;

        const { data: cleared, error: clearError } = await supabaseAdmin.rpc(
          'subscription_finalize_pending_plan_cancellation',
          {
            _organization_id: context.organizationId,
            _subscription_id: subscription.id,
            _expected_subscription_updated_at: subscription.updated_at,
            _expected_current_preapproval_id: subscription.mercadopago_preapproval_id,
            _expected_pending_preapproval_id: pendingPreapprovalId,
            _current_plan_code: fromPlan.code,
            _mode: 'pending_checkout',
            _expected_billing_amount_ars: subscription.billing_amount_ars,
            _metadata: cleanedMetadata,
          },
        );
        if (clearError || !cleared) {
          const compensated = await reconcileOwnedPreapproval(supabaseAdmin, {
            organizationId: context.organizationId,
            preapprovalId: pendingPreapprovalId,
            expectedExternalReference: pendingExternalReference,
            logPrefix: 'subscription-change-plan',
          });
          return jsonResponse({
            error: compensated
              ? 'La suscripcion cambio mientras se invalidaba el checkout. Actualiza y reintenta.'
              : 'El checkout se invalido y Mercado Pago requiere conciliacion manual.',
          }, compensated ? 409 : 502);
        }

        return jsonResponse({ ok: true, change_type: 'pending_change_cancelled' });
      }

      const currentAmount = Number(subscription.billing_amount_ars);
      if (
        subscription.provider !== 'mercadopago' ||
        !subscription.mercadopago_preapproval_id ||
        !subscription.mercadopago_external_reference ||
        !Number.isFinite(currentAmount) ||
        currentAmount <= 0
      ) {
        return jsonResponse({ error: 'No se puede restaurar el plan vigente sin un checkout nuevo' }, 409);
      }
      const { preapproval: currentPreapproval, error: currentVerificationError } = await loadOwnedPreapproval(
        subscription.mercadopago_preapproval_id,
        context.organizationId,
        subscription.mercadopago_external_reference,
      );
      if (currentVerificationError) return currentVerificationError;
      if (!currentPreapproval || !['authorized', 'active'].includes(currentPreapproval.status)) {
        return jsonResponse({ error: 'La suscripcion de Mercado Pago ya no esta activa' }, 409);
      }

      const restoreResponse = await mpPlatformFetch(
        `/preapproval/${encodeURIComponent(subscription.mercadopago_preapproval_id)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            auto_recurring: { transaction_amount: currentAmount, currency_id: 'ARS' },
          }),
        },
      );
      if (!restoreResponse.ok) {
        const providerError = await readMpError(restoreResponse);
        console.warn('[subscription-change-plan] scheduled cancellation failed:', restoreResponse.status, providerError.code);
        return jsonResponse({ error: 'No pudimos restaurar el importe del plan vigente' }, 502);
      }

      const { data: cleared, error: clearError } = await supabaseAdmin.rpc(
        'subscription_finalize_pending_plan_cancellation',
        {
          _organization_id: context.organizationId,
          _subscription_id: subscription.id,
          _expected_subscription_updated_at: subscription.updated_at,
          _expected_current_preapproval_id: subscription.mercadopago_preapproval_id,
          _expected_pending_preapproval_id: null,
          _current_plan_code: fromPlan.code,
          _mode: 'scheduled_downgrade',
          _expected_billing_amount_ars: currentAmount,
          _metadata: cleanedMetadata,
        },
      );
      if (clearError || !cleared) {
        const compensated = await reconcileOwnedPreapproval(supabaseAdmin, {
          organizationId: context.organizationId,
          preapprovalId: subscription.mercadopago_preapproval_id,
          expectedExternalReference: subscription.mercadopago_external_reference,
          logPrefix: 'subscription-change-plan',
        });
        console.error('[subscription-change-plan] scheduled cancellation local conflict:', clearError?.code ?? 'empty_result');
        return jsonResponse({
          error: compensated
            ? 'La suscripcion cambio mientras se restauraba el plan. Actualiza y reintenta.'
            : 'La suscripcion cambio y Mercado Pago requiere conciliacion manual.',
        }, compensated ? 409 : 502);
      }

      return jsonResponse({ ok: true, change_type: 'pending_change_cancelled' });
    }

    const isUpgrade = toPlan.sort_order > fromPlan.sort_order;
    const isDowngrade = toPlan.sort_order < fromPlan.sort_order;

    if (!isUpgrade && !isDowngrade) {
      return jsonResponse({ ok: true, unchanged: true });
    }

    if (isDowngrade) {
      if (pendingPreapprovalId && pendingPreapprovalId !== subscription.mercadopago_preapproval_id) {
        if (!subscription.pending_plan_code || !pendingExternalReference) {
          return jsonResponse({ error: 'El checkout pendiente no tiene una referencia verificable' }, 409);
        }
        const cancellationError = await cancelPendingCheckout(
          pendingPreapprovalId,
          context.organizationId,
          pendingExternalReference,
        );
        if (cancellationError) return cancellationError;
      }

      const targetAmount = Number(toPlan.amount_ars);
      const targetPriceVersion = Number(toPlan.price_version);
      if (
        subscription.provider !== 'mercadopago' ||
        !subscription.mercadopago_preapproval_id ||
        !Number.isFinite(targetAmount) ||
        targetAmount <= 0 ||
        !Number.isInteger(targetPriceVersion) ||
        targetPriceVersion < 1
      ) {
        return jsonResponse({
          error: 'El cambio requiere un nuevo checkout',
          requires_checkout: true,
        }, 409);
      }

      if (!subscription.mercadopago_external_reference) {
        return jsonResponse({ error: 'La suscripcion no tiene una referencia verificable' }, 409);
      }
      const { preapproval: currentPreapproval, error: verificationError } = await loadOwnedPreapproval(
        subscription.mercadopago_preapproval_id,
        context.organizationId,
        subscription.mercadopago_external_reference,
      );
      if (verificationError) return verificationError;
      if (!currentPreapproval || !['authorized', 'active'].includes(currentPreapproval.status)) {
        return jsonResponse({
          error: 'La suscripcion de Mercado Pago no esta activa. Se necesita un nuevo checkout.',
          requires_checkout: true,
        }, 409);
      }

      const providerUpdate = await mpPlatformFetch(
        `/preapproval/${encodeURIComponent(subscription.mercadopago_preapproval_id)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            auto_recurring: {
              transaction_amount: targetAmount,
              currency_id: 'ARS',
            },
          }),
        },
      );
      if (!providerUpdate.ok) {
        const providerError = await readMpError(providerUpdate);
        console.warn('[subscription-change-plan] scheduled price update failed:', providerUpdate.status, providerError.code);
        return jsonResponse({ error: 'No pudimos programar el importe del proximo periodo' }, 502);
      }

      const scheduledMetadata = {
        ...withoutPendingCheckoutMetadata(metadata),
        scheduled_renewal_amount_ars: targetAmount,
        scheduled_renewal_price_version: targetPriceVersion,
      };

      const { data: updatedSubscription, error: updateError } = await supabaseAdmin.rpc(
        'subscription_finalize_scheduled_plan_change',
        {
          _organization_id: context.organizationId,
          _subscription_id: subscription.id,
          _expected_subscription_updated_at: subscription.updated_at,
          _expected_preapproval_id: subscription.mercadopago_preapproval_id,
          _from_plan_code: fromPlan.code,
          _to_plan_code: toPlan.code,
          _expected_amount_ars: targetAmount,
          _expected_price_version: targetPriceVersion,
          _expected_plan_updated_at: toPlan.updated_at,
          _metadata: scheduledMetadata,
        },
      );

      if (updateError || !updatedSubscription) {
        const compensated = await reconcileOwnedPreapproval(supabaseAdmin, {
          organizationId: context.organizationId,
          preapprovalId: subscription.mercadopago_preapproval_id,
          expectedExternalReference: subscription.mercadopago_external_reference,
          logPrefix: 'subscription-change-plan',
        });
        console.error('[subscription-change-plan] downgrade update error:', updateError?.code ?? 'concurrent_change');
        const conflict = updateError?.code === '40001' ||
          updateError?.message?.includes('CATALOG_CONFLICT') ||
          updateError?.message?.includes('SUBSCRIPTION_CONFLICT');
        return jsonResponse({
          error: conflict && compensated
            ? 'El precio o la suscripcion cambiaron mientras se programaba la baja. Actualiza y reintenta.'
            : 'No se pudo programar la baja y Mercado Pago requiere conciliacion.',
        }, conflict && compensated ? 409 : 502);
      }

      await supabaseAdmin.from('subscription_plan_changes').insert({
        organization_id: context.organizationId,
        subscription_id: subscription.id,
        from_plan_code: fromPlan.code,
        to_plan_code: toPlan.code,
        change_type: 'downgrade',
        requested_by: context.userId,
        effective_at: subscription.current_period_end,
        period_start: subscription.current_period_start,
        period_end: subscription.current_period_end,
        amount_ars: targetAmount,
        metadata: {
          price_version: targetPriceVersion,
        },
      });

      return jsonResponse({
        ok: true,
        change_type: 'downgrade',
        pending_plan_code: toPlan.code,
        effective_at: subscription.current_period_end,
      });
    }

    return jsonResponse({
      ok: true,
      change_type: 'upgrade',
      plan_code: toPlan.code,
      requires_checkout: true,
    });
  } catch (err) {
    console.error('[subscription-change-plan] error:', err);
    return jsonResponse({ error: 'Error interno' }, 500);
  }
});
