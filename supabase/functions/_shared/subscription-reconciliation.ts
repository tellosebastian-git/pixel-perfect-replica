import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { mpPlatformFetch, readMpError } from './mp-client.ts';

const MAX_ATTEMPTS = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function amount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseReference(value: unknown): { organizationId: string } | null {
  const reference = text(value);
  if (!reference) return null;
  const match = reference.match(
    /^sub_([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_(?:basico|profesional|premium)(?:_|$)/i,
  );
  return match ? { organizationId: match[1] } : null;
}

function transient(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function delay(response: Response, attempt: number): Promise<void> {
  const retryAfter = Number(response.headers.get('retry-after'));
  const milliseconds = Number.isFinite(retryAfter) && retryAfter >= 0
    ? Math.min(retryAfter * 1000, 1_500)
    : Math.min(250 * (2 ** Math.max(attempt - 1, 0)), 1_500);
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Restores the exact provider preapproval to the latest committed local intent,
 * or cancels it when it is no longer the active preapproval. The confirming RPC
 * touches the compared subscription revision so a concurrent stale finalizer
 * must lose its own CAS and reconcile instead of committing divergence.
 */
export async function reconcileOwnedPreapproval(
  supabaseAdmin: SupabaseClient,
  input: {
    organizationId: string;
    preapprovalId: string;
    expectedExternalReference: string;
    logPrefix: string;
  },
): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { data: subscription, error: subscriptionError } = await supabaseAdmin
      .from('organization_subscriptions')
      .select('id,updated_at,status,provider,billing_amount_ars,pending_plan_code,pending_checkout_amount_ars,pending_checkout_price_version,mercadopago_preapproval_id,mercadopago_status,metadata')
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (subscriptionError) return false;

    const metadata = isRecord(subscription?.metadata) ? subscription.metadata : {};
    const hasPendingCheckout = Boolean(
      text(metadata.pending_mercadopago_preapproval_id) ||
      subscription?.mercadopago_status === 'pending' ||
      subscription?.pending_checkout_amount_ars != null ||
      subscription?.pending_checkout_price_version != null,
    );
    const shouldRestore = Boolean(
      subscription?.status === 'active' &&
      subscription?.provider === 'mercadopago' &&
      text(subscription?.mercadopago_preapproval_id) === input.preapprovalId,
    );
    const hasScheduledRenewal = Boolean(text(subscription?.pending_plan_code) && !hasPendingCheckout);
    const scheduledAmount = hasScheduledRenewal
      ? amount(metadata.scheduled_renewal_amount_ars)
      : null;
    const desiredAmount = shouldRestore
      ? hasScheduledRenewal
        ? scheduledAmount
        : amount(subscription?.billing_amount_ars)
      : null;
    if (shouldRestore && !desiredAmount) {
      console.error(`[${input.logPrefix}] compensation amount is unavailable`);
      return false;
    }

    let providerRead: Response;
    try {
      providerRead = await mpPlatformFetch(
        `/preapproval/${encodeURIComponent(input.preapprovalId)}`,
      );
    } catch (error) {
      console.warn(`[${input.logPrefix}] compensation read failed:`,
        error instanceof Error ? error.message : 'network_error');
      if (attempt < MAX_ATTEMPTS) continue;
      return false;
    }
    if (providerRead.status === 404 && shouldRestore) {
      console.error(`[${input.logPrefix}] current preapproval is missing during compensation`);
      return false;
    }
    if (!providerRead.ok && providerRead.status !== 404) {
      const providerError = await readMpError(providerRead);
      console.warn(`[${input.logPrefix}] compensation read failed:`, providerRead.status, providerError.code);
      if (transient(providerRead.status) && attempt < MAX_ATTEMPTS) {
        await delay(providerRead, attempt);
        continue;
      }
      return false;
    }

    if (providerRead.ok) {
      const provider = await providerRead.json() as Record<string, unknown>;
      const parsedReference = parseReference(provider.external_reference);
      if (
        String(provider.id ?? '') !== input.preapprovalId ||
        provider.external_reference !== input.expectedExternalReference ||
        parsedReference?.organizationId.toLowerCase() !== input.organizationId.toLowerCase()
      ) {
        console.error(`[${input.logPrefix}] compensation ownership mismatch`);
        return false;
      }

      const providerStatus = text(provider.status)?.toLowerCase();
      const alreadyCancelled = !shouldRestore &&
        (providerStatus === 'cancelled' || providerStatus === 'canceled');
      if (!alreadyCancelled) {
        let providerUpdate: Response;
        try {
          providerUpdate = await mpPlatformFetch(
            `/preapproval/${encodeURIComponent(input.preapprovalId)}`,
            {
              method: 'PUT',
              headers: { 'X-Idempotency-Key': crypto.randomUUID() },
              body: JSON.stringify(shouldRestore
                ? {
                  status: 'authorized',
                  auto_recurring: {
                    transaction_amount: desiredAmount,
                    currency_id: 'ARS',
                  },
                }
                : { status: 'cancelled' }),
            },
          );
        } catch (error) {
          console.warn(`[${input.logPrefix}] compensation update failed:`,
            error instanceof Error ? error.message : 'network_error');
          if (attempt < MAX_ATTEMPTS) continue;
          return false;
        }
        if (providerUpdate.status === 404 && shouldRestore) return false;
        if (!providerUpdate.ok && !(providerUpdate.status === 404 && !shouldRestore)) {
          const providerError = await readMpError(providerUpdate);
          console.warn(`[${input.logPrefix}] compensation update failed:`, providerUpdate.status, providerError.code);
          if (transient(providerUpdate.status) && attempt < MAX_ATTEMPTS) {
            await delay(providerUpdate, attempt);
            continue;
          }
          return false;
        }
      }
    }

    const { data: confirmed, error: confirmationError } = await supabaseAdmin.rpc(
      'subscription_confirm_provider_reconciliation',
      {
        _organization_id: input.organizationId,
        _expected_subscription_id: subscription?.id ?? null,
        _expected_subscription_updated_at: subscription?.updated_at ?? null,
        _preapproval_id: input.preapprovalId,
        _should_cancel: !shouldRestore,
        _expected_amount_ars: desiredAmount,
      },
    );
    if (!confirmationError && confirmed === true) return true;
    if (
      confirmationError?.code === '40001' ||
      confirmationError?.message?.includes('SUBSCRIPTION_CONFLICT') ||
      confirmationError?.message?.includes('RECONCILIATION_INTENT_CHANGED')
    ) {
      continue;
    }
    return false;
  }

  return false;
}
