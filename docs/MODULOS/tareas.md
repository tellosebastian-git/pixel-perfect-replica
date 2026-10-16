# Tareas y Tareas automáticas

Estado: **Etapa 2 (motor de Tareas automáticas) implementada, aplicada en el proyecto Supabase
operativo y verificada — 2026-10-12.** **Etapa 3 (backup, reset pre-lanzamiento e integridad definitiva) ejecutada
y verificada — 2026-10-13**: las Tareas legacy se borraron con un backup interno verificado (ver “Reset
pre-lanzamiento” al final). Falta el QA manual de Sebastián (ver `ESTADO_ACTUAL.md`).
**BUILD 4A implementado y validado localmente — 2026-10-14:** datos/lógica y acciones controladas de
seguridad/permisos/PIN en la misma rama `codex/tareas-4a-1`. Ese nombre de rama es histórico:
no existe un BUILD 4A-2. Regresión local y 17/17 mutaciones de acciones y proyecciones aprobadas.
**BUILD 4B (rework UX/UI) implementado localmente — 2026-10-14** y **BUILD 4C (avisos semanales) cerrado localmente — 2026-10-15** (ver ambos builds al final).
Etapa 4 commiteada y respaldada en `origin/feat/tareas-etapa-4` (`63b78369`); sin publicación en `main`, despliegue ni cambios en producción.

- **Ubicación en la app:** barra lateral → Principal → Tareas (`src/components/TareasPanel.tsx`).
  Pestañas Tareas / Peticiones; dentro de Tareas, “Mis tareas | Negocio” (cuando corresponde), progreso de
  la semana y la lista temporal. **Tareas automáticas** y **Historial** son subvistas dentro de la pestaña Tareas.
- **Archivos técnicos:** `src/components/tareas/TareaFila.tsx`, `TareasSeccion.tsx`, `TareasProgresoSemanal.tsx`,
  `TareaDetalleDrawer.tsx`, `TareaFormDrawer.tsx`, `TareasFiltros.tsx`, `TareaEliminarDialog.tsx`,
  `TareasHistorial.tsx`, `PeticionesLista.tsx`, `PeticionFormDrawer.tsx`, `RecurrentesPanel.tsx`, `RecurrenteFila.tsx`,
  `TareasLoadError.tsx`, `TareaActionPinDialog.tsx`, `TareasAutomaticasPausaAviso.tsx`; hooks `src/hooks/useTareas.ts`,
  `useTareasRecurrentes.ts`, `useTareasSemana.ts`, `useTareasHistorial.ts`, `useTareasAlcance.ts`,
  `useTareaResponsables.ts`, `useTareaAcciones.ts`; utilidades `src/lib/tareasAgenda.ts`, `src/lib/tareasData.ts`,
  `src/lib/tareasRepeticion.ts`, `src/lib/tareasAutomaticas.ts`, `src/lib/tareasVencimiento.ts`.
- **Terminología:** al usuario se le dice **Tareas automáticas** (no “recurrencias”). Los nombres
  técnicos históricos se mantienen: tabla `tareas_recurrentes`, `RecurrentesPanel.tsx`,
  `useTareasRecurrentes.ts`.

## Modelo: Tarea automática → tareas generadas

| Pieza | Qué es |
|---|---|
| `tareas_recurrentes` | La **Tarea automática** (la “receta”): título, descripción, a quién (`individual` con `asignado_a` = `barberos.id`, o `team`), sucursal (obligatoria), hora, **programación** y `proxima_fecha`. Es la única dueña de la programación. |
| `tareas` | Cada **tarea generada** (ocurrencia). `tipo='tarea'`, `recurrente=false`, sin `repeat_*`, `creado_por_id` NULL y “Sistema”, `recurrencia_id` apunta a la Tarea automática. La etiqueta **Automática** de la pantalla sale de `recurrencia_id`. |
| `uq_tareas_recurrencia_fecha` | Índice único `(recurrencia_id, fecha_inicio)`: clave de idempotencia (una ocurrencia por Tarea automática y fecha). |

Crear una tarea con repetición desde **Nueva tarea** crea **solo la Tarea automática**; el servidor
genera la tarea de hoy si corresponde (antes el cliente creaba esa primera tarea con la fecha UTC y
podía desplazar el ciclo). Al **editar** una tarea no hay repetición: si viene de una Tarea automática,
el formulario indica editarla en Tareas → Tareas automáticas.

## Calendario canónico (única fuente: la base)

La serie de fechas se calcula **siempre desde `fecha_inicio`** (nunca “fecha anterior + intervalo”, que
acumula drift). Convención de días: 0 = domingo … 6 = sábado; las semanas empiezan el lunes.

| Preset | Regla |
|---|---|
| `daily` | cada día |
| `weekdays` / `weekends` | lunes a viernes / sábado y domingo |
| `weekly` / `biweekly` | cada 1 / 2 semanas, el día de la semana de `fecha_inicio` |
| `monthly` / `quarterly` / `semiannual` / `yearly` | cada 1 / 3 / 6 / 12 meses; si el mes no tiene ese día, el último día del mes (29/30/31, febrero, bisiesto; 29-feb anual → 28-feb en años no bisiestos) |
| `custom` | diario / semanal (con días elegidos) / mensual / anual, cada N (1–99). Semanal sin días elige el día de `fecha_inicio`; cada N semanas cuenta desde la semana del ancla |

Funciones (`SECURITY INVOKER`, `search_path=''`, **sin `EXECUTE` para ningún rol de cliente**):
`_tareas_auto_regla`, `_tareas_auto_siguiente` (primera fecha estrictamente posterior a una dada),
`_tareas_auto_vigente` (última fecha ≤ una dada), `_tareas_auto_hoy`, `_tareas_auto_lunes`,
`_tareas_auto_en_semana`, `_tareas_auto_tz_valida`. `calcNextDate` (`src/lib/recurrence.ts`) **no se
tocó**: lo usan los Gastos recurrentes. La función SQL anterior `_calc_next_tarea_date` se eliminó
(trataba weekly/biweekly/quarterly/semiannual/yearly como “+1 día”).

## Zona horaria

“Hoy” es `(ahora AT TIME ZONE organizations.timezone)::date`; sin zona válida usa
`America/Argentina/Buenos_Aires` y el motor deja un `WARNING`. No se usa la zona del navegador, la de la
sucursal ni `CURRENT_DATE`. La validación de zona horaria de la Etapa 1 se conserva.

## Motor y cron

- `process_tareas_recurrentes()` (cron horario `0 * * * *`, mismo nombre, firma y permisos: solo
  `service_role`) delega en `_tareas_auto_procesar(_now)`; `_now` permite probarlo con un instante fijo.
- Cada ejecución: (1) sincroniza pausas; (2) para cada Tarea automática activa con `proxima_fecha ≤ hoy` genera
  **como máximo una** ocurrencia, la **vigente** (última fecha de la serie ≤ hoy y ≥ `proxima_fecha`), y
  deja `proxima_fecha` en la primera fecha **posterior a hoy**.
- Idempotencia y concurrencia: `FOR UPDATE SKIP LOCKED` + `INSERT … ON CONFLICT (recurrencia_id, fecha_inicio) DO NOTHING`.
  Un reintento o una ejecución en paralelo no duplican.
- Aislamiento de errores: cada organización y cada Tarea automática corren en su propio sub-bloque; el
  `WARNING` lleva solo identificadores. Una Tarea automática defectuosa no frena a las demás.
- Antes de generar valida sucursal y persona (asignación vigente); si no, **pausa y no genera**.
- Al **guardar** (alta, cambio de programación, reanudar) el trigger `trg_tareas_recurrentes_generar`
  genera la tarea de hoy si corresponde; nunca bloquea el guardado (si falla, el cron reintenta).

### Recuperación excepcional (solo ante un fallo técnico del motor)

Si el motor estuvo detenido: **no reconstruye** lo perdido; genera como máximo la ocurrencia vigente. Si esa
ocurrencia **ya habría nacido vencida** (`fecha + tareas_vencimiento_dias_default < hoy`) **no se crea**, no
se avisa nada y se avanza a la próxima fecha futura. Trazabilidad en la propia Tarea automática:
`recuperaciones` (contador acumulado), `recuperacion_tipo` (`omitida` | `tardia`), `recuperacion_fecha`
(primera fecha perdida), `recuperacion_at`. **Un contador que crece indica que el motor está fallando**;
la recuperación no se vuelve comportamiento normal.

```sql
-- ¿Hubo recuperaciones excepcionales? (solo lectura)
select id, recuperaciones, recuperacion_tipo, recuperacion_fecha, recuperacion_at
from public.tareas_recurrentes where recuperaciones > 0 order by recuperacion_at desc;
```

## Pausas

`activo` es “¿genera?”; `pausa_motivo` dice por qué no (`activo = (pausa_motivo IS NULL)`):

| Motivo | Quién lo pone | Se reanuda sola |
|---|---|---|
| `manual` | una persona (Pausar) | **No**, nunca |
| `sucursal_inactiva` | sucursal desactivada (`activa=false` o `deleted_at`) | Sí, al reactivarla |
| `barbero_inactivo` | `barberos.activo=false`, persona borrada | Sí, al reactivarla |
| `barbero_sin_asignacion` | el barbero ya no tiene **ninguna asignación vigente** a la sucursal (ver abajo) | Sí, al volver a tener una |

