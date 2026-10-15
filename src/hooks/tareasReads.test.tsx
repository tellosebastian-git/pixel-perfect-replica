import { useState, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTareas } from './useTareas';
import { useTareasHistorial } from './useTareasHistorial';
import { useTareasSemana } from './useTareasSemana';
import { useTareaResponsables } from './useTareaResponsables';
import { useNotifications } from './useNotifications';
import { requireTaskBranch } from '@/lib/tareasData';

const state = vi.hoisted(() => ({
  org: 'org-a', user: 'user-a', branch: 'branch-a' as string | null, loading: false,
  fetch: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: state.user }, profile: { full_name: 'Prueba' } }) }));
vi.mock('@/contexts/OrganizationContext', () => ({ useOrganization: () => ({ organization: { id: state.org, timezone: 'America/Argentina/Buenos_Aires' } }) }));
vi.mock('@/contexts/SucursalContext', () => ({ useSucursal: () => ({
  currentSucursal: state.branch ? { id: state.branch } : null, isAllMode: !state.branch && !state.loading, isLoading: state.loading,
  sucursales: [{ id: 'branch-a', organization_id: state.org, activa: true }],
}) }));
vi.mock('./useNotificationPreferences', () => ({ useNotificationPreferences: () => ({ preferences: new Map() }) }));
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return { supabase: createClient('https://example.test', 'test-public-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (...args) => state.fetch(...args) } }) };
});

function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const wrapper = Wrapper;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const requestUrls = () => state.fetch.mock.calls.map(args => new URL(String(args[0])));
beforeEach(() => {
  state.org = 'org-a'; state.user = 'user-a'; state.branch = 'branch-a'; state.loading = false;
  state.fetch.mockReset().mockImplementation(async () => response([]));
});

