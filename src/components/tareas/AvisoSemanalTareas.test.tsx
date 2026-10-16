import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Tarea } from '@/hooks/useTareas';
import type { TareaPrevista } from '@/lib/tareasAgenda';
import { AvisosGlobalesProvider, useAvisoGlobal } from '@/components/avisos/AvisosGlobales';
import { reiniciarAvisosGlobales, type EstadoAviso } from '@/lib/avisosGlobales';
import { TareaAccionError } from '@/hooks/useTareaAcciones';
import { consumirDestinoTareas } from '@/lib/tareasNavegacion';
import { AvisoSemanalTareas } from './AvisoSemanalTareas';

type Fila = { estado: string; pospuesto_hasta: string | null } | null;
const state = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  orgId: 'o1',
  hoy: '2026-10-12',
  prefs: new Map<string, boolean>(),
  filas: {} as Record<string, Fila>,
  tareas: [] as unknown[],
  resueltas: [] as unknown[],
  previstas: [] as unknown[],
  lecturas: [] as Record<string, unknown>[],
  upserts: [] as { payload: Record<string, unknown>; opts: unknown }[],
  leyoTareas: false,
  resumen: 'no' as 'no' | 'listo',
  completadaPor: 'Juan',
  accion: vi.fn(),
  ok: vi.fn(), err: vi.fn(), info: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('@/contexts/OrganizationContext', () => ({ useOrganization: () => ({
  organization: { id: state.orgId, timezone: 'America/Argentina/Buenos_Aires', tareas_vencimiento_dias_default: 1 },
}) }));
vi.mock('@/contexts/SucursalContext', () => ({ useSucursal: () => ({
  currentSucursal: null, isAllMode: true, isLoading: false, error: null,
  sucursales: [{ id: 's1', nombre: 'Centro', organization_id: state.orgId, activa: true }, { id: 's2', nombre: 'Norte', organization_id: state.orgId, activa: true }],
}) }));
vi.mock('@/hooks/useOrganizationToday', () => ({ useOrganizationToday: () => state.hoy }));
vi.mock('@/hooks/useNotificationPreferences', () => ({ useNotificationPreferences: () => ({
  preferences: state.prefs, preferencesReady: true, preferencesError: false,
}) }));
vi.mock('@/hooks/useTareas', () => ({ useTareas: ({ enabled }: { enabled?: boolean } = {}) => {
  if (enabled) state.leyoTareas = true;
  return { tareas: enabled ? state.tareas : [], hasData: !!enabled, isLoading: false, error: null, dataUpdatedAt: 1 };
} }));
vi.mock('@/hooks/useTareasSemana', async () => {
  const { weekRange } = await import('@/lib/tareasData');
  return { useTareasSemana: (today: string, { enabled }: { enabled?: boolean } = {}) => ({
    week: weekRange(today),
    resueltas: { data: enabled ? state.resueltas : undefined, isSuccess: !!enabled, isError: false, dataUpdatedAt: 1 },
    previstas: { data: enabled ? state.previstas : undefined, isSuccess: !!enabled, isError: false },
  }) };
});
vi.mock('@/hooks/useTareaResponsables', () => ({ useSucursalesDeIntegrante: () => ({ data: ['s1'], isSuccess: true, isError: false }) }));
vi.mock('@/hooks/useTareaAcciones', async importOriginal => ({
  ...(await importOriginal<typeof import('@/hooks/useTareaAcciones')>()),
  useTareaAcciones: () => ({ isPending: false, variables: undefined, mutateAsync: state.accion }),
}));
vi.mock('@/lib/feedback', () => ({ feedback: { success: state.ok, error: state.err, info: state.info, dismiss: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (tabla: string) => {
  const filtros: Record<string, unknown> = { tabla };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    eq: (col: string, val: unknown) => { filtros[col] = val; return b; },
    abortSignal: () => b,
    maybeSingle: async () => {
      state.lecturas.push(filtros);
      if (tabla === 'tareas') return { data: { estado: 'completada', completada_por_nombre: state.completadaPor }, error: null };
      return { data: state.filas[String(filtros.organization_id)] ?? null, error: null };
    },
    upsert: (payload: Record<string, unknown>, opts: unknown) => { state.upserts.push({ payload, opts }); return b; },
    single: async () => ({ data: { estado: state.upserts.at(-1)?.payload.estado, pospuesto_hasta: null }, error: null }),
  });
  return b;
} } }));

