# Decisiones de arquitectura y criterio — Vittro

## Aliados: niveles solo por referidos — 2026-10-14

El usuario retiró la vía de seguidores y pidió una misma propuesta de ingresos
para amigos y comunidades. Los niveles automáticos dependen exclusivamente de
barberías calificadas (0/5/20); el convenio conserva prioridad y los snapshots
anteriores no se recalculan. La metáfora del frasco es un indicador de progreso
solicitado, con datos y umbrales legibles, no decoración de la app operativa.
Detalle y evidencia por etapa: `docs/ALIADOS_NIVELES_REFERIDOS.md`.

## Aliados: altas automáticas y liquidación humana — 2026-10-14

Plan aprobado: cliente owner y creador externo comparten el programa; la identidad
externa no crea tenant ni roles operativos. Instagram aporta un nivel inicial
verificado, mientras 5/20 barberías con dos pagos distintos aportan progreso
acumulativo. Un contador declarado por el creador no puede mejorar su comisión.

La comunidad recibe 10% en el primer mes pagado; la comisión es 10/20/30% del
importe cobrado después del descuento, antes de costos del procesador, o convenio
vigente hasta 100%. Tasa y términos se congelan al primer checkout. Código solo
en signup evita atribución retrospectiva. Hold 30 días y libro de ajustes cubren
reversiones; transferencia mensual humana evita introducir pagos automáticos
antes de verificar titularidad y confiabilidad del circuito.

La entrega comenzó como contrato para Lovable. El usuario autorizó después la
excepción puntual de DB/RLS y producción: «podemos ir a produccion directamente».
Se aplicaron solo cinco migraciones del programa, sin reordenar el historial
anterior. Se reportó handle_new_user antes de modificar su SECURITY DEFINER;
un guard de hash asegura que el original sea el revisado. Las funciones propias
nuevas son INVOKER, solo service_role, y vuelven a validar identidad/scope.
Un bloqueo por identidad sustituye FOR UPDATE sobre Auth, evitando ampliar
los permisos de esa tabla. La extensión oficial pg_net fue reportada antes de
habilitarla; cron consulta Vault y envía HMAC de vida corta, no el secreto fijo.
GoTrue aplica app_metadata después de insertar el usuario. La prueba de API real
detectó ese orden; el alta externa ahora reserva una intención privada de un uso
que el trigger consume por email/nonce, antes de crear cualquier tenant. Un dato
de user_metadata sin esa intención no puede saltar el aprovisionamiento ni
asignar account_kind. Se agregó regresión del orden INSERT/UPDATE.
SQL sintético, rollback y prueba Auth/API productiva complementan las pruebas TS; no equivalen
a pagos reales de Mercado Pago. Instagram requiere una verificación oficial
externa real. Detalle y evidencia: `docs/MODULOS/aliados.md` y `docs/ALIADOS_PRODUCCION.md`.

Registro del "por qué", no del "qué". Para el estado actual de cada módulo,
ver `ESTADO_ACTUAL.md`. Para la especificación normativa vigente del sistema
visual, ver `DESIGN.md` — este archivo no repite esa especificación, solo el
contexto y el razonamiento detrás de cada decisión.

## 2026-10-14 — BUILD 4B: Tareas como agenda semanal, no como grilla

- **R1 sin segundo calendario.** 4B se detuvo porque 4A no exponía las ocurrencias futuras de Tareas automáticas
  (el calendario del motor está cerrado a clientes y `proxima_fecha` es una sola fecha: no alcanza para una diaria).
  Se aprobó una corrección final de 4A: `public.tareas_previstas` (INVOKER) sobre `tareas_private.previstas`
  (DEFINER, solo para usar ese calendario), con el mismo alcance que la lectura de tareas, organización del perfil,
  rango ≤ 14 días y nunca fechas pasadas ni ocurrencias ya creadas. El frontend no calcula fechas: las ubica.
- **Índice del historial por evidencia.** Se ordena por `completada_at` (lo que el usuario entiende por historial).
  El plan local con RLS mostró que cada página evaluaba la política sobre todas las completadas (1,6 s con 45.000;
  el orden previo por `created_at` igual); un índice parcial lo deja en ~2 ms. Sin el plan no se habría agregado.
- **Semana y progreso.** Lunes a domingo de la organización. El total solo incluye lo previsto para esa semana
  (con fecha o Programado): sin fecha y pendientes anteriores quedan aparte para que el número no mienta ni castigue
  la semana actual por deudas de otra; lo atrasado se ve igual, arriba, en Necesitan atención.
- **`TareaFila` en lugar de `RecordRow`.** `RecordRow` mantiene las acciones siempre al costado: a 375 px dos
  acciones con texto dejaban al título ~140 px. La fila de Tareas deja bajar las acciones por espacio real
  (layout intrínseco) y encapsula estados propios (vencida, en progreso + vencida, Programada, completada).
- **Completar con un círculo.** Es la acción más frecuente y el patrón de lista de tareas más reconocible; tiene
  nombre accesible y un deshacer de servidor de 30 s como red. Iniciar queda como botón con texto porque es menos
  frecuente; Editar/Eliminar al `⋯` para que no compitan.
- **Un formulario.** Tarea y Tarea automática comparten campos; la repetición decide el modo dentro del mismo
  `DrawerForm` (sin diálogo extra). Editar una ocurrencia nunca toca la receta. `RepeatPicker`/`CustomRepeatSheet` se
  conservan porque los usan Gastos y Bono fijo (D54).
- **Mis tareas | Negocio solo cuando significa algo.** Aparece para supervisores con integrante vinculado; “mías”
  incluye las de equipo de las sucursales con pertenencia estructural (misma regla que 4A). La elección se guarda en
  el dispositivo por usuario + organización: es una comodidad, no un permiso.
- **QA visual sin sesión.** No había sesión autenticada usable: se agregó un arnés local con datos sintéticos
  (`qa/tareas.html`, fuera del build, mismo criterio que `qa/admin-commercial`). No reemplaza el QA autenticado.

## 2026-10-14 — BUILD 4A: datos operativos, seguridad y permisos en el mismo build

- No existe BUILD 4A-2. Se conserva `codex/tareas-4a-1` como nombre histórico de la rama de trabajo.
- **Principal → Tareas → acciones** (`supabase/migrations/20261014120000_tareas_acciones_controladas.sql`):
  excepción local explícita a AGENTS para SQL/RLS y SECURITY DEFINER, únicamente en schema privado.
  Entradas públicas INVOKER, EXECUTE mínimo, autorización interna y versiones/bloqueo por fila.
  La entrada PIN es solo para servidor; deriva identidad del token y del PIN, nunca de UUID del navegador.
- **Principal → Tareas → PIN / Deshacer** (`supabase/functions/tareas-action/handler.ts`,
  `src/hooks/useTareaAcciones.ts`): verificación y escritura en la misma acción; 30 segundos para
  deshacer por quien completó, conservando estado previo y rechazando cambios posteriores.
- **Principal → Tareas / Tareas automáticas → alcance Manager** (misma migración): vínculo real
  `user_sucursales` con organización/sucursal, sin ampliar alcance por un rol Barber adicional.
  Cuenta de sucursal no obtiene edición administrativa aunque tenga un rol adicional.
- Generación de tipos local por introspección oficial, sin firmas manuales:
  `supabase/tests/tareas-generate-types.mjs`, contrato de `src/integrations/supabase/types.ts`.
- Dependencia de seguridad del PIN: el permiso efectivo de tabla exponía y permitía escribir
  `barberos.pin_hash` pese a una revocación histórica por columna. La misma migración 4A conserva
  los grants previos de otras columnas y retira el hash del cliente. Cobrar, carga de Equipo, Mi Negocio,
  comisión de equipo y Agenda usan `src/lib/barberoColumns.ts` en sus cinco consumidores documentados
  en `docs/MODULOS/tareas.md`; no cambian filtros ni cálculos. Publicar requerirá coordinar frontend,
  migración y recarga de pestañas antiguas. No se leyeron hashes ni se cambiaron PIN reales.
- Build completo y validado localmente: 43 SQL de acciones, 12 mutaciones nuevas detectadas y
  regresión de Etapas 1–3/frontend. Sin despliegue, sin 4B/4C.

