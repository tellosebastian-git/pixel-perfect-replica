/**
 * Attempts to reactivate a cancelled subscription.
 * If Mercado Pago cannot reactivate it, the client should create a new checkout.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  jsonResponse,
  mpPlatformFetch,
  readMpError,
} from '../_shared/mp-client.ts';
import { getBillingContext } from '../_shared/subscription-billing.ts';

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
      .select('id, status, current_plan_code, effective_plan_code, billing_plan_code, current_period_start, current_period_end, mercadopago_preapproval_id')
      .eq('organization_id', context.organizationId)
      .maybeSingle();

    if (subscriptionError || !subscription) {
      return jsonResponse({ error: 'Suscripcion no encontrada' }, 404);
    }

    if (subscription.status === 'active') {
      return jsonResponse({ ok: true, already_active: true });
    }

    const planCode =
      subscription.current_plan_code ??
      subscription.billing_plan_code ??
      subscription.effective_plan_code ??
      null;

    if (!subscription.mercadopago_preapproval_id || !planCode) {
      return jsonResponse({
        ok: false,
        requires_checkout: true,
        plan_code: planCode,
      }, 409);
    }

    const mpRes = await mpPlatformFetch(`/preapproval/${subscription.mercadopago_preapproval_id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'authorized' }),
    });

    if (!mpRes.ok) {
      const mpError = await readMpError(mpRes);
      console.warn('[subscription-reactivate] MP could not reactivate:', mpRes.status, mpError.payload);
      return jsonResponse({
        ok: false,
        requires_checkout: true,
        plan_code: planCode,
        code: mpError.code,
      }, 409);
    }

    const { error: updateError } = await supabaseAdmin
      .from('organization_subscriptions')
      .update({
        status: 'active',
        cancel_at_period_end: false,
        cancelled_at: null,
        pending_plan_code: null,
        mercadopago_status: 'authorized',
      })
      .eq('id', subscription.id);

    if (updateError) {
      console.error('[subscription-reactivate] update error:', updateError);
      return jsonResponse({ error: 'No se pudo reactivar la suscripcion local' }, 500);
    }

    await supabaseAdmin.from('subscription_plan_changes').insert({
      organization_id: context.organizationId,
      subscription_id: subscription.id,
      from_plan_code: planCode,
      to_plan_code: planCode,
      change_type: 'reactivation',
      requested_by: context.userId,
      effective_at: new Date().toISOString(),
      period_start: subscription.current_period_start,
      period_end: subscription.current_period_end,
      metadata: {
        mercadopago_preapproval_id: subscription.mercadopago_preapproval_id,
      },
    });

    return jsonResponse({ ok: true, status: 'active', plan_code: planCode });
  } catch (err) {
    console.error('[subscription-reactivate] error:', err);
    return jsonResponse({ error: 'Error interno' }, 500);
  }
});
