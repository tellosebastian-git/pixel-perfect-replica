import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecurrenteFila } from './RecurrenteFila';
import { RecurrentesPanel } from './RecurrentesPanel';
import { TareasAutomaticasPausaAviso } from './TareasAutomaticasPausaAviso';
import type { TareaRecurrente, useTareasRecurrentes } from '@/hooks/useTareasRecurrentes';

const auth = vi.hoisted(() => ({ value: { isOwner: true, isGeneralManager: false, isManager: false, isSucursalAccount: false } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.value }));
vi.mock('@/contexts/SucursalContext', () => ({ useSucursal: () => ({ currentSucursal: { id: 's1' }, sucursales: [{ id: 's1', nombre: 'Centro', activa: true }] }) }));
vi.mock('@/components/ActionPinGate', () => ({ useRequirePinForAction: () => async () => ({ ok: true }) }));

const base: TareaRecurrente = {
  id: 'r1', organization_id: 'o1', sucursal_id: 's1', titulo: 'Limpiar herramientas', descripcion: null, assignment_scope: 'team',
  asignado_a: null, asignado_nombre: 'Todo el equipo', hora: '09:00', repeat_preset: 'weekly', repeat_frequency: null,
  repeat_interval: null, repeat_byweekday: null, fecha_inicio: '2026-10-05', proxima_fecha: '2026-10-19', activo: true,
  pausa_motivo: null, pausada_at: null, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', created_by: null,
};

function renderFila(receta: TareaRecurrente, extra: Partial<Parameters<typeof RecurrenteFila>[0]> = {}) {
  const onAlternar = vi.fn();
  render(<ul><RecurrenteFila receta={receta} today="2026-10-14" puedeGestionar puedeEliminar onEditar={vi.fn()} onAlternar={onAlternar}
    onEliminar={vi.fn()} {...extra} /></ul>);
  return onAlternar;
}

describe('Tareas automáticas · filas', () => {
  it('activa: frecuencia, hora, responsable y próxima fecha; se puede pausar', () => {
    const onAlternar = renderFila(base, { ultima: { fecha: '2026-10-12', texto: 'completada (lun 12 oct)' } });
    expect(screen.getByText('Cada semana')).toBeInTheDocument();
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('Todo el equipo')).toBeInTheDocument();
    expect(screen.getByText(/Próxima: lun 19 oct/)).toBeInTheDocument();
    expect(screen.getByText('Última: completada (lun 12 oct)')).toBeInTheDocument();
    expect(screen.queryByText(/Pausada/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pausar «Limpiar herramientas»' }));
    expect(onAlternar).toHaveBeenCalledOnce();
  });

  it('pausa manual: muestra el motivo, nunca una próxima, y se reanuda a mano', () => {
    const onAlternar = renderFila({ ...base, activo: false, pausa_motivo: 'manual' });
    expect(screen.getByText('Pausada')).toBeInTheDocument();
    expect(screen.getByText(/Pausada manualmente/)).toBeInTheDocument();
    expect(screen.queryByText(/Próxima/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reanudar «Limpiar herramientas»' }));
    expect(onAlternar).toHaveBeenCalledOnce();
  });

  it.each([
    ['sucursal_inactiva', /Sucursal inactiva/],
    ['barbero_inactivo', /Barbero inactivo/],
    ['barbero_sin_asignacion', /Barbero sin asignación en la sucursal/],
  ] as const)('pausa automática (%s): motivo, se reanuda sola y no ofrece reanudar a mano', (motivo, texto) => {
    renderFila({ ...base, activo: false, pausa_motivo: motivo });
    expect(screen.getByText(texto)).toBeInTheDocument();
    expect(screen.getByText(/Se reanuda sola/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reanudar|Pausar/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Próxima/)).not.toBeInTheDocument();
  });

  it('sin permisos de gestión no muestra acciones', () => {
    renderFila(base, { puedeGestionar: false, puedeEliminar: false });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Tareas automáticas · subvista', () => {
  const hook = (o: Partial<ReturnType<typeof useTareasRecurrentes>> = {}) => ({
    recetas: [], hasData: true, isLoading: false, error: null, refetch: vi.fn(), isFetching: false,
    toggleActivo: { mutate: vi.fn(), isPending: false, variables: undefined }, deleteReceta: { mutate: vi.fn() }, ...o,
  }) as unknown as ReturnType<typeof useTareasRecurrentes>;

  it('sin automáticas explica para qué sirven y ofrece crear una', () => {
    const nueva = vi.fn();
    render(<RecurrentesPanel recurrentes={hook()} today="2026-10-14" onVolver={vi.fn()} onNueva={nueva} onEditar={vi.fn()} />);
    expect(screen.getByText('Todavía no hay Tareas automáticas')).toBeInTheDocument();
    expect(screen.getByText(/Configurala una vez y Vittro la vuelve a crear/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Nueva Tarea automática/ })[1]);
    expect(nueva).toHaveBeenCalledOnce();
  });

  it('un error de carga no se presenta como vacío', () => {
    const recurrentes = hook({ hasData: false, error: new Error('offline') });
    render(<RecurrentesPanel recurrentes={recurrentes} today="2026-10-14" onVolver={vi.fn()} onEditar={vi.fn()} />);
    expect(screen.queryByText('Todavía no hay Tareas automáticas')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar las Tareas automáticas.');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(recurrentes.refetch).toHaveBeenCalledOnce();
  });

  it('Activas | Pausadas, con vacío compacto en el segmento sin elementos', () => {
    render(<RecurrentesPanel recurrentes={hook({ recetas: [base] })} today="2026-10-14" onVolver={vi.fn()} onEditar={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /Activas/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Limpiar herramientas')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Pausadas/ }));
    expect(screen.getByText('No hay Tareas automáticas pausadas.')).toBeInTheDocument();
  });

  it('volver lleva a la lista de Tareas', () => {
    const volver = vi.fn();
    render(<RecurrentesPanel recurrentes={hook()} today="2026-10-14" onVolver={volver} onEditar={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Volver a Tareas/ }));
    expect(volver).toHaveBeenCalledOnce();
  });
});

describe('TareasAutomaticasPausaAviso', () => {
  it('no muestra nada mientras consulta ni cuando no hay Tareas automáticas afectadas', () => {
    const { container, rerender } = render(<TareasAutomaticasPausaAviso tipo="sucursal" cantidad={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<TareasAutomaticasPausaAviso tipo="sucursal" cantidad={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('avisa cuántas se pausarán, con la terminología "Tareas automáticas"', () => {
    render(<TareasAutomaticasPausaAviso tipo="barbero" cantidad={2} />);
    expect(screen.getByRole('note')).toHaveTextContent('2 Tareas automáticas asignadas a esta persona se pausarán.');
  });

  it('si no se pudo consultar, lo dice en vez de callar', () => {
    render(<TareasAutomaticasPausaAviso tipo="asignacion" cantidad={null} />);
    expect(screen.getByRole('note')).toHaveTextContent('No pudimos verificar');
  });
});
