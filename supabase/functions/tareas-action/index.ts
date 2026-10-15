import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createTareaPinHandler } from './handler.ts';

serve(createTareaPinHandler({
  authenticate: async authorization => {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser();
    return error ? null : data.user?.id ?? null;
  },
  hashPin: async pin => {
    // Same storage algorithm as existing set-pin/validate-pin. No PIN migration in BUILD 4A.
    const bytes = new TextEncoder().encode(pin + (Deno.env.get('PIN_SALT') || 'barbershop_salt_2024'));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,'0')).join('');
  },
  execute: async args => {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc('tareas_accion_pin', args);
    if (error) throw error;
    return data;
  },
}));
