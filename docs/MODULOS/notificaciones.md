# Notificaciones

Estado: **Etapa 1 de seguridad implementada, validada localmente y APLICADA en el proyecto
Supabase operativo — 2026-10-12.** Las tres migraciones pasan 44 pruebas SQL sobre PostgreSQL
local sintético (PGlite) y figuran en `list_migrations` (nombres `notifications_security_functions`,
`notifications_security_rls`, `organizations_timezone_validation`; el conector les asignó las versiones
`20261012145524`, `…145549` y `…145604`, distintas del prefijo de los archivos del repo). Los tipos de
`src/integrations/supabase/types.ts` se regeneraron desde la base real el 2026-10-12 y no incluyen las dos
RPC eliminadas. Falta el QA manual autenticado de la campana (ver “Pendiente”).

**Etapa 2 (Tareas automáticas, 2026-10-12):** agrega el helper `_notif_barbero_users`, el evento
`tarea_automatica_pausada` y corrige tres productores que trataban `barberos.id` como id de usuario.
Ver la tabla de productores y `docs/MODULOS/tareas.md`.

- **Ubicación en la app:** barra lateral → campana de Notificaciones → No leídas / Leídas.
- **Archivos técnicos:** `src/components/notifications/NotificationsBell.tsx`,
  `src/hooks/useNotifications.ts`, `src/hooks/useNotificationPreferences.ts`,
  `src/lib/notifications/catalog.ts`.
- **Configuración de preferencias:** `src/components/config/NotificationsConfig.tsx`.

## Modelo: evento y entrega

**BUILD 4A — cambio local, 2026-10-14, sin despliegue.** En barra lateral → campana
(`src/hooks/useNotifications.ts`), las fuentes de Tareas se consultan por los IDs referenciados en
las últimas 100 entregas, con organización y sucursal del contexto. Ya no se monta `useTareas`
(`src/hooks/useTareas.ts`, carga de Principal → Tareas) desde la campana. Se mantienen catálogo,
preferencias, lecturas, filtrado de fuentes terminadas/eliminadas y RLS de Notificaciones. Las fuentes
de Tareas respetan además el alcance candidato de 4A (ver `docs/MODULOS/tareas.md`). La consulta
acotada comparte el prefijo de invalidación `tareas`, por lo que las acciones del módulo refrescan
también esas fuentes. No cambia el límite de entregas ni se agregan avisos semanales. Validación
de consultas con cliente Supabase real y transporte simulado: `src/hooks/tareasReads.test.tsx`;
QA autenticado pendiente. No implica despliegue.

| Tabla | Qué representa | Quién escribe | Quién lee |
|---|---|---|---|
| `notifications` | El **evento**: título, cuerpo, `metadata` (montos, nombres), `sucursal_id`, `category`. Única por `(organization_id, event_key)`. | Solo las funciones `SECURITY DEFINER` que emiten (triggers, cron, `notif_emit_view_event`). | Solo quien tiene una **entrega propia** de ese evento. |
| `notification_deliveries` | Una fila por **destinatario**: `user_id`, `read_at`, `hidden_at`. | Solo las mismas funciones. El cliente únicamente cambia `read_at` y `hidden_at` de su propia fila. | Cada usuario ve solo las suyas. |
| `user_notification_preferences` | Preferencia por tipo de evento (`enabled`, `mode`). | El propio usuario. | El propio usuario. |
| `notification_reads` | Legado de lectura por `(source_type, source_id)`. | El propio usuario. | El propio usuario. |

**Fuente de verdad: `notification_deliveries`.** Los destinatarios se calculan **al
momento de emitir**, según cargo, sucursal y preferencia del usuario en ese
instante. Leer un evento exige una entrega propia en la misma organización. No
existe el concepto de “notificación visible para toda la organización”: un aviso
institucional se reparte con una entrega a cada admin/manager correspondiente.
Un mismo hecho con públicos distintos se emite como eventos distintos (ej. turnos:
`:propio`, `:companero`, `:gestion`).

### Historial (decisión D1)

La entrega histórica **sigue siendo válida** aunque la persona pierda después el
cargo o la sucursal: conserva lo que recibió legítimamente y no recibe avisos
nuevos que ya no le correspondan (las emisiones usan los permisos vigentes al
momento del evento). No hay revocación retroactiva. Si deja de pertenecer a la
organización, el control por organización le corta el acceso a sus avisos.

## Autorización por capa

1. **Privilegios de tabla.** `anon` no tiene privilegios sobre las cuatro tablas.
   `authenticated`: `SELECT` en `notifications`; `SELECT` y `UPDATE` en
   `notification_deliveries`. Sin `INSERT`, `UPDATE`, `DELETE` ni `TRUNCATE` donde no corresponde.