- **Principal → Tareas** (`src/hooks/useTareas.ts`, `src/lib/tareasData.ts`): cursor compuesto
  `created_at,id` para paginar con orden estable. Se sigue hasta una página vacía, sin asumir que
  el límite del servidor coincide con el tamaño solicitado. Una falla intermedia invalida la carga
  completa en vez de presentar una fracción como lista total. Se conservan filtros y contadores locales.
- **Principal → Tareas → Historial** (`src/hooks/useTareasHistorial.ts`): consulta separada bajo demanda,
  filtrada en servidor antes de paginar. Se informa cantidad cargada, sin inventar un total histórico.
- **Principal → Tareas → responsables** (`src/hooks/useTareaResponsables.ts`): carga específica por
  pertenencia estructural, reutilizando `sostienePertenencia` de `src/lib/tareasAutomaticas.ts`.
  No se cambia la semántica de `src/hooks/useSupabaseData.ts`, compartido por otras pantallas;
  solo su proyección excluye el hash por la dependencia de PIN mencionada. Tampoco se usa
  disponibilidad diaria como pertenencia.
- **Principal → Tareas → Nueva/Editar** (`src/components/tareas/TareaFormDialog.tsx`,
  `src/components/tareas/TareaRecurrenteFormDialog.tsx`): sucursal activa obligatoria al crear;
  no agregar ese bloqueo a edición de registros existentes. El guardado conserva contenido si falla.
- **Barra lateral → campana** (`src/hooks/useNotifications.ts`): resolver solo fuentes de las entregas
  cargadas conserva la vigencia de avisos sin depender de toda la lista de Tareas. Misma sesión y RLS,
  filtros explícitos de organización/sucursal y caché por contexto. Sin nuevos avisos ni cambios
  de permisos en las tablas de Notificaciones.
- Implementación local, sin despliegue. El detalle y el QA pendiente viven en `docs/MODULOS/tareas.md`.

## Tareas: reset pre-lanzamiento con backup interno verificado (Etapa 3) — 2026-10-13

Qué se decidió y por qué (operación y resultados en `docs/MODULOS/tareas.md`; scripts en
`supabase/diagnostics/20261013_etapa3_reset_tareas/`):

- **Descartar el historial en vez de sanearlo.** Antes del lanzamiento, las 141 tareas `tipo='admin'` del motor anterior
  (invisibles para los barberos) y las Tareas automáticas con calendario viejo no valen el costo de migrarlas fila por fila. Se
  borraron las tareas `admin`/`tarea`, **todas** las Tareas automáticas y sus notificaciones. Las peticiones no se tocan nunca.
- **Alcance por estructura, nunca por texto.** Una notificación es “de Tareas” solo por `source_module`, `source_table`, tipo de
  evento y `source_id` (las huérfanas incluidas); jamás por título, cuerpo, fecha aproximada o nombre. Cualquier cosa que no se
  pueda clasificar sin adivinar (evento nuevo, tipo de tarea desconocido, FK nueva, trigger de `DELETE`, cruce de organización)
  **aborta** el proceso (`etapa3_backup.ambiguedades()`). Las cifras se recalculan en el momento: entre el preflight y el reset el
  motor generó dos tareas más (142 → 144) y el procedimiento las respaldó y borró igual, porque compara el alcance vivo con el backup.
- **Backup interno obligatorio; copia externa no realizada.** El respaldo es el schema `etapa3_backup` (fuera de `public`, sin acceso
  para `anon`, `authenticated` ni `service_role`), verificado contra lo vivo con cantidades, conjuntos de ids en ambos sentidos y
  md5 de filas completas, más un ensayo de restauración que siempre se revierte. Se intentó una copia externa con `pg_dump` 17
  (herramientas instaladas solo para el usuario, conexión *Session pooler*); exigía la contraseña de la base de datos y **Sebastián
  decidió continuar sin ella**. Consecuencia aceptada: el único respaldo vive en el mismo proyecto, así que cubre un error del
  reset pero no la pérdida del proyecto.
- **Triggers: `DISABLE TRIGGER USER`, no `session_replication_role`.** El rol `postgres` de Supabase no es superusuario y no puede
  cambiar `session_replication_role`. Restaurar deshabilita solo los triggers de usuario de `tareas` y `tareas_recurrentes`, durante
  el `INSERT`, y el ensayo comprueba que quedan habilitados.
- **Reset atómico e idempotente.** Una transacción con `LOCK` (`SHARE ROW EXCLUSIVE`), revalidación contra el backup, borrado en
  orden notificaciones → tareas → Tareas automáticas (entregas y lecturas caen por `ON DELETE CASCADE`), post-condiciones antes del
  `COMMIT`. Se ejecuta lejos del minuto 00 (crons horarios). Una segunda ejecución devuelve `ya_aplicado` y no borra nada.
- **Integridad definitiva (3B).** CHECK validado `tipo IN ('tarea','peticion')`: `admin` deja de ser un valor válido y el trigger
  temporal `trg_tareas_tipo_guard` se elimina con su función. CHECK de ocurrencias: `recurrencia_id` no nulo ⇒ `tipo='tarea'` y
  `fecha_inicio` presente. No se eliminaron las columnas de repetición heredadas de `tareas` (fuera de alcance).
- **Excepción directa.** Como en las Etapas 1 y 2, AGENTS.md manda DB por Lovable; el usuario autorizó expresamente ejecutar esta
  operación y la migración 3B en el único proyecto operativo. No es una autorización general.

## Tareas automáticas: el servidor es dueño del calendario, de la pausa y de la recuperación — 2026-10-12

Qué se decidió y por qué (Etapa 2; modelo y permisos en `docs/MODULOS/tareas.md`):

- **Una sola semántica de calendario, en la base, anclada en `fecha_inicio`.** Había tres cálculos
  distintos (SQL, TypeScript del cliente y el que usa Gastos) y el SQL trataba weekly, biweekly, quarterly,
  semiannual y yearly como “+1 día”. Encadenar “fecha anterior + intervalo” acumula drift (31 → 28 → 28 …);
  desde el ancla, un mensual del 31 vuelve al 31 en los meses que lo tienen. El cliente ya no calcula `proxima_fecha`: envía solo un
  marcador (el tipo generado exige el campo) y la base lo reemplaza siempre. `calcNextDate` se mantiene intacta porque la usan los Gastos recurrentes.
- **“Hoy” es el día de `organizations.timezone`.** No el navegador, no la zona de la sucursal, no `CURRENT_DATE`.
- **Ocurrencia vigente y recuperación excepcional.** Cada ejecución genera como máximo la última fecha de la serie
  ≤ hoy y avanza a la primera posterior a hoy. Si el motor estuvo detenido no reconstruye lo perdido, y si la ocurrencia
  vigente ya habría nacido vencida **no se crea** (evita tareas que nacen vencidas y su aviso de vencimiento). La falla no se
  esconde: queda un contador y la última fecha perdida en la propia Tarea automática (`recuperaciones`,
  `recuperacion_*`) y un `WARNING` con identificadores. No se creó una tabla de log: no existe una infraestructura de
  auditoría adecuada para el cron y esto basta para detectarlo con una consulta.
- **Pausas: un motivo, no un segundo sistema.** `activo` sigue significando “¿genera?” y `pausa_motivo` dice por qué
  (`manual`, `sucursal_inactiva`, `barbero_inactivo`, `barbero_sin_asignacion`). Las automáticas se reanudan solas cuando
  desaparece la causa; **la manual jamás** y una automática nunca la pisa. Con varias causas manda la más fuerte.
  Los triggers sobre barberos, sucursales y `barberos_sucursales` reaccionan al instante y el motor repite la
  sincronización cada hora (red de seguridad contra un trigger que no corrió).
- **Pertenencia estructural, no disponibilidad diaria (corrige BUILD 2, E2-M5).** BUILD 2 había leído `barberos_sucursales.disponible=false`
  como “el barbero dejó la sucursal”, pero ese campo lo recalcula solo el cron diario (una sola fila disponible por barbero): un barbero en
  dos sucursales habría pausado y reanudado sus Tareas automáticas todos los días. Decisión de producto: una Tarea automática individual
  se pausa solo cuando no queda **ninguna asignación vigente** del par organización+barbero+sucursal. `principal` y `recurrente` cuentan
  mientras exista la fila (la recurrente no depende del día de hoy); `temporal` solo dentro de su rango (futura: todavía no; vencida: ya no,
  sin borrar la fila). Motivo `barbero_sin_asignacion`. No se inventó una columna: la señal ya existía. El paso del tiempo lo resuelve la
  sincronización horaria del motor (demora de hasta una hora) en vez de un segundo cron. Sin notificación nueva en la campana: solo el aviso
  previo dentro de la acción que provoca la pausa, y únicamente si era la última asignación vigente.
