import { useEffect, useState } from 'react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { todayInTimezoneIso } from '@/lib/dateUtils';

/** Recalcula al cruzar medianoche o volver a una pestaña suspendida. */
export function useOrganizationToday() {
  const { organization } = useOrganization();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return todayInTimezoneIso(organization?.timezone, now);
}
