/**
 * Centro de Notificaciones — Catálogo central de eventos.
 *
 * Cada evento del catálogo representa una notificación del sistema final.
 *
 * - `configurable`: aparece en `Configuración → Notificaciones`.
 * - `implemented`: el evento ya está conectado técnicamente y puede generar deliveries.
 *
 * Reglas:
 * - Si `implemented = false`, el evento se muestra deshabilitado en configuración
 *   con texto "Se activará próximamente" y nunca produce notificaciones, aunque
 *   exista preferencia activada.
 * - Eventos sensibles (finanzas, caja, sueldos, permisos, roles, PIN, cuenta de
 *   sucursal, auditoría) deben permanecer `implemented = false` hasta que exista
 *   validación backend/RPC o generación server-side segura. La validación
 *   frontend de "rol puede activar evento" es defensa en profundidad, no de
 *   seguridad.
 */

import type { AppRole } from '@/contexts/AuthContext';

export type EventCategory =
  | 'actividad_operativa'
  | 'gestion_interna'
  | 'finanzas_caja'
  | 'sistema_seguridad';

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  actividad_operativa: 'Actividad operativa',
  gestion_interna: 'Gestión interna',
  finanzas_caja: 'Finanzas y caja',
  sistema_seguridad: 'Sistema y seguridad',
};

export const CATEGORY_ORDER: EventCategory[] = [
  'actividad_operativa',
  'gestion_interna',
  'finanzas_caja',
  'sistema_seguridad',
];

export type PrefMode = 'disabled' | 'always' | 'sucursal_account_only';

export interface NotificationEventDef {
  eventType: string;
  category: EventCategory;
  label: string;
  description: string;
  defaultEnabled: boolean;
  /** Forma parte del catálogo y aparece en Configuración → Notificaciones. */
  configurable: boolean;
  /** Está conectado técnicamente y puede generar notificaciones reales. */
  implemented: boolean;
  /** Fase prevista de implementación (informativo). */
  phase: 1 | 2 | 3 | 4;
  /** Cargos que tienen permitido recibirlo. */
  rolesAllowed: AppRole[];
  /** Visible para cuenta de sucursal (sucursal_account). */
  showForSucursalAccount: boolean;
  /** Visible para barbero. */
  showForBarber: boolean;
  /** Contiene datos sensibles (finanzas, seguridad, etc.). */
  sensitive: boolean;
  /** Suele incluir metadata/body que justifica vista desplegable. */
  requiresDetails: boolean;
  sourceModule: string;
  /** Si true, la preferencia soporta modos (No notificar / Siempre / Solo cuenta de sucursal). */
  supportsMode?: boolean;
  /** Modo default cuando supportsMode=true y no hay preferencia. */
  defaultMode?: Exclude<PrefMode, 'disabled'>;
  /** `false`: no llega a la campana (p. ej. el resumen semanal de Tareas, que aparece al entrar). Default: sí. */
  inBell?: boolean;
}

/**
 * Catálogo completo del sistema final.
 *
 * Mantener `implemented = false` para todo evento sensible o no conectado.
 * Solo tareas/peticiones están conectadas en Fase 2 (compatibilidad con el
 * sistema legacy).
 */