- Los triggers sobre `barberos`, `sucursales` y `barberos_sucursales` pausan **y** reanudan; el motor repite la
  sincronización cada hora como red de seguridad. Si hay varias causas, manda la más fuerte
  (sucursal > persona inactiva > sin asignación). Una pausa automática **nunca** pisa una manual.
- Al reanudar, `proxima_fecha` se recalcula desde hoy; **no se genera lo atrasado**.
- Reanudar a mano con el recurso inactivo se rechaza con un mensaje claro; la tarjeta no ofrece “Reanudar” para
  una pausa automática y muestra el motivo.
- **Aviso al usuario:** `tarea_automatica_pausada` (a dueño, encargado general y encargados de la sucursal)
  solo para `sucursal_inactiva` y `barbero_inactivo`. `barbero_sin_asignacion` **no** genera aviso en la campana: el aviso
  es previo, dentro de la acción que la provoca.
- **Antes de confirmar** una acción que realmente pausará Tareas automáticas se muestra cuántas se pausarán (solo si hay):
  *Finalizar actividad* de un barbero (`EquipoUnificado.tsx`), *Desactivar sucursal* (`SucursalTabContent.tsx`),
  *Eliminar asignación* en `EquipoSucursalPanel.tsx` y, en `BarberSucursalesGeneralSection.tsx`, *Eliminar asignación recurrente*
  y *Cambiar sucursal principal* — estas tres últimas **solo si era la última asignación vigente** del barbero en esa
  sucursal. *Desactivar de la sucursal* (`disponible=false`) **no** avisa porque no pausa nada. Mismo recuadro de
  advertencia que ya usaban los diálogos para turnos futuros; si no se puede consultar, el aviso lo dice.

### Pertenencia estructural (E2-M5) vs. disponibilidad diaria

`barberos_sucursales.disponible` es **disponibilidad operativa**: dónde está el barbero *hoy*. Lo recalcula solo el cron
`bs-recompute-disponibles-daily` y solo una fila por barbero puede estar disponible. **No participa** en pausar ni reanudar
Tareas automáticas. Lo que decide es la **pertenencia estructural**: existe alguna asignación vigente del par
(organización, barbero, sucursal):

| Tipo de fila | Cuenta como pertenencia |
|---|---|
| `principal` | mientras exista la fila |
| `recurrente` | mientras exista la fila (no depende de que hoy sea uno de sus `dias_semana`) |
| `temporal` | solo entre `fecha_inicio` (vacío = ya empezó) y `fecha_fin`, según el “hoy” de la organización. Futura: todavía no. Vencida: ya no, aunque la fila histórica siga existiendo (no se borra) |

Triggers de `barberos_sucursales`: alta, baja y cambios de `organization_id, barbero_id, sucursal_id, tipo, fecha_inicio,
fecha_fin` (mover la principal sincroniza la sucursal que se deja y la nueva). Una temporal que empieza o vence **sin que
nadie edite nada** la resuelve la sincronización horaria del motor: puede demorar hasta una hora. Un barbero que trabaja
en dos sucursales ya no pausa ni reanuda nada por la rotación diaria.

## Edición

`proxima_fecha` la fija **solo la base** y se recalcula únicamente si cambia la programación (inicio,
repetición, intervalo, días) o al reanudar. Editar título, descripción, hora o asignación **no** la mueve; reenviar la
misma programación tampoco (se compara la regla normalizada). Un cliente no puede escribir `proxima_fecha`,
`pausa_motivo`, `pausada_at` ni `recuperacion_*`. La organización de una Tarea automática no cambia, y su
sucursal y persona deben ser de **la misma organización** (cierra el hueco que dejaba la clave foránea sola).

## Vencimientos

`process_vencimientos_tareas()` (cron horario): `pendiente` vencida → `estado='vencida'` + `vencida_at`;
**`en_progreso` vencida → conserva `estado='en_progreso'` y recibe `vencida_at`** (“empezada” y “atrasada” son
independientes; la tarjeta muestra **En progreso** y **Vencida** a la vez, y los filtros la incluyen en “Vencida”). Aviso
`tarea_vencida` una sola vez. Aislamiento por fila. Plazo: `fecha_inicio + organizations.tareas_vencimiento_dias_default`
en el día de la organización.

## Identidad y notificaciones

`profiles.barbero_id → barberos.id`; `profiles.id = auth.users.id`. Un barbero puede tener 0..n usuarios. El
helper `_notif_barbero_users(org, barbero_id)` devuelve esos usuarios (exige que el barbero sea de la organización).
`tareas.asignado_a_id` y `tareas_recurrentes.asignado_a` son **barberos**; **nunca** se usan como id de usuario
(corregido en `trg_tareas_after_insert_notif`, `process_vencimientos_tareas` y
`trg_barberos_sucursales_after_disponible_off_notif`). Detalle de eventos: `docs/MODULOS/notificaciones.md`.

## Seguridad

| Función | Tipo | Quién la ejecuta |
|---|---|---|
| `_tareas_auto_*` (calendario, motivo, reconciliar, generar, procesar), `_notif_barbero_users` | `SECURITY INVOKER`, `search_path=''` | Nadie desde un cliente (`anon`, `authenticated`, `service_role` sin `EXECUTE`) |
| `process_tareas_recurrentes()`, `process_vencimientos_tareas()` | `SECURITY DEFINER`, `search_path=''` | Solo `service_role` y el dueño (cron) |
| `trg_tareas_recurrentes_prepare`, `trg_tareas_recurrentes_generar`, `trg_tareas_auto_sync_*` (barberos / sucursales / barberos_sucursales) | `SECURITY DEFINER`, `search_path=''`, filtran por `organization_id` | Solo como trigger; sin `EXECUTE` para clientes |
| ~~`trg_tareas_tipo_guard`~~ | — | **Eliminado** el 2026-10-13 (3B): lo reemplaza `tareas_tipo_check` |

El trigger de preparación distingue una escritura de cliente (`auth.uid()` presente y sin la marca interna
`vittro.tareas_auto`) de las internas (motor, sincronización, cron, `service_role`). Las funciones DEFINER son
necesarias porque quien desactiva a una persona o sucursal puede no tener `UPDATE` sobre las Tareas automáticas
ni acceso a los helpers de notificaciones cerrados en la Etapa 1.

## Integridad

CHECKs en `tareas_recurrentes` (validados): preset permitido, custom con frecuencia válida, intervalo 1–99, días
0–6 solo en custom semanal, `pausa_motivo` y `recuperacion_tipo` en su conjunto, `activo ⇔ sin motivo`.
`tareas.estado` queda limitado a `pendiente, en_progreso, completada, vencida, rechazada, aprobada` (CHECK validado).
`tareas.tipo` solo admite `tarea` y `peticion`: CHECK `tareas_tipo_check` **validado** (3B, 2026-10-13). `admin` dejó de
ser un valor válido; el trigger temporal `trg_tareas_tipo_guard` (E2-M4) y su función se eliminaron porque el CHECK lo
reemplaza por completo (era un trigger y no un CHECK solo porque existían 141 filas `admin` históricas que el `UPDATE` de la
clave foránea `ON DELETE SET NULL` habría hecho rechazar). Además `tareas_recurrencia_check` (validado): una ocurrencia
de Tarea automática (`recurrencia_id` no nulo) es siempre `tipo='tarea'` y tiene `fecha_inicio`, de modo que
`uq_tareas_recurrencia_fecha` las cubre a todas; el `ON DELETE SET NULL` de la receta sigue funcionando.

## Migraciones (aplicadas 2026-10-12 en el proyecto operativo)

`20261012120000_tareas_automaticas_calendario.sql`, `…120100_tareas_automaticas_pausa_integridad.sql`,
`…120200_tareas_automaticas_motor.sql`, `…120300_tareas_tipo_estado_integridad.sql` y la corrección
`…120400_tareas_automaticas_pertenencia_estructural.sql` (E2-M5). En Supabase quedaron registradas con el mismo nombre
y la versión que asignó el conector (`20261012190213`, `…190408`, `…190548`, `…190623`, `20261012220833`).
Cada una trae su preflight (aborta si falta la Etapa 1, hay dueños distintos, un job de cron perdería acceso o una
Tarea automática apunta a otra organización) y verifica sus permisos al final.

Etapa 3 (2026-10-13): `20261013120000_tareas_integridad_post_reset.sql` (3B; remota `20261013234522`,
`tareas_integridad_post_reset`). Su preflight aborta, sin tocar nada, si queda alguna fila con un tipo fuera de
`tarea`/`peticion` o una ocurrencia automática inválida; no modifica datos, RLS, grants, crons ni el motor. El reset en sí **no es una
migración**: es una operación única con scripts en `supabase/diagnostics/20261013_etapa3_reset_tareas/`.

## Pruebas

```bash
npm install --prefix node_modules/.admin-sql-test --no-package-lock --no-save @electric-sql/pglite@0.5.8
node supabase/tests/tareas-automaticas-sql.mjs                    # 82 pruebas SQL (72 de la Etapa 2 + 10 de la Etapa 3)
node supabase/tests/tareas-automaticas-sql.mjs --mutation-check   # 24 mutaciones, todas detectadas
node supabase/tests/notifications-security-sql.mjs                # Etapa 1: 44 pruebas, siguen pasando
bunx vitest run src/lib/tareasAutomaticas.test.ts src/components/tareas
```