- **Aviso antes de confirmar.** Finalizar actividad de un barbero, desactivar una sucursal y quitar la última asignación vigente (eliminar asignación,
  eliminar recurrente, cambiar la principal) muestran cuántas Tareas automáticas activas se pausarán, dentro de los diálogos de confirmación que ya existían. Si no se puede consultar, el aviso lo dice.
- **Identidad.** `tareas.asignado_a_id` y `tareas_recurrentes.asignado_a` son `barberos.id`. El usuario es `profiles.id` vía
  `profiles.barbero_id` (0..n). Tres productores usaban `barberos.id` como id de usuario y se corrigieron con `_notif_barbero_users`.
- **`en_progreso` también vence.** “Empezada” y “atrasada” son independientes: se marca `vencida_at` y el estado sigue siendo
  `en_progreso` (no se inventó un estado nuevo; la tarjeta muestra ambos).
- **`tipo` por trigger y no por CHECK (transitorio; reemplazado el 2026-10-13).** Existían 141 filas `tipo='admin'` vinculadas a Tareas automáticas y `recurrencia_id` es
  `ON DELETE SET NULL`: un CHECK, incluso `NOT VALID`, habría rechazado ese `UPDATE` y bloqueado el borrado de una Tarea automática. El trigger
  impedía crear `admin` nuevas sin tocar las viejas. Con el reset de la Etapa 3 (ver la entrada siguiente) el CHECK definitivo ya está y el trigger se eliminó.
- **`SECURITY DEFINER` nuevos o reescritos (AGENTS.md exige reportarlos):** los triggers `trg_tareas_recurrentes_prepare`,
  `trg_tareas_recurrentes_generar`, `trg_tareas_auto_sync_barberos`, `…_sucursales`, `…_barberos_sucursales`; `process_tareas_recurrentes`
  y `process_vencimientos_tareas` (ya lo eran) y los dos triggers de notificación reescritos. Son necesarios porque quien desactiva una sucursal
  o a una persona puede no tener `UPDATE` sobre las Tareas automáticas ni acceso a los helpers cerrados en la Etapa 1. Todos con `search_path = ''`,
  nombres calificados, filtro por `organization_id` y sin `EXECUTE` para clientes. Las funciones auxiliares y el motor interno son `SECURITY INVOKER`.
  `_notif_barbero_users` quedó `INVOKER` (el plan aprobado la preveía `DEFINER`): todos sus llamadores son `DEFINER` del mismo dueño, así que no necesita más privilegios.

## Excepción directa y aplicación en el proyecto operativo para la Etapa 2 de Tareas automáticas — 2026-10-12

Igual que en la Etapa 1, AGENTS.md manda DB/RLS por Lovable y las excepciones requieren autorización explícita. El usuario autorizó
construir la Etapa 2 con Claude Code **y aplicar las cuatro migraciones directamente en el único proyecto Supabase operativo**
(`azqpyfoobpovqosbayvz`), condicionado a: verificar el SQL, correr el preflight, confirmar que no contenían saneamiento ni borrado histórico,
revisar la seguridad y confirmar que no debilitaban la Etapa 1. Se cumplió y se aplicó en orden E2-M1 → E2-M4, verificando cada una. **No se
crearon ramas ni entornos de desarrollo.** La excepción no cambia la regla general, no cubre la Etapa 3 (saneamiento / reset) y no autoriza otras
migraciones. El conector registra su propia versión (timestamp de aplicación) con el mismo nombre que el archivo del repo; el prefijo del archivo
no coincide con la versión remota (ya ocurría con la Etapa 1).

Actualización sobre la Etapa 1: sus tres migraciones **ya están aplicadas** en el proyecto operativo (confirmado con `list_migrations` el 2026-10-12),
por lo que el texto de la entrada siguiente (“no autoriza aplicar las migraciones…”) describe lo que cubría ese build, no el estado actual.

## Notificaciones: la entrega es la fuente de verdad — 2026-10-12

La campana ya leía solo `notification_deliveries`, pero la base permitía a
cualquier miembro de la organización leer, crear y reescribir `notifications`,
y los helpers `_notif_*` eran ejecutables por `anon` (inyección entre
organizaciones, lectura de emails). La protección estaba solo en pantalla. Se
decidió que **leer un evento exige una entrega propia**: los destinatarios ya se
calculan al emitir por cargo, sucursal y preferencia, así que la entrega es la
representación exacta de “esto te corresponde”. No se creó el concepto de
notificación “visible para toda la organización”; un aviso institucional se reparte
con entregas explícitas.

- **Historial preservado (D1).** Perder un cargo o una sucursal no borra lo recibido
  legítimamente ni se revoca retroactivamente: eso exigiría duplicar en SQL las reglas
  por categoría del catálogo del frontend. Las emisiones nuevas usan los permisos
  vigentes; salir de la organización sí corta el acceso por el control de organización.
- **`DROP` de `upsert_notification` y `upsert_notification_delivery`.** Sin
  consumidores en `src/` ni `supabase/functions/`, Vittro no está lanzado y ambas
  permitían fabricar/sobrescribir avisos y autosuscribirse a cualquiera de la
  organización. Reduce superficie; se pueden reconstruir desde las migraciones históricas.
- **`REVOKE` explícito y por firma, no global.** Los helpers `_notif_*` pierden
  `EXECUTE` incluso para `service_role` (nada del backend los llama). Los helpers de
  RLS (`has_role`, `get_user_organization_id`…) no se tocan: revocar `authenticated`
  rompería cientos de políticas. Tampoco se usó `ALTER DEFAULT PRIVILEGES` global,
  que rompería funciones futuras legítimas; en su lugar, una prueba de catálogo.
- **Inmutabilidad de entregas por trigger `SECURITY INVOKER`**, no por privilegios
  de columna, que Supabase documenta como avanzados y que rompen `select *`.
- **`notif_emit_view_event` sigue `SECURITY DEFINER`** (escribe tablas cerradas al
  cliente): `search_path = ''`, valida usuario, organización y que la sucursal sea la
  de la cuenta que llama, y solo `authenticated` la ejecuta. Es la única función
  privilegiada de notificaciones que queda expuesta; AGENTS.md exige reportar cada
  `SECURITY DEFINER` nuevo o reescrito y este se reportó antes de construir.
- **Zona horaria (SEG-05): solo la ruta de escritura.** Un trigger rechaza nombres no
  IANA al insertar/actualizar `organizations.timezone` (acepta `NULL`). No limpia datos
  existentes ni cambia los cron, y no dispara en actualizaciones que no mencionan la
  columna, para no bloquear organizaciones con un valor histórico malo. Aislar fallos
  por organización dentro de los cron y limpiar datos queda para la Etapa 2.
- **Las migraciones se protegen a sí mismas:** abortan si hay dueños distintos entre
  helpers y llamadores, funciones `SECURITY INVOKER` que llamen a los helpers, jobs de
  pg_cron que perderían `EXECUTE`, o políticas inesperadas que anularían el modelo.

Detalle del modelo, productores y cómo agregar eventos: `docs/MODULOS/notificaciones.md`.

## Excepción directa acotada para la Etapa 1 de seguridad de Notificaciones — 2026-10-12

AGENTS.md establece que la base de datos y RLS van por Lovable y que las excepciones
requieren autorización explícita. El usuario autorizó ejecutar **solo este build** con
Claude Code: `20261012100000_notifications_security_functions.sql`,
`20261012100100_notifications_security_rls.sql`,
`20261012100200_organizations_timezone_validation.sql`, la prueba
`supabase/tests/notifications-security-sql.mjs`, el ajuste de tipos generados y la
documentación asociada. La excepción **no cambia la regla general** de AGENTS.md, no
cubre otras migraciones ni la Etapa 2, y no autoriza aplicar las migraciones en ningún
proyecto Supabase: este build las validó únicamente contra PostgreSQL local sintético.
Un `push` de Git tampoco las aplica (ver `docs/FLUJO_PUBLICACION.md`). *(Posteriormente el usuario las aplicó en el proyecto operativo; ver la entrada de la Etapa 2.)*

