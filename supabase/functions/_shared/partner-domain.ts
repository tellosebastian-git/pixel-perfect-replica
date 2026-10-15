/** Environment-free rules shared by the API and its executable contract tests. */
export const PARTNER_TERMS_VERSION = '2026-10-14-v2';
export const PARTNER_CONTRACT_VERSION = 1;
export const PARTNER_HOLD_MS = 30 * 24 * 60 * 60 * 1000;
export type PartnerRate = 10 | 20 | 30;
export type CommissionStatus = 'pending' | 'available' | 'held' | 'paid' | 'reversed';

export interface PartnerAgreement {
  percent: number;
  startsAt: string;
  endsAt: string;
  suspended: boolean;
}
export interface PartnerTier {
  percent: number;
  source: 'initial' | 'results' | 'agreement';
  qualifiedOrganizations: number;
  nextGoal: number | null;
}
export interface PartnerSummary {
  id: string;
  name: string;
  code: string;
  tier: PartnerTier;
  registrations: number;
  pendingCents: number;
  availableCents: number;
  paidCents: number;
  adjustmentsCents: number;
  instagram: {
    connected: boolean;
    username: string | null;
    followers: number | null;
    verifiedAt: string | null;
  };
  payout: { configured: boolean; verified: boolean; lastFour: string | null };
  commissions: Array<{
    id: string;
    amountCents: number;
    status: CommissionStatus;
    createdAt: string;
    availableAt: string;
  }>;
}
export interface PartnerProgramStatus {
  enabled: boolean;
  instagramEnabled: boolean;
  termsVersion: string;
}

export function moneyToCents(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('INVALID_AMOUNT');
  const match = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('INVALID_AMOUNT');
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('INVALID_AMOUNT');
  return cents;
}
export function percentOf(cents: number, percent: number): number {
  if (
    !Number.isSafeInteger(cents) ||
    cents < 0 ||
    !Number.isInteger(percent) ||
    percent < 0 ||
    percent > 100
  ) {
    throw new Error('INVALID_PERCENT_AMOUNT');
  }
  // BigInt prevents intermediate multiplication from losing centavo precision.
  return Number((BigInt(cents) * BigInt(percent) + 50n) / 100n);
}
export function introAmount(cents: number): number {
  return cents - percentOf(cents, 10);
}
export function normalizePartnerCode(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_CODE');
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,20}$/.test(code) || ['VITTRO', 'ADMIN', 'SUPPORT', 'SOPORTE'].includes(code)) {
    throw new Error('INVALID_CODE');
  }
  return code;
}
export function partnerTier(
  input: {
    qualifiedOrganizations: number;
    /** Legacy metadata is ignored; automatic levels depend only on referrals. */
    instagram?: unknown;
    agreement?: PartnerAgreement | null;
  },
  nowMs: number,
): PartnerTier {
  const count = input.qualifiedOrganizations;
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(nowMs))
    throw new Error('INVALID_TIER_INPUT');
  const results: PartnerRate = count >= 20 ? 30 : count >= 5 ? 20 : 10;
  const agreement = input.agreement;
  if (
    agreement &&
    !agreement.suspended &&
    Number.isInteger(agreement.percent) &&
    agreement.percent >= 1 &&
    agreement.percent <= 100 &&
    Date.parse(agreement.startsAt) <= nowMs &&
    nowMs < Date.parse(agreement.endsAt)
  ) {
    return {
      percent: agreement.percent,
      source: 'agreement',
      qualifiedOrganizations: count,
      nextGoal: null,
    };
  }
  const percent = results;
  return {
    percent,
    source: count >= 5 ? 'results' : 'initial',
    qualifiedOrganizations: count,
    nextGoal: percent >= 30 ? null : percent === 20 ? 20 : 5,
  };
}