`tareas-automaticas-sql.mjs` reconstruye la forma real de producción (migraciones históricas + Etapa 1), prueba los
defectos previos y aplica las cuatro migraciones nuevas. Cubre calendario (semanal, cada N, varios días, mensual
29/30/31, febrero, bisiesto, 29-feb, sin drift), zona horaria (Buenos Aires vs Madrid, medianoche, respaldo),
generación (`tipo='tarea'`, nunca `admin`, idempotencia, reintento, generación al guardar), recuperación
(`omitida`/`tardia`, sin aviso retroactivo, contador), recursos (sucursal, persona, pertenencia estructural: principal/recurrente/temporal, rotación de disponibilidad, manual vs
automática, prioridades, red de seguridad), edición, vencimientos (incluye `en_progreso`), destinatarios (usuarios
del barbero, nunca `barberos.id`), aislamiento entre organizaciones, aislamiento de errores, permisos y
`SECURITY DEFINER`, y los controles de las propias migraciones. Un hecho que las pruebas **no** cubren: la
concurrencia real entre dos sesiones (PGlite tiene una sola conexión); `FOR UPDATE SKIP LOCKED` se verifica en
el código entregado.

## Reset pre-lanzamiento (Etapa 3) — ejecutado 2026-10-13

Decisión de producto: antes del lanzamiento se descartó el historial de Tareas generado por el motor anterior (141
tareas `tipo='admin'` invisibles para los barberos y Tareas automáticas con `proxima_fecha` fuera de calendario), en vez
de sanearlo fila por fila. No es una migración: es una operación única, con scripts reproducibles y verificables en
`supabase/diagnostics/20261013_etapa3_reset_tareas/` (ver su `README.md`).

- **Alcance borrado** (calculado en el momento, no con cifras fijas): las tareas con `tipo IN ('admin','tarea')`, **todas**
  las Tareas automáticas y las notificaciones de Tareas identificadas solo por columnas estructurales
  (`source_module='tareas'` + `source_table` + evento + `source_id`; incluidas las huérfanas). Sus entregas y lecturas
  cayeron por `ON DELETE CASCADE`. Cantidades reales: 144 tareas (141 `admin` + 3 `tarea`), 5 Tareas automáticas
  (todas activas), 11 notificaciones (8 huérfanas), 18 entregas y 1 lectura.
- **Intacto:** las peticiones (`tipo='peticion'`, hoy no hay ninguna) y las notificaciones `peticion_*`; 3.099
  notificaciones y 2.918 entregas de otros módulos; organizaciones, barberos, sucursales y `barberos_sucursales` (mismas
  cantidades, ids y último `updated_at`); funciones, triggers, grants, RLS y crons de las Etapas 1 y 2.
- **Cómo:** (1) schema `etapa3_backup` fuera de `public`, sin acceso para `anon`, `authenticated` ni `service_role`
  (solo el dueño), con copias completas, `manifest` (cantidades, md5 de filas completas, md5 de ids) e ids de control;
  (2) 27 verificaciones, backup = vivo en ambos sentidos; (3) ensayo de restauración dentro de un bloque que siempre se
  revierte (R → T → N → entregas → lecturas, mismos ids y checksums, triggers de usuario deshabilitados solo durante el
  `INSERT` y vueltos a habilitar; sin `session_replication_role`); (4) reset en una sola transacción bajo `LOCK`, que
  recalcula el alcance, lo compara con el backup, borra en orden notificaciones → tareas → Tareas automáticas y comprueba
  20 post-condiciones antes del `COMMIT`; (5) segunda ejecución: `{"ya_aplicado": true, "borradas": 0}`.
- **Copia de seguridad:** la única es el schema `etapa3_backup` **dentro del mismo proyecto Supabase** (no hay una copia
  fuera de la base). Contiene datos reales de las organizaciones y sigue ahí; qué se hace con él (conservarlo o eliminarlo
  con `DROP SCHEMA etapa3_backup CASCADE`) es una decisión pendiente de Sebastián. Restaurar:
  `06_restaurar_SOLO_SI_SE_DECIDE.sql`; tras 3B las filas `admin` no pueden volver sin quitar antes `tareas_tipo_check`.
- **Lo que se ve:** la lista de Tareas quedó vacía y las 5 Tareas automáticas **hay que volver a crearlas**: no se
  restauran solas, y el motor no genera nada hasta entonces.

## Deuda (no es esta etapa)

- Rediseño de la pantalla: hecho localmente en 4B (ver al final). La fecha organizacional al eliminar una automática y
  la paginación se corrigieron localmente en BUILD 4A; no confundir ese estado local con un despliegue.
- Sigue sin existir un equivalente TypeScript del calendario: las próximas fechas de la semana las calcula la base
  (`tareas_previstas`, corrección final de 4A) y el frontend solo las ubica.
- Avisos semanales globales (lunes/jueves/sábado): implementados localmente en BUILD 4C; despliegue y QA autenticado pendientes (ver al final).

## BUILD 4A — datos, lógica, seguridad y permisos (local, 2026-10-14)

Base: `43bd9ce` (Etapa 3), rama `codex/tareas-4a-1`. La parte de datos ya validada se conserva;
la autorización posterior amplía este mismo build a seguridad, permisos y migración local.
Sin cambios del motor/crons, rework 4B ni avisos 4C. Impeccable **4.1.1 ya estaba instalado**
en `.agents/skills/impeccable/SKILL.md`; se cargó su contexto una vez y se aplicó `harden` para fechas,
errores, validaciones y datos grandes, conservando el diseño. No se instaló ni actualizó el skill.

### Comportamiento y archivos

| Ubicación en la app | Archivos técnicos modificados o agregados | Cambio |
|---|---|---|
| Principal → Tareas → lista, Hoy, Peticiones, Historial | `src/components/TareasPanel.tsx` | Fechas civiles sin desplazamiento; Hoy exacto; timestamps de la organización; errores con reintento; historial bajo demanda y botón Cargar más. Se conserva la estructura visual. |
| Principal → Tareas → lectura y creación | `src/hooks/useTareas.ts`, `src/lib/tareasData.ts` (nuevo) | Abiertas y peticiones por páginas de hasta 500, sin completadas de Tareas. Orden descendente `created_at,id`, cursor compuesto; toda página conserva organización/sucursal. Si una página falla no se publica una carga parcial como completa. Sucursal activa de la organización validada al crear, incluso fuera del formulario. |
| Principal → Tareas → Historial | `src/hooks/useTareasHistorial.ts` (nuevo) | Páginas de hasta 50 solo al abrir; filtros de responsable/sucursal aplicados en servidor, antes de paginar. El contador indica filas cargadas. Una página vacía confirma el final, incluso si el servidor impone un límite menor. |
| Principal → Tareas → Nueva tarea / Editar tarea | `src/components/tareas/TareaFormDialog.tsx` | En contexto global exige elegir sucursal; cambia responsables al cambiarla. Guarda la sucursal elegida, preserva datos ante error y espera confirmación antes de cerrar. Validación de sucursal activa solo en creación; editar metadata de una tarea antigua sin sucursal no la reasigna ni se bloquea por ese motivo. |
| Principal → Tareas → Tareas automáticas → lista / edición | `src/hooks/useTareasRecurrentes.ts`, `src/components/tareas/RecurrentesPanel.tsx`, `src/components/tareas/TareaRecurrenteFormDialog.tsx` | Error distinto de vacío, reintento, lista paginada estable, fechas organizacionales también al eliminar futuras pendientes; mismos responsables estructurales. Editar una automática de sucursal inactiva conserva el comportamiento previo y no la reactiva. |
| Principal → Tareas → selectores de responsables | `src/hooks/useTareaResponsables.ts` (nuevo) | Consulta solo identificadores/nombres y pertenencia en sucursales del contexto, con filtros de organización en asignación y persona. Deduplica. Principal/recurrente cuentan siempre; temporal solo vigente según el día de la organización. No consulta ni filtra `disponible`. |
| Principal → Tareas y Tareas automáticas → fechas | `src/lib/dateUtils.ts`, `src/lib/tareasVencimiento.ts`, `src/hooks/useOrganizationToday.ts` (nuevo) | Reutiliza `todayInTimezoneIso` y su respaldo Buenos Aires. Calcula diferencias entre días civiles; actualiza Hoy cada 30 segundos y al volver a la pestaña. No modifica utilidades compartidas de otros módulos. |
| Principal → Tareas / Tareas automáticas → errores de carga | `src/components/tareas/TareasLoadError.tsx` (nuevo) | Mensaje accesible y reintento, sin confundir fallo con ausencia de datos. |
| Barra lateral → campana de Notificaciones | `src/hooks/useNotifications.ts` | Ya no llama a `useTareas`. Consulta solo los IDs de tareas referenciados por las últimas 100 entregas, conservando organización, sucursal, RLS y filtros de vigencia. Invalidación bajo el prefijo existente `tareas`. |
| Validaciones de las superficies anteriores | `src/lib/tareasData.test.ts`, `src/hooks/tareasReads.test.tsx`, `src/components/tareas/TareasReliability.test.tsx` (nuevos) | Fechas, más de 1000 filas con páginas limitadas, fallos intermedios, scope y cambio de contexto, historial, campana, responsables y estados visibles/guardado. |

