import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type OnboardingStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface OnboardingRow {
  user_id: string;
  current_step: string | null;
  completed_steps: string[];
  status: OnboardingStatus;
  started_at: string | null;
  completed_at: string | null;
}

export function useOnboardingState() {
  const { user, isOwner } = useAuth();
  const [row, setRow] = useState<OnboardingRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) { setRow(null); setIsLoading(false); return; }
    setIsLoading(true);
    const { data } = await supabase
      .from('user_onboarding')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    setRow((data as OnboardingRow | null) ?? null);
    setIsLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const upsert = useCallback(async (patch: Partial<OnboardingRow>) => {
    if (!user?.id) return;
    const next: OnboardingRow = {
      user_id: user.id,
      current_step: row?.current_step ?? null,
      completed_steps: row?.completed_steps ?? [],
      status: row?.status ?? 'pending',
      started_at: row?.started_at ?? null,
      completed_at: row?.completed_at ?? null,
      ...patch,
    };
    setRow(next);
    await supabase.from('user_onboarding').upsert(next, { onConflict: 'user_id' });
  }, [user?.id, row]);

  return { row, isLoading, isOwner, reload: load, upsert };
}