export const NOTIFICATION_CATALOG: NotificationEventDef[] = [
  // ───────── Actividad operativa ─────────
  // Turnos: eventos a nivel gestión (owner / general_manager / manager / cuenta de sucursal).
  // Para barberos existen variantes _propio y _companero más abajo.
  {
    eventType: 'turno_creado',
    category: 'actividad_operativa',
    label: 'Turno creado',
    description: 'Cuando se reserva un nuevo turno en la sucursal.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 3,
    rolesAllowed: ['owner', 'general_manager', 'manager', 'sucursal_account'],
    showForSucursalAccount: true,
    showForBarber: false,
    sensitive: false,
    requiresDetails: true,
    sourceModule: 'agenda',
  },
  {
    eventType: 'turno_cancelado',
    category: 'actividad_operativa',
    label: 'Turno cancelado',
    description: 'Cuando un turno de la sucursal se cancela.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 3,
    rolesAllowed: ['owner', 'general_manager', 'manager', 'sucursal_account'],
    showForSucursalAccount: true,
    showForBarber: false,
    sensitive: false,
    requiresDetails: true,
    sourceModule: 'agenda',
  },
  {
    eventType: 'turno_reprogramado',
    category: 'actividad_operativa',
    label: 'Turno reprogramado',
    description: 'Cuando un turno cambia de fecha, horario, barbero o sucursal.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 3,
    rolesAllowed: ['owner', 'general_manager', 'manager', 'sucursal_account'],
    showForSucursalAccount: true,
    showForBarber: false,
    sensitive: false,
    requiresDetails: true,
    sourceModule: 'agenda',
  },
  // Turnos del barbero — variantes propio / compañero.
  {
    eventType: 'turno_creado_propio',
    category: 'actividad_operativa',
    label: 'Mi nuevo turno',
    description: 'Cuando se crea un turno asignado a vos.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 3,
    rolesAllowed: ['barber'],
    showForSucursalAccount: false,
    showForBarber: true,
    sensitive: false,
    requiresDetails: true,
    sourceModule: 'agenda',
  },
  {
    eventType: 'turno_creado_companero',
    category: 'actividad_operativa',
    label: 'Nuevo turno de un compañero',
    description: 'Cuando se crea un turno para otro barbero de tu sucursal.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 3,
    rolesAllowed: ['barber'],
    showForSucursalAccount: false,
    showForBarber: true,
    sensitive: false,
    requiresDetails: true,
    sourceModule: 'agenda',
  },
  {
    eventType: 'turno_reprogramado_propio',
    category: 'actividad_operativa',
    label: 'Mi turno reprogramado',
    description: 'Cuando se reprograma un turno asignado a vos.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 3,
    rolesAllowed: ['barber'],
    showForSucursalAccount: false,
    showForBarber: true,
    sensitive: false,
    requiresDetails: true,
    sourceModule: 'agenda',
  },
  {
    eventType: 'turno_reprogramado_companero',
    category: 'actividad_operativa',
    label: 'Turno reprogramado de un compañero',
    description: 'Cuando se reprograma un turno de otro barbero de tu sucursal.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 3,
    rolesAllowed: ['barber'],
    showForSucursalAccount: false,
    showForBarber: true,
    sensitive: false,
    requiresDetails: true,
    sourceModule: 'agenda',
  },
  {
    eventType: 'turno_cancelado_propio',
    category: 'actividad_operativa',
    label: 'Mi turno cancelado',
    description: 'Cuando se cancela un turno asignado a vos.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 3,
    rolesAllowed: ['barber'],
    showForSucursalAccount: false,
    showForBarber: true,
    sensitive: false,
    requiresDetails: true,
    sourceModule: 'agenda',
  },
  {
    eventType: 'turno_cancelado_companero',
    category: 'actividad_operativa',
    label: 'Turno cancelado de un compañero',
    description: 'Cuando se cancela un turno de otro barbero de tu sucursal.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 3,
    rolesAllowed: ['barber'],
    showForSucursalAccount: false,
    showForBarber: true,
    sensitive: false,
    requiresDetails: true,
    sourceModule: 'agenda',
  },
  {
    eventType: 'tarea_asignada',
    category: 'actividad_operativa',
    label: 'Tarea asignada',
    description: 'Cuando se te asigna una tarea pendiente.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 2,
    rolesAllowed: ['owner', 'general_manager', 'manager', 'barber', 'sucursal_account'],
    showForSucursalAccount: true,
    showForBarber: true,
    sensitive: false,
    requiresDetails: false,
    sourceModule: 'tareas',
  },
  {
    eventType: 'tarea_equipo_asignada',
    category: 'actividad_operativa',
    label: 'Tarea asignada al equipo',
    description: 'Cuando se asigna una tarea a todo el equipo de la sucursal.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 3,
    rolesAllowed: ['owner', 'general_manager', 'manager', 'barber', 'sucursal_account'],
    showForSucursalAccount: true,
    showForBarber: true,
    sensitive: false,
    requiresDetails: false,
    sourceModule: 'tareas',
  },
  {
    eventType: 'tarea_por_vencer',
    category: 'actividad_operativa',
    label: 'Tarea por vencer',
    description: 'Cuando una tarea pendiente se acerca a su fecha límite.',
    defaultEnabled: true,
    configurable: true,
    implemented: false,
    phase: 3,
    rolesAllowed: ['owner', 'general_manager', 'manager', 'barber', 'sucursal_account'],
    showForSucursalAccount: true,
    showForBarber: true,
    sensitive: false,
    requiresDetails: false,
    sourceModule: 'tareas',
  },
  {
    eventType: 'tarea_vencida',
    category: 'actividad_operativa',
    label: 'Tarea vencida',
    description: 'Cuando una tarea pendiente supera su fecha límite.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 2,
    rolesAllowed: ['owner', 'general_manager', 'manager', 'barber', 'sucursal_account'],
    showForSucursalAccount: true,
    showForBarber: true,
    sensitive: false,
    requiresDetails: false,
    sourceModule: 'tareas',
  },
  {
    eventType: 'tarea_automatica_pausada',
    category: 'actividad_operativa',
    label: 'Tarea automática pausada',
    description: 'Cuando una Tarea automática se pausa sola porque la sucursal o la persona asignada dejó de estar activa.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 3,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: false,
    requiresDetails: true,
    sourceModule: 'tareas',
  },
  {
    // Aviso al entrar a la app (BUILD 4C), no una notificación: nunca se entrega a la campana.
    eventType: 'tareas_resumen_semanal',
    category: 'actividad_operativa',
    label: 'Resumen semanal de Tareas',
    description: 'Al entrar a Vittro al empezar la semana, el jueves y el sábado: cómo vienen tus tareas. No llega a la campana.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager', 'manager', 'barber'],
    showForSucursalAccount: false,
    showForBarber: true,
    sensitive: false,
    requiresDetails: false,
    sourceModule: 'tareas',
    inBell: false,
  },
  {
    eventType: 'cliente_bloqueado',
    category: 'actividad_operativa',
    label: 'Cliente bloqueado',
    description: 'Cuando un cliente queda bloqueado para reservar online.',
    defaultEnabled: false,
    configurable: true,
    implemented: false,
    phase: 3,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: false,
    requiresDetails: true,
    sourceModule: 'clientes',
  },

  // ───────── Gestión interna ─────────
  {
    eventType: 'peticion_nueva',
    category: 'gestion_interna',
    label: 'Petición nueva',
    description: 'Cuando alguien del equipo envía una petición.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 3,
    rolesAllowed: ['owner', 'general_manager', 'manager', 'sucursal_account'],
    showForSucursalAccount: true,
    showForBarber: false,
    sensitive: false,
    requiresDetails: true,
    sourceModule: 'tareas',
  },
  {
    eventType: 'peticion_aprobada',
    category: 'gestion_interna',
    label: 'Petición aprobada',
    description: 'Cuando se aprueba una petición.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 3,
    rolesAllowed: ['owner', 'general_manager', 'manager', 'sucursal_account'],
    showForSucursalAccount: true,
    showForBarber: false,
    sensitive: false,
    requiresDetails: false,
    sourceModule: 'tareas',
  },
  {
    eventType: 'peticion_rechazada',
    category: 'gestion_interna',
    label: 'Petición rechazada',
    description: 'Cuando se rechaza una petición.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 3,
    rolesAllowed: ['owner', 'general_manager', 'manager', 'sucursal_account'],
    showForSucursalAccount: true,
    showForBarber: false,
    sensitive: false,
    requiresDetails: false,
    sourceModule: 'tareas',
  },
  {
    eventType: 'peticion_por_vencer',
    category: 'gestion_interna',
    label: 'Petición por vencer',
    description: 'Cuando una petición pendiente se acerca a su vencimiento.',
    defaultEnabled: true,
    configurable: true,
    implemented: false,
    phase: 3,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: false,
    requiresDetails: false,
    sourceModule: 'tareas',
  },
  {
    eventType: 'peticion_vencida',
    category: 'gestion_interna',
    label: 'Petición vencida',
    description: 'Cuando una petición pendiente supera su vencimiento.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 2,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: false,
    requiresDetails: false,
    sourceModule: 'tareas',
  },
  {
    eventType: 'stock_bajo',
    category: 'gestion_interna',
    label: 'Stock bajo',
    description: 'Cuando un producto cae por debajo del stock mínimo configurado.',
    defaultEnabled: true,
    configurable: true,
    implemented: false,
    phase: 3,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: false,
    requiresDetails: true,
    sourceModule: 'productos',
  },

  // ───────── Finanzas y caja (Fase 4) ─────────
  // Caja
  {
    eventType: 'cierre_caja_realizado',
    category: 'finanzas_caja',
    label: 'Cierre de caja realizado',
    description: 'Cuando se confirma el cierre de caja del día.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'caja',
    supportsMode: true,
    defaultMode: 'always',
  },
  {
    eventType: 'cierre_caja_dia_anterior_realizado',
    category: 'finanzas_caja',
    label: 'Cierre de caja de día anterior',
    description: 'Cuando se realiza un cierre correspondiente a un día anterior (regularización).',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'caja',
    supportsMode: true,
    defaultMode: 'always',
  },
  {
    eventType: 'transaccion_anulada',
    category: 'finanzas_caja',
    label: 'Transacción anulada',
    description: 'Cuando se anula una venta o cobro confirmado.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'caja',
    supportsMode: true,
    defaultMode: 'always',
  },
  {
    eventType: 'anulacion_cierre',
    category: 'finanzas_caja',
    label: 'Anulación de cierre',
    description: 'Cuando se anula un cierre de caja confirmado.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'caja',
    supportsMode: true,
    defaultMode: 'always',
  },
  // Gastos
  {
    eventType: 'visualizacion_gastos',
    category: 'finanzas_caja',
    label: 'Visualización de gastos',
    description: 'Cuando una cuenta de sucursal abre la sección de gastos.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'finanzas',
    supportsMode: true,
    defaultMode: 'sucursal_account_only',
  },
  {
    eventType: 'gasto_registrado',
    category: 'finanzas_caja',
    label: 'Gasto registrado',
    description: 'Cuando se registra un nuevo gasto en finanzas.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'finanzas',
    supportsMode: true,
    defaultMode: 'always',
  },
  {
    eventType: 'gasto_editado',
    category: 'finanzas_caja',
    label: 'Gasto editado',
    description: 'Cuando se modifica un gasto existente.',
    defaultEnabled: false,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'finanzas',
    supportsMode: true,
    defaultMode: 'always',
  },
  {
    eventType: 'gasto_anulado',
    category: 'finanzas_caja',
    label: 'Gasto anulado',
    description: 'Cuando se anula un gasto registrado.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'finanzas',
    supportsMode: true,
    defaultMode: 'always',
  },
  // Inversiones / deudas — solo owner+gm
  {
    eventType: 'inversion_creada',
    category: 'finanzas_caja',
    label: 'Inversión registrada',
    description: 'Cuando se registra una nueva inversión.',
    defaultEnabled: false,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'finanzas',
  },
  {
    eventType: 'deuda_creada',
    category: 'finanzas_caja',
    label: 'Deuda registrada',
    description: 'Cuando se registra una nueva deuda.',
    defaultEnabled: false,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'finanzas',
  },
  // Sueldos
  {
    eventType: 'visualizacion_sueldos',
    category: 'finanzas_caja',
    label: 'Visualización de sueldos',
    description: 'Cuando una cuenta de sucursal abre la sección de sueldos.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'sueldos',
    supportsMode: true,
    defaultMode: 'sucursal_account_only',
  },
  {
    eventType: 'pago_sueldo_registrado',
    category: 'finanzas_caja',
    label: 'Pago de sueldo registrado',
    description: 'Cuando se registra el pago de un sueldo.',
    defaultEnabled: false,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'sueldos',
    supportsMode: true,
    defaultMode: 'always',
  },

  // ───────── Sistema y seguridad (Fase 4) ─────────
  {
    eventType: 'cambio_permisos',
    category: 'sistema_seguridad',
    label: 'Cambio de acceso a sucursal',
    description: 'Cuando se asigna o remueve el acceso de un usuario a una sucursal.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'seguridad',
  },
  {
    eventType: 'barbero_removido_sucursal',
    category: 'sistema_seguridad',
    label: 'Barbero movido entre sucursales',
    description: 'Cuando un barbero se habilita en otra sucursal y queda deshabilitado en la actual.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: false,
    requiresDetails: true,
    sourceModule: 'equipo',
  },
  {
    eventType: 'cambio_roles',
    category: 'sistema_seguridad',
    label: 'Cambio de cargos',
    description: 'Cuando se modifica el cargo de un usuario.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'seguridad',
  },
  {
    eventType: 'cambio_configuracion_critica',
    category: 'sistema_seguridad',
    label: 'Cambio en configuración crítica',
    description: 'Cuando se modifica la configuración de PIN por acción (alcance parcial).',
    defaultEnabled: false,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'seguridad',
  },
  {
    eventType: 'accion_bloqueada_permisos',
    category: 'sistema_seguridad',
    label: 'Acción bloqueada por permisos',
    description: 'Cuando se intenta una acción sensible no autorizada.',
    defaultEnabled: false,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'seguridad',
  },
  {
    eventType: 'inicio_sesion_cuenta_sucursal',
    category: 'sistema_seguridad',
    label: 'Inicio de sesión de cuenta de sucursal',
    description: 'Cuando una cuenta de sucursal inicia sesión (dedupe diario).',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'seguridad',
  },
  {
    eventType: 'accion_autorizada_pin',
    category: 'sistema_seguridad',
    label: 'Acción autorizada con PIN',
    description: 'Cuando se autoriza con PIN una acción sensible desde cuenta de sucursal.',
    defaultEnabled: true,
    configurable: true,
    implemented: true,
    phase: 4,
    rolesAllowed: ['owner', 'general_manager', 'manager'],
    showForSucursalAccount: false,
    showForBarber: false,
    sensitive: true,
    requiresDetails: true,
    sourceModule: 'seguridad',
  },
];