`src/hooks/useSupabaseData.ts` conserva su filtrado por sucursal de origen, compartido con otros módulos.
Solo se ajustó la proyección de integrantes y el retorno del alta para excluir el hash del PIN (ver
dependencia de seguridad debajo). Los responsables de Tareas mantienen su consulta específica.
`src/lib/tareasAutomaticas.ts` se reutiliza sin cambios como regla
de pertenencia ya comprobada en Etapa 2.

### Seguridad, límites y pendientes

- Las políticas candidatas de Tareas aplican los alcances detallados abajo. Los filtros y las claves
  de caché complementan RLS; no la reemplazan. Las políticas remotas aún no fueron modificadas.
- No se cargan filas de una organización previa mientras cambia el contexto. Se espera la resolución
  de sucursal antes de consultar. Las lecturas aceptan cancelación al desmontarse o cambiar el contexto.
- La lista operativa reúne todas las abiertas/peticiones en memoria para conservar filtros y contadores
  actuales; ya no reúne todo el histórico de Tareas completadas. No es virtualización ni un snapshot
  transaccional: cambios concurrentes pueden requerir refrescar. El cursor evita desplazamientos por
  nuevas filas o borrados que ocurrirían al paginar por posición.
- Inicio y completado de `tipo='tarea'` usan identidad y `clock_timestamp()` del servidor. Las
  peticiones conservan su flujo anterior; no pasan por las nuevas acciones de tareas internas.
- El borrado de automática e hijas conserva sus dos operaciones previas; no se convirtió en transacción.
- Los avisos de accesibilidad de los formularios heredados (título/descripción de Sheet) y su estructura
  visual siguen pendientes del rework 4B. No se ejecutó QA visual autenticado ni se tocaron datos reales.

### Validación del bloque de datos de BUILD 4A (checkpoint anterior conservado)

- Base sin cambios: **163 pruebas / 26 archivos**, build OK; TypeScript de la app con **5 errores**;
  lint global **378 errores y 52 advertencias**. Los intentos iniciales de tests/build dentro del sandbox
  fallaron por `EPERM` de Windows; al ejecutarlos con acceso adecuado la base pasó tests y build.
- Resultado de ese checkpoint: **184 pruebas / 29 archivos**, todas pasan. Incluye 21 regresiones nuevas.
  Build de producción local OK, con la advertencia de tamaño de bundle que ya existía.
- `tsc --noEmit -p tsconfig.app.json`: los mismos cinco errores y salida idéntica a la base:
  `src/contexts/AuthContext.tsx:80`, `src/contexts/OrganizationContext.tsx:86,106`,
  `src/hooks/useSubscriptionAccess.ts:65`, `src/lib/readRetry.test.ts:21`. Son dependencias generales
  de acceso/contexto y su prueba de reintentos; no corresponden a un nuevo comportamiento de Tareas.
- Lint global: **378 errores y 50 advertencias**. Lint de todos los archivos de código modificados y
  nuevos: **0 errores**, una advertencia preexistente de dependencias en el filtro de
  Principal → Tareas → Tareas automáticas (`src/components/tareas/RecurrentesPanel.tsx`).
- Revisión independiente de solo lectura: detectó validación de sucursal activa aplicada indebidamente
  a edición. Se corrigió en ambos formularios y se cubrieron edición legacy sin sucursal y edición de
  automática de sucursal inactiva. No se cambió ni reasignó la sucursal de esos registros.
- Las pruebas de consultas usan el cliente Supabase real con respuestas de red simuladas. Verifican
  filtros, cursores y aislamiento de caché; **no certifican RLS en una base remota**. No se hicieron
  escrituras en producción ni QA visual autenticado. Las validaciones SQL del bloque de seguridad
  se registran a continuación y no implican aplicar la migración en producción.

### QA manual pendiente (ambiente de prueba, datos sintéticos)

1. **Principal → Tareas** — `src/components/TareasPanel.tsx`, `src/lib/dateUtils.ts`: configurar una
   organización en Buenos Aires y un dispositivo en otra zona. Con tareas de ayer/hoy/mañana, comprobar
   que Hoy contiene solo las de la fecha organizacional, que la tarjeta no corre de día y que una
   tarea en progreso vencida conserva ambos indicadores. Repetir cerca de medianoche y volver a la pestaña.
2. **Principal → Tareas / Tareas automáticas** — `src/components/TareasPanel.tsx`,
   `src/components/tareas/RecurrentesPanel.tsx`: bloquear la consulta de lectura. Debe mostrarse error,
   no estado vacío. Restablecer conexión y pulsar Reintentar; comprobar también fallo de una segunda página.
3. **Principal → Tareas → Nueva tarea** — `src/components/tareas/TareaFormDialog.tsx`,
   `src/hooks/useTareas.ts`: desde Todas, no guardar sin sucursal. Elegir A y asignar a alguien perteneciente
   a A aunque hoy no esté disponible allí; comprobar temporales vigentes/futuras/vencidas. Cambiar a B:
   debe limpiar la selección individual anterior. Forzar fallo de guardado y verificar que conserva el texto.
4. **Principal → Tareas → lista / Historial** — `src/hooks/useTareas.ts`, `src/hooks/useTareasHistorial.ts`:
   con más de 1000 abiertas y muchas completadas, comprobar presencia de la abierta más antigua. Antes
   de abrir Historial, la red no debe pedir todas las completadas. Abrirlo, cargar más, cambiar filtros y
   provocar un fallo de página: debe permitir reintentar sin presentar un total parcial como total histórico.
5. **Barra lateral → campana** — `src/hooks/useNotifications.ts`: abrirla fuera de Tareas y comprobar que
   solo pide tareas por IDs de las entregas. Completar una tarea y confirmar que su aviso se actualiza.
   Cambiar sucursal y luego sesión/organización: nunca deben aparecer tareas de la sesión anterior.
6. **Principal → Tareas → Editar / Tareas automáticas → Editar** —
   `src/components/tareas/TareaFormDialog.tsx`, `src/components/tareas/TareaRecurrenteFormDialog.tsx`:
   editar solo el título de una automática pausada por sucursal inactiva sin reactivarla. Una tarea
   interna sin sucursal ya no es un estado persistible después de aplicar la migración 4A; si existe
   una antes, la migración aborta para resolver sus datos, sin asignarle una sucursal inventada.

### Acciones controladas y autorización local

**Ubicación:** Principal → Tareas → Iniciar / Completar / Deshacer; Tareas automáticas → alcance Manager.
**Archivo de seguridad:** `supabase/migrations/20261014120000_tareas_acciones_controladas.sql`.

La excepción de `AGENTS.md` para DB/RLS fuera de Lovable y `SECURITY DEFINER` fue autorizada
explícitamente por el usuario el 2026-10-14, solo para implementar/probar localmente este BUILD 4A.
No autoriza aplicar migraciones, desplegar funciones ni publicar la rama.

- Nuevas funciones elevadas solo en `tareas_private`, con `search_path = ''` y referencias explícitas.
  Las dos entradas `public.tareas_accion` y `public.tareas_accion_pin` son `SECURITY INVOKER`.
  Se revoca EXECUTE público/anon; la primera entrada es para `authenticated`, la segunda solo
  `service_role`. Tener EXECUTE no alcanza: la autorización se valida dentro de la función privada.
- Cuentas personales: identidad de `auth.uid()`. Cuenta de sucursal: la Edge Function resuelve
  `auth.getUser()` del token, calcula el digest del PIN en servidor y ejecuta la acción en una llamada.
  La ruta privilegiada verifica que el caller sea `service_role`; nunca acepta como prueba un UUID
  del navegador. Campos inesperados, incluyendo `actor_id`/`user_id`/`pin_hash`, se rechazan.
- Owner/General Manager conservan alcance de su organización. Manager requiere relación real
  `user_sucursales(user_id, organization_id, sucursal_id)`, también en recetas y peticiones.
  Barbero: tarea propia o de equipo, con pertenencia estructural vigente; no `disponible`.
  Las cuentas de sucursal requieren su vínculo real en `sucursal_accounts` y PIN. Roles combinados
  no permiten al Manager usar el rol Barber para ampliar sucursales ni a la cuenta de sucursal editar.
- No se agregan grants generales de UPDATE. Las tareas de Barbero/cuenta de sucursal no admiten
  edición administrativa directa. Un trigger INVOKER impide falsificar estado, inicio y completado
  aun desde una cuenta administrativa que pueda editar título/descripción.
- Inicio registra usuario/nombre e instante del servidor; se permite iniciar vencida. Completar
  registra usuario/nombre/instante y guarda el estado anterior en una tabla privada.
- Deshacer dura **30 segundos**, solo para quien completó, con la autorización todavía vigente.
  Restaura pendiente, en_progreso o vencida según el valor exacto anterior; conserva inicio.
  Cada modificación renueva `accion_version`; cualquier cambio posterior invalida el deshacer.
  `FOR UPDATE` serializa acciones concurrentes: el segundo completado no sobrescribe actor/fecha.
