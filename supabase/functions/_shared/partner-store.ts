import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PARTNER_CONTRACT_VERSION } from './partner-domain.ts';

export class PartnerError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
/** All writes use atomic, revision-checked database transactions. */
export async function partnerStore<T>(
  client: SupabaseClient,
  action: string,
  actorId: string | null,
  input: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await client.rpc('partner_program_command', {
    _contract_version: PARTNER_CONTRACT_VERSION,
    _action: action,
    _actor_id: actorId,
    _input: input,
  });
  if (error) {
    const known = [
      'CODE_TAKEN',
      'INVALID_CODE',
      'NOT_OWNER',
      'ALREADY_ENROLLED',
      'SELF_REFERRAL',
      'REVISION_CONFLICT',
      'PAYOUT_NOT_VERIFIED',
      'ALREADY_PAID',
      'INVALID_REFERRAL',
      'INCIDENT_OPEN',
      'CAPABILITY_NOT_READY',
    ];
    const code = known.find((item) => error.message.includes(item));
    throw new PartnerError(code ?? 'STORAGE_UNAVAILABLE', code ? 409 : 503);
  }
  if (data == null) throw new PartnerError('STORAGE_UNAVAILABLE', 503);
  if (typeof data === 'object' && data.status === 'rejected') {
    throw new PartnerError(typeof data.code === 'string' ? data.code : 'OPERATION_REJECTED');
  }
  return data as T;
}
export const partnerBillingEnabled = () => Deno.env.get('PARTNER_BILLING_ENABLED') === 'true';
export const partnerProgramEnabled = () => Deno.env.get('PARTNER_PROGRAM_ENABLED') === 'true';