describe('consultas de 4A-1 con el cliente Supabase real y transporte simulado', () => {
  it('carga 1105 abiertas con orden estable, scopes en cada página y sin histórico', async () => {
    const all = Array.from({ length: 1105 }, (_, i) => ({ id: String(9999 - i), created_at: '2026-10-13T00:00:00+00:00', tipo: 'tarea', estado: 'pendiente' }));
    state.fetch.mockImplementation(async url => {
      const params = new URL(String(url)).searchParams;
      const cursor = params.getAll('or').join('').match(/id.lt."(\d+)"/);
      return response(all.filter(r => !cursor || r.id < cursor[1]).slice(0, 200));
    });
    const { result } = renderHook(() => useTareas(), { wrapper });
    await waitFor(() => expect(result.current.tareas).toHaveLength(1105));
    for (const url of requestUrls()) {
      expect(url.searchParams.get('organization_id')).toBe('eq.org-a');
      expect(url.searchParams.get('sucursal_id')).toBe('eq.branch-a');
      expect(url.searchParams.get('order')).toBe('created_at.desc,id.desc');
      expect(url.searchParams.getAll('or')).toContain('(tipo.eq.peticion,estado.neq.completada)');
    }
  });
  it('propaga fallo de una página sin presentar resultados parciales como completos', async () => {
    state.fetch.mockResolvedValueOnce(response([{ id: 'a', created_at: '2026-10-13' }]))
      .mockResolvedValueOnce(response({ message: 'lectura fallida', code: 'XX000' }, 400));
    const { result } = renderHook(() => useTareas(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.tareas).toEqual([]);
  });
  it('espera a resolver el contexto de sucursal antes de consultar', () => {
    state.loading = true; state.branch = null;
    renderHook(() => useTareas(), { wrapper });
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it('no reutiliza filas de otro usuario u organización al cambiar contexto', async () => {
    state.fetch.mockResolvedValueOnce(response([{ id: 'a', created_at: '2026-10-13' }])).mockResolvedValue(response([]));
    const { result, rerender } = renderHook(() => useTareas(), { wrapper });
    await waitFor(() => expect(result.current.tareas).toHaveLength(1));
    state.org = 'org-b'; state.user = 'user-b';
    rerender();
    expect(result.current.tareas).toEqual([]);
    await waitFor(() => expect(requestUrls().some(url => url.searchParams.get('organization_id') === 'eq.org-b')).toBe(true));
  });
  it('historial solo bajo demanda, filtra antes de paginar y conserva cursor en cargar más', async () => {
    state.fetch.mockResolvedValueOnce(response([{ id: 'h1', created_at: '2026-10-13', completada_at: '2026-10-14T12:00:00+00:00' }])).mockResolvedValue(response([]));
    const { result, rerender } = renderHook(({ enabled }) => useTareasHistorial(enabled, 'todas', '__team__'), { wrapper, initialProps: { enabled: false } });
    expect(state.fetch).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      const page = await result.current.fetchNextPage();
      expect(page.error).toBeNull();
      expect(page.data?.pages.map(p => p.length)).toEqual([1, 0]);
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    const urls = requestUrls();
    expect(urls[0].searchParams.get('estado')).toBe('eq.completada');
    expect(urls[0].searchParams.get('tipo')).toBe('eq.tarea');
    expect(urls[0].searchParams.get('assignment_scope')).toBe('eq.team');
    expect(urls[0].searchParams.get('limit')).toBe('50');
    // Ordenado por fecha de completado (4B), con desempate estable por id.
    expect(urls[0].searchParams.get('order')).toBe('completada_at.desc.nullslast,id.desc');
    expect(urls[1].searchParams.get('or')).toContain('completada_at.lt."2026-10-14T12:00:00+00:00"');
    expect(urls[1].searchParams.get('or')).toContain('id.lt."h1"');
  });
  it('semana: completadas acotadas a esta semana y proyecciones calculadas por la base', async () => {
    state.fetch.mockImplementation(async url => {
      const u = new URL(String(url));
      if (u.pathname.endsWith('/rpc/tareas_previstas')) return response([{ recurrencia_id: 'r1', fecha: '2026-10-15', titulo: 'Limpieza' }]);
      return response([]);
    });
    const { result } = renderHook(() => useTareasSemana('2026-10-14'), { wrapper });
    await waitFor(() => expect(result.current.previstas.isSuccess && result.current.resueltas.isSuccess).toBe(true));
    expect(result.current.week).toEqual({ lunes: '2026-10-12', domingo: '2026-10-18' });
    expect(result.current.previstas.data).toHaveLength(1);
    const urls = requestUrls();
    const semana = urls.find(u => u.pathname.endsWith('/tareas'))!;
    expect(semana.searchParams.get('estado')).toBe('eq.completada');
    expect(semana.searchParams.get('organization_id')).toBe('eq.org-a');
    expect(semana.searchParams.get('sucursal_id')).toBe('eq.branch-a');
    expect(semana.searchParams.get('or')).toBe('(and(fecha_inicio.gte.2026-10-12,fecha_inicio.lte.2026-10-18),completada_at.gte."2026-10-11T00:00:00Z")');
    const rpc = state.fetch.mock.calls.find(args => String(args[0]).includes('/rpc/tareas_previstas'))!;
    expect(JSON.parse(String((rpc[1] as RequestInit).body))).toEqual({ p_desde: '2026-10-14', p_hasta: '2026-10-18', p_sucursal: 'branch-a' });
    // No pide existencia de historial salvo que la lista lo necesite.
    expect(urls.filter(u => u.pathname.endsWith('/tareas'))).toHaveLength(1);
  });
  it('una proyección fallida es un error, no una semana sin programadas', async () => {
    state.fetch.mockImplementation(async url => (String(url).includes('/rpc/tareas_previstas')
      ? response({ message: 'falla', code: 'XX000' }, 500) : response([])));
    const { result } = renderHook(() => useTareasSemana('2026-10-14'), { wrapper });
    await waitFor(() => expect(result.current.previstas.isError).toBe(true));
    expect(result.current.previstas.data).toBeUndefined();
  });
  it('responsables por pertenencia, deduplicados e independientes de disponible', async () => {
    const person = { id: 'p1', nombre: 'Ana', apellido: 'Prueba', activo: true, organization_id: 'org-a' };
    state.fetch.mockResolvedValueOnce(response([
      { id: '1', tipo: 'recurrente', fecha_inicio: null, fecha_fin: null, disponible: false, barberos: person },
      { id: '2', tipo: 'principal', fecha_inicio: null, fecha_fin: null, barberos: person },
      { id: '3', tipo: 'temporal', fecha_inicio: '2099-01-01', fecha_fin: '2099-01-02', barberos: { ...person, id: 'p2' } },
      { id: '4', tipo: 'temporal', fecha_inicio: null, fecha_fin: '2000-01-01', barberos: { ...person, id: 'p3' } },
    ])).mockResolvedValue(response([]));
    const { result } = renderHook(() => useTareaResponsables('branch-a'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'p1', nombre: 'Ana Prueba' }]);
    const params = requestUrls()[0].searchParams;
    expect(params.get('organization_id')).toBe('eq.org-a');
    expect(params.get('barberos.organization_id')).toBe('eq.org-a');
    expect(params.get('sucursal_id')).toBe('in.(branch-a)');
    expect(params.has('disponible')).toBe(false);
    expect(params.get('select')).not.toContain('disponible');
  });
  it('campana consulta únicamente IDs de sus entregas y conserva el scope', async () => {
    state.fetch.mockImplementation(async url => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/notification_deliveries')) return response([{ id: 'd1', notifications: { source_module: 'tareas', source_table: 'tareas', source_id: 't1', type: 'tarea_pendiente' } }]);
      if (path.endsWith('/tareas')) return response([{ id: 't1', estado: 'pendiente', tipo: 'tarea' }]);
      return response([]);
    });
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    const urls = requestUrls().filter(url => url.pathname.endsWith('/tareas'));
    expect(urls).toHaveLength(1);
    expect(urls[0].searchParams.get('id')).toBe('in.(t1)');
    expect(urls[0].searchParams.get('organization_id')).toBe('eq.org-a');
    expect(urls[0].searchParams.get('sucursal_id')).toBe('eq.branch-a');
  });
  it('no permite crear tareas globales sin sucursal ni acepta sucursales inexistentes', async () => {
    await expect(requireTaskBranch('org-a', null)).rejects.toThrow('Seleccioná');
    expect(state.fetch).not.toHaveBeenCalled();
    state.fetch.mockResolvedValue(response(null));
    await expect(requireTaskBranch('org-a', 'foreign-branch')).rejects.toThrow('no está disponible');
    expect(requestUrls()[0].searchParams.get('organization_id')).toBe('eq.org-a');
  });
});