- La migración comprueba tareas sin sucursal bajo bloqueo antes del CHECK. La inspección remota
  previa de solo lectura encontró cero tareas/peticiones; el preflight se repite al aplicar.
  No cambia ni convierte peticiones y no inventa sucursales. Valida sucursal y responsable en la
  misma organización. No reescribe las funciones de motor/crons ni productores de notificaciones.
- PIN: se reutiliza el hash existente de `set-pin` (SHA-256 + `PIN_SALT`, con el fallback heredado).
  No se rota el algoritmo en este build. PIN ambiguo o varios perfiles vinculados falla cerrado;
  solo personas activas con perfil/rol habilitado pueden actuar. Cinco intentos por cuenta en cinco
  minutos; contador bajo bloqueo, persistente incluso cuando se rechaza. El PIN no se registra en
  logs ni respuestas y se elimina de las variables de mutación frontend al terminar.

| Ubicación funcional | Archivos de la continuación del mismo 4A |
|---|---|
| Principal → Tareas → acciones y aviso Deshacer | `src/components/TareasPanel.tsx`, `src/hooks/useTareaAcciones.ts`, `src/hooks/useTareas.ts` |
| Principal → Tareas → confirmación con PIN | `src/components/tareas/TareaActionPinDialog.tsx`, `supabase/functions/tareas-action/index.ts`, `supabase/functions/tareas-action/handler.ts`, `supabase/config.toml` |
| Principal → Tareas / Tareas automáticas → autorización, integridad y concurrencia | `supabase/migrations/20261014120000_tareas_acciones_controladas.sql` |
| Contrato de datos de las mismas acciones | `src/integrations/supabase/types.ts`, `supabase/tests/tareas-generate-types.mjs` |
| Validaciones de acciones/PIN/interfaz | `supabase/tests/tareas-acciones-sql.mjs`, `supabase/tests/tareas-automaticas-sql.mjs`, `src/hooks/useTareaAcciones.test.tsx`, `src/lib/tareaPinServer.test.ts`, `src/components/tareas/TareaActionPinDialog.test.tsx`, `src/components/tareas/TareasReliability.test.tsx` |

**Dependencia real del PIN resuelta localmente dentro de 4A:** la consulta de permisos efectiva
confirmó SELECT/INSERT/UPDATE de `authenticated` sobre `barberos.pin_hash`. La revocación histórica
por columna no anulaba los grants generales de tabla. No se consultó ningún hash ni registro real.
La migración candidata conserva los permisos efectivos previos sobre todas las demás columnas y
quita únicamente lectura/escritura directa del hash; aborta si queda acceso heredado. RLS de barberos
y `set-pin` servidor permanecen intactos. Se verifican permisos, lectura/escritura denegadas y
configuración de PIN desde servidor con datos sintéticos.

Para evitar que `SELECT *` falle tras restringir esa columna, los siguientes consumidores piden
explícitamente los mismos campos previos salvo el hash, mediante `src/lib/barberoColumns.ts`:

| Ubicación funcional | Archivo técnico |
|---|---|
| Cobrar → selección de integrante | `src/hooks/useCobrarBarbers.ts` |
| Carga compartida de integrantes / Configuración → Equipo → alta | `src/hooks/useSupabaseData.ts` |
| Configuración → Mi Negocio → Equipo | `src/components/MiNegocioPanel.tsx` |
| Configuración → Equipo → comisión de equipo | `src/components/config/ComisionEquipoConfig.tsx` |
| Turnos → Agenda → integrantes | `src/components/TurnosAgendaPanel.tsx` |

Es una adaptación de consultas necesaria para el PIN; no cambia filtros, roles de equipo, cálculos,
datos financieros, interfaz ni flujos de esos módulos. **Publicación futura:** coordinar frontend y
migración y recargar sesiones antiguas: una pestaña con código anterior seguirá pidiendo `SELECT *`
y recibirá error. La vulnerabilidad preexistente permanece en producción hasta una aplicación autorizada.

### Regresión de seguridad: evidencia y límites

- PostgreSQL real local, dos conexiones independientes, esquema propiedad de un rol no superusuario:
  **43 pruebas aprobadas**, incluyendo todos los roles, cross-tenant/cross-sucursal, PIN, campos
  administrativos, identidades falsificadas, roles combinados, equipo, fechas del servidor, deshacer
  doble completado y cambio de estado concurrentes, permisos del hash y preservación de peticiones.
  Recetas siguen generando tareas y notificaciones tras la migración.
- Etapa 1: **44 SQL aprobadas**. Etapas 2–3: **82 SQL aprobadas**, **24/24 mutaciones detectadas**.
  Administración comercial: **18 SQL aprobadas**. Estas suites previas se conservan; la de automáticas
  ahora también exporta su fixture para reutilizarlo sin ejecutar sus casos al importarla.
- Vitest: **199 pruebas / 32 archivos aprobados**. Build local OK; aviso de bundle grande preexistente.
  TypeScript conserva exactamente los cinco errores previos ya detallados. Lint global conserva
  **378 errores / 50 advertencias**; no se ampliaron a este bloque. Lint nuevo de acciones/PIN sin errores.
- Revisión independiente: detectó y se corrigió la combinación Manager+Barber / cuenta+Owner.
  La segunda lectura confirmó la corrección, sin problemas críticos nuevos.
- **12/12 mutation tests de acciones detectados**, incluida la reexposición del hash del PIN.
  Debilitar organización, bloqueos, versión, autor/plazo del deshacer, alcance Manager, identidad/PIN,
  límite de intentos, protección de campos o pertenencia estructural hace fallar la suite.
  El runner distingue importación de fixtures de ejecución directa; no omite las suites previas.
- No se ejecutó QA autenticado contra producción ni despliegue de la nueva Edge Function.
  Un resultado local no certifica configuración/secrets/roles de una publicación futura.

### Reproducción local y tipos

El repo no tenía script local de regeneración para schema candidato. Se agregó una regeneración
acotada por introspección con el generador oficial de Supabase `@supabase/postgrest-typegen@0.4.0`:
obtiene los tipos desde la base local migrada e incorpora automáticamente las columnas/RPC nuevas
en el archivo existente; conserva las partes ajenas que el fixture no modela. No hay firmas de
columnas ni funciones escritas a mano. Referencia: https://github.com/supabase/sdk/tree/main/packages/postgrest-typegen

```powershell
npm install --prefix node_modules/.admin-sql-test --no-package-lock --no-save @electric-sql/pglite@0.5.8 embedded-postgres@18.4.0-beta.17 pg@8.16.3 @supabase/postgrest-typegen@0.4.0
node supabase/tests/tareas-acciones-sql.mjs --generate-types
node supabase/tests/tareas-acciones-sql.mjs --mutation-check
node supabase/tests/notifications-security-sql.mjs
node supabase/tests/tareas-automaticas-sql.mjs
node supabase/tests/tareas-automaticas-sql.mjs --mutation-check
node supabase/tests/admin-commercial-sql.mjs
npm test
npx tsc --noEmit -p tsconfig.app.json
npm run lint
npm run build
```

La suite 4A crea PostgreSQL UTF-8 en directorio temporal y escucha solo en `127.0.0.1:55439`.
Siempre cierra conexiones/servidor; deja el directorio sintético para diagnóstico. No acepta URL
remota, no usa credenciales reales y no modifica dependencias de la aplicación.

### Cierre local y publicación

Estado al cierre de BUILD 4A (histórico; estado vigente de la rama en BUILD 4C): completo en código y regresión local, con datos/lógica, acciones seguras, PIN, roles, integridad,
timestamps, deshacer, concurrencia, tipos y documentación. Rama `codex/tareas-4a-1`, base `43bd9ce`;
cambios locales sin commit/push, sin migración/Edge Function aplicada a producción. No se inició 4B/4C.
La publicación futura requiere autorización separada, coordinación de frontend/migración/Edge Function,
mantener `tareas_private` fuera de los schemas expuestos y QA autenticado. La protección candidata del
PIN no remedia retroactivamente una eventual exposición previa; no se verificó ni se afirma que la haya habido.

### QA manual de acciones (ambiente de prueba, después de autorizar su preparación)

1. **Principal → Tareas**, `src/components/TareasPanel.tsx`, `src/hooks/useTareaAcciones.ts`:
   con Owner y General Manager de A, iniciar/completar tareas individuales y de equipo de A.
   Verificar actor/fecha de servidor. Una sesión de B no debe leer ni actuar en esas tareas.
2. **Principal → Tareas / Tareas automáticas**, migración `20261014120000_tareas_acciones_controladas.sql`:
   Manager de S1 puede leer/editar/actuar en S1, no en S2. Repetir con Manager+Barber estructural de S2.
3. **Principal → Tareas**, misma migración y `src/components/TareasPanel.tsx`:
   Barbero inicia/completa tarea propia y de equipo en sucursal estructural aunque `disponible=false`.
   No puede actuar en tarea ajena/otra sucursal ni editar título, responsable, sucursal o borrar/crear tareas.
4. **Principal → Tareas → confirmación PIN**, `src/components/tareas/TareaActionPinDialog.tsx` y
   `supabase/functions/tareas-action/handler.ts`: cuenta de S1 prueba PIN correcto, incorrecto, PIN
   de persona sin permiso y seis intentos fallidos. No debe autorizarse alterando un UUID en la petición.