let n = 0;
const tarea = (o: Partial<Tarea> = {}): Tarea => ({
  id: `t${++n}`, organization_id: 'o1', tipo: 'tarea', titulo: `Tarea ${n}`, descripcion: null, estado: 'pendiente',
  asignado_a_id: 'b1', asignado_a_nombre: 'Juan', creado_por_id: 'u', creado_por_nombre: 'Ana', assignment_scope: 'individual',
  sucursal_id: 's1', recurrente: false, fecha_inicio: '2026-10-14', fecha_limite: null, hora: null, repeat_preset: null,
  repeat_frequency: null, repeat_interval: null, repeat_byweekday: null, vencimiento_dias: null, completada_por_id: null,
  completada_por_nombre: null, completada_at: null, recurrencia_id: null, vencida_at: null,
  created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', accion_version: 'v1', ...o,
});
const completada = (fecha: string) => tarea({ estado: 'completada', fecha_inicio: fecha, completada_at: `${fecha}T15:00:00Z` });
const prevista = (fecha: string): TareaPrevista => ({
  recurrencia_id: 'r1', fecha, hora: '09:00', titulo: 'Limpieza', descripcion: null, sucursal_id: 's1', assignment_scope: 'team',
  asignado_a_id: null, asignado_a_nombre: null,
});
const OWNER = { user: { id: 'u1' }, profile: { id: 'u1', barbero_id: null }, isOwner: true, isGeneralManager: false, isManager: false, isBarber: false, isSucursalAccount: false };
const BARBERO = { user: { id: 'u1' }, profile: { id: 'u1', barbero_id: 'b1' }, isOwner: false, isGeneralManager: false, isManager: false, isBarber: true, isSucursalAccount: false };

function Otros() {
  useAvisoGlobal('onboarding', 'no');
  useAvisoGlobal('resumen', state.resumen as EstadoAviso);
  return null;
}
function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AvisosGlobalesProvider entrada={`u1:${state.orgId}`}>
        <Otros />
        <AvisoSemanalTareas disponible />
      </AvisosGlobalesProvider>
    </QueryClientProvider>,
  );
}
/**
 * Espera la decisión del coordinador en tramos cortos: React procesa lo que disparan los timers al cerrar cada `act`.
 * Con el aviso ya abierto se usan consultas sincrónicas (D53: `act` async con un overlay de Radix abierto es lento).
 */
const entrar = async () => {
  cleanup(); // cada entrada es una carga nueva de la app
  montar();
  for (let i = 0; i < 15 && !screen.queryByRole('dialog'); i++) await act(() => new Promise(r => setTimeout(r, 100)));
};
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const aviso = () => screen.queryByRole('dialog');

beforeEach(() => {
  reiniciarAvisosGlobales();
  consumirDestinoTareas();
  window.localStorage.clear();
  Object.assign(state, {
    auth: OWNER, orgId: 'o1', hoy: '2026-10-12', prefs: new Map(), filas: {}, tareas: [], resueltas: [], previstas: [],
    lecturas: [], upserts: [], leyoTareas: false, resumen: 'no', completadaPor: 'Juan',
  });
  state.accion.mockReset(); state.ok.mockReset(); state.err.mockReset(); state.info.mockReset();
});