/**
 * Mapping de tipos legacy persistidos en `notifications.type` (Fase 1)
 * hacia el catálogo de Fase 2.
 *
 * - tarea_pendiente → tarea_asignada
 *   (la antigua "tarea_pendiente" indica que la tarea está pendiente y visible
 *   para el usuario; semánticamente corresponde al evento "tarea_asignada".
 *   NO se mapea a "tarea_por_vencer" porque no implica proximidad de
 *   vencimiento.)
 * - tarea_vencida → tarea_vencida
 * - peticion_vencida → peticion_vencida
 */
const LEGACY_TYPE_MAP: Record<string, string> = {
  tarea_pendiente: 'tarea_asignada',
  tarea_vencida: 'tarea_vencida',
  peticion_vencida: 'peticion_vencida',
};

/**
 * Resuelve el `eventType` canónico del catálogo a partir de un valor
 * persistido en `notifications.type` (que puede ser legacy).
 */
export function resolveNotificationEventType(rawType: string | null | undefined): string | null {
  if (!rawType) return null;
  return LEGACY_TYPE_MAP[rawType] ?? rawType;
}

const CATALOG_BY_EVENT: Record<string, NotificationEventDef> = Object.fromEntries(
  NOTIFICATION_CATALOG.map(e => [e.eventType, e]),
);

