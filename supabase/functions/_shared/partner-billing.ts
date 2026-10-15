import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  moneyToCents,
  introAmount,
  paymentEffect,
  type PartnerBillingContext,
} from './partner-domain.ts';
import { PartnerError, partnerBillingEnabled, partnerStore } from './partner-store.ts';
import { mpPlatformFetch } from './mp-client.ts';

export interface PartnerCheckoutQuote {
  id: string;
  amountArs: number;
  catalogAmountArs: number;
  percent: number;
  termsVersion: string;
}
export async function partnerCheckoutQuote(
  client: SupabaseClient,
  actorId: string,
  organizationId: string,
  plan: { code: string; amount_ars: number | string; price_version: number; updated_at: string },
): Promise<PartnerCheckoutQuote | null> {
  if (!partnerBillingEnabled()) return null;
  const result = await partnerStore<{ quote: PartnerCheckoutQuote | null }>(
    client,
    'prepare_checkout',
    actorId,
    {
      organizationId,
      planCode: plan.code,
      catalogAmountArs: plan.amount_ars,
      priceVersion: plan.price_version,
      planUpdatedAt: plan.updated_at,
    },
  );
  if (
    result.quote &&
    (moneyToCents(result.quote.catalogAmountArs) !== moneyToCents(plan.amount_ars) ||
      moneyToCents(result.quote.amountArs) !== introAmount(moneyToCents(plan.amount_ars)) ||
      !result.quote.id ||
      !Number.isInteger(result.quote.percent) ||
      result.quote.percent < 1 ||
      result.quote.percent > 100)
  ) {
    throw new PartnerError('INVALID_QUOTE');
  }
  return result.quote;
}

/** The webhook may have completed billing before this hook fails. Always rerun on duplicates. */
export async function observePartnerEvent(client: SupabaseClient, eventId: string): Promise<void> {
  if (!partnerBillingEnabled()) return;
  await applyPartnerLedger(client, { eventId });
}
export async function historicalPartnerPayment(
  client: SupabaseClient,
  input: {
    organizationId: string;
    authorizedPaymentId: string;
    preapprovalId: string;
    amountArs: number;
    currency: string;
  },
): Promise<boolean> {
  if (!partnerBillingEnabled() || input.currency !== 'ARS') return false;
  const { accepted } = await partnerStore<{ accepted: boolean }>(
    client,
    'historical_intro_payment',
    null,
    input,
  );
  return accepted === true;
}
async function applyPartnerLedger(
  client: SupabaseClient,
  reference: Record<string, unknown>,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { context } = await partnerStore<{ context: PartnerBillingContext | null }>(
      client,
      'billing_context',
      null,
      reference,
    );
    if (!context) return;
    const effect = paymentEffect(context, Date.now());
    try {
      await partnerStore(client, 'apply_billing', null, {
        ...reference,
        revision: context.revision,
        effect,
      });
      return;
    } catch (error) {
      if (!(error instanceof PartnerError) || error.code !== 'REVISION_CONFLICT' || attempt === 2)
        throw error;
    }
  }
}

/** Reversals arrive through ordinary payment notifications, independently of authorized-payments. */
export async function reconcilePartnerPayment(
  client: SupabaseClient,
  paymentId: string,
): Promise<void> {
  if (!partnerBillingEnabled()) return;
  const { payment } = await partnerStore<{
    payment: { id: string; providerId: string; reference: string; amountArs: number } | null;
  }>(client, 'payment_lookup', null, { providerPaymentId: paymentId });
  if (!payment) return; // No reference to barbería POS payments is ever followed.
  const response = await mpPlatformFetch(`/v1/payments/${encodeURIComponent(paymentId)}`);
  if (!response.ok) throw new PartnerError('PROVIDER_UNAVAILABLE', 503);
  const provider = await response.json();
  if (
    String(provider.id) !== payment.providerId ||
    provider.currency_id !== 'ARS' ||
    provider.external_reference !== payment.reference ||
    moneyToCents(provider.transaction_amount) !== moneyToCents(payment.amountArs)
  ) {
    throw new PartnerError('PAYMENT_OWNERSHIP_MISMATCH');
  }
  const allowed = ['approved', 'refunded', 'charged_back', 'cancelled', 'in_process', 'rejected'];
  if (!allowed.includes(provider.status)) throw new PartnerError('UNKNOWN_PAYMENT_STATUS');
  const refundedCents = moneyToCents(provider.transaction_amount_refunded ?? 0);
  if (refundedCents > moneyToCents(payment.amountArs)) throw new PartnerError('INVALID_REFUND');
  await partnerStore(client, 'sync_payment', null, {
    paymentId: payment.id,
    providerPaymentId: paymentId,
    status: provider.status,
    refundedCents,
  });
  await applyPartnerLedger(client, { paymentId: payment.id });
}

/** Claim durable work; reread provider ownership; use the incumbent CAS reconciler for updates. */
export async function processPartnerJobs(
  client: SupabaseClient,
): Promise<{ processed: number; failed: number }> {
  const { jobs } = await partnerStore<{
    jobs: Array<{ id: string; lease: string; kind: string; input: Record<string, string> }>;
  }>(client, 'claim_jobs', null, { limit: 25 });
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      if (job.kind === 'payment')
        await reconcilePartnerPayment(client, job.input.providerPaymentId);
      else if (job.kind === 'ledger')
        await applyPartnerLedger(client, job.input.eventId ? { eventId: job.input.eventId } : { attributionId: job.input.attributionId });
      else if (job.kind === 'renewal') {
        // This transaction changes the local renewal intent to the CURRENT catalog,
        // preserving the historical discounted payment, and validates the live link.
        const { intent } = await partnerStore<{
          intent: {
            organizationId: string;
            preapprovalId: string;
            externalReference: string;
          } | null;
        }>(client, 'prepare_renewal', null, { jobId: job.id, lease: job.lease });
        if (intent) {
          const { reconcileOwnedPreapproval } = await import('./subscription-reconciliation.ts');
          if (
            !(await reconcileOwnedPreapproval(client, {
              organizationId: intent.organizationId,
              preapprovalId: intent.preapprovalId,
              expectedExternalReference: intent.externalReference,
              logPrefix: 'partner-renewal',
            }))
          )
            throw new PartnerError('RENEWAL_PENDING', 503);
        }
      } else if (job.kind === 'instagram') {
        const { refreshPartnerInstagram } = await import('./partner-instagram.ts');
        await refreshPartnerInstagram(client, job.id, job.lease);
      } else throw new PartnerError('UNKNOWN_JOB');
      await partnerStore(client, 'complete_job', null, { jobId: job.id, lease: job.lease });
      processed++;
    } catch {
      failed++;
      // No provider payload, bank account, token or email goes into logs.
      await partnerStore(client, 'retry_job', null, {
        jobId: job.id,
        lease: job.lease,
        code: 'JOB_RETRY',
      });
    }
  }
  return { processed, failed };
}
