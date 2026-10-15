// Exercise the actual Edge handler with dependency boundaries; SQL authorization is tested in PostgreSQL.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTareaPinHandler } from '../../supabase/functions/tareas-action/handler';
const deps={authenticate:vi.fn(),hashPin:vi.fn(),execute:vi.fn()};
const handler=createTareaPinHandler(deps);
const body={tarea_id:'11111111-1111-4111-8111-111111111111',version:'22222222-2222-4222-8222-222222222222',accion:'completar',pin:'1234'};
const req=(data:unknown=body,auth=true)=>new Request('https://local.test/tareas-action',{method:'POST',headers:auth?{Authorization:'Bearer synthetic'}:{},body:JSON.stringify(data)});
beforeEach(()=>{vi.resetAllMocks();deps.authenticate.mockResolvedValue('verified-user');deps.hashPin.mockResolvedValue('server-digest');deps.execute.mockResolvedValue({ok:true});});
describe('PIN de Tareas: identidad solo desde servidor',()=>{
  it('resuelve auth.getUser y envía digest calculado en servidor',async()=>{
    expect((await handler(req())).status).toBe(200);
    expect(deps.execute).toHaveBeenCalledWith({p_tarea:body.tarea_id,p_version:body.version,p_accion:'completar',p_cuenta:'verified-user',p_pin_hash:'server-digest'});
  });
  it.each(['user_id','actor_id','p_cuenta','validatedByUserId','pin_hash'])('rechaza identidad/digest falsificado: %s',async field=>{
    expect((await handler(req({...body,[field]:'forged'}))).status).toBe(400);expect(deps.execute).not.toHaveBeenCalled();
  });
  it('rechaza ausencia de sesión y tokens inválidos',async()=>{
    expect((await handler(req(body,false))).status).toBe(401);deps.authenticate.mockResolvedValue(null);
    expect((await handler(req())).status).toBe(401);expect(deps.execute).not.toHaveBeenCalled();
  });
  it('PIN incorrecto conserva mensaje del servidor, sin identidad revelada',async()=>{
    deps.execute.mockResolvedValue({ok:false,code:'invalid_pin',message:'PIN incorrecto'});
    expect(await (await handler(req())).json()).toEqual({ok:false,code:'invalid_pin',message:'PIN incorrecto'});
  });
  it('fallos internos no revelan PIN, digest ni detalles SQL',async()=>{
    deps.execute.mockRejectedValue(new Error('secret-query server-digest 1234'));
    const response=await handler(req());expect(response.status).toBe(500);expect(await response.text()).not.toMatch(/secret-query|server-digest|1234/);
  });
});