2. **RLS.** `notifications`: una sola política `SELECT … TO authenticated` que exige
   organización del usuario **y** una entrega propia para esa notificación
   (`EXISTS` sobre el índice único `(notification_id, user_id)`; sin recursión).
   `notification_deliveries`: filas propias de la organización del usuario.
3. **Inmutabilidad de entregas.** Trigger `SECURITY INVOKER`
   (`notification_deliveries_guard_immutable`) que rechaza cambios en `id`,
   `notification_id`, `organization_id`, `user_id` y `created_at`. Se eligió trigger y
   no privilegios por columna porque Supabase los documenta como una función
   avanzada que rompe los `select *`.
4. **Funciones.** Ver la tabla siguiente. Los helpers internos no son llamables
   desde ningún rol de cliente; los triggers y el cron siguen funcionando porque las
   funciones `SECURITY DEFINER` se ejecutan con los permisos del dueño.
5. **Zona horaria.** Trigger `SECURITY INVOKER` que rechaza valores que no sean
   nombres IANA (o `NULL`) al insertar/actualizar `organizations.timezone`.

### Actores (resultado verificado por las pruebas)

| Evento | Owner / GM | Manager de la sucursal | Manager de otra sucursal | Barbero | Cuenta de sucursal | Otro rol / sin organización | Otra organización |
|---|---|---|---|---|---|---|---|
| Pago de sueldo, inversión, deuda, cambio de cargo, configuración crítica | Sí | No | No | No | No | No | No |
| Gasto, cierre/anulación de caja, transacción anulada, cambio de acceso | Sí | Sí | No | No | No | No | No |
| Tarea de equipo / vencida | Sí | Sí | No | Sí (de esa sucursal) | Sí (esa sucursal) | No | No |
| Turno propio | — | — | — | Sí (el asignado) | — | No | No |
| Tarea asignada a una persona (individual) | Sí | Sí (de esa sucursal) | No | Sí, **los usuarios de ese barbero** (`profiles.barbero_id`) | No | No | No |
| Tarea automática pausada (sucursal o persona inactiva) | Sí | Sí (de esa sucursal) | No | No | No | No | No |

## Productores

Todos son `SECURITY DEFINER`, crean el evento y sus entregas, y dependen de los helpers `_notif_*`.

| Ubicación funcional | Función / migración | Eventos |
|---|---|---|
| Tareas → crear tarea o petición (también las que genera el motor) | `trg_tareas_after_insert_notif` (`20260515220322`; reescrita en E2-M3) | `tarea_asignada` (destinatario individual = usuarios del barbero vía `_notif_barbero_users`, antes se usaba `barberos.id`), `tarea_equipo_asignada`, `peticion_nueva` |
| Tareas → Tareas automáticas (pausa por sucursal o persona inactiva) | `_tareas_auto_reconciliar` / `_tareas_auto_generar` → `_tareas_auto_notificar_pausa` (E2-M2) | `tarea_automatica_pausada` (a dueño, encargado general y encargados de la sucursal; **no** avisa la pérdida de asignación ni la disponibilidad diaria; ese caso solo tiene aviso previo en la acción) |
| Tareas → aprobar / rechazar petición | `trg_tareas_after_update_notif` (`20260515220322`) | `peticion_aprobada`, `peticion_rechazada` |
| Tareas (cron horario) | `process_vencimientos_tareas()` (`20260602052143`; reescrita en E2-M3: aislamiento por fila, usuarios del barbero, y una tarea `en_progreso` también vence con `vencida_at`) | `tarea_vencida`, `peticion_vencida` |
| Turnos → crear, reprogramar, cancelar | `trg_turnos_after_*_notif` → `_notif_turno_dispatch` (`20260515220322`) | `turno_*` (propio / compañero / gestión) |
| Caja → cierre, anulación de cierre, transacción anulada | `trg_ingresos_*`, `trg_anulaciones_cierre_*`, `trg_venta_*` (`20260515222233`) | `cierre_caja_*`, `anulacion_cierre`, `transaccion_anulada` |
| Finanzas → Gastos | `trg_egresos_after_*_notif` (`20260515222233`) | `gasto_registrado`, `gasto_editado`, `gasto_anulado` |
| Finanzas → Sueldos / Inversiones / Deudas | `trg_pagos_sueldos_*`, `trg_inversiones_*`, `trg_deudas_*` (`20260515222233`) | `pago_sueldo_registrado`, `inversion_creada`, `deuda_creada` |
| Configuración → cargos, accesos, PIN | `trg_user_roles_*`, `trg_user_sucursales_*`, `trg_pin_config_*` (`20260515222233`) | `cambio_roles`, `cambio_permisos`, `cambio_configuracion_critica` |
| Equipo → barbero deshabilitado en sucursal | `trg_barberos_sucursales_after_disponible_off_notif` (`20260608120225`; reescrita en E2-M3: excluye a los **usuarios** del barbero, antes comparaba contra `barberos.id`) | `barbero_removido_sucursal` |
| Finanzas → Gastos / Sueldos (cuenta de sucursal desbloquea la vista) | RPC `notif_emit_view_event` (`GastosPanel.tsx`, `SueldosPanel.tsx`) | `visualizacion_gastos`, `visualizacion_sueldos` |