describe('Aviso semanal de Tareas — momentos', () => {
  it('lunes: lo previsto, lo de hoy y lo anterior; nunca más de 5 tareas', async () => {
    state.tareas = [
      tarea({ titulo: 'De la semana pasada', fecha_inicio: '2026-10-08' }),
      tarea({ titulo: 'Abrir caja', fecha_inicio: '2026-10-12' }),
      ...['13', '14', '15', '16', '17'].map(d => tarea({ titulo: `Próxima ${d}`, fecha_inicio: `2026-10-${d}` })),
    ];
    await entrar();
    const d = aviso()!;
    expect(within(d).getByRole('heading', { name: 'Arranca la semana' })).toBeInTheDocument();
    expect(within(d).getByText('previstas').parentElement!.textContent).toBe('previstas6');
    expect(within(d).getByText('para hoy').parentElement!.textContent).toBe('para hoy1');
    expect(within(d).getByText('pendiente anterior').parentElement!.textContent).toBe('pendiente anterior1');
    expect(within(d).getAllByRole('listitem')).toHaveLength(5);
    expect(within(d).getByText('Y 2 más esta semana en Tareas.')).toBeInTheDocument();
  });

  it('jueves con todo resuelto: no aparece', async () => {
    state.hoy = '2026-10-15';
    state.resueltas = [completada('2026-10-13')];
    await entrar();
    expect(aviso()).toBeNull();
  });

  it('jueves con trabajo pendiente: "Cómo viene la semana" con X de Y (misma cuenta que Principal → Tareas)', async () => {
    state.hoy = '2026-10-15';
    state.tareas = [tarea({ titulo: 'Vencida', fecha_inicio: '2026-10-12' }), tarea({ titulo: 'Viernes', fecha_inicio: '2026-10-16' })];
    state.resueltas = [completada('2026-10-13')];
    await entrar();
    const d = aviso()!;
    expect(within(d).getByRole('heading', { name: 'Cómo viene la semana' })).toBeInTheDocument();
    expect(within(d).getByText((_, el) => el?.tagName === 'P' && el.textContent === '1 de 3 completadas')).toBeInTheDocument();
    expect(within(d).getAllByText('Vencida').length).toBeGreaterThan(0);
  });

  it('sábado al 100 %: aparece como cierre, sobrio', async () => {
    state.hoy = '2026-10-17';
    state.resueltas = [completada('2026-10-12'), completada('2026-10-15')];
    await entrar();
    const d = aviso()!;
    expect(within(d).getByRole('heading', { name: 'Cierre de la semana' })).toBeInTheDocument();
    expect(within(d).getByText('Todo al día esta semana.')).toBeInTheDocument();
    expect(within(d).getByText((_, el) => el?.tagName === 'P' && el.textContent === '2 de 2 completadas')).toBeInTheDocument();
    expect(within(d).queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('Aviso semanal de Tareas — Listo, Más tarde y persistencia', () => {
  beforeEach(() => { state.tareas = [tarea({ titulo: 'Abrir caja', fecha_inicio: '2026-10-12' })]; });

  it('"Listo" guarda solo el estado de ese momento (usuario + organización + semana) y cierra', async () => {
    await entrar();
    fireEvent.click(within(aviso()!).getByRole('button', { name: 'Listo' }));
    expect(aviso()).toBeNull();
    await waitFor(() => expect(state.upserts).toHaveLength(1));
    expect(state.upserts[0]).toEqual({
      payload: { user_id: 'u1', organization_id: 'o1', semana: '2026-10-12', momento: 'lunes', estado: 'listo' },
      opts: { onConflict: 'user_id,organization_id,semana,momento' },
    });
  });

  it('"Más tarde" y cerrar con Escape posponen; un cierre accidental nunca cuenta como Listo', async () => {
    await entrar();
    fireEvent.click(within(aviso()!).getByRole('button', { name: 'Más tarde' }));
    await waitFor(() => expect(state.upserts.map(u => u.payload.estado)).toEqual(['pospuesto']));
    reiniciarAvisosGlobales();
    await entrar();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(aviso()).toBeNull();
    await waitFor(() => expect(state.upserts.map(u => u.payload.estado)).toEqual(['pospuesto', 'pospuesto']));
  });

  it('pospuesto dentro del plazo o ya resuelto: no aparece ni lee tareas; con el plazo vencido, vuelve', async () => {
    state.filas = { o1: { estado: 'pospuesto', pospuesto_hasta: new Date(Date.now() + 3_600_000).toISOString() } };
    await entrar();
    expect(aviso()).toBeNull();
    expect(state.leyoTareas).toBe(false);
    reiniciarAvisosGlobales();
    state.filas = { o1: { estado: 'pospuesto', pospuesto_hasta: new Date(Date.now() - 60_000).toISOString() } };
    await entrar();
    expect(aviso()).not.toBeNull();
  });

  it('el estado es por usuario + organización: "Listo" en una organización no apaga la otra', async () => {
    state.filas = { o1: { estado: 'listo', pospuesto_hasta: null } };
    await entrar();
    expect(aviso()).toBeNull();
    expect(state.lecturas.find(l => l.tabla === 'tareas_aviso_semanal')).toMatchObject({ user_id: 'u1', organization_id: 'o1', semana: '2026-10-12', momento: 'lunes' });
    state.orgId = 'o2';
    await entrar();
    expect(aviso()).not.toBeNull();
    expect(state.lecturas.filter(l => l.tabla === 'tareas_aviso_semanal').map(l => l.organization_id)).toEqual(['o1', 'o2']);
  });

  it('preferencia desactivada: no aparece ni consulta nada', async () => {
    state.prefs = new Map([['tareas_resumen_semanal', false]]);
    await entrar();
    expect(aviso()).toBeNull();
    expect(state.lecturas).toHaveLength(0);
    expect(state.leyoTareas).toBe(false);
  });

  it('cuenta de sucursal: nunca recibe el aviso', async () => {
    state.auth = { ...OWNER, isOwner: false, isSucursalAccount: true, profile: { id: 'u1', barbero_id: null } };
    await entrar();
    expect(aviso()).toBeNull();
    expect(state.lecturas).toHaveLength(0);
  });

  it('el resumen mensual tiene prioridad: el aviso de Tareas no aparece en esa entrada', async () => {
    state.resumen = 'listo';
    await entrar();
    expect(aviso()).toBeNull();
  });
});

describe('Aviso semanal de Tareas — público', () => {
  it('barbero: versión personal, sin repetir su propio nombre', async () => {
    state.auth = BARBERO;
    state.tareas = [tarea({ titulo: 'Afilar navajas', fecha_inicio: '2026-10-12', asignado_a_id: 'b1', asignado_a_nombre: 'Juan' })];
    await entrar();
    const d = aviso()!;
    expect(within(d).getByText('Tus tareas')).toBeInTheDocument();
    expect(within(d).getByText('Afilar navajas')).toBeInTheDocument();
    expect(within(d).queryByText('Juan')).toBeNull();
  });

  it('supervisor: Negocio con responsable; "Mis tareas" solo si además es integrante', async () => {
    window.localStorage.setItem('vittro:tareas:alcance:u1:o1', 'mias');
    state.tareas = [
      tarea({ titulo: 'De Juan', fecha_inicio: '2026-10-12', asignado_a_id: 'b1', asignado_a_nombre: 'Juan' }),
      tarea({ titulo: 'Mía', fecha_inicio: '2026-10-12', asignado_a_id: 'b9', asignado_a_nombre: 'Ana' }),
    ];
    // Sin barbero vinculado, "Mis tareas" no es válido: vuelve a Negocio.
    await entrar();
    let d = aviso()!;
    expect(within(d).getByText('Tareas · Todo el negocio')).toBeInTheDocument();
    expect(within(d).getByText('Juan')).toBeInTheDocument();
    fireEvent.click(within(d).getByRole('button', { name: 'Listo' }));
    // Con barbero vinculado, se respeta su última elección.
    reiniciarAvisosGlobales();
    state.auth = { ...OWNER, profile: { id: 'u1', barbero_id: 'b9' } };
    await entrar();
    d = aviso()!;
    expect(within(d).getByText('Tus tareas')).toBeInTheDocument();
    expect(within(d).getByText('Mía')).toBeInTheDocument();
    expect(within(d).queryByText('De Juan')).toBeNull();
  });
});

describe('Aviso semanal de Tareas — acciones y navegación', () => {
  it('completar usa la acción del servidor (4A) y la tarea sale del aviso', async () => {
    const abrir = tarea({ titulo: 'Abrir caja', fecha_inicio: '2026-10-12' });
    state.tareas = [abrir, tarea({ titulo: 'Cerrar caja', fecha_inicio: '2026-10-13' })];
    state.accion.mockResolvedValueOnce({ ok: true, version: 'v2', estado: 'completada', actor_nombre: 'Ana', completada_at: '2026-10-12T15:00:00Z' });
    await entrar();
    fireEvent.click(within(aviso()!).getByRole('button', { name: 'Completar «Abrir caja»' }));
    await flush();
    expect(state.accion).toHaveBeenCalledWith({ id: abrir.id, version: 'v1', accion: 'completar', pin: undefined });
    expect(within(aviso()!).queryByText('Abrir caja')).toBeNull();
    expect(state.ok).toHaveBeenCalledWith('Tarea completada', expect.objectContaining({ action: expect.objectContaining({ label: 'Deshacer' }) }));
  });

  it('si otra persona ya la completó: "Ya la completó Juan." sin sobrescribir nada', async () => {
    state.tareas = [tarea({ titulo: 'Abrir caja', fecha_inicio: '2026-10-12' })];
    state.accion.mockRejectedValueOnce(new TareaAccionError('La tarea cambió', 'conflict'));
    await entrar();
    fireEvent.click(within(aviso()!).getByRole('button', { name: 'Completar «Abrir caja»' }));
    await flush();
    expect(state.info).toHaveBeenCalledWith('Ya la completó Juan.');
    expect(state.err).not.toHaveBeenCalled();
    expect(state.accion).toHaveBeenCalledTimes(1);
  });

  it('las Programadas se ven pero no tienen Iniciar ni Completar', async () => {
    state.previstas = [prevista('2026-10-14')];
    await entrar();
    const d = aviso()!;
    expect(within(d).getByText('Limpieza')).toBeInTheDocument();
    expect(within(d).getByText('Programada')).toBeInTheDocument();
    expect(within(d).queryByRole('button', { name: /«Limpieza»/ })).toBeNull();
  });

  it('tocar una tarea lleva a Principal → Tareas con esa tarea abierta (y el aviso queda para más tarde)', async () => {
    const t = tarea({ titulo: 'Revisar stock', fecha_inicio: '2026-10-12' });
    state.tareas = [t];
    await entrar();
    fireEvent.click(within(aviso()!).getByText('Revisar stock'));
    expect(aviso()).toBeNull();
    expect(consumirDestinoTareas()).toEqual({ tipo: 'tarea', id: t.id });
    await waitFor(() => expect(state.upserts.map(u => u.payload.estado)).toEqual(['pospuesto']));
  });

  it('una Programada lleva a su ocurrencia; "Ver todas las tareas" lleva a la lista', async () => {
    state.previstas = [prevista('2026-10-14')];
    await entrar();
    fireEvent.click(within(aviso()!).getByText('Limpieza'));
    expect(consumirDestinoTareas()).toEqual({ tipo: 'prevista', recurrenciaId: 'r1', fecha: '2026-10-14' });
    reiniciarAvisosGlobales();
    await entrar();
    fireEvent.click(within(aviso()!).getByRole('button', { name: 'Ver todas las tareas' }));
    expect(consumirDestinoTareas()).toEqual({ tipo: 'lista' });
  });
});