## Repositorio principal antes del fork productivo — 2026-10-11

El usuario estableció pixel-perfect-replica como origen de los cambios y
BarberApp como fork de distribución, en ese orden. GitHub confirmó esa relación.
La recuperación previa se había publicado directamente al fork y dejó cinco
commits fuera del original. Se corrige por avance normal, conservando la
recuperación y el historial; no se reescribe ni se recrea el fork. Vercel sigue
consumiendo main de BarberApp. Un push no autoriza operaciones de base de datos.
Regla activa: AGENTS.md y FLUJO_PUBLICACION.md.

## Fechas de trial y rechazos no reintentables — 2026-10-11

El usuario aprobó acortar/extender trials y confirmó vencimiento inmediato.
Se agrega una acción explícita; extend_trial conserva su contrato anterior.
Acortar no cancela Mercado Pago y exige revisar la pérdida de acceso.
Tras el incidente 40001, conflictos de negocio usan PT409 y recibos fallidos
atómicos, manteniendo el advisory lock fuera del savepoint. Se puede recuperar
un fallo confirmado sin asumir que not_found significa fracaso ni reenviar
una escritura incierta. El usuario autorizó la excepción DB exacta y la
reconciliación de un solo request: migration INVOKER en BEGIN/COMMIT y recibo
fallido separado, sin cambiar datos comerciales. Publicación verificada y
switch restaurado. response.status mantiene el rechazo HTTP durante despliegues
mixtos sin revertir el recibo. No se ejecutó un vencimiento real como prueba.
Evidencia: ADMIN_TRIAL_FECHAS_RECUPERACION.md.

## Habilitación comercial sin sustituir una prueba de compra — 2026-10-10

El usuario autorizó habilitar la gestión comercial, confirmó Básico ARS 1 y
eligió su barbería de prueba. Al distinguir cortesía de contratación, prefirió
conservar su trial Premium para probar la compra. Se habilitaron las tres
acciones con el switch independiente y se verificó una edición de contacto
confirmada personalmente por el usuario, más el rechazo de confirmaciones
incorrectas. No se ejecutó asignación manual/extensión ni se tocó MP o Auth.
Concurrencia productiva y pruebas ampliadas siguen sin certificarse.
Evidencia: `docs/ADMIN_COMERCIAL_HABILITACION_PRODUCCION.md`.

## Recuperación y publicación comercial sin habilitar escrituras — 2026-10-10

El merge `2bda5a7` eliminó la base de Admin y dejó conflictos. El usuario
autorizó recuperar todo: reversión contra su primer padre `df51109`, con una
referencia local al merge y sin reescribir historial. Pruebas completas y build
validaron el estado recuperado antes de publicarlo por el remoto productivo
confirmado en Vercel. No se restauraron datos ni se repitieron migraciones.

Con autorización separada se desplegaron solo query/organization y frontend;
`PLATFORM_ADMIN_ORG_MUTATIONS_ENABLED=false` se configuró antes de publicar.
La verificación Admin real demuestra la entrega de lectura, no autoriza una
escritura de prueba ni el paso a true. El switch de precios no cambió. Se informó
el Básico a ARS 1 de un lote previo, sin revertir decisiones comerciales ajenas.
Evidencia: `docs/ADMIN_COMERCIAL_DESPLIEGUE_PRODUCCION.md`.

## Excepción directa acotada para la migración comercial — 2026-10-10

Al no disponer del propietario de Lovable, el usuario autorizó expresamente
solo `20261010130000_platform_admin_commercial.sql` en producción y una única
transacción. Se aplicó el archivo íntegro con guardas y se registró esa versión
en el historial dentro del mismo commit; no se ejecutaron ni repararon otras
migraciones. RLS/grants/RPC se comprobaron por lectura independiente posterior.
La excepción no cambia la regla general de DB/RLS por Lovable ni autoriza
desplegar o habilitar escrituras. Evidencia y límites:
`docs/ADMIN_COMERCIAL_MIGRACION_PRODUCCION.md`.

## Gestión comercial separada de facturación y de Auth — 2026-10-10

Plan aprobado para editar barbería/contacto, otorgar acceso manual y extender
trial. El email comercial es privado e independiente del login; cambiar datos
no cambia slug, roles ni credenciales. El acceso manual no implica un débito ni
autoriza cancelar un contrato Mercado Pago. Cualquier vínculo/pending/fence de
proveedor requiere reconciliación explícita antes de cambiar acceso.

Una RPC nueva `SECURITY INVOKER`, restringida a `service_role`, guarda cambio y
auditoría en una transacción; CAS conserva microsegundos y un request ID estable
evita repetir efectos. Reautenticación efímera y kill switch comercial apagado
son independientes del editor de precios. Se validó en PostgreSQL local
sintético, no producción. La aprobación del build no concede una excepción para
aplicar DB fuera de Lovable. Suspensión queda separada hasta demostrar enforcement
servidor; no se presenta un switch visual como bloqueo efectivo.

La ficha amplía la superficie vigente sin reemplazar su identidad. Separar
«fuente de acceso», «plan efectivo» y «facturación» evita que una cortesía se
interprete como suscripción cobrada. Los vencimientos se eligen con los pickers
canónicos, se interpretan en la zona local y se convierten a UTC al enviar;
no se redondean minutos. Ante un resultado ambiguo se conserva solo ID/acción,
no contraseña ni formulario, y se bloquea repetir hasta reconciliar el ID.
Un `not_found` no acredita que la primera transacción ya terminó. Por eso la
recuperación exige lectura/auditoría del servidor, no un botón de reenvío ciego.

## Un checkout pendiente no define el contrato vigente — 2026-10-10

BarberMalza conservaba una asignación manual de Básico sin vencimiento, pero su
proveedor local era Mercado Pago y apuntaba a un checkout pendiente antiguo de
Premium. El proveedor verificó cuenta/aplicación/referencia y cero facturas;
no había evidencia de una renovación autorizada ni de pagos locales. Convertir
ese vínculo en una renovación habría mezclado intenciones comerciales distintas.

Con autorización explícita se canceló únicamente el checkout antiguo y se
reclasificó la suscripción como manual, preservando acceso, plan, vencimiento y
snapshots históricos. La excepción directa de DB se ejecutó en una transacción
con guards y auditoría, sin migraciones ni funciones nuevas. El lote se cerró
mediante las RPC canónicas, no forzando su estado: completado significa todos
los objetivos terminales, no todos cobrados/actualizados. Los 26 faltantes de
preapproval permanecen visibles y el caso manual queda excluido.

La siguiente fase de Admin debe mostrar separadamente acceso manual/trial,
contrato con Mercado Pago y evidencia de pagos. Una asignación manual no debe
cancelar o modificar automáticamente un contrato autorizado. Tampoco basta
cambiar `organizations.is_active` para prometer suspensión efectiva: hay que
verificar enforcement server-side y sesiones existentes. El alcance confirmado
por el usuario es barbería/contacto, no gestión de identidades de Supabase Auth.

Evidencia operativa y pendientes de facturación: `docs/MODULOS/admin.md`.

## Datos ficticios independientes para grabar Finanzas — 2026-10-01

Los ejemplos se crean desde una fecha y una sucursal sintética, sin transformar importes o nombres reales. El modo mantiene los contextos reales para autorización, pero suspende lecturas operativas y protege escrituras, incluidas las automáticas al cargar Sueldos/Gastos. `sessionStorage` lo limita a la pestaña y lo vincula a la identidad tenant para evitar arrastrarlo a otra cuenta. Las operaciones reales en curso deben terminar antes de activar. La navegación fuera de Finanzas requiere salida explícita; la URL queda sin cambios porque la grabación acordada cubre solo el contenido de la app.

Se usa una presentación ficticia para la barra lateral, sin alterar la sucursal operativa: modificar el contexto real habría cambiado el alcance de consultas y permisos al volver al uso normal. Al cambiar la fuente se remontan los paneles para impedir que formularios o detalles anteriores reaparezcan. La confirmación vive en el árbol tenant para cubrir también un bloqueo de suscripción sobrevenido, manteniendo el control de acceso y ocultando allí la identidad real. El Toaster global usa la misma guarda mediante suscripción de React porque vive fuera del árbol tenant: así una respuesta tardía de otro módulo no puede insertar un aviso real en la grabación. Los pagos e inversiones del escenario conservan importes/identificadores al filtrar por sucursal; se verificó esta estabilidad durante el segundo build.