export function validatePayoutDetails(input: {
  holder: unknown;
  taxId: unknown;
  account: unknown;
}) {
  const holder = typeof input.holder === 'string' ? input.holder.trim() : '';
  const taxId = typeof input.taxId === 'string' ? input.taxId.replace(/[-\s]/g, '') : '';
  const account = typeof input.account === 'string' ? input.account.replace(/\s/g, '') : '';
  if (holder.length < 3 || holder.length > 80) throw new Error('INVALID_HOLDER');
  if (!/^\d{11}$/.test(taxId)) throw new Error('INVALID_TAX_ID');
  const sum = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2].reduce(
    (total, weight, index) => total + Number(taxId[index]) * weight,
    0,
  );
  const digit = 11 - (sum % 11);
  if (Number(taxId[10]) !== (digit === 11 ? 0 : digit === 10 ? 9 : digit))
    throw new Error('INVALID_TAX_ID');
  if (!/^\d{22}$/.test(account) || /^0+$/.test(account)) throw new Error('INVALID_ACCOUNT');
  const checksum = (digits: string, weights: number[]) =>
    (10 -
      (weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0) % 10)) %
    10;
  if (
    checksum(account.slice(0, 7), [7, 1, 3, 9, 7, 1, 3]) !== Number(account[7]) ||
    checksum(account.slice(8, 21), [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]) !== Number(account[21])
  )
    throw new Error('INVALID_ACCOUNT');
  return { holder, taxId, account };
}

export interface PartnerBillingContext {
  revision: string;
  firstPayment: {
    id: string;
    amountCents: number;
    refundedCents: number;
    status: string;
    paidAt: string;
  } | null;
  percent: number;
  validPaidCycleIds: string[];
  commissionPaidCents: number;
  adjustmentsRecordedCents: number;
  held: boolean;
  introConsumed: boolean;
  renewalPending: boolean;
}
export interface PartnerPaymentEffect {
  firstPaymentId: string | null;
  amountCents: number;
  status: CommissionStatus;
  availableAt: string | null;
  adjustmentDeltaCents: number;
  qualified: boolean;
  consumeIntro: boolean;
  restoreRenewal: boolean;
}

/** Re-evaluate authoritative ledger state, including reversals after payout. */
export function paymentEffect(context: PartnerBillingContext, nowMs: number): PartnerPaymentEffect {
  const first = context.firstPayment;
  const qualified = new Set(context.validPaidCycleIds).size >= 2;
  if (!first)
    return {
      firstPaymentId: null,
      amountCents: 0,
      status: 'pending',
      availableAt: null,
      adjustmentDeltaCents: 0,
      qualified: false,
      consumeIntro: false,
      restoreRenewal: false,
    };
  const paidAt = Date.parse(first.paidAt);
  if (
    !Number.isFinite(paidAt) ||
    !Number.isFinite(nowMs) ||
    paidAt > nowMs ||
    !Number.isSafeInteger(first.amountCents) ||
    first.amountCents <= 0 ||
    !Number.isSafeInteger(first.refundedCents) ||
    first.refundedCents < 0 ||
    first.refundedCents > first.amountCents ||
    !Number.isSafeInteger(context.commissionPaidCents) ||
    context.commissionPaidCents < 0 ||
    !Number.isSafeInteger(context.adjustmentsRecordedCents) ||
    context.adjustmentsRecordedCents > 0
  )
    throw new Error('INVALID_LEDGER');
  const net = first.status === 'approved' ? first.amountCents - first.refundedCents : 0;
  const amountCents = percentOf(net, context.percent);
  const reversal = Math.min(0, amountCents - context.commissionPaidCents);
  const availableAt = new Date(paidAt + PARTNER_HOLD_MS).toISOString();
  const status: CommissionStatus =
    context.commissionPaidCents > 0
      ? 'paid'
      : net === 0
        ? 'reversed'
        : context.held
          ? 'held'
          : nowMs >= paidAt + PARTNER_HOLD_MS
            ? 'available'
            : 'pending';
  return {
    firstPaymentId: first.id,
    amountCents,
    status,
    availableAt,
    adjustmentDeltaCents: reversal - context.adjustmentsRecordedCents,
    qualified,
    consumeIntro: context.introConsumed || net > 0,
    restoreRenewal: context.renewalPending || (!context.introConsumed && net > 0),
  };
}