## Permisos de funciones

| Función | `EXECUTE` | Nota |
|---|---|---|
| `_notif_emit`, `_notif_emit_sensitive`, `_notif_org_admins`, `_notif_sucursal_managers`, `_notif_sucursal_barbers`, `_notif_sucursal_account`, `_notif_actor_name`, `_notif_actor_account_type`, `_notif_pref_mode`, `_notif_turno_dispatch`, `_notif_turno_metadata`, `_notif_turno_title` | Nadie salvo el dueño (revocado a `PUBLIC`, `anon`, `authenticated`, `service_role`) | Llamables solo desde otras funciones `SECURITY DEFINER` del mismo dueño |
| `_notif_barbero_users(uuid, uuid)` (E2-M3) | Nadie salvo el dueño (revocado a `PUBLIC`, `anon`, `authenticated`, `service_role`) | `SECURITY INVOKER`, `search_path = ''`. Devuelve `profiles.id` de los usuarios vinculados a un barbero de esa organización |
| `notif_emit_view_event(text, uuid)` | `authenticated` | `SECURITY DEFINER`, `search_path = ''`. Valida usuario, organización, rol de cuenta de sucursal y que `_sucursal_id` sea la de **esa** cuenta. |
| `notif_emit_login_sucursal_account`, `notif_emit_action_blocked`, `notif_emit_pin_authorized` | Nadie salvo el dueño (revocado a `PUBLIC`, `anon`, `authenticated` y `service_role`) | Nada las invoca todavía; se conservan para su futura implementación |
| `process_vencimientos_tareas()`, `process_tareas_recurrentes()` | Dueño (cron) y `service_role` | Sin exposición a clientes. Ahora `search_path = ''` |
| `_tareas_auto_*` y los triggers `trg_tareas_recurrentes_*`, `trg_tareas_auto_sync_*` (Etapa 2; `trg_tareas_tipo_guard` se eliminó en la Etapa 3) | Nadie desde un cliente | Ver `docs/MODULOS/tareas.md`; llaman a `_notif_*` siendo `SECURITY DEFINER` del mismo dueño (las migraciones lo verifican) |
| `upsert_notification`, `upsert_notification_delivery` | — | **Eliminadas.** Permitían fabricar/sobrescribir avisos y autosuscribirse |

## Cómo agregar una notificación nueva

1. Emitir **siempre desde el servidor**: un trigger o función `SECURITY DEFINER`
   (dueño de las tablas) que calcule los destinatarios con los helpers y llame a
   `_notif_emit` o `_notif_emit_sensitive`. Nunca insertar en `notifications` desde el cliente.
2. Cada persona que deba verla necesita **su entrega**. Si no hay entrega, no hay lectura.
3. Si una acción del cliente debe disparar un aviso, usar una RPC `SECURITY DEFINER` como
   `notif_emit_view_event`: validar `auth.uid()`, la organización y la **pertenencia de cada
   id recibido**, con `search_path` fijo y nombres calificados.
4. **Revocar `EXECUTE` en la misma migración** que crea la función: Supabase concede por
   defecto a `anon`, `authenticated` y `service_role`. No usar `ALTER DEFAULT PRIVILEGES`
   global sobre `public` (rompería funciones legítimas). La prueba de catálogo H.6
   falla si una función `_notif*`, `notif_*` o `upsert_notification*` queda ejecutable por
   un cliente sin estar en la lista permitida.
5. Registrar el evento en `src/lib/notifications/catalog.ts` (`rolesAllowed` es solo un
   filtro de presentación, no una barrera de seguridad). Un aviso que se muestra en la app pero **no** se entrega a la
   campana (hoy: `tareas_resumen_semanal`) lleva `inBell: false`: aparece en Configuración → Notificaciones como
   preferencia, pero no en los filtros de la campana.
6. Sumar un escenario a `supabase/tests/notifications-security-sql.mjs`.

## Pruebas