## La sesión tenant se reutiliza, no se prolonga artificialmente

Para reducir logins repetidos se aprovecha la sesión que Supabase ya persiste
en `localStorage` y renueva con refresh tokens. La homepage permanece pública;
el acceso por `/login` restaura la sesión si aún es válida y delega la
verificación de organización a la ruta protegida. No se agregan cookies propias,
un control “recordarme” ni un JWT más largo: sumarían complejidad o riesgo sin
resolver el fallo de carga del perfil. La duración real sigue gobernada por la
configuración central de Supabase, que debe verificarse en producción antes de
prometer un plazo concreto. Un logout explícito siempre exige un login nuevo.

Las lecturas del contexto tenant usan reintentos acotados solo para errores
transitorios y cancelación de peticiones. Mantener la sesión ante un fallo REST
permite que “Reintentar” recupere la fase fallida sin contraseña; asociar cada
respuesta a usuario/organización evita mostrar datos de un tenant anterior.
Una ausencia confirmada, 401 o denegación de permisos no se reintenta
automáticamente.

## Por qué existe la regla de color de chip

La especificación vigente (`bg-primary/10` = se edita acá, `bg-muted` = atajo
o solo lectura) vive en `DESIGN.md` → Colors → Named Rules. Acá solo el
porqué: surgió de una auditoría sobre Configuración de reservas, donde 3
tratamientos de chip convivían sin regla escrita. Se declaró explícitamente
y ya se aplicó retroactivamente en Portal público ("Compartir tu portal"
corregido de primary a muted, porque no edita nada).

## Portal público no está migrado al canon de formularios

A diferencia de Configuración de reservas (RHF+Zod completo, modo
lectura/edición por card), Portal público sigue siendo un formulario
siempre-editable con guardado mixto (instantáneo para logo/portada,
diferido con botón para el resto). Es una divergencia temporal conocida,
no un error — migrarlo del todo requiere decidir primero cuál de los dos
modelos de guardado se adopta (Fase 5, pendiente).

## La vista previa de Portal público es el portal real

`PortalPreview.tsx` no es una maqueta — renderiza el mismo componente
(`BookingLanding`) que ve el cliente final en `Reservar.tsx`. Decisión
correcta (la preview nunca puede mentir), pero implica que no se puede
rediseñar visualmente sin tocar el portal público real.

## Horarios: editor único, múltiples puertas de entrada

Se descartó duplicar el editor de horarios en Mi Negocio y en Turnos.
El editor vive en un solo lugar (Mi Negocio → ficha de Sucursal) y Turnos
tiene un acceso directo. Motivo: el editor de horario del barbero necesita
ver el horario de la sucursal al mismo tiempo (para copiar como base o
comparar contra el override) — separarlo en dos pantallas hubiera roto esa
referencia cruzada.

## Admin es un plano de control, no un tenant privilegiado

Se descartó modelar al administrador de Vittro como `owner`, agregarlo a
`app_role` o darle membresía en todas las organizaciones. Esos mecanismos son
delegables dentro de un tenant y mezclarían dos fronteras de confianza. Admin
vive en `/admin`, fuera de los providers de organización/sucursal, y se autoriza
únicamente con `app_metadata.platform_role = "platform_admin"`. Su cliente Auth,
sesión, caché y cierre por inactividad son independientes para que pueda convivir
con una sesión tenant sin contaminarla.

El alias compartido `admin` es una decisión consciente de v1: simplifica el
acceso pedido, pero la auditoría solo puede atribuir una acción a esa identidad,
no a una persona concreta. También se acepta temporalmente no exigir MFA. El
email técnico y la credencial se provisionan fuera del repositorio; el frontend
solo conoce el email público de resolución del alias. Administradores nominales
y MFA son la evolución recomendada antes de ampliar las capacidades de escritura.

## El guard del frontend nunca concede privilegios de plataforma

Ocultar rutas o comprobar claims en React solo evita estados de UX incoherentes.
Cada Edge Function global vuelve a verificar el bearer JWT contra Supabase Auth,
que el usuario siga vigente y que su `app_metadata` actual conserve el rol de
plataforma. Recién después usa `service_role`; esa clave nunca sale del servidor.
Las tablas de control tienen RLS activa, no ofrecen policies a `anon` o
`authenticated` y reservan privilegios a `service_role`.

## Un precio tiene una fuente, una versión y una propagación durable

Se eliminó el modelo de precios duplicados en componentes y
`plan_features.price_monthly`. `subscription_plans.amount_ars` es la fuente
única para Homepage, Registro, Facturación y `SubscriptionGate`, y
`price_version` identifica la revisión exacta. Cada checkout y suscripción
persiste el importe y la versión que contrató: así un enlace viejo no puede
reaparecer silenciosamente después de un cambio de catálogo.

Actualizar un plan no se resuelve con una sucesión de requests desde React. Una
RPC `SECURITY INVOKER`, ejecutable solo por `service_role`, bloquea el plan,
comprueba importe/versión/fecha esperados, cambia el catálogo y materializa un
lote inmutable en la misma transacción. El worker actualiza cada `preapproval`
por separado, con claims acotados, revalidación, idempotencia y reintentos. No hay
rollback automático ante éxito parcial: revertir el catálogo no podría deshacer
de forma atómica las renovaciones externas ya actualizadas y produciría una
segunda divergencia. El estado parcial queda visible para intervención y retry.

Cada ítem persiste, antes del efecto externo, el `preapproval`, la operación y la
revisión exacta de la suscripción. Si esa revisión cambia, no se declara éxito a
partir de una lectura tardía: se reconcilia Mercado Pago con la intención más
reciente y se confirma con otro CAS. Si el plan/preapproval todavía son el
objetivo del lote, la reconciliación termina de aplicar el precio nuevo; solo una
intención realmente reemplazada se compensa y queda excluida.

## Las métricas globales usan vigencia efectiva, no etiquetas ambiguas

“Barbería con acceso” significa organización habilitada con trial o período de
suscripción vigente. “Usuario activo” significa una cuenta tenant cuyo último
ingreso ocurrió en los últimos 30 días; nunca se presenta como presencia online
y excluye identidades de plataforma. Los pagos aprobados se agrupan por fecha
efectiva (`paid_at` cuando existe) y no solo por creación. Esta semántica evita
que métricas comercialmente distintas compartan la misma etiqueta y permite
separar trial, activa, vencida, cancelada y legacy.

## Los eventos de Mercado Pago no son autoridad suficiente por sí solos

Firma válida, idempotencia y un estado `approved` son necesarios pero no bastan
para otorgar acceso. Antes de mutar la suscripción, el webhook compara moneda,
importe, plan, referencia, período y vínculo local; usa una actualización CAS
para impedir que eventos concurrentes o fuera de orden retrocedan el estado. Si
falta el secret de firma, falla cerrado salvo un opt-in explícito y limitado a
sandbox. La intención local de checkout se conserva frente a rechazos
recuperables. Al promover uno nuevo, primero se confirma el estado local por CAS
y se persiste un marcador del vínculo reemplazado; después se cancela ese vínculo
de forma idempotente. Así una carrera no puede cancelar la suscripción que aún
figura vigente y un retry puede terminar la limpieza.

## La excepción de provisioning requiere Lovable

Las funciones SQL nuevas del módulo Admin son `SECURITY INVOKER`. La única
excepción involucrada es `handle_new_user`, una función `SECURITY DEFINER` que ya
existía: necesita un early return para que una identidad de plataforma no cree
organización, sucursal, perfil owner ni trial. Por la política del repositorio,
esa sustitución quedó preparada en una migración pero no se aplica desde una
sesión local o automatizada; debe revisarse y ejecutarse mediante Lovable antes de
crear la cuenta técnica.

## El viewport gobierna el shell; el componente gobierna su propio espacio

