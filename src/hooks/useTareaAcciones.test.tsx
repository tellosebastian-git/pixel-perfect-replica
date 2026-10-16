import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTareaAcciones } from './useTareaAcciones';
const state=vi.hoisted(()=>({account:false,rpc:vi.fn(),invoke:vi.fn()}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({isSucursalAccount:state.account})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:state.rpc,functions:{invoke:state.invoke}}}));
const request={id:'task',version:'revision',accion:'completar' as const};
function setup(){ const client=new QueryClient({defaultOptions:{mutations:{retry:false}}});
  const invalidate=vi.spyOn(client,'invalidateQueries');
  const hook=renderHook(useTareaAcciones,{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
  return {...hook,invalidate}; }
beforeEach(()=>{state.account=false;state.rpc.mockReset();state.invoke.mockReset();});
describe('acciones controladas de Tareas',()=>{
  it('la cuenta personal usa RPC sin actor ni timestamps enviados',async()=>{
    state.rpc.mockResolvedValue({data:{ok:true,version:'next'},error:null}); const {result}=setup();
    await act(()=>result.current.mutateAsync(request));
    expect(state.rpc).toHaveBeenCalledWith('tareas_accion',{p_tarea:'task',p_version:'revision',p_accion:'completar'});
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it('la cuenta de sucursal envía el PIN y la acción juntos, sin UUID de identidad',async()=>{
    state.account=true;state.invoke.mockResolvedValue({data:{ok:true},error:null});const {result}=setup();
    await act(()=>result.current.mutateAsync({...request,pin:'1234'}));
    expect(state.invoke).toHaveBeenCalledWith('tareas-action',{body:{tarea_id:'task',version:'revision',accion:'completar',pin:'1234'}});
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('conflictos muestran la respuesta del servidor e invalidan lista e historial',async()=>{
    state.rpc.mockResolvedValue({data:{ok:false,code:'conflict',message:'La tarea cambió'},error:null});const {result,invalidate}=setup();
    await act(async()=>{await expect(result.current.mutateAsync(request)).rejects.toMatchObject({message:'La tarea cambió',code:'conflict'});});
    expect(invalidate).toHaveBeenCalledWith({queryKey:['tareas']});expect(state.rpc).toHaveBeenCalledOnce();
  });
  it('un fallo de transporte no simula éxito ni reintenta completar',async()=>{
    state.rpc.mockResolvedValue({data:null,error:new Error('offline')});const {result}=setup();
    await act(async()=>{await expect(result.current.mutateAsync(request)).rejects.toThrow('No pudimos confirmar');});
    expect(state.rpc).toHaveBeenCalledOnce();
  });
});
