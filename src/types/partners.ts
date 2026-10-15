export type {
  PartnerSummary,
  PartnerTier,
  PartnerAgreement,
  PartnerProgramStatus,
  CommissionStatus,
} from '../../supabase/functions/_shared/partner-domain';

export interface PartnerAdminRow {
  id: string;
  name: string;
  code: string;
  percent: number;
  registrations: number;
  qualifiedOrganizations: number;
  availableCents: number;
  payoutVerified: boolean;
  suspended: boolean;
  revision: string;
}
export interface PartnerPayoutItem {
  id: string;
  partnerId: string;
  name: string;
  amountCents: number;
  holder: string;
  taxId: string;
  account: string;
  verified: boolean;
  status: 'review' | 'paid' | 'held';
  revision: string;
}
export interface PartnerAdminSummary {
  partners: PartnerAdminRow[];
  payouts: PartnerPayoutItem[];
  incidents: Array<{ id: string; partnerId: string; message: string; revision: string }>;
  totalPartners: number;
  page: number;
  pageSize: number;
}