La auditoría responsive de C7 midió una contradicción concreta: el shell
usaba `useIsMobile` (JS, corte en 768px) mientras el layout general corta
en `sm:` (CSS, 640px), y entre 640 y 768px el botón de hamburguesa y el
tile de `PageHeader` se solapaban entre 28 y 36px en la medición real. La
causa no era un bug puntual — eran dos sistemas contestando la misma
pregunta ("¿esto es mobile?") con números distintos.

C7.1 fija la regla que resuelve la causa, no todavía el síntoma: separa
tres preguntas que se venían mezclando bajo un solo "ancho de pantalla" —
qué modo de ventana es esto (CSS, tres modos: Compact/Medium/Expanded),
si el contenido entra en su propio contenedor (medición vía
`ResizeObserver`, no un breakpoint), y si hace falta una container query
(solo cuando las dos anteriores no alcanzan). Los breakpoints técnicos de
Tailwind se centralizan en `src/lib/breakpoints.ts` para que CSS y JS
lean el mismo número en vez de declararlo cada uno por su cuenta.

La migración real de `useIsMobile` en el shell (`AppSidebar`, `PageHeader`)
pertenece a C7.2 — acá solo queda escrita la regla que esa migración va a
seguir, para no tener que decidirla de nuevo pantalla por pantalla. La
especificación completa vive en `DESIGN.md` → Layout; este archivo no la
repite.

## Medium tiene navegación persistente porque tablet es mostrador, no un desktop chico

La tablet de mostrador es un dispositivo operativo prioritario (PRODUCT.md →
Operating Context), no una ventana de desktop que quedó angosta. Colapsar el
shell a un drawer temporal ahí —como hacía `useIsMobile` hasta 768px— le
pide al barbero abrir un menú para cada cambio de módulo en el dispositivo
que más rota de mano durante el día. Un riel persistente de 64px resuelve
eso: conserva acceso frecuente a los 8 destinos sin consumir el ancho de un
sidebar completo, y no depende de un toggle que Medium no tiene espacio
conceptual para ofrecer (Expanded sí, porque ahí competir por ancho con el
contenido es una decisión real del usuario).

El riel de Medium no reutiliza tal cual el riel colapsado de Expanded: ese
depende de `title`/hover para identificar cada ítem, algo que no existe en
touch. Medium necesita una etiqueta compacta siempre visible — se resolvió
extendiendo el rol tipográfico `Micro` ya existente (badges, contadores,
section labels) en vez de crear un cuarto tamaño de texto para un solo caso.
La especificación completa vive en `DESIGN.md` → Components → Navigation →
Sidebar; este archivo no la repite.

## La protección física de un overlay vive en la primitiva, no en cada consumidor

La auditoría de C7.3 encontró el mismo patrón repetido en `Dialog` y
`AlertDialog`: `w-full` sin gutter y sin `max-h`, y varios consumidores
(`DailySummary`, `DonutDetailDialog`, `MetricDetailDialog`,
`StockHistoryDialog`, `PortalCoverPositionDialog`) ya habían descubierto el
problema por su cuenta y lo parchaban cada uno a mano, con valores parecidos
pero no iguales (`max-h-[85vh]`, `max-h-[90vh]`, `w-[calc(100vw-2rem)]`). Ese
patrón — la misma protección reinventada archivo por archivo — es exactamente
lo que `DrawerForm` ya evitaba con su propio ancho fijo por tamaño, hasta que
esa misma fórmula (`sm:w-[680px]` sin techo) resultó insuficiente en la banda
640–679px y produjo el defecto que midió la auditoría (`left: -30px`).

La decisión no es agregar más protecciones locales, es mover la garantía al
único lugar donde no se puede olvidar: la primitiva. Si `Dialog` garantiza por
sí solo que nunca excede el viewport, ningún consumidor nuevo necesita
recordar agregar `max-h`/gutter — y los que ya lo hacían pueden seguir
haciéndolo (sus clases ganan por `tailwind-merge`, la base no los contradice).
Es la misma razón por la que `Popover`/`DropdownMenu` pasan a leer la altura
real que expone Radix (`--radix-*-content-available-height`) en vez de asumir
un máximo fijo: el espacio disponible ya lo sabe la librería, no hace falta
que cada consumidor lo vuelva a calcular ni lo ignore.

No se restructuró el DOM de `Dialog`/`AlertDialog` en header/body/footer fijo
— eso hubiera sido una ruptura de API sobre ~90 consumidores para un
problema que la garantía exterior (ancho, alto, scroll) ya resuelve. Un
consumidor que necesita header fijo y body scrolleable propio
(`ProductoPickerDialog`) ya lo arma con `flex flex-col` + su propio scroll
interno, sin que la primitiva se lo exija ni se lo impida. La especificación
completa vive en `DESIGN.md` → Components → Overlays — contrato físico; este
archivo no la repite.

## Por qué Caja fue el piloto de los patrones de datos, y no Finanzas

C7.5 necesitaba un lugar real donde probar `MetricGroup`, `RecordRow` y el
contrato de tabla comparativa antes de propagarlos a Sueldos, Gastos,
Inversiones, Deudas y Estadísticas (C7.6) — cinco superficies con lógica
financiera más sensible (comisiones, cierres, anulaciones con auditoría). Caja
(`DailySummary.tsx`, `CashClosingHistory.tsx`) ya tenía, en el código
existente, el anti-patrón exacto que motivó el build (`grid-cols-3
md:grid-cols-4` en el resumen general) *y* dos instancias más del mismo
problema en el mismo archivo (el diálogo de cierre, el historial de cierres) —
suficiente duplicación real para justificar un componente, sin todavía tocar
la superficie de mayor riesgo. Validar el patrón contra un problema que ya
existía en producción, antes de tocar Sueldos o Gastos, es más seguro que
migrar por uniformidad.

## Por qué el historial de cierres de caja quedó como Registro, no como tabla

La auditoría de C7.5 esperaba encontrar en `CashClosingHistory.tsx` una tabla
comparativa (fechas × efectivo × Mercado Pago × totales) — el nombre "historial
de cierres" invita a pensarlo así. El código real es otra cosa: cada cierre es
un evento auditable con su propia acción destructiva (anular), vive dentro de
un `DrawerForm` de 680px máximo, y hoy ya funciona como una lista de cards. Eso
es la definición de Tipo A (Registro), no Tipo B (Tabla comparativa) — la
decisión es semántica, no un conteo de columnas. Convertirlo en una tabla de
~8 columnas dentro de un contenedor angosto hubiera sido peor UX que lo que ya
había, solo para que el build pudiera decir que "usó" el patrón de tabla. El
contrato de tabla comparativa se construyó y probó igual (con datos
financieros realistas, en un harness temporal, nunca en producción) para que
C7.6 lo tenga listo el día que aparezca un consumidor real.

## Por qué `MetricGroup` es flexbox y no CSS Grid `auto-fit`

El Shape original pedía `repeat(auto-fit, minmax(var(--metric-min), 1fr))`.
Probado con el baseline financiero real (`$99.999.999` y una sonda de
`$1.234.567.890`), ese `1fr` reparte el espacio en partes iguales *sin mirar
el contenido*: si una cifra necesita más ancho que la porción que le tocó, el
texto se sale de su columna y se superpone con la columna vecina — exactamente
la clase de defecto que el baseline financiero existe para atrapar. CSS Grid
tiene una forma de evitarlo (que el mínimo de la pista sea `min-content` en
vez de un largo fijo), pero combinado con `auto-fit` el conteo de columnas se
vuelve indefinido y el navegador cae a una sola columna aun con espacio de
sobra — probado y descartado también. Flexbox con `flex-wrap` resuelve esto
por construcción: un flex item nunca encoge por debajo del ancho de su propio
contenido a menos que se le ponga `min-width: 0` explícitamente, y acá nunca
se pone. El wrap a la fila siguiente ocurre solo, sin necesidad de calcular
nada. Es la misma garantía que pedía el Shape (sin breakpoints, sin JS,
reacciona al espacio real), lograda con la herramienta que efectivamente la
cumple.

## La navegación horizontal conserva una única línea y hace explícita su continuidad

