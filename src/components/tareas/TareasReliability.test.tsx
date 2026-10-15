import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tarea } from '@/hooks/useTareas';
import type { TareaRecurrente } from '@/hooks/useTareasRecurrentes';
import type { TareaPrevista } from '@/lib/tareasAgenda';
import { TareaFormDrawer } from './TareaFormDrawer';
import { TareasFiltros } from './TareasFiltros';
import { TareasPanel } from '../TareasPanel';

const state = vi.hoisted(() => ({
  branch: null as string | null, error: null as Error | null, hasData: true, roles: {} as Record<string, boolean>, barberoId: 'b1' as string | null,
  tareas: [] as Tarea[], previstas: [] as TareaPrevista[], resueltas: [] as Tarea[], existe: false, orgId: 'org',
  retry: vi.fn(), accion: vi.fn(), del: vi.fn(), ok: vi.fn(), err: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({
  isOwner: false, isGeneralManager: false, isManager: false, isBarber: false, isSucursalAccount: false, canManageConfig: false, ...state.roles,
  user: { id: 'u1' }, profile: { id: 'u1', barbero_id: state.barberoId, full_name: 'Ana' },
}) }));
vi.mock('@/contexts/OrganizationContext', () => ({ useOrganization: () => ({ organization: {
  id: state.orgId, timezone: 'America/Argentina/Buenos_Aires', tareas_vencimiento_dias_default: 1, peticiones_vencimiento_dias: 60,
} }) }));
vi.mock('@/contexts/SucursalContext', () => ({ useSucursal: () => ({
  currentSucursal: state.branch ? { id: state.branch, nombre: 'Centro' } : null, isAllMode: !state.branch, isLoading: false, error: null,
  refreshSucursales: vi.fn(), sucursales: [{ id: 's1', nombre: 'Centro', activa: true, organization_id: 'org' }],
}) }));
vi.mock('@/hooks/useOrganizationToday', () => ({ useOrganizationToday: () => '2026-10-14' }));
vi.mock('@/hooks/useTareaResponsables', () => ({
  useTareaResponsables: () => ({ data: [{ id: 'b2', nombre: 'Bruno Paz' }], isLoading: false, isError: false, refetch: vi.fn(), isFetching: false }),
  useSucursalesDeIntegrante: () => ({ data: ['s1'] }),
}));
vi.mock('@/hooks/useTareasHistorial', () => ({ useTareasHistorial: () => ({ data: undefined, isLoading: false }) }));
vi.mock('@/hooks/useTareas', () => ({ useTareas: () => ({
  tareas: state.tareas, hasData: state.hasData, isLoading: false, error: state.error, refetch: state.retry, isFetching: false, dataUpdatedAt: 1,
  addTarea: { mutateAsync: vi.fn() }, updateTarea: { mutateAsync: vi.fn() }, deleteTarea: { mutateAsync: state.del },
}) }));
vi.mock('@/hooks/useTareasSemana', () => ({ useTareasSemana: () => ({
  week: { lunes: '2026-10-12', domingo: '2026-10-18' },
  resueltas: { data: state.resueltas, dataUpdatedAt: 1, error: null, refetch: vi.fn() },
  previstas: { data: state.previstas, error: null, refetch: vi.fn() },
  existeHistorial: { data: state.existe, isLoading: false },
}) }));
vi.mock('@/hooks/useTareasRecurrentes', () => ({ useTareasRecurrentes: () => ({
  recetas: [], hasData: true, isLoading: false, error: null, refetch: vi.fn(), isFetching: false,
  updateReceta: { mutateAsync: vi.fn() }, toggleActivo: { mutate: vi.fn(), isPending: false }, deleteReceta: { mutate: vi.fn() },
}) }));
vi.mock('@/components/ActionPinGate', () => ({ useRequirePinForAction: () => async () => ({ ok: true }) }));
vi.mock('@/hooks/useTareaAcciones', () => ({ useTareaAcciones: () => ({ isPending: false, variables: undefined, mutateAsync: state.accion }) }));
vi.mock('@/lib/feedback', () => ({ feedback: { success: state.ok, error: state.err, info: vi.fn(), dismiss: vi.fn() } }));

Element.prototype.scrollIntoView ??= () => {};

