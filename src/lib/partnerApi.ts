import { supabase } from '@/integrations/supabase/client';
import { adminSupabase } from '@/integrations/supabase/adminClient';
import type { PartnerProgramStatus } from '@/types/partners';

export class PartnerApiError extends Error {
  constructor(
    message: string,
    readonly code = 'UNAVAILABLE',
  ) {
    super(message);
  }
}
export async function callPartner<T>(
  action: string,
  input: Record<string, unknown> = {},
  admin = false,
): Promise<T> {
  const client = admin ? adminSupabase : supabase;
  const { data, error } = await client.functions.invoke('partner-program', {
    body: { action, input },
  });
  if (error) {
    let payload: { error?: string; code?: string } = {};
    if (error.context instanceof Response) {
      try {
        payload = await error.context.clone().json();
      } catch {
        /* Keep human fallback. */
      }
    }
    throw new PartnerApiError(
      typeof payload.error === 'string'
        ? payload.error
        : 'No pudimos conectar con el programa. Probá nuevamente en unos minutos.',
      payload.code,
    );
  }
  if (data == null)
    throw new PartnerApiError('No pudimos confirmar el resultado. Volvé a consultar.');
  return data as T;
}
export const partnerStatus = () => callPartner<PartnerProgramStatus>('status');
export const partnerMoney = (cents: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