5. **Principal → Tareas → Deshacer**, `src/hooks/useTareaAcciones.ts` y migración 4A:
   completar desde pendiente y desde en progreso; Deshacer debe restaurar cada estado exacto.
   Probar otro usuario, más de 30 segundos y edición posterior: todos rechazados sin sobrescribir.
6. **Principal → Tareas**, misma ruta técnica: dos sesiones completan a la vez. Una gana; la otra
   recibe conflicto. El actor y timestamp del ganador permanecen. Repetir con tarea vencida.
7. **Principal → Tareas → Nueva / Peticiones**, `src/hooks/useTareas.ts` y migración 4A:
   crear tarea sin sucursal directamente debe fallar; crear petición sin sucursal debe conservar la
   semántica previa. Probar creación/edición/asignación con IDs de otra organización: rechazada.
8. **Principal → Tareas → Tareas automáticas / campana**, `src/hooks/useTareasRecurrentes.ts`,
   `src/hooks/useNotifications.ts`: comprobar generación y notificaciones, sin crons nuevos ni avisos 4C.
9. **Cobrar / Mi Negocio → Equipo / Turnos → Agenda**, archivos del cuadro de dependencia PIN:
   después de recargar la app, comprobar listado/alta de integrantes y comisión de equipo. En la red,
   ninguna consulta a barberos debe pedir el hash. Intentar leer/escribir `pin_hash` directamente debe
   rechazarse; configurar/cambiar el PIN desde su flujo existente debe seguir funcionando.

## Corrección final de BUILD 4A — proyecciones, semana e historial (local, 2026-10-14)

Autorizada explícitamente antes de 4B, en la misma rama y como parte de 4A (no es un build nuevo).

| Ubicación en la app | Archivo técnico | Cambio |
|---|---|---|
| Principal → Tareas → Próximas (Programadas) y progreso semanal | `supabase/migrations/20261014120000_tareas_acciones_controladas.sql` | `public.tareas_previstas(p_desde, p_hasta, p_sucursal)` (INVOKER) sobre `tareas_private.previstas` (DEFINER, `search_path=''`). Devuelve ocurrencias futuras de Tareas automáticas **activas** que todavía no existen como tarea, con el calendario del motor (`_tareas_auto_siguiente`, siempre desde `fecha_inicio`). Arranca en `max(p_desde, hoy, proxima_fecha)`: nunca reconstruye fechas pasadas. Filtra la organización del perfil y aplica el mismo alcance que la lectura de tareas (`tareas_private.alcance`, sin acción administrativa): owner/GM su organización, manager sus sucursales, barbero lo propio y lo de equipo de su pertenencia estructural, cuenta de sucursal la suya. Rango máximo 14 días (fuera de eso, error, no vacío). DEFINER solo porque el calendario está cerrado a todos los roles de cliente. |
| Principal → Tareas → Historial | misma migración | Índice parcial `idx_tareas_historial_completadas (organization_id, completada_at DESC NULLS LAST, id DESC) WHERE tipo='tarea' AND estado='completada'`. Plan medido en PostgreSQL local con RLS 4A y datos sintéticos: sin índice, la primera página evalúa RLS sobre todas las completadas y ordena (4.500 → 173 ms; 45.000 → 1,6 s; el orden previo por `created_at` costaba lo mismo); con el índice, ~2 ms constantes. |
| Principal → Tareas → Historial | `src/lib/tareasData.ts`, `src/hooks/useTareasHistorial.ts` | Orden por `completada_at` (más reciente primero) con cursor compuesto `completada_at,id`; las completadas sin fecha de completado van al final y también se paginan. |
| Principal → Tareas → progreso y Resueltas esta semana | `src/lib/tareasData.ts`, `src/hooks/useTareasSemana.ts` | Lectura acotada de completadas: las programadas para la semana o completadas desde el lunes (con un día de margen por zona horaria, recortado al día de la organización en el cliente). Paginada con el mismo cursor; no vuelve a cargar todo el histórico. |
| Contrato de tipos | `src/integrations/supabase/types.ts`, `supabase/tests/tareas-generate-types.mjs` | `tareas_previstas` incorporada por el generador oficial desde la base local migrada. |

Pruebas: `supabase/tests/tareas-acciones-sql.mjs` suma 4 casos (serie canónica sin la ocurrencia creada ni fechas
pasadas; ancla quincenal, días personalizados y pausadas; alcance por rol/sucursal/organización y rango; índice) y
5 mutaciones (sin alcance, repite ocurrencias, incluye pausadas, reconstruye el pasado, sin límite de rango):
**47 pruebas y 17/17 mutaciones**. Las funciones del calendario siguen sin `EXECUTE` para clientes.

## BUILD 4B — rework UX/UI de Tareas (local, 2026-10-14)

Sin commit, sin push, sin despliegue. Implementado sobre el estado completo de 4A. (Estado al cierre de 4B: después se commiteó e integró en el checkout normal; ver BUILD 4C.)

### Experiencia

- **Lista vertical, no grilla.** Misma lectura temporal en mobile, tablet y desktop. En ≥1280 px el progreso semanal
  pasa a una columna derecha; la lista no vuelve a grilla.
- **Secciones** (`src/lib/tareasAgenda.ts`): **Necesitan atención** (vencidas, en progreso + vencida y abiertas de
  semanas anteriores; solo si hay), **Hoy** (las de hoy y las abiertas desde otro día de esta semana que siguen
  vigentes, con “Desde el martes”; muestra “Vence hoy” cuando corresponde), **Próximas** (cronológicas, con las
  Programadas intercaladas), **Sin fecha** (las más antiguas primero) y **Resueltas esta semana** (plegada, con
  “Ver historial”).
- **Progreso semanal** (`TareasProgresoSemanal.tsx`): semana lunes 00:00 → domingo 23:59 de la organización.
  Cuenta solo tareas con fecha en la semana más las Programadas; sin fecha y pendientes de semanas anteriores no
  entran (estas se muestran aparte y llevan a Necesitan atención); una completada tarde aparece en Resueltas pero no
  altera el progreso de una semana que no era la suya. Sin puntos, rachas ni rankings.
- **Programadas (R1):** filas con el mismo formato, círculo punteado y “Programada”; sin Iniciar, Completar ni
  Eliminar. Al crearse la tarea real la proyección desaparece (la base la excluye).
- **Fila** (`TareaFila.tsx`): círculo para **Completar en un toque**; **Iniciar** visible cuando aplica (también en
  vencidas); Ver detalle / Editar / Ver Tarea automática / Eliminar en el menú `⋯` (kebab canónico), solo con permiso.
  Estados excepcionales con ícono + texto (En progreso, Vencida —también juntas—, Programada); la pendiente normal no
  lleva pill. “Automática” es un indicador discreto en la misma fila. No repite lo que ya dice la sección (en Hoy no
  muestra la fecha; en “Mis tareas” no muestra tu propio nombre). Se creó `TareaFila` en vez de usar `RecordRow`
  porque sus acciones nunca bajan de línea (a 375 px aplastaban el título) y la fila encapsula estados propios de Tareas.
- **Completar / Deshacer:** acción de servidor de 4A. Mientras corre, el control muestra actividad y las acciones
  quedan deshabilitadas (sin doble envío). Al confirmar, la fila sale de la lista y suma al progreso en el momento;
  el aviso “Tarea completada · Deshacer” dura los 30 s que permite el servidor, que sigue siendo quien decide.
  Si falla, la fila no cambia y el mensaje es humano. La cuenta de sucursal confirma con PIN (diálogo de 4A).
- **Eliminar** pide confirmación (`TareaEliminarDialog.tsx`, sin la cuenta regresiva); si la tarea vino de una
  automática, aclara que la Tarea automática no se elimina y sigue creando las próximas.
- **Detalle** (`TareaDetalleDrawer.tsx`, sobre `DrawerForm` sin formulario): descripción completa, estado,
  fecha, hora, vencimiento, responsable, sucursal, origen (Tarea automática o quién la creó), quién la inició y
  quién la completó; Iniciar / Completar / Editar según permisos.
- **Formulario único** (`TareaFormDrawer.tsx`, `DrawerForm` + React Hook Form + Zod): Qué hay que hacer / Quién y
  dónde / Cuándo / Repetición. Hoy por defecto y “Sin fecha” visible sin abrir un calendario. Sucursal obligatoria
  si el contexto no la define. Responsables por pertenencia estructural (4A). Elegir una repetición convierte el
  alta en **Nueva Tarea automática** (título, explicación, “Empieza el” y “Crear Tarea automática”), sin diálogo
  extra; la personalizada (unidad, cada N, días) se expande en el mismo panel, sin hojas apiladas. “Nueva Tarea
  automática” desde la subvista abre el mismo formulario. Editar una tarea generada no muestra la programación:
  indica “Creada por la Tarea automática X” con acceso a editarla. Cierra solo después de guardar; si falla,
  conserva lo cargado y muestra un error humano; cerrar con cambios pide confirmación.
- **Tareas automáticas** (`RecurrentesPanel.tsx`, `RecurrenteFila.tsx`): subvista de configuración con “Volver a
  Tareas”, “Nueva Tarea automática”, Activas | Pausadas y filtro de sucursal solo si hay automáticas en más de una.
  Activa: frecuencia, hora, responsable, sucursal y “Próxima”; Pausada: motivo (sin “Próxima”), y una pausa
  automática no ofrece reanudar a mano. Muestra el estado de la última ocurrencia real cuando está entre los datos ya
  cargados (sin consultas nuevas). Eliminar conserva la cuenta regresiva con el texto corregido: deja de crear la
  tarea; si hoy ya creó la del día y sigue pendiente, también se elimina; anteriores, iniciadas y completadas se conservan.