let n = 0;
const tarea = (o: Partial<Tarea> = {}): Tarea => ({
  id: `t${++n}`, organization_id: 'org', tipo: 'tarea', titulo: `Tarea ${n}`, descripcion: null, estado: 'pendiente',
  asignado_a_id: null, asignado_a_nombre: null, creado_por_id: 'u', creado_por_nombre: 'Ana', assignment_scope: 'team',
  sucursal_id: 's1', recurrente: false, fecha_inicio: '2026-10-14', fecha_limite: null, hora: null, repeat_preset: null,
  repeat_frequency: null, repeat_interval: null, repeat_byweekday: null, vencimiento_dias: null, completada_por_id: null,
  completada_por_nombre: null, completada_at: null, recurrencia_id: null, vencida_at: null,
  created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', accion_version: 'v1', ...o,
});
const owner = { isOwner: true, canManageConfig: true };

beforeEach(() => {
  Object.assign(state, { branch: null, error: null, hasData: true, roles: owner, barberoId: 'b1', tareas: [], previstas: [], resueltas: [], existe: false, orgId: 'org' });
  state.accion.mockResolvedValue({ ok: true, version: 'v2', estado: 'completada', actor_nombre: 'Ana', completada_at: '2026-10-14T15:00:00Z' });
  state.del.mockResolvedValue(undefined);
  window.localStorage.clear();
});

const abrirSelect = (nombre: RegExp | string) => fireEvent.keyDown(screen.getByRole('combobox', { name: nombre }), { key: 'ArrowDown' });