La auditoría de C7.4 encontró la causa exacta de los tres síntomas que motivaron
el build: `FinanzasPanel` y `MiNegocioPanel` le agregaban `flex-wrap` a su
`TabsList` (las pestañas se partían en dos filas en vez de quedarse en una);
`MiNegocioPanel` además envolvía sus tabs de sucursal en un `overflow-x-auto
scrollbar-hide` interno — dos estrategias contradictorias apiladas para la
misma fila, y la que sí scrolleaba lo hacía sin ninguna señal de que había más
sucursales fuera de vista. Y las tres páginas largas de Mi Negocio/Portal
tenían su navegación interna envuelta en `hidden md:block`: por debajo de
768px, la navegación no se ocultaba ni se adaptaba, directamente dejaba de
existir en el DOM interactivo.

La decisión, igual que en overlays (C7.3), es que la garantía viva en la
primitiva: `TabsList variant="underline"` nunca envuelve por construcción
(`flex-nowrap`), se vuelve scrolleable cuando no entra, y siempre expone la
misma señal — un fade de 24px, visible solo del lado donde efectivamente hay
contenido oculto — para que ningún consumidor tenga que inventar su propia
afordancia ni, peor, quedarse sin ninguna. `SectionNav` nace como componente
nuevo (no un parche por página) precisamente porque las tres páginas
duplicaban carácter por carácter la misma responsabilidad — mismo mecanismo
físico que Tabs, pero semántica distinta: Tabs cambia qué contenido está
montado, `SectionNav` desplaza a una sección que ya está montada. Confundir
ambas hubiera sido usar la primitiva equivocada para la pregunta equivocada.

`SectionNav` inicialmente no resaltaba una "sección activa": ninguno de los
tres consumidores tenía esa noción antes de C7.4, y el build original pedía no
reinventar observación de scroll sin necesidad. El ajuste de cierre de C7.4
corrigió esto — resulta que sí formaba parte del Shape aprobado, no era una
decisión de producto nueva por tomar. La resolvimos con `IntersectionObserver`
en vez de, por ejemplo, comparar `scrollY` contra offsets fijos, porque es la
única de las dos que no rompe apenas cambia el contenido de arriba (una
sucursal con más o menos campos, un Collapsible que se abre) — mide el DOM
real, no una posición de scroll asumida. El único número que necesitaba (cuánto
"tapa" el `<nav>` sticky al medir qué sección entró) sale de
`getBoundingClientRect().height` sobre el propio `<nav>`, no de una constante
copiada a mano — si el alto de la tira cambia algún día, el cálculo se ajusta
solo. La sección activa se define como la última, en orden de documento, que
sigue dentro de la franja de lectura (bajo la tira sticky, sin llegar al
tercio inferior del viewport) — el mismo criterio que usa cualquier scroll-spy
convencional, elegido por ser predecible y no por ser el único posible.

## Por qué la continuidad de la navegación horizontal pasó de señal a mecanismo

C7.4 resolvió "una navegación que no entra" con una tira de una sola línea,
scrollbar oculta y un fade como única pista. El QA manual posterior al cierre
lo desmintió: con mouse no había forma de llegar a Inversiones y Deudas en
Finanzas — el fade tapaba justo el tab cortado (quedaba un fragmento de ícono
sin texto), no existía scrollbar ni arrastre, y con `Tabs` no controlado ni
siquiera el tab activo se traía a la vista. Una señal de que hay más contenido
no equivale a un camino para llegar a él; en una navegación, donde ocultar un
destino es inaceptable, hace falta el camino.

La decisión es que la primitiva ofrezca controles direccionales explícitos
(chevrons), no que cada consumidor invente los suyos. Se descartó envolver la
fila (rompe la jerarquía de un solo nivel), un menú "Más" o un Select
(reemplazan la navegación visible por otra), drag con mouse como mecanismo
principal (no descubrible) y scrollbar nativa visible (rompe el lenguaje
visual del resto de la app). Los chevrons solo desplazan la tira y nunca
activan un destino: si activaran, dejarían de ser una forma de mirar y se
volverían una segunda forma de navegar.

Cada toque **pagina alineando un destino completo** (el primero no visible hacia
la derecha, el último no visible hacia la izquierda) en lugar de un ancho
fijo: un salto en píxeles deja cortes arbitrarios contra el borde — la misma
media palabra que el fade original mostraba — y hace impredecible qué apareció.
Un destino por toque hubiera necesitado cuatro toques para recorrer Mi Negocio
→ Sucursal a 320px. Van superpuestos y no reservan ancho para que aparecer o
desaparecer no corra los labels ni cree un bucle de medición, y el degradé
quedó reducido a su fondo — no es una segunda señal. El orden DOM es el orden de
foco (flecha izquierda → tira → flecha derecha, sin `tabindex` positivo) y ambas
flechas viven fuera del `role="tablist"` para no entrar en el roving focus de
Radix.

El auto-scroll del activo se movió de `TabsTrigger` a `TabsList`: dependía de que
el wrapper React del trigger se re-renderizara, y Radix cambia el `data-state`
sin pasar por él. Un `MutationObserver` filtrado a "un tab pasó a `active`" (más
un tab que se agrega ya activo, para sucursales que cargan tarde) es lo que hace
que no pelee con el scroll manual: no escucha scroll ni resize, así que sin
cambio de tab no hay movimiento. Todo se resuelve moviendo únicamente
`scrollLeft`, nunca con `scrollIntoView`, que puede arrastrar la página.

`useScrollAffordance` ganó `observeContent` como opt-in: las tablas comparativas
comparten el hook y no debían cambiar de comportamiento. La regla de motion
global tampoco cubre el scroll suave, así que el desplazamiento decide él mismo
entre suave e instantáneo según `prefers-reduced-motion`; la coreografía de
motion sigue siendo de C11.

Un hallazgo del mismo QA se resolvió aparte, sin chevrons: la fila de
Agenda → Configuración nunca tuvo un scroller interno porque `w-fit` + `w-auto` +
un wrapper sin `min-w-0` hacían que midiera su propio contenido; el shell (D41) lo
recortaba. Se corrigió su geometría local, no la primitiva.

## Por qué `Table.comparative` pasó a ser opt-in

C7.5 dejó la afordancia de fade de `ui/table.tsx` activa para las ~9 tablas
existentes, con el razonamiento de que era "inerte" salvo que una tabla
realmente desbordara. Antes de cerrar C7.5 se verificó ese supuesto y resultó
falso: `SueldosPanel.tsx` (4 tablas, hasta 6 columnas, sin `min-width`) y
`GastosPanel.tsx` (2 tablas de 6 columnas, una de texto libre) son consumidores
reales sin ninguna protección de ancho — plausiblemente ya desbordaban en
viewports angostos por razones ajenas a ser comparativos, lo que hubiera hecho
aparecer la afordancia nueva sobre Finanzas sin que el build la hubiera tocado
ni revisado. El mecanismo no tenía forma de distinguir "tabla Tipo B genuina"
de "tabla Tipo A que resulta angosta" — solo medía si desbordaba. Se convirtió
en opt-in (`comparative?: boolean`, default `false`) con la rama por defecto
byte-idéntica a la primitiva anterior a C7.5, para que activar la afordancia
fuera siempre una decisión explícita del consumidor, nunca un efecto lateral
de su propio contenido.

## Por qué Cierres de Caja de Sueldos es Tabla comparativa y el resto de Sueldos/Gastos es Registro

C7.6 migró cinco estructuras tabulares de Finanzas y solo una terminó en
`Table comparative`. La pregunta no es cuántas columnas tiene cada una — las
seis que descartó (Resumen por Empleado, Historial de Pagos ×2, Historial de
Gastos, Gastos Recurrentes) tienen entre 3 y 6. La pregunta es qué compara el
usuario: en Cierres de Caja (dentro de la fila expandida de un empleado en
`SueldosPanel.tsx`) no hay ninguna acción por fila — es un historial de
lectura donde el valor está en comparar efectivo/MP/facturado/comisión *entre*
cierres, la definición exacta de Tipo B. Las otras cinco son listas de
entidades independientes (un pago, un gasto, una regla de recurrencia) que se
leen una por una, no en comparación de columnas — Tipo A, aunque el código
anterior las mostrara en una tabla. Coincide con el precedente de C7.5
(`CashClosingHistory.tsx`, Tipo A pese a tener columnas comparables) y lo
completa: ahí faltaba el consumidor Tipo B real que D44 pedía, y apareció acá.

## Por qué Inversiones y Deudas no migraron

