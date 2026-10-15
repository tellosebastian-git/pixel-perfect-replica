import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

/** No organization hydration: external creators are authenticated identities without a tenant. */
export function usePartnerSession() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let mounted = true;
    const timer = window.setTimeout(() => {
      if (mounted) {
        setLoading(false);
        setError(true);
      }
    }, 12_000);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      window.clearTimeout(timer);
      setUser(session?.user ?? null);
      setLoading(false);
      setError(false);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') setRecovery(false);
    });
    return () => {
      mounted = false;
      window.clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);
  return { user, loading, error, recovery, finishRecovery: () => setRecovery(false) };
}
