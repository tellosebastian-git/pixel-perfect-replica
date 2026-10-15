import { describe, expect, it } from 'vitest';
import {
  introAmount,
  moneyToCents,
  normalizePartnerCode,
  partnerTier,
  paymentEffect,
  percentOf,
  validatePayoutDetails,
  PARTNER_HOLD_MS,
  type PartnerBillingContext,
} from '../../supabase/functions/_shared/partner-domain';

const now = Date.parse('2026-10-14T12:00:00Z');
const instagram = (followers: number, age = 0, connected = true) => ({
  accountId: '1789000123456',
  followers,
  verifiedAt: new Date(now - age).toISOString(),
  connected,
});
const ledger = (changes: Partial<PartnerBillingContext> = {}): PartnerBillingContext => ({
  revision: 'r1',
  firstPayment: {
    id: 'p1',
    amountCents: 2_700_000,
    refundedCents: 0,
    status: 'approved',
    paidAt: new Date(now - PARTNER_HOLD_MS).toISOString(),
  },
  percent: 20,
  validPaidCycleIds: ['cycle-1'],
  commissionPaidCents: 0,
  adjustmentsRecordedCents: 0,
  held: false,
  introConsumed: false,
  renewalPending: false,
  ...changes,
});

describe('partner amounts and codes', () => {
  it('discounts the actual first invoice and calculates commission afterwards', () => {
    expect(introAmount(moneyToCents('30000'))).toBe(2_700_000);
    expect(percentOf(2_700_000, 10)).toBe(270_000);
    expect(percentOf(2_700_000, 30)).toBe(810_000);
    expect(percentOf(2_700_000, 100)).toBe(2_700_000);
  });
  it('uses centavo rounding without intermediate floating point loss', () => {
    expect(moneyToCents('0.29')).toBe(29);
    expect(percentOf(15, 10)).toBe(2);
    expect(percentOf(Number.MAX_SAFE_INTEGER, 100)).toBe(Number.MAX_SAFE_INTEGER);
  });
  it.each([null, NaN, -1, '1.001', '1e20', Number.MAX_SAFE_INTEGER])(
    'rejects invalid or overflowing monetary input %s',
    (value) => {
      expect(() => moneyToCents(value)).toThrow();
    },
  );
  it.each([-1, 101, 12.5, NaN])('rejects invalid percentages %s', (percent) =>
    expect(() => percentOf(100, percent)).toThrow(),
  );
  it('normalizes one case-insensitive code and rejects privileged/invalid names', () => {
    expect(normalizePartnerCode(' bruno10 ')).toBe('BRUNO10');
    for (const code of ['VITTRO', 'abc', 'Bruno 10', 'áááá', 'A'.repeat(21)])
      expect(() => normalizePartnerCode(code)).toThrow();
  });
});
describe('partner tier rules', () => {
  it.each([
    [0, 10],
    [4, 10],
    [5, 20],
    [19, 20],
    [20, 30],
    [100, 30],
  ])('qualifies %s retained organizations at %s%%', (qualifiedOrganizations, percent) => {
    expect(partnerTier({ qualifiedOrganizations }, now).percent).toBe(percent);
  });
  it.each([
    [9999, 10],
    [10000, 10],
    [49999, 10],
    [50000, 10],
  ])('ignores %s verified followers and keeps the referral rate at %s%%', (followers, percent) => {
    expect(
      partnerTier({ qualifiedOrganizations: 0, instagram: instagram(followers) }, now).percent,
    ).toBe(percent);
  });
  it('preserves the earned referral tier regardless of audience age', () => {
    expect(
      partnerTier({ qualifiedOrganizations: 5, instagram: instagram(50_000, PARTNER_HOLD_MS) }, now)
        .percent,
    ).toBe(20);
    expect(
      partnerTier(
        { qualifiedOrganizations: 0, instagram: instagram(50_000, PARTNER_HOLD_MS - 1) },
        now,
      ).percent,
    ).toBe(10);
  });
  it('ignores disconnected, future and invalid audience metrics', () => {
    for (const ig of [
      instagram(50000, 0, false),
      instagram(50000, -1),
      instagram(-1),
      instagram(50000.5),
    ]) {
      expect(partnerTier({ qualifiedOrganizations: 0, instagram: ig }, now).percent).toBe(10);
    }
  });
  it('honors a valid agreement without letting automatic upgrades replace its terms', () => {
    const agreement = {
      percent: 100,
      startsAt: new Date(now - 1).toISOString(),
      endsAt: new Date(now + 1).toISOString(),
      suspended: false,
    };
    expect(partnerTier({ qualifiedOrganizations: 20, agreement }, now).source).toBe('agreement');
    expect(partnerTier({ qualifiedOrganizations: 20, agreement }, now + 1).percent).toBe(30);
    expect(
      partnerTier({ qualifiedOrganizations: 20, agreement: { ...agreement, suspended: true } }, now)
        .source,
    ).toBe('results');
  });
});
describe('commission ledger transitions', () => {
  it('creates nothing for registration or a checkout with no approved first payment', () => {
    expect(paymentEffect(ledger({ firstPayment: null }), now)).toMatchObject({
      amountCents: 0,
      consumeIntro: false,
    });
  });
  it('releases at exactly 30 days and never treats cancellation as a refund', () => {
    expect(paymentEffect(ledger(), now - 1).status).toBe('pending');
    expect(paymentEffect(ledger(), now)).toMatchObject({
      amountCents: 540_000,
      status: 'available',
      consumeIntro: true,
      restoreRenewal: true,
    });
    expect(paymentEffect(ledger({ held: true }), now).status).toBe('held');
  });
  it('counts distinct paid cycles once, independently from commission release', () => {
    expect(
      paymentEffect(ledger({ validPaidCycleIds: ['cycle-1', 'cycle-1'] }), now).qualified,
    ).toBe(false);
    expect(
      paymentEffect(ledger({ validPaidCycleIds: ['cycle-1', 'cycle-2'] }), now).qualified,
    ).toBe(true);
  });
  it('reverses an unpaid commission without reopening the introductory benefit', () => {
    const context = ledger({
      introConsumed: true,
      firstPayment: { ...ledger().firstPayment!, status: 'charged_back' },
    });
    expect(paymentEffect(context, now)).toMatchObject({
      amountCents: 0,
      status: 'reversed',
      consumeIntro: true,
      adjustmentDeltaCents: 0,
    });
  });
  it('records only the remaining reversal after payout, including partial refunds', () => {
    const partial = ledger({
      commissionPaidCents: 540_000,
      firstPayment: { ...ledger().firstPayment!, refundedCents: 1_350_000 },
    });
    expect(paymentEffect(partial, now).adjustmentDeltaCents).toBe(-270_000);
    expect(
      paymentEffect({ ...partial, adjustmentsRecordedCents: -270_000 }, now).adjustmentDeltaCents,
    ).toBe(0);
    expect(
      paymentEffect(
        {
          ...partial,
          adjustmentsRecordedCents: -270_000,
          firstPayment: { ...partial.firstPayment!, status: 'refunded' },
        },
        now,
      ).adjustmentDeltaCents,
    ).toBe(-270_000);
  });
  it('does not reissue or reconsume an already paid commission on duplicates', () => {
    expect(
      paymentEffect(ledger({ commissionPaidCents: 540_000, introConsumed: true }), now),
    ).toMatchObject({ status: 'paid', adjustmentDeltaCents: 0 });
  });
  it('rejects a refund greater than its payment', () => {
    expect(() =>
      paymentEffect(
        ledger({ firstPayment: { ...ledger().firstPayment!, refundedCents: 2_700_001 } }),
        now,
      ),
    ).toThrow();
  });
});
describe('payout syntax', () => {
  it('checks CUIT digits and rejects zero or invalid CBU/CVU', () => {
    expect(() =>
      validatePayoutDetails({
        holder: 'Test Titular',
        taxId: '20123456786',
        account: '0'.repeat(22),
      }),
    ).toThrow('INVALID_ACCOUNT');
    expect(() =>
      validatePayoutDetails({
        holder: 'Test Titular',
        taxId: '20123456787',
        account: '0'.repeat(22),
      }),
    ).toThrow('INVALID_TAX_ID');
  });
});