- **Historial** (`TareasHistorial.tsx`): subvista bajo demanda, por fecha de completado, “Cargar más” de a 50.
- **Peticiones** (`PeticionesLista.tsx`, `PeticionFormDrawer.tsx`): misma funcionalidad (estados, completar/aprobar,
  rechazar, eliminar con PIN), en lista. Corregido el feedback falso: el aviso con quién la resolvió aparece recién
  después de guardar, y el texto dice “Petición…” (antes “Tarea actualizada”). Eliminar pide confirmación. Se quitó
  el filtro de fecha de Peticiones, que no aplicaba (las peticiones no tienen fecha de inicio).
- **Estados vacíos:** nunca tuvo tareas (supervisor: explicación + Nueva tarea + Nueva Tarea automática; barbero:
  mensaje simple), Todo al día (mensaje calmo), filtro sin resultados (una línea + Quitar filtros), sin automáticas
  (explicación + CTA), pausadas vacías (una línea). **Error ≠ vacío:** sin datos, `InlineReadError` con Reintentar
  (vía `TareasLoadError`); con datos, se conservan y un aviso ofrece reintentar. Los errores técnicos no se muestran crudos.
- **Carga:** skeleton demorado con la forma final (progreso + sección + filas); en recargas se conservan los datos.

### Roles

| Rol | Selector | Filtros | Acciones |
|---|---|---|---|
| Owner / General Manager / Manager con integrante vinculado | Mis tareas \| Negocio (recordado por usuario + organización) | En Negocio: Responsable y, si el contexto abarca varias, Sucursal | Nueva tarea, Tareas automáticas, completar/iniciar, editar, eliminar |
| Owner / General Manager / Manager sin integrante | — (Negocio) | Igual | Igual |
| Barbero | — (sus tareas, ya acotadas por RLS) | — | Completar/iniciar las propias y de equipo |
| Cuenta de sucursal | — (Negocio de su sucursal) | — | Completar/iniciar con PIN; Tareas automáticas con PIN para pausar/editar (permisos previos) |

“Mis tareas” = individuales asignadas a tu integrante + de equipo en las sucursales con tu pertenencia estructural
(`useSucursalesDeIntegrante`, misma regla `sostienePertenencia`). No amplía permisos: RLS sigue decidiendo qué se ve.

### Responsive y accesibilidad

- 375–430: “Mis tareas | Negocio” y un único **Filtrar · N** (drawer inferior, el mismo contenedor móvil de los
  pickers canónicos) en una sola fila; las acciones de cada fila bajan de línea si no entran. 768 y 1024: filtros en
  línea. ≥1280: progreso en columna derecha. Contenedor: el canónico de la app (`max-w-7xl` del shell); se quitó el
  ancho propio más angosto que tenía Tareas.
- Áreas táctiles: completar 40 px; Iniciar/Pausar, kebab y “Resueltas esta semana” con `.hit-area-expand`.
- Botones de ícono con nombre (“Completar «X»”, “Más acciones para «X»”), foco visible, etiquetas asociadas y
  errores por campo (`FormMessage`), drawers y diálogos titulados, fecha y días anunciados como grupo/opción,
  urgencia con posición + sección + ícono + texto. “Vence hoy” usa texto con contraste AA y el ámbar solo en el ícono
  (`--status-warning-foreground` sobre blanco da ≈3,3:1 y no alcanza para texto chico).

### Validación

- Vitest **235 pruebas / 33 archivos** (base 4A: 199/32): agrupación, Hoy, Necesitan atención, Próximas, Sin fecha,
  Resueltas, automática vs manual, proyectada vs real, Mis tareas / Negocio, roles y acciones visibles, error vs
  vacío, filtros, formulario, paso tarea → automática, guardado fallido, deshacer, iniciar vencida, automáticas
  activas/pausadas y consultas reales con transporte simulado (historial por `completada_at`, semana, proyecciones).
- Build OK (aviso de bundle grande preexistente). `tsc --noEmit` exit 0; `tsc -p tsconfig.app.json` con los mismos
  5 errores previos. Lint de los archivos tocados sin errores; global 378 errores / 49 advertencias (base 378/50).
  Detector de Impeccable sin hallazgos.
- Limitación del entorno de pruebas: en jsdom, `act` asíncrono (y `findBy*`) con un overlay de Radix abierto por
  interacción tarda 12–21 s; reproducido con las primitivas del repo sin código de Tareas. Esas pruebas usan
  consultas sincrónicas (ver `DESIGN_BACKLOG.md`, D53).
- QA visual con datos sintéticos, sin sesión ni APIs reales: `qa/tareas.html` (arnés local, fuera del build:
  `npx vite --config qa/vite.tareas.config.ts`, parámetros `rol=owner|manager|barbero|cuenta` y
  `estado=normal|aldia|nuevo|error|lento`). Revisado a 375, 768, 1024 y 1280+: secciones, progreso, completar +
  deshacer, detalle, formulario (incluido el paso a Tarea automática y la confirmación al cerrar con cambios),
  subvistas, Peticiones, filtro móvil, estados vacíos/error y roles.

### QA manual pendiente (ambiente de prueba autenticado, datos sintéticos)

1. **Principal → Tareas**, `src/components/TareasPanel.tsx`: con Owner/GM/Manager/Barbero/cuenta de sucursal,
   verificar secciones, progreso y Programadas contra datos reales; que “Mis tareas” muestre lo esperado para un
   supervisor con integrante vinculado en varias sucursales.
2. **Principal → Tareas → Próximas**, `public.tareas_previstas`: tras aplicar la migración en el ambiente de prueba,
   crear una automática diaria y comprobar que la de hoy no aparece como Programada una vez creada y que la serie
   coincide con la que genera el motor.
3. **Completar / Deshacer / PIN**, `src/hooks/useTareaAcciones.ts`: dentro y fuera de los 30 s; cuenta de sucursal
   con PIN; doble toque.
4. **Formulario**, `src/components/tareas/TareaFormDrawer.tsx`: crear tarea, tarea sin fecha, Tarea automática
   (preset y personalizada) desde ambos accesos, editar una generada y forzar un error de guardado.
5. **Historial**, `src/components/tareas/TareasHistorial.tsx`: orden por fecha de completado con muchas completadas
   y “Cargar más”.
6. **Tablet real** (mostrador) y touch: áreas táctiles, drawer de filtros y selectores.

## BUILD 4C — avisos semanales, integración global y cierre de Etapa 4 (local, 2026-10-15)

Último build de la Etapa 4, incluido en el commit `63b78369ec55634970c69189a8167a570ae52999` junto al estado integrado de 4A + 4B.
Commit verificado localmente y en `origin/feat/tareas-etapa-4` el 2026-10-15. Sin publicación en `main`, sin despliegue y sin migraciones aplicadas en producción. `origin/main` y `production/main` permanecen en `3377f8d6`.

### Repositorio

- 4A + 4B se commitearon en el worktree `…\.codex\…\vittro-build-4a-1` (rama `codex/tareas-4a-1`, commit `64b63b7c`) y se
  integraron en la rama local `feat/tareas-etapa-4` del checkout normal `C:\Users\Sebastian Tello\proyectos\pixel-perfect-replica`
  (la ruta `…\projects\…` no existe). Merge de `origin/main` (`4c77935c`): conflictos solo en `supabase/config.toml`
  (`[functions.tareas-action]` + plantilla de correo de aliados) y `docs/ESTADO_ACTUAL.md`, resueltos conservando ambos lados.
- `npm run dev` en esa carpeta muestra 4A + 4B + 4C. Su `.env` apunta al proyecto Supabase de producción, que no tiene las
  migraciones de 4A/4C: la UI nueva se ve y lo nuevo del servidor falla de forma segura hasta aplicar las migraciones en un
  ambiente de prueba. Inspección de metadata de producción del 2026-10-15: ausentes las migraciones `20261014120000_tareas_acciones_controladas` y `20261015120000_tareas_aviso_semanal`, la Edge Function `tareas-action`, `public.tareas_aviso_semanal`, `tareas.accion_version` y `public.tareas_accion`; sin consultar datos ni modificar la base. Sin backend: `qa/tareas.html` (`.claude/launch.json` → `qa-tareas`, puerto 8091).

### Aviso semanal

