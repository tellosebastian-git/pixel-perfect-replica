import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createAdminClient } from '../_shared/subscription-billing.ts';
import { processPartnerJobs } from '../_shared/partner-billing.ts';
import { partnerBillingEnabled } from '../_shared/partner-store.ts';
import { authorizePartnerWorker } from '../_shared/partner-worker-auth.ts';

serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  const secret = Deno.env.get('PARTNER_JOB_SECRET');
  if (!(await authorizePartnerWorker(req, secret)))
    return new Response(null, { status: 401 });
  if (!partnerBillingEnabled()) return Response.json({ enabled: false });
  try {
    return Response.json(await processPartnerJobs(createAdminClient()));
  } catch {
    return Response.json({ error: 'WORK_PENDING' }, { status: 503 });
  }
});
