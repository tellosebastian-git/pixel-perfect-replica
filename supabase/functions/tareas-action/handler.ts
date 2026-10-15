// Principal → Tareas. The browser supplies only the action and PIN, never an actor identity.
type Dependencies = {
  authenticate: (authorization: string) => Promise<string | null>;
  hashPin: (pin: string) => Promise<string>;
  execute: (args: { p_tarea: string; p_accion: string; p_version: string; p_cuenta: string; p_pin_hash: string }) => Promise<unknown>;
};
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createTareaPinHandler(deps: Dependencies) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers });
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (req.method !== 'POST') return reply({ error: 'Método no permitido' }, 405);
    try {
      const authorization = req.headers.get('Authorization');
      if (!authorization) return reply({ error: 'Iniciá sesión nuevamente.' }, 401);
      const userId = await deps.authenticate(authorization);
      if (!userId) return reply({ error: 'Iniciá sesión nuevamente.' }, 401);
      const text = await req.text();
      if (text.length > 1024) return reply({ error: 'Solicitud inválida.' }, 400);
      let body: Record<string, unknown>;
      try { body = JSON.parse(text); } catch { return reply({ error: 'Solicitud inválida.' }, 400); }
      if (!body || typeof body !== 'object' || Object.keys(body).some(k => !['tarea_id','accion','version','pin'].includes(k))
        || typeof body.tarea_id !== 'string' || !uuid.test(body.tarea_id)
        || typeof body.version !== 'string' || !uuid.test(body.version)
        || typeof body.accion !== 'string' || !['iniciar','completar','deshacer'].includes(body.accion)
        || typeof body.pin !== 'string' || !/^\d{4,6}$/.test(body.pin)) {
        return reply({ error: 'Solicitud inválida. Revisá el PIN y actualizá la tarea.' }, 400);
      }
      const result = await deps.execute({ p_tarea: body.tarea_id, p_accion: body.accion, p_version: body.version,
        p_cuenta: userId, p_pin_hash: await deps.hashPin(body.pin) });
      return reply(result);
    } catch {
      // Never return/log a PIN, digest, token, database error or service credential.
      return reply({ error: 'No pudimos realizar la acción. Actualizá la lista antes de reintentar.' }, 500);
    }
  };
}