export function getEventDef(eventType: string | null | undefined): NotificationEventDef | undefined {
  if (!eventType) return undefined;
  return CATALOG_BY_EVENT[eventType];
}

export interface RoleScope {
  roles: AppRole[];
  isSucursalAccount: boolean;
  isBarber: boolean;
}

/**
 * Determina si un evento del catálogo debe ser visible para el rol actual.
 */
export function isEventVisibleForRole(def: NotificationEventDef, scope: RoleScope): boolean {
  // Cuenta de sucursal tiene flag dedicado.
  if (scope.isSucursalAccount) return def.showForSucursalAccount;
  // Barbero tiene flag dedicado (los demás flags no aplican aquí).
  if (scope.isBarber && !scope.roles.some(r => r === 'owner' || r === 'general_manager' || r === 'manager')) {
    return def.showForBarber;
  }
  // Resto: chequeo por rolesAllowed.
  return scope.roles.some(r => def.rolesAllowed.includes(r));
}

/**
 * Devuelve el subconjunto del catálogo visible para el rol actual.
 */
export function getCatalogForRole(scope: RoleScope): NotificationEventDef[] {
  return NOTIFICATION_CATALOG.filter(def => def.configurable && isEventVisibleForRole(def, scope));
}

/**
 * Agrupa una lista de eventos por categoría, respetando `CATEGORY_ORDER`.
 * Categorías sin eventos no se incluyen.
 */