`InversionesPanel.tsx` y `DeudasPanel.tsx` ya eran, antes de C7.6, listas de
cards con `flex-wrap`, `min-w-0` en la identidad y `whitespace-nowrap` en las
cifras junto a la barra de progreso — el mismo resultado visual que
`RecordRow`/`MetricGroup` imponen, llegado por otro camino antes de que esos
patrones existieran. No se encontró un caso real de información que
desapareciera o se solapara a 320–375px (auditoría de código; ambas pantallas
dependen de Supabase con sesión real y no se replicaron con el harness de este
build). Migrarlas de todos modos hubiera sido cambiar una estructura que ya
cumple la regla del dinero por otra visualmente distinta sin corregir ningún
defecto real — exactamente lo que C7.6 pide no hacer ("no migrar por
uniformidad si una estructura ya funciona bien").

## Por qué el hover-only de MpDevicesConfig se resolvió con un arbitrary variant de Tailwind, no con un plugin

El botón de renombrar terminal usaba `sm:opacity-0 sm:group-hover:opacity-100`
— invisible por defecto a partir de 640px, revelado solo por `:hover`. En una
tablet táctil ≥640px eso es una acción sin ningún mecanismo real que la
revele: el ancho no es una señal válida de "este dispositivo tiene mouse"
(regla ya vigente en DESIGN.md → Do's, esto es su primer caso real de
aplicación). La corrección necesitaba la media feature `hover`, no un
breakpoint — sin agregar una dependencia nueva: Tailwind 3.4 (ya instalado)
soporta variants arbitrarios de media query (`[@media(hover:hover)]:`) de
fábrica, verificado en el stylesheet generado (`@media (hover: hover) { ... }`
correctamente scoped). Se descartó instalar un plugin de `pointer`/`hover` o
tocar `tailwind.config.ts` — no había necesidad real, la sintaxis nativa ya
alcanzaba. Verificado con dos cargas frescas del harness (nunca con resize
sobre una página ya montada, que en este mismo proyecto ya dio falsos
negativos con `ResizeObserver` en C7.7): `hover:hover` real → oculto hasta
hover; `hover:none` emulado (touch) → siempre visible.

## Por qué el bloque de Reservas de ClienteDetailDialog pasó a MetricGroup

`grid grid-cols-3` (Total/Última/Próxima) dentro de un `DrawerForm size="lg"`
(680px, pero clamped a `viewport - 48px` en Compact — a 320px de dispositivo
quedan ~224px de contenido real) es exactamente el caso que `MetricGroup`
(C7.5) ya resuelve: N métricas etiqueta+valor cuya cantidad de columnas debe
responder al espacio real, no a un grid fijo. No se creó una solución nueva
— se consumió el primitivo ya existente y estable, igual que lo hizo C7.6
para Sueldos. No es "reabrir" `MetricGroup.tsx` (no se tocó su archivo);
es el mismo tipo de consumo nuevo que ya está documentado como uso previsto
del componente.

## Por qué MIN_COL de 3 días/Semana es 128px y no 160px (el de Día)

El Shape dejó la decisión abierta entre ~112px y ~128px, a elegir con
evidencia. Se midió con el componente real (`AgendaMultiDayTurnoCard`) en un
harness temporal: a 96px y 112px un nombre de barbero realista pero no
extremo ("Francisco Rodríguez", 20 caracteres) ya se trunca en el detalle
terciario de la card; a 128px entra completo. Un nombre de cliente
genuinamente largo ("Bartolomé Etcheverry Insúa") se trunca en las tres
medidas probadas, 96 a 160px — eso es esperado (la card ya trunca por
diseño, C7.7 no la rediseña) y no es lo que la decisión debía resolver. Se
descartó copiar el `MIN_COL_WIDTH = 160` de Día: esa columna representa un
barbero (típicamente 1–8 por sucursal); en 3 días/Semana la columna
representa un día, y Semana necesita 7 en simultáneo — con 160px, 7 columnas
ya piden 1120px solo de grilla antes del riel horario, forzando scroll
horizontal incluso en desktops medianos donde hoy no hace falta. 128px es
además uno de los dos valores que el propio Shape proponía, ahora con
evidencia detrás en vez de elegido por intuición.

## Por qué la altura de Agenda pasó a medirse, no a adivinar un segundo número fijo

`clamp(600px, calc(100vh - 180px), 1100px)` tenía dos supuestos que dejaron
de sostenerse: que "100vh - 180px" casi siempre superaría 600px (falso en
375×667 y 320×568, donde da 487px y 388px — el piso ganaba igual y forzaba
un alto mayor al real, generando el scroll vertical anidado reportado), y
que 180px seguiría representando fielmente "todo lo que va arriba de la
grilla" — un supuesto que este mismo build debilitó más, al hacer que el
toolbar de `AgendaPanel` pueda partirse en dos líneas en viewports angostos
(cambia cuánto mide "arriba"). En vez de afinar la constante, se midió: el
offset real (borde superior del componente + alto de su propio header
sticky + un gutter chico) sale de `getBoundingClientRect()` en runtime, y
la altura máxima queda `clamp(240px, calc(100svh - offsetMedido), 1100px)`
— `svh` en vez de `vh` por la misma razón que el resto de C7 (estable
frente al chrome móvil dinámico durante el scroll), 240px como piso de
seguridad genuino (una grilla de 0px no tiene sentido) en vez de un piso
que en la práctica siempre ganaba. La propiedad del scroll no se movió: la
grilla conserva su propio `overflow-y-auto` (mantiene el header sticky
dentro de su cuerpo, y sobre todo no toca el auto-scroll-a-la-hora-actual
de `AgendaDayView.tsx`, que opera sobre esa misma referencia) — se
consideró y se descartó eliminarlo para que `<main>` fuera el único
scroller, porque hubiera exigido reescribir el auto-scroll-a-hora-actual
para operar contra un contenedor ajeno, un riesgo real sobre lógica que el
build tenía instrucción explícita de preservar, a cambio de una ganancia
arquitectónica que la fórmula medida ya resuelve por su cuenta.

## C7.8B — por qué el total reduce tipografía en el ancho mínimo

**Ubicación en la app:** Cobrar → resumen del pago → Total a cobrar.
**Archivo técnico:** `src/components/PaymentRegistration.tsx:1731`.

La implementación existente conserva la composición del resumen y usa
`text-2xl sm:text-3xl tabular-nums whitespace-nowrap` para el total. El reporte
del build documentó que `$99.999.999` ya entraba, pero `$1.234.567.890`
desbordaba a 320px con 30px incluso sin permitir saltos de línea. El tamaño
de 24px en el tramo angosto resolvió ese caso; 30px se conserva desde el
breakpoint compartido `sm`. Es una decisión local de presentación del importe,
no una nueva política de grillas, un máximo de dinero soportado ni un cambio
de cálculo o formato.

La verificación original debió hacerse cambiando el viewport real: limitar
solo el ancho de una sonda dentro de una ventana grande no desactiva `sm:`.
La continuación en Codex confirmó las clases y la ausencia de cambios
funcionales, sin repetir esa medición visual. La regla normativa del dinero
ya existe en **Ubicación en la app:** transversal → sistema visual;
**Archivo técnico:** `DESIGN.md`; aquí se registra únicamente el porqué de
esta elección concreta. El estado del chequeo global y el QA pendiente viven
en **Ubicación en la app:** transversal → estado del proyecto;
**Archivo técnico:** `docs/ESTADO_ACTUAL.md`.

## Por qué el ribbon de fechas del Portal se resolvió con ancho fluido, no con scroll local

El ribbon de 5 días de `FechaHorarioStep.tsx` tenía dos salidas válidas según
el propio contrato de C7 (layout intrínseco primero, scroll local cuando
corresponde semánticamente). Se eligió ancho fluido (`flex-1 min-w-0` en
vez de `shrink-0 w-12` + `overflow-x-auto`) porque la cantidad de items es
fija y chica (siempre 5, nunca más) — a diferencia de Tabs o de la grilla
semanal de Agenda, acá no hay nada que el usuario podría necesitar "seguir
scrolleando para ver": los 5 días completos siempre caben mostrándose enteros,
solo necesitan poder angostarse. Agregar scroll local a un set fijo de 5
ítems habría sido resolver con la herramienta equivocada — el problema real
era que el ancho pedido (fijo) no respondía al espacio real, no que hubiera
contenido genuinamente más ancho que su contenedor.