```bash
npm install --prefix node_modules/.admin-sql-test --no-package-lock --no-save @electric-sql/pglite@0.5.8
node supabase/tests/notifications-security-sql.mjs
node supabase/tests/tareas-automaticas-sql.mjs   # Etapas 2 y 3: destinatarios, pausas, aislamiento, permisos y reset (82 pruebas)
```

`supabase/tests/notifications-security-sql.mjs` carga las migraciones históricas reales sobre
PostgreSQL local con un dueño **no superusuario** (para que los permisos sean reales) y los
privilegios por defecto de Supabase emulados. Primero demuestra las vulnerabilidades del
estado previo (SEG-01 a SEG-06), luego aplica M1–M3 y comprueba que quedaron cerradas, que
los 22 escenarios de productores emiten exactamente las mismas entregas y que las
migraciones abortan ante dueños distintos, llamadores `SECURITY INVOKER` desconocidos,
trabajos de pg_cron que perderían acceso o políticas inesperadas. Datos 100 % sintéticos,
sin URLs ni credenciales. Se verificó además por mutación que las pruebas fallan si se
debilita cada migración.

## Campana → tarea puntual y aviso semanal de Tareas (BUILD 4C, local 2026-10-15)

Sin cambios de base en este sistema (ni tablas, ni productores, ni RLS de notificaciones).

| Ubicación en la app | Archivo técnico | Cambio |
|---|---|---|
| Campana → tocar una notificación de Tareas | `src/components/notifications/NotificationsBell.tsx`, `src/components/AppSidebar.tsx` | `onNavigate` recibe la notificación tocada y la barra lateral pide ir a **esa** tarea (`irATareas(destinoDeNotificacion(n))`, `src/lib/tareasNavegacion.ts`): `source_table = 'tareas'` abre la tarea o petición con su detalle; `tareas_recurrentes`, su Tarea automática; otros módulos, la lista. Si ya no existe o no es accesible, Tareas lo dice sin revelar datos (lectura con la sesión del usuario, RLS). |
| (datos) | `src/hooks/useNotifications.ts` | `NotificationItem.source_table` (ya venía en la entrega; no se exponía). |
| Campana — accesibilidad | `src/components/notifications/NotificationsBell.tsx` | Filtros con nombre (“Filtrar por sucursal/categoría/tipo/fecha”); el botón colapsado se anuncia “Notificaciones, N sin leer” (antes, solo el número). |
| Configuración → Notificaciones | `src/lib/notifications/catalog.ts`, `src/hooks/useNotificationPreferences.ts` | Preferencia **Resumen semanal de Tareas** (`tareas_resumen_semanal`, `inBell: false`) sobre `user_notification_preferences` existente (sin migración: la tabla no restringe `event_type`). El hook expone `preferencesReady`/`preferencesError` para que un aviso apagado nunca aparezca un instante. La preferencia es por usuario (la tabla es única por usuario + evento), no por organización. |

El aviso semanal **no es una notificación**: no crea eventos ni entregas, no figura en la campana y su estado vive en
`tareas_aviso_semanal` (ver `docs/MODULOS/tareas.md`, BUILD 4C). Pruebas: `src/components/notifications/NotificationsBell.test.tsx`.

## Pendiente y límites

- **Aplicadas (M1–M3):** el 2026-10-12, en el proyecto operativo. Un `push` de Git no las aplica
  (ver `docs/FLUJO_PUBLICACION.md`). Cada migración comprueba antes que las funciones tengan el mismo
  dueño y que los jobs de `cron.job` corran como ese dueño, y aborta si no.
- **Tipos generados:** regenerados el 2026-10-12 desde la base real (no incluyen las RPC eliminadas).
- **QA manual autenticado** de la campana con usuarios sintéticos de dos organizaciones: pendiente.
- Fuera de esta etapa: RLS de Finanzas (los managers leen todos los `Egresos` de la
  organización); helpers generales de RLS (`has_role`, `get_user_organization_id`… aceptan un
  `user_id` arbitrario); aislar fallos por organización dentro de los demás cron (los de Tareas ya lo hacen desde la Etapa 2) y limpiar
  zonas horarias históricas; (el saneamiento de las Tareas legacy ya se hizo en la Etapa 3, 2026-10-13: se borraron
  las notificaciones de Tareas —incluidas las huérfanas— con sus entregas y lecturas; las `peticion_*` y las de otros módulos
  quedaron intactas; ver `docs/MODULOS/tareas.md`);
  push (`send-push-notification` solo acepta la clave `service_role`); el bug legado de
  lecturas que reaparecen (`notification_reads`); las funciones `trg_*` siguen siendo
  `SECURITY DEFINER` con `EXECUTE` por defecto (no son invocables como RPC); tres eventos del
  catálogo figuran `implemented: true` y nada los emite todavía.
