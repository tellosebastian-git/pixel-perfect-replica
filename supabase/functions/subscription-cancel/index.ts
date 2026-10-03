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
      .select('id, status, current_plan_code, effective_plan_code, current_period_start, current_period_end, mercadopago_preapproval_id')
      .eq('organization_id', context.organizationId)
      .maybeSingle();

    if (subscriptionError || !subscription) {
      return jsonResponse({ error: 'Suscripcion no encontrada' }, 404);
    }

    if (subscription.status === 'cancelled') {
      return jsonResponse({ ok: true, already_cancelled: true });
    }

    if (!subscription.mercadopago_preapproval_id) {
      return jsonResponse({ error: 'La suscripcion no tiene una referencia de Mercado Pago' }, 409);
    }

    const mpRes = await mpPlatformFetch(`/preapproval/${subscription.mercadopago_preapproval_id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'cancelled' }),
    });

    if (!mpRes.ok) {
      const mpError = await readMpError(mpRes);
      console.error('[subscription-cancel] MP error:', mpRes.status, mpError.payload);
      return jsonResponse({
        error: mpErrorMessage(mpError, mpRes.status, 'No se pudo cancelar la suscripcion'),
        code: mpError.code,
      }, mpRes.status >= 500 ? 502 : 422);
    }

    const now = new Date().toISOString();
    const accessUntil = subscription.current_period_end ?? now;

    const { error: updateError } = await supabaseAdmin
      .from('organization_subscriptions')
      .update({
        status: 'cancelled',
        cancel_at_period_end: true,
        cancelled_at: now,
        mercadopago_status: 'cancelled',
        current_period_end: accessUntil,
      })
      .eq('id', subscription.id);

    if (updateError) {
      console.error('[subscription-cancel] update error:', updateError);
      return jsonResponse({ error: 'No se pudo actualizar la suscripcion local' }, 500);
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
