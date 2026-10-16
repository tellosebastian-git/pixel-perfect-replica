import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationItem } from '@/hooks/useNotifications';
import { getCatalogForRole, getEventDef } from '@/lib/notifications/catalog';
import { destinoDeNotificacion } from '@/lib/tareasNavegacion';
import { NotificationsBell } from './NotificationsBell';

const state = vi.hoisted(() => ({ items: [] as NotificationItem[], leer: vi.fn() }));
const SCOPE = { roles: ['owner'], isSucursalAccount: false, isBarber: false };

vi.mock('@/hooks/use-window-mode', () => ({ useWindowMode: () => 'expanded' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isOwner: true, isGeneralManager: false }) }));
vi.mock('@/contexts/SucursalContext', () => ({ useSucursal: () => ({ sucursales: [{ id: 's1', nombre: 'Centro' }] }) }));
vi.mock('@/hooks/useNotificationPreferences', () => ({ useNotificationPreferences: () => ({ scope: SCOPE }) }));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => ({
  unreadNotifications: state.items, readNotifications: [], unreadCount: state.items.length,
  markAsRead: { mutate: state.leer }, markAsUnread: { mutate: vi.fn() }, markAllAsRead: { mutate: vi.fn() }, refresh: vi.fn(),
}) }));

const item = (o: Partial<NotificationItem>): NotificationItem => ({
  id: 'd1', notification_id: 'n1', source_type: 'tarea_asignada', event_type: 'tarea_asignada', category: 'actividad_operativa',
  source_id: 't9', titulo: 'Te asignaron «Abrir caja»', body: null, summary: null, fecha: '2026-10-15T12:00:00Z', read: false,
  source_module: 'tareas', source_table: 'tareas', sucursal_id: 's1', actor_name: null, authorized_by_name: null, metadata: {}, ...o,
});

beforeEach(() => { state.items = []; state.leer.mockReset(); });

describe('Campana → tarea puntual', () => {
  it('tocar una notificación de Tareas entrega esa notificación (con su tabla de origen) para abrir esa tarea', () => {
    const onNavigate = vi.fn();
    state.items = [item({})];
    render(<NotificationsBell collapsed onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones, 1 sin leer' }));
    fireEvent.click(screen.getByText('Te asignaron «Abrir caja»'));
    expect(state.leer).toHaveBeenCalledWith({ id: 'd1', source_type: 'tarea_asignada', source_id: 't9' });
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ source_id: 't9', source_table: 'tareas' }));
  });

  it('cada notificación lleva a lo que nombra: tarea, Tarea automática o la lista', () => {
    expect(destinoDeNotificacion(item({}))).toEqual({ tipo: 'tarea', id: 't9' });
    expect(destinoDeNotificacion(item({ source_table: 'tareas_recurrentes', source_id: 'r1' }))).toEqual({ tipo: 'automatica', id: 'r1' });
    expect(destinoDeNotificacion(item({ source_module: 'agenda', source_table: 'turnos' }))).toEqual({ tipo: 'lista' });
    expect(destinoDeNotificacion(item({ source_id: '' }))).toEqual({ tipo: 'lista' });
  });

  it('el aviso semanal no figura en la campana (ni como tipo filtrable), pero sí en Configuración', () => {
    render(<NotificationsBell collapsed />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Filtrar por tipo' }), { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Tarea asignada' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Resumen semanal de Tareas' })).toBeNull();
    expect(getEventDef('tareas_resumen_semanal')).toMatchObject({ inBell: false, implemented: true, configurable: true, showForSucursalAccount: false });
    expect(getCatalogForRole(SCOPE as never).some(e => e.eventType === 'tareas_resumen_semanal')).toBe(true);
    expect(getCatalogForRole({ roles: ['sucursal_account'], isSucursalAccount: true, isBarber: false }).some(e => e.eventType === 'tareas_resumen_semanal')).toBe(false);
  });
});