describe('formulario único de Tareas (TareaFormDrawer)', () => {
  const props = { onClose: vi.fn(), onCrear: vi.fn(), onActualizarTarea: vi.fn(), onActualizarAutomatica: vi.fn() };

  it('edita una tarea histórica sin sucursal sin reasignarla', async () => {
    const actualizar = vi.fn().mockResolvedValue(undefined);
    render(<TareaFormDrawer {...props} onActualizarTarea={actualizar}
      modo={{ tipo: 'editar-tarea', tarea: tarea({ id: 'legacy', titulo: 'Tarea anterior', sucursal_id: null, fecha_inicio: null }) }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(actualizar).toHaveBeenCalledOnce());
    expect(actualizar.mock.calls[0][1]).not.toHaveProperty('sucursal_id');
    expect(screen.queryByText('Se repite')).not.toBeInTheDocument();
  });

  it('edita una automática pausada por sucursal inactiva sin reactivarla ni moverla', async () => {
    const actualizar = vi.fn().mockResolvedValue(undefined);
    render(<TareaFormDrawer {...props} onActualizarAutomatica={actualizar} modo={{ tipo: 'editar-automatica', receta: {
      id: 'paused', titulo: 'Automática pausada', sucursal_id: 'inactive', assignment_scope: 'team', fecha_inicio: '2026-10-01',
      created_at: '2026-10-01T00:00:00Z', repeat_preset: 'weekly', activo: false, pausa_motivo: 'sucursal_inactiva',
    } as TareaRecurrente }} />);
    expect(screen.getByText('Editar Tarea automática')).toBeInTheDocument();
    expect(screen.getByText('Empieza el')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(actualizar).toHaveBeenCalledOnce());
    expect(actualizar.mock.calls[0][0]).not.toHaveProperty('sucursal_id');
    expect(actualizar.mock.calls[0][0]).not.toHaveProperty('activo');
  });

  it('desde Todas exige elegir sucursal y lo dice junto al campo', async () => {
    const crear = vi.fn();
    render(<TareaFormDrawer {...props} onCrear={crear} modo={{ tipo: 'nueva' }} />);
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Limpiar herramientas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
    expect(await screen.findByText('Elegí una sucursal para guardar la tarea.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sucursal' })).toHaveAttribute('aria-invalid', 'true');
    expect(crear).not.toHaveBeenCalled();
  });

  it('si falla guardar conserva lo escrito, no cierra y no muestra el error técnico', async () => {
    state.branch = 's1';
    const cerrar = vi.fn();
    const crear = vi.fn().mockRejectedValue({ code: 'XX000', message: 'duplicate key value violates unique constraint' });
    render(<TareaFormDrawer {...props} onClose={cerrar} onCrear={crear} modo={{ tipo: 'nueva' }} />);
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Limpiar herramientas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar los cambios. Revisá los datos y reintentá.');
    expect(screen.queryByText(/duplicate key/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toHaveValue('Limpiar herramientas');
    expect(cerrar).not.toHaveBeenCalled();
    expect(crear.mock.calls[0][0]).toMatchObject({ sucursal_id: 's1', assignment_scope: 'team', fecha_inicio: '2026-10-14', repeat_preset: 'never' });
  });

  it('cierra solamente después de confirmar el guardado', async () => {
    state.branch = 's1';
    let resolver!: () => void;
    const crear = vi.fn(() => new Promise<void>(done => { resolver = done; }));
    const cerrar = vi.fn();
    render(<TareaFormDrawer {...props} onClose={cerrar} onCrear={crear} modo={{ tipo: 'nueva' }} />);
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Limpiar herramientas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
    expect(await screen.findByRole('button', { name: /Guardando/ })).toBeDisabled();
    expect(cerrar).not.toHaveBeenCalled();
    resolver();
    await waitFor(() => expect(cerrar).toHaveBeenCalledOnce());
  });

  it('Hoy por defecto y "Sin fecha" visible sin abrir un calendario', async () => {
    state.branch = 's1';
    const crear = vi.fn().mockResolvedValue(undefined);
    render(<TareaFormDrawer {...props} onCrear={crear} modo={{ tipo: 'nueva' }} />);
    expect(screen.getByRole('radio', { name: 'Hoy' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Sin fecha' }));
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Ordenar depósito' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
    await waitFor(() => expect(crear).toHaveBeenCalledOnce());
    expect(crear.mock.calls[0][0].fecha_inicio).toBeUndefined();
  });

  it('elegir una repetición convierte el alta en Nueva Tarea automática dentro del mismo panel', async () => {
    state.branch = 's1';
    render(<TareaFormDrawer {...props} modo={{ tipo: 'nueva' }} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Sin fecha' }));
    // Con un overlay de Radix abierto, las consultas por rol de jsdom son muy lentas: se usa texto y etiqueta.
    const opcion = (texto: string) => fireEvent.click(screen.getByText(texto, { selector: '[role="option"] span' }).closest('[role="option"]')!);
    abrirSelect('Se repite');
    opcion('Cada día');
    expect(screen.getByText('Nueva Tarea automática', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByText('Crear Tarea automática', { selector: 'button' })).toBeInTheDocument();
    expect(screen.getByText('Empieza el')).toBeInTheDocument();
    expect(screen.queryByText('Sin fecha', { selector: 'button' })).not.toBeInTheDocument();
    expect(screen.getByText('Hoy', { selector: 'button' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Vittro va a crear esta tarea/)).toHaveTextContent('cada día');
    // Personalizada se expande en el mismo panel, sin hojas encima.
    abrirSelect('Se repite');
    opcion('Personalizada');
    expect(screen.getByText('Días', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByLabelText('miércoles')).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  }, 20_000);

  it('alta directa desde Tareas automáticas abre el mismo formulario en modo automática', () => {
    state.branch = 's1';
    render(<TareaFormDrawer {...props} modo={{ tipo: 'nueva', automatica: true }} />);
    expect(screen.getByRole('heading', { name: 'Nueva Tarea automática' })).toBeInTheDocument();
    expect(screen.getByText(/Vittro va a crear esta tarea/)).toHaveTextContent('cada semana');
  });

  it('editar una tarea generada no edita la programación y ofrece la Tarea automática', () => {
    const editarAutomatica = vi.fn();
    render(<TareaFormDrawer {...props} automaticaTitulo={() => 'Limpieza'} onEditarAutomatica={editarAutomatica}
      modo={{ tipo: 'editar-tarea', tarea: tarea({ recurrencia_id: 'r1' }) }} />);
    expect(screen.getByText(/Creada por la Tarea automática «Limpieza»/)).toBeInTheDocument();
    expect(screen.queryByText('Se repite')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Tarea automática' }));
    expect(editarAutomatica).toHaveBeenCalledWith('r1');
  });
});

describe('Principal → Tareas', () => {
  it('un error sin datos no se presenta como vacío y ofrece reintento', () => {
    Object.assign(state, { hasData: false, error: new Error('offline') });
    render(<TareasPanel barbers={[]} />);
    expect(screen.queryByText('Todo al día')).not.toBeInTheDocument();
    expect(screen.queryByText('Organizá el trabajo del local')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar las tareas.');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });

  it('un refetch fallido conserva la lista y avisa con Reintentar', () => {
    Object.assign(state, { error: new Error('offline'), tareas: [tarea({ titulo: 'Abrir caja' })] });
    render(<TareasPanel barbers={[]} />);
    expect(screen.getByText('Abrir caja')).toBeInTheDocument();
    expect(state.err).toHaveBeenCalledWith('No pudimos actualizar las tareas.', expect.objectContaining({ retry: expect.objectContaining({ id: 'tareas-lista' }) }));
  });

  it('distingue "nunca tuvo tareas" (con CTA para supervisores) de "todo al día"', () => {
    const { unmount } = render(<TareasPanel barbers={[]} />);
    expect(screen.getByText('Organizá el trabajo del local')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Nueva Tarea automática/ }).length).toBeGreaterThan(0);
    unmount();
    state.existe = true;
    render(<TareasPanel barbers={[]} />);
    expect(screen.getByText('Todo al día')).toBeInTheDocument();
  });

  it('un barbero sin tareas ve un mensaje simple, sin acciones administrativas', () => {
    state.roles = { isBarber: true };
    render(<TareasPanel barbers={[]} />);
    expect(screen.getByText('Todavía no hay tareas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nueva tarea/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tareas automáticas/ })).not.toBeInTheDocument();
  });

  it('organiza por Necesitan atención, Hoy, Próximas y Sin fecha, con Programadas sin acciones', () => {
    state.tareas = [
      tarea({ titulo: 'Reponer toallas', estado: 'vencida', fecha_inicio: '2026-10-10' }),
      tarea({ titulo: 'Abrir caja', hora: '09:00' }),
      tarea({ titulo: 'Pedido de insumos', fecha_inicio: '2026-10-16', recurrencia_id: 'r9' }),
      tarea({ titulo: 'Ordenar depósito', fecha_inicio: null }),
    ];
    state.previstas = [{ recurrencia_id: 'r1', fecha: '2026-10-15', hora: null, titulo: 'Limpieza profunda', descripcion: null, sucursal_id: 's1', assignment_scope: 'team', asignado_a_id: null, asignado_a_nombre: null }];
    render(<TareasPanel barbers={[]} />);
    for (const titulo of ['Necesitan atención', 'Hoy', 'Próximas', 'Sin fecha']) expect(screen.getByRole('heading', { name: new RegExp(`^${titulo}`) })).toBeInTheDocument();
    const atencion = screen.getByRole('region', { name: /Necesitan atención/ });
    expect(within(atencion).getByText('Reponer toallas')).toBeInTheDocument();
    expect(within(atencion).getByText('Vencida')).toBeInTheDocument();
    const proximas = screen.getByRole('region', { name: /Próximas/ });
    expect(within(proximas).getByText('Programada')).toBeInTheDocument();
    expect(within(proximas).getAllByText('Automática')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Completar «Limpieza profunda»' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar «Limpieza profunda»' })).not.toBeInTheDocument();
    // Progreso: 4 con fecha esta semana o programadas (la vencida es de la semana anterior y va aparte).
    expect(screen.getByRole('region', { name: /Esta semana/ })).toHaveTextContent('0 de 3 completadas');
    expect(screen.getByText('1 pendiente de semanas anteriores')).toBeInTheDocument();
  });

  it('completar es un toque, usa la acción del servidor y ofrece Deshacer', async () => {
    state.tareas = [tarea({ id: 'x1', titulo: 'Abrir caja' })];
    render(<TareasPanel barbers={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Completar «Abrir caja»' }));
    await waitFor(() => expect(state.accion).toHaveBeenCalledWith({ id: 'x1', version: 'v1', accion: 'completar', pin: undefined }));
    await waitFor(() => expect(state.ok).toHaveBeenCalledWith('Tarea completada', expect.objectContaining({ duration: 30_000 })));
    await waitFor(() => expect(screen.queryByText('Abrir caja')).not.toBeInTheDocument());
    const opciones = state.ok.mock.calls[0][1];
    expect(opciones.action.label).toBe('Deshacer');
    state.accion.mockResolvedValueOnce({ ok: true, version: 'v3', estado: 'pendiente', actor_nombre: 'Ana' });
    opciones.action.onClick();
    await waitFor(() => expect(state.accion).toHaveBeenLastCalledWith({ id: 'x1', version: 'v2', accion: 'deshacer', pin: undefined }));
  });

  it('si completar falla, la tarea sigue en la lista y el mensaje es entendible', async () => {
    state.tareas = [tarea({ titulo: 'Abrir caja' })];
    state.accion.mockRejectedValueOnce(new Error('La tarea cambió o ya fue completada. Actualizá la lista.'));
    render(<TareasPanel barbers={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Completar «Abrir caja»' }));
    await waitFor(() => expect(state.err).toHaveBeenCalledWith('La tarea cambió o ya fue completada. Actualizá la lista.'));
    expect(screen.getByText('Abrir caja')).toBeInTheDocument();
  });

  it('una tarea vencida se puede iniciar', async () => {
    state.tareas = [tarea({ id: 'v1', titulo: 'Reponer toallas', estado: 'vencida', fecha_inicio: '2026-10-10' })];
    render(<TareasPanel barbers={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar «Reponer toallas»' }));
    await waitFor(() => expect(state.accion).toHaveBeenCalledWith({ id: 'v1', version: 'v1', accion: 'iniciar', pin: undefined }));
  });

  it('eliminar pide confirmación y aclara que la Tarea automática sigue', async () => {
    state.tareas = [tarea({ id: 'a1', titulo: 'Limpieza', recurrencia_id: 'r1' })];
    render(<TareasPanel barbers={[]} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Más acciones para «Limpieza»' }), { key: 'Enter' });
    fireEvent.click(screen.getByText('Eliminar', { selector: '[role="menuitem"]' }));
    const dialogo = screen.getByText(/no se elimina: sigue creando las próximas/).closest('[role="alertdialog"]') as HTMLElement;
    expect(dialogo).not.toBeNull();
    expect(state.del).not.toHaveBeenCalled();
    fireEvent.click(within(dialogo).getByText('Eliminar', { selector: 'button' }));
    // Se verifica sin act asíncrono: con un overlay de Radix abierto, en jsdom tarda 12–21 s (ver DESIGN_BACKLOG).
    expect(state.del).toHaveBeenCalledWith('a1');
  }, 20_000);

  it('roles: supervisor con barbero elige Mis tareas | Negocio; barbero y cuenta de sucursal no', () => {
    state.tareas = [tarea({ titulo: 'Abrir caja' })];
    const { unmount } = render(<TareasPanel barbers={[]} />);
    expect(screen.getByRole('tab', { name: 'Mis tareas' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filtros de tareas' })).toBeInTheDocument();
    unmount();
    for (const roles of [{ isBarber: true }, { isSucursalAccount: true }]) {
      state.roles = roles;
      const r = render(<TareasPanel barbers={[]} />);
      expect(screen.queryByRole('tab', { name: 'Mis tareas' })).not.toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Filtros de tareas' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Nueva tarea/ })).not.toBeInTheDocument();
      r.unmount();
    }
    state.roles = owner; state.barberoId = null;
    render(<TareasPanel barbers={[]} />);
    expect(screen.queryByRole('tab', { name: 'Mis tareas' })).not.toBeInTheDocument();
  });

  it('Mis tareas se recuerda por usuario y organización', () => {
    state.tareas = [tarea({ titulo: 'Abrir caja' })];
    const { unmount } = render(<TareasPanel barbers={[]} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Mis tareas' }));
    expect(window.localStorage.getItem('vittro:tareas:alcance:u1:org')).toBe('mias');
    unmount();
    render(<TareasPanel barbers={[]} />);
    expect(screen.getByRole('tab', { name: 'Mis tareas' })).toHaveAttribute('aria-selected', 'true');
    expect(window.localStorage.getItem('vittro:tareas:alcance:u1:otra')).toBeNull();
  });

  it('Resueltas esta semana está plegada y da acceso al historial', () => {
    state.tareas = [tarea({ titulo: 'Abrir caja' })];
    state.resueltas = [tarea({ titulo: 'Cerrar caja', estado: 'completada', completada_at: '2026-10-13T22:00:00Z', completada_por_nombre: 'Ana' })];
    render(<TareasPanel barbers={[]} />);
    const disparador = screen.getByRole('button', { name: /Resueltas esta semana/ });
    expect(disparador).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Cerrar caja')).not.toBeInTheDocument();
    fireEvent.click(disparador);
    expect(screen.getByText('Cerrar caja')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ver historial/ })).toBeInTheDocument();
  });
});

describe('filtros de Negocio', () => {
  it('en mobile un único "Filtrar · N" y quitar filtros vuelve a todo', () => {
    const quitar = vi.fn();
    render(<TareasFiltros responsable="b2" onResponsable={vi.fn()} responsables={[{ id: 'b2', nombre: 'Bruno' }]}
      sucursales={[{ id: 's1', nombre: 'Centro' }]} sucursal="s1" onSucursal={vi.fn()} onQuitar={quitar} />);
    expect(screen.getByRole('button', { name: 'Filtrar · 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(quitar).toHaveBeenCalledOnce();
  });
});
