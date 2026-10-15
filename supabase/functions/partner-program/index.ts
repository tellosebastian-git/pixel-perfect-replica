import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handlePartnerRequest } from '../_shared/partner-program-handler.ts';

serve(handlePartnerRequest);