| Ubicación en la app | Archivo técnico | Comportamiento |
|---|---|---|
| Cualquier pantalla al entrar a Vittro | `src/components/tareas/AvisoSemanalTareas.tsx` | Diálogo `.resumen-sheet` (sheet inferior en mobile, centrado desde 640 px), encabezado y pie fijos, cuerpo con scroll. Lunes–miércoles **Arranca la semana** (previstas · para hoy · pendientes anteriores); jueves–viernes **Cómo viene la semana** y sábado–domingo **Cierre de la semana**, ambos con `TareasProgresoSemanal`; al 100 % con actividad, “Todo al día esta semana.” sin gamificación. Hasta 5 tareas con `TareaFila` y “Y N más esta semana en Tareas.”. Pie: Más tarde · Ver todas las tareas · Listo. |
| (lógica) | `src/lib/tareasAvisoSemanal.ts` | Momento por el día de la organización (`momentoDelDia`), pendiente según el estado guardado (`avisoPendiente`) y contenido (`construirAviso`) sobre la agenda y el progreso de 4B: lunes/jueves solo si queda algo de la semana (abiertas, Programadas) o algo que necesita atención; sábado si hubo actividad; la lista se limita a la semana (lo posterior vive en Tareas). |
| (datos) | `src/hooks/useAvisoSemanalTareas.ts` | Personas (barbero o supervisor) con Tareas en el plan y la preferencia activa; nunca la cuenta de sucursal. Lee el estado del aviso y **solo si está pendiente** las mismas lecturas acotadas de Principal → Tareas (abiertas, completadas de la semana, Programadas R1): sin historial, sin N+1. Alcance igual al módulo: barbero lo suyo (RLS 4A); supervisor su última elección Mis tareas/Negocio, con Negocio si ya no es válida. Cualquier error lo apaga en silencio (nunca “todo al día”). |
| Principal → Tareas y aviso | `src/hooks/useAgendaSemanal.ts` | Una sola definición de abierta, prevista, completada, Programada y pendiente anterior para el panel y el aviso (incluida la completada en el momento hasta que el servidor la confirma). |
| Acciones dentro del aviso | `src/hooks/useAccionesTarea.tsx`, `src/hooks/useTareaAcciones.ts` | Iniciar / Completar / Deshacer con las acciones de 4A, la misma regla de permisos (`puedeOperarTarea`, `src/lib/tareasAgenda.ts`) y PIN para la cuenta de sucursal. Si otra persona ya la completó, la respuesta segura de 4A (`conflict`/`invalid_state`, `TareaAccionError`) muestra “Ya la completó X.” sin sobrescribir nada. Programadas sin acciones. Con el aviso abierto, el “Deshacer” del toast sigue tocable (`body[data-aviso-tareas]` en `src/index.css`) y tocarlo no lo cierra. |
| Persistencia | `supabase/migrations/20261015120000_tareas_aviso_semanal.sql` | `tareas_aviso_semanal (user_id, organization_id, semana, momento, estado, pospuesto_hasta, updated_at)`: lunes de la semana, momento `lunes/jueves/sabado`, estado `listo/pospuesto`; ninguna copia de tareas. RLS: leer/crear/actualizar solo la propia fila en la organización del perfil; la cuenta de sucursal no puede guardar; sin DELETE ni acceso anon. Trigger INVOKER: “Más tarde” = reloj del servidor + 3 h (el valor del cliente se ignora). Sin SECURITY DEFINER ni cron. |
| Listo / Más tarde | mismo componente | “Listo” resuelve ese momento; “Más tarde”, la X, Escape, el clic afuera e ir a Tareas (una tarea o “Ver todas”) lo posponen: vuelve en una entrada posterior después del plazo. El contenido se calcula al abrir, nunca se congela. |

### Avisos al entrar (prioridad global)

| Ubicación en la app | Archivo técnico | Comportamiento |
|---|---|---|
| Al entrar a la app | `src/lib/avisosGlobales.ts`, `src/components/avisos/AvisosGlobales.tsx`, `src/pages/Index.tsx` | Onboarding > resumen mensual > Tareas. Uno solo por entrada (usuario + organización): el elegido queda fijo y no se encadena el siguiente. Nunca encima de un Dialog/Drawer/PIN/menú/selector, con un campo en edición o una mutación en curso; si la persona ya tocó o escribió en `<main>`, queda para la próxima entrada. |
| Onboarding | `src/components/onboarding/OnboardingProvider.tsx` | Informa `avisoGlobal` (pendiente mientras se sabe si arranca). Al terminar o saltear el tour, libera el lugar sin dar paso a otro aviso en esa entrada. |
| Resumen mensual | `src/components/resumenMensual/ResumenMensualStory.tsx` | Pasa por el coordinador; ya no se abre después del onboarding en la misma entrada. |

### Preferencia

Configuración → Notificaciones → **Resumen semanal de Tareas** (`src/lib/notifications/catalog.ts`, evento
`tareas_resumen_semanal`, sistema existente `user_notification_preferences`, sin migración). Apaga solo este aviso.
`inBell: false`: no se entrega a la campana ni figura en sus filtros. Visible para owner/GM/manager/barbero, no para la
cuenta de sucursal. La preferencia es por usuario (la tabla existente es única por usuario + evento): vale para todas sus
organizaciones (ver `DESIGN_BACKLOG.md`).

### Abrir una tarea puntual (campana y aviso)

| Ubicación en la app | Archivo técnico | Comportamiento |
|---|---|---|
| Campana → notificación de Tareas | `src/components/notifications/NotificationsBell.tsx`, `src/components/AppSidebar.tsx`, `src/hooks/useNotifications.ts` | Entrega la notificación tocada (con `source_table`); `tareas` abre esa tarea o petición, `tareas_recurrentes` su Tarea automática. Filtros de la campana con nombre accesible; botón colapsado con “Notificaciones, N sin leer”. |
| Navegación interna | `src/lib/tareasNavegacion.ts`, `src/pages/Index.tsx` | Pedido de destino (`irATareas`) sin router nuevo: `Index` cambia a Tareas (respeta onboarding y plan) y `TareasPanel` lo consume una vez. |
| Principal → Tareas | `src/components/TareasPanel.tsx`, `src/lib/tareasData.ts` (`fetchTareaPorId`) | Busca la tarea en lo cargado o con la sesión del usuario (RLS) y abre su detalle; una petición lleva a Peticiones. Resaltado breve de la fila (`TareaFila` → `domId`/`resaltada`, `PeticionesLista` → `resaltadaId`), sin movimiento con `prefers-reduced-motion`. Programada: abre su ocurrencia o, si ya existe, la tarea real. Eliminada o sin acceso: “Esa tarea ya no está disponible.” sin revelar datos; fallo de lectura: mensaje humano y la lista. |

### Pruebas

- `src/lib/tareasAvisoSemanal.test.ts` (11): ventanas, cambio domingo → lunes y zona distinta del dispositivo, Listo,
  Más tarde y plazo, lunes/jueves/sábado, 100 %, máximo 5, fuera de la semana, Programadas, completada tarde.
- `src/components/avisos/AvisosGlobales.test.tsx` (10): prioridad onboarding/resumen, un solo aviso, sin encadenar,
  superficie ocupada, persona trabajando, otra organización = otra entrada.
- `src/components/tareas/AvisoSemanalTareas.test.tsx` (18): momentos, Listo/Más tarde/Escape, persistencia por usuario +
  organización, plazo vigente o vencido, preferencia apagada, cuenta de sucursal, resumen con prioridad, barbero y
  supervisor (Mis tareas válido o no), completar, “Ya la completó Juan.”, Programadas sin acciones, navegación.
- `src/components/tareas/TareasReliability.test.tsx` (+6): abrir la tarea puntual con resaltado, fuera de la lista
  (RLS), eliminada/sin acceso, fallo de lectura, Programada → ocurrencia o real, petición.
- `src/components/notifications/NotificationsBell.test.tsx` (3): la campana abre la tarea correcta, mapeo de destinos,
  el aviso semanal no figura en la campana.
- `supabase/tests/tareas-acciones-sql.mjs` (+4 = **51**): plazo del servidor, upsert como el de PostgREST, aislamiento
  por usuario/organización, cuenta de sucursal, sin DELETE/anon, CHECK de lunes y momento, columnas sin contenido,
  trigger no DEFINER; +4 mutaciones del aviso.

Resultados: Vitest **327/40** (base integrada 279/36), SQL 51 + 82 + 44 + 18 + 27, build OK, `tsc` raíz exit 0 y
`-p tsconfig.app.json` con los 5 errores previos (`abortSignal`, `readRetry.test`), lint de lo tocado sin errores.

### QA con el arnés (sin sesión ni APIs reales)

`qa/tareas.html?rol=owner|manager|barbero|cuenta&estado=normal|aldia|…&hoy=AAAA-MM-DD&aviso=listo|no&pref=off`.
Revisado: lunes, jueves, sábado al 100 %, domingo (usa el cierre del sábado), barbero, a 375 / 430 / 768 vertical /
1024 horizontal / 1280; completar y “Deshacer” desde el toast con el aviso abierto; tocar una tarea abre su detalle
con la fila resaltada; foco inicial en “Cerrar y recordar más tarde”. Corregidos en la pasada: alineación de los
números del inicio de semana y el encabezado “Tareas · Tareas · …”. El arnés no aplica RLS: el recorte por persona del
barbero se valida en las pruebas SQL y queda para el QA autenticado.

### Pendiente (QA autenticado en un ambiente de prueba con las migraciones de 4A y 4C)

1. Aviso con Owner, GM, Manager (una y varias sucursales) y Barbero; cuenta de sucursal sin aviso.
2. Listo y Más tarde entre dos dispositivos (mismo usuario) y en dos organizaciones.
3. Campana → tarea puntual con una notificación real; tarea eliminada y sin acceso.
4. Prioridad con un onboarding pendiente y con un resumen mensual pendiente.
5. Tablet real (táctil).