export function groupByCategory(
  events: NotificationEventDef[],
): Array<{ category: EventCategory; events: NotificationEventDef[] }> {
  const map = new Map<EventCategory, NotificationEventDef[]>();
  for (const e of events) {
    const arr = map.get(e.category) ?? [];
    arr.push(e);
    map.set(e.category, arr);
  }
  return CATEGORY_ORDER.filter(c => map.has(c)).map(category => ({
    category,
    events: map.get(category)!,
  }));
}

/**
 * Resuelve el estado efectivo de "habilitado" para un evento entregado al
 * usuario, considerando preferencia guardada + default + disponibilidad.
 */
export function isEventEnabledForUser(
  eventType: string | null | undefined,
  preferences: Map<string, boolean>,
): boolean {
  const def = getEventDef(eventType ?? '');
  if (!def) return true; // tipos desconocidos: no filtrar (compatibilidad)
  if (!def.implemented) return false;
  const pref = preferences.get(def.eventType);
  return pref ?? def.defaultEnabled;
}

/**
 * Resuelve el modo efectivo para un evento dado el catálogo + preferencia.
 * Reglas:
 *  - mode IS NOT NULL → manda mode.
 *  - mode IS NULL pero enabled definido → enabled=false→disabled, enabled=true→defaultMode||'always'.
 *  - sin preferencia → defaultMode || (defaultEnabled ? 'always' : 'disabled').
 */
export function resolveModeForUser(
  def: NotificationEventDef,
  pref: { mode: PrefMode | null; enabled: boolean | null } | undefined,
): PrefMode {
  const fallback: PrefMode = def.defaultMode ?? (def.defaultEnabled ? 'always' : 'disabled');
  if (!pref) return fallback;
  if (pref.mode) return pref.mode;
  if (pref.enabled === null || pref.enabled === undefined) return fallback;
  return pref.enabled ? (def.defaultMode ?? 'always') : 'disabled';
}
