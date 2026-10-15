# Estado actual — Vittro

Última actualización: 2026-10-14

## Programa de aliados — publicado y habilitado

Publicados: entrada “Crear mi código” en Homepage, `/aliados`,
`/aliados/panel` sin providers tenant, ingreso/alta/recuperación, código en signup,
datos de cobro, niveles/progreso/comisiones, y `/admin/aliados` con convenios,
verificación de titularidad, liquidaciones, comprobantes e incidencias.

Motor: centavos exactos, snapshot de cotización para intro 10%, comisiones
10/20/30% o convenio hasta 100%, calificación acumulada por dos ciclos, hold
30 días y ajustes por reversión. Checkout tiene ruta promocional separada;
webhook reanuda la etapa del aliado en duplicados ya procesados por billing.
Worker: outbox durable, renovación al catálogo vigente con reconciliador CAS
actual, lectura del pago real para devoluciones y liberación. Instagram retirado:
sin conexión, niveles por audiencia ni refresh; datos antiguos privados.

Excepción directa de DB/RLS y producción autorizada por el usuario. Cinco
migraciones propias del primer rollout; revisión v2 suma una sexta migración
de niveles por referidos. 20 tablas con RLS sin lectura cliente directa,
funciones propias INVOKER, trigger Auth adaptado tras reportarlo y guard de hash.
Cinco Edge Functions publicadas; cron periódico con Vault/HMAC y Auth allowlist
configurados. Backend probado con rollback y Auth/API reales: cero fixtures
persistentes, creador sin tenant/trial, código y panel funcionales. Alta abierta;
Vercel Ready / Production / Current y Git original/fork sincronizados por avance
normal. Instagram está retirado: niveles 1/2/3 por 0/5/20 barberías calificadas,
con frasco de progreso, comunicación de ingresos para amigos/comunidades y
condiciones desplegables. Correo Magic Link en español y con marca Vittro. Se corrigió el orden real de
GoTrue con una intención privada de un uso, sin confiar en metadata de navegador.
No hubo cargos ni transferencias. Evidencia vigente de la revisión:
`docs/ALIADOS_NIVELES_REFERIDOS.md`; primer rollout: `docs/ALIADOS_PRODUCCION.md`.

Evidencia local: 34 pruebas de dominio + 3 de acceso/recuperación UI, seis pruebas
de barreras HTTP Deno sin permiso de red; build, lint focal y chequeo Deno de las
cinco funciones involucradas.
Regresión de la revisión aprobada: 207 Vitest, 32 Deno y 27 PostgreSQL/PGlite, incluidos los casos existentes.
QA Playwright con tráfico remoto interceptado:
11 escenarios: landing/panel/Admin a 390/768/1440px y correo a 390/680px,
drawers e importes de
$99.999.999 y $1.234.567.890 sin scroll horizontal ni errores de página. Artefactos
en `.impeccable/review/partners/`, ejecutor `supabase/tests/partners-ui-qa.cjs`.
TypeScript de app conserva cinco errores preexistentes documentados, sin errores
nuevos de Aliados. Detalle y pendientes: `docs/MODULOS/aliados.md`.

## Notificaciones — Etapa 1 de seguridad

**Implementada, validada localmente y APLICADA en el proyecto Supabase operativo — 2026-10-12**
(confirmado con `list_migrations`; el conector registró las versiones `20261012145524`,
`20261012145549` y `20261012145604`). Excepción de DB/RLS vía Claude Code autorizada solo para este build
(`docs/DECISIONES.md`). Tres migraciones nuevas, sin editar históricas:
`20261012100000_notifications_security_functions.sql` (M1),
`20261012100100_notifications_security_rls.sql` (M2),
`20261012100200_organizations_timezone_validation.sql` (M3). Sin cambios de UI ni de
frontend: la campana ya leía solo entregas propias.

Resuelto en código: **SEG-01** (cualquier miembro leía, creaba y reescribía `notifications`: ahora
solo lee con una entrega propia, sin escritura de clientes); **SEG-01b** (una entrega
podía reapuntarse a otra notificación: ahora solo `read_at`/`hidden_at` son mutables);
**SEG-02** (helpers `_notif_*` ejecutables por `anon`: inyección entre organizaciones,
lectura de emails, enumeración de admins; ahora sin `EXECUTE` para ningún cliente);
**SEG-03/04** (`upsert_notification_delivery` y `upsert_notification` eliminadas);
**SEG-05, solo la ruta de escritura** (`organizations.timezone` rechaza valores no IANA);
**SEG-06** (`process_vencimientos_tareas` sin `EXECUTE` para `anon`/`authenticated`).
`notif_emit_view_event` ahora valida que la sucursal sea la de la cuenta que llama.
Historial preservado (D1): perder cargo o sucursal no revoca lo ya entregado.

Evidencia: `supabase/tests/notifications-security-sql.mjs`, **44 pruebas** sobre
PostgreSQL local sintético con el esquema real de HEAD: reproduce las vulnerabilidades,
aplica M1–M3, comprueba que quedan cerradas y que los **22 escenarios de productores**
(triggers, cron y RPC) emiten exactamente las mismas entregas que antes; las migraciones
abortan ante dueños distintos, llamadores `SECURITY INVOKER`, jobs de cron sin acceso o
políticas inesperadas; verificado por mutación. Vitest 106/21 archivos, `tsc` raíz exit 0,
`tsc -p tsconfig.app.json` con los mismos 5 errores preexistentes (`abortSignal`,
`readRetry.test`), ESLint 378 errores + 54 warnings sin cambios por archivo, build OK.

**Pendiente (no resuelto):** QA manual autenticado con usuarios sintéticos de dos
organizaciones. `src/integrations/supabase/types.ts` se regeneró desde la base real el 2026-10-12
(sin las dos RPC eliminadas). Fuera de esta etapa y sigue abierto: RLS de Finanzas, helpers
generales de RLS, aislamiento de fallos por organización en los cron que no son de Tareas y
limpieza de zonas horarias históricas, push. Detalle: `docs/MODULOS/notificaciones.md`.

## Tareas automáticas — Etapa 2 (motor)

**Implementada, aplicada en el proyecto Supabase operativo y verificada — 2026-10-12.** Excepción de
DB/RLS vía Claude Code autorizada para este build (`docs/DECISIONES.md`). Cinco migraciones nuevas (la quinta, E2-M5 `20261012120400…`, corrige la pertenencia estructural; remota `20261012220833`), sin
editar históricas: `20261012120000_tareas_automaticas_calendario.sql`, `…120100_tareas_automaticas_pausa_integridad.sql`,
`…120200_tareas_automaticas_motor.sql`, `…120300_tareas_tipo_estado_integridad.sql` (versiones remotas
`20261012190213`, `…190408`, `…190548`, `…190623`). Detalle del modelo, pausas, recuperación y permisos:
`docs/MODULOS/tareas.md`.

Lo que cambia: el motor genera `tipo='tarea'` (antes `admin`, invisible para los barberos); un calendario canónico
calculado en la base desde `fecha_inicio` (sin drift; semanal, cada N semanas, varios días, mensual 29/30/31,
febrero, bisiesto, 29-feb); “hoy” según `organizations.timezone`; como máximo una ocurrencia por ejecución y, ante un
fallo del motor, **no reconstruye ni crea tareas que nacerían vencidas** (deja `recuperaciones` / `recuperacion_*`);
idempotente (`ON CONFLICT` + `SKIP LOCKED`) y aislado por Tarea automática; pausa automática y reanudación
automática por sucursal inactiva, barbero inactivo o **barbero sin asignación vigente** a la sucursal (E2-M5: principal,
recurrente o temporal vigente; la disponibilidad diaria `disponible` no pausa nada; la pausa manual nunca se reanuda sola); la próxima fecha solo se recalcula si cambia la programación; una tarea `en_progreso` también puede
vencer; los destinatarios individuales son los **usuarios** del barbero (`profiles.barbero_id`), no `barberos.id`. En la
app: copy “Tareas automáticas” / “Automática”, motivo de pausa en la tarjeta y aviso previo con la cantidad de Tareas
automáticas que se pausarán al finalizar la actividad de un barbero, desactivar una sucursal o quitar la última asignación
vigente de un barbero en una sucursal (eliminar asignación, eliminar recurrente, cambiar la principal).

Evidencia: `supabase/tests/tareas-automaticas-sql.mjs` (**72 pruebas** sobre la forma real de producción, **18
mutaciones detectadas**), suite de Etapa 1 **44/44**, Vitest 132/25 archivos, `tsc` raíz exit 0, `tsc -p
tsconfig.app.json` con los mismos 5 errores preexistentes, ESLint sin cambios por archivo (47 errores + 3 avisos en los
archivos tocados, igual que en HEAD), build OK, `impeccable detect` 0 anti-patrones. En producción se verificaron
funciones, permisos, triggers, constraints y cron, y una **prueba de humo dentro de una transacción revertida**
(motor, idempotencia, pausa por sucursal, camino de un dueño real y aislamiento con otra organización). Security
Advisors: sin hallazgos nuevos de este build (solo los `trg_*` heredados con `EXECUTE` por defecto).

**Pendiente / abierto:** QA manual de Sebastián (`docs/MODULOS/tareas.md`); **Etapa 4**
(rediseño de la pantalla); fecha del navegador y falta de paginación corregidas localmente en 4A-1 (ver abajo); una temporal que empieza o
vence sin ningún cambio se refleja en las Tareas automáticas con hasta una hora de demora (sincronización horaria).
La **Etapa 3** (saneamiento) ya se ejecutó: ver la sección siguiente.

## Tareas automáticas — Etapa 3 (reset pre-lanzamiento e integridad)

**Ejecutada y verificada en el proyecto Supabase operativo — 2026-10-13.** Backup interno verificado → ensayo de
restauración → reset → integridad definitiva. Detalle, alcance y límites: `docs/MODULOS/tareas.md` (“Reset
pre-lanzamiento”) y `supabase/diagnostics/20261013_etapa3_reset_tareas/README.md`.

Lo que cambió en producción: se borraron las Tareas legacy (144 tareas `tipo` `admin`/`tarea`, **todas** las 5 Tareas
automáticas y las 11 notificaciones de Tareas —8 huérfanas— con sus 18 entregas y 1 lectura). **Intactos**: las
peticiones (hoy no hay ninguna), el resto de las notificaciones (3.099 y 2.918 entregas), organizaciones, barberos,
sucursales, `barberos_sucursales` y todo lo de las Etapas 1 y 2 (funciones, triggers, grants, RLS, crons). La segunda
ejecución del reset no encuentra nada. Después, la migración 3B (`20261013120000_tareas_integridad_post_reset.sql`;
remota `20261013234522`): `tareas_tipo_check` (solo `tarea` y `peticion`; `admin` ya no es un valor válido y se rechaza al
insertar o actualizar), `tareas_recurrencia_check` (una ocurrencia automática es siempre `tarea` y tiene fecha) y la
eliminación del trigger temporal `trg_tareas_tipo_guard` y su función. No se tocaron las columnas de repetición heredadas.

**Consecuencias:** la lista de Tareas quedó vacía y las 5 Tareas automáticas hay que volver a crearlas desde la app (no
se restauran solas; el motor no genera nada hasta entonces). **No existe una copia fuera de la base**: el único respaldo es
el schema `etapa3_backup` del mismo proyecto (datos reales, sin acceso para roles de cliente). Decisión pendiente de Sebastián:
conservarlo o eliminarlo (`DROP SCHEMA etapa3_backup CASCADE`).

Evidencia: SQL **82/82** (incluye 10 pruebas de la Etapa 3 sobre datos legacy sintéticos con dos organizaciones, huérfanas y un
evento `peticion_*`), **24/24 mutaciones detectadas**, Etapa 1 **44/44**, Vitest **163/163** (26 archivos), `tsc` raíz exit 0, `tsc -p
tsconfig.app.json` con los mismos 5 errores preexistentes (`abortSignal`), build OK, ESLint sin problemas en el archivo tocado. En
producción: 27 verificaciones del backup, ensayo de restauración, 20 post-condiciones antes y después del `COMMIT`, prueba de
los CHECK en una transacción revertida y Security Advisors sin hallazgos nuevos (los mismos 7 de antes).

## Tareas — BUILD 4A completo localmente (2026-10-14)

**Implementación local, sin publicación ni aplicación en producción.** Principal → Tareas
(`src/components/TareasPanel.tsx`, `src/hooks/useTareas.ts`): Hoy y vencimientos por zona organizacional,
errores con reintento, abiertas paginadas sin corte silencioso, completadas bajo demanda
(`src/hooks/useTareasHistorial.ts`). Nueva tarea (`src/components/tareas/TareaFormDialog.tsx`): sucursal
obligatoria creando desde Todas y responsables estructurales (`src/hooks/useTareaResponsables.ts`).
Tareas automáticas (`src/components/tareas/RecurrentesPanel.tsx`, `src/hooks/useTareasRecurrentes.ts`):
errores explícitos, paginación y fecha organizacional al eliminar futuras pendientes. Campana global
(`src/hooks/useNotifications.ts`): consulta únicamente fuentes de sus entregas, sin cargar el módulo completo.
El mismo 4A agrega acciones servidor/PIN, timestamps, deshacer de 30 segundos y concurrencia
(`src/hooks/useTareaAcciones.ts`, `supabase/functions/tareas-action/`,
`supabase/migrations/20261014120000_tareas_acciones_controladas.sql`). SECURITY DEFINER solo privado,
excepción local autorizada; Manager limitado por sucursales reales, también en recetas.
43 SQL de acciones, 44 de Etapa 1, 82 de Etapas 2–3, 18 comerciales; 24 mutaciones previas y 12 nuevas detectadas.
Vitest 199/32 y build OK, mismos cinco errores TypeScript y 378 errores lint previos.
También se cerró localmente el acceso directo al hash del PIN; cinco consumidores de integrantes
usan columnas explícitas sin alterar sus filtros. Requiere recarga de pestañas antiguas en una futura
publicación coordinada. Detalle, archivos, límites y QA: `docs/MODULOS/tareas.md`.
No existe BUILD 4A-2. QA autenticado de despliegue y visual pendiente.

**Corrección final de 4A (2026-10-14, misma rama, autorizada antes de 4B):** lectura canónica de
proyecciones R1 `public.tareas_previstas(desde, hasta, sucursal)` (entrada INVOKER sobre
`tareas_private.previstas`, DEFINER solo para usar el calendario del motor cerrado a clientes; mismo
alcance que la lectura de tareas, organización del perfil, rango ≤ 14 días, nunca fechas pasadas ni
ocurrencias ya creadas), índice parcial del historial por `completada_at` (con evidencia de plan) y
tipos regenerados. 47 SQL de acciones y **17/17** mutaciones; Etapa 1 44, Etapas 2–3 82 + todas sus
mutaciones, comercial 18. Sigue sin aplicarse en producción.

## Tareas — BUILD 4B: rework UX/UI completo, local (2026-10-14)

**Implementación local sobre el mismo worktree de 4A (`codex/tareas-4a-1`), sin commit, sin push, sin
despliegue.** Principal → Tareas (`src/components/TareasPanel.tsx`) deja la grilla de tarjetas: lista vertical
de filas (`src/components/tareas/TareaFila.tsx`) organizada en Necesitan atención / Hoy / Próximas / Sin fecha
(`src/lib/tareasAgenda.ts`), progreso semanal lunes–domingo de la organización
(`src/components/tareas/TareasProgresoSemanal.tsx`) con Programadas de Tareas automáticas calculadas por la base
(`src/hooks/useTareasSemana.ts`), y Resueltas esta semana plegada con acceso al Historial
(`src/components/tareas/TareasHistorial.tsx`, por fecha de completado). "Mis tareas | Negocio" solo para
supervisores con integrante vinculado, recordado por usuario + organización (`src/hooks/useTareasAlcance.ts`);
barbero y cuenta de sucursal sin selector ni filtros. Completar en un toque con "Deshacer" del servidor;
Iniciar también en vencidas; Editar/Eliminar en el menú `⋯`; eliminar con confirmación. Detalle en panel
(`TareaDetalleDrawer.tsx`). Un solo formulario sobre `DrawerForm` + RHF + Zod (`TareaFormDrawer.tsx`) para
tarea y Tarea automática, con Hoy por defecto, "Sin fecha" visible y repetición dentro del mismo panel;
Peticiones con su propio `PeticionFormDrawer.tsx` y lista (`PeticionesLista.tsx`). Tareas automáticas como
subvista de configuración (`RecurrentesPanel.tsx`, `RecurrenteFila.tsx`). Se eliminaron `TareaFormDialog.tsx`,
`TareaRecurrenteFormDialog.tsx` y `RecurrenteCard.tsx`; `RepeatPicker`/`CustomRepeatSheet` siguen por Gastos y Bono fijo.
Vitest **235/33** (base 4A 199/32), build OK, `tsc` raíz exit 0 y `-p tsconfig.app.json` con los mismos 5 errores,
lint global 378 errores / 49 advertencias (base 378/50), detector de Impeccable sin hallazgos.
QA visual con datos sintéticos (`qa/tareas.html`, sin sesión real) a 375/768/1024/1280+; **QA autenticado
pendiente**. 4C (avisos semanales) no iniciado. Detalle: `docs/MODULOS/tareas.md`.

## Finanzas — modo ficticio

**Ambos builds implementados y validados localmente — 2026-10-01.** Botón al final de Estadísticas e indicador compartido en las cinco pestañas. Contexto por usuario/organización, persistencia por pestaña, escenarios independientes con dos sucursales/cuatro empleados/doce meses y guardas de lecturas/escrituras. Cuenta, sucursales, tooltips y atributos accesibles de la barra lateral usan la presentación ficticia; notificaciones y avisos globales, onboarding y resumen mensual automático quedan suspendidos. Salidas a otros módulos y facturación requieren confirmación. La URL conserva el slug real, fuera del encuadre acordado. Sueldos carga mediante `useSueldosData`; bonos/gastos recurrentes no se materializan durante el modo. Sin DB/RLS ni despliegue. Evidencia: diff de archivos, build exitoso, **72 pruebas en 17 archivos** y QA local de las cinco pestañas a 375/834/1280 px con acceso/backend simulados. TypeScript conserva cinco errores preexistentes en archivos sin modificar. Detalle y límites: `docs/MODULOS/finanzas.md`.

## Centro de administración de plataforma

**Desplegado en producción; tres cambios reales y caso Básico reconciliado —
2026-10-10.** Se incorporó una cuarta superficie en
`/admin`, separada del árbol tenant. Sus rutas no montan
`OrganizationProvider`, `SucursalProvider`,
onboarding ni `SubscriptionGate`; usan `AdminAuthProvider`, un cliente Supabase
propio con `sessionStorage` y una clave de almacenamiento independiente. La
sesión administrativa puede convivir con una sesión tenant en el mismo navegador
y cierra solamente el contexto Admin tras 30 minutos de inactividad.

El alias visible es `admin`, resuelto en frontend al email técnico configurado en
`VITE_PLATFORM_ADMIN_EMAIL`. La autorización real exige una cuenta vigente de
Supabase Auth con `app_metadata.platform_role = "platform_admin"`. El guard de
React solo mejora la experiencia: tanto `platform-admin-query` como
`platform-admin-price-change` vuelven a validar el JWT, el usuario actual y el
claim antes de crear un cliente `service_role`. La contraseña no forma parte del
código, migraciones, variables `VITE_*`, documentación, respuestas ni auditoría.

Superficie implementada: shell responsive propio; Resumen; Barberías; Usuarios;
Suscripciones con tabs Planes/Suscripciones/Pagos; y Auditoría. Los listados
aceptan búsqueda, filtros, orden y paginación con máximo de 50 registros por
página; desktop/tablet usan tablas densas y mobile cards equivalentes. Los DTO
permitidos excluyen payloads crudos, tokens y metadata arbitraria. Carga inicial,
refetch, error y vacío siguen el canon vigente de `DESIGN.md`.
Las métricas y listas operativas se filtran, agregan, ordenan y paginan en vistas
Postgres exclusivas de `service_role`; solamente MAU combina en Edge la lectura
paginada de Auth Admin con los perfiles tenant.

Definiciones de producto implementadas: una barbería con acceso es una
organización habilitada cuyo trial o período de suscripción sigue vigente;
`MAU 30 días` cuenta cuentas tenant con último inicio de sesión dentro de los 30
días anteriores y excluye identidades de plataforma. Los cobros del resumen usan
la fecha efectiva de aprobación, no la fecha de creación. Trials, vigentes,
vencidas, canceladas y legacy permanecen diferenciados.

Precios: `subscription_plans.amount_ars` quedó como única fuente consumida por
Homepage, Registro, Facturación, `SubscriptionGate` y checkout. El precio lleva
`price_version`; las suscripciones conservan snapshots de importe/versión de
facturación y checkout pendiente. La migración aplicada establece Profesional
en ARS 60.000 mediante un lote auditable solo si el importe anterior difiere; en
este despliegue ya estaba en ARS 60.000 y ese bloque fue un no-op. También elimina
el campo legacy `plan_features.price_monthly`. Un checkout pendiente solo se
reutiliza cuando plan, importe, versión, moneda, referencia y estado del proveedor
coinciden.

La edición de precio usa preview, confirmación del impacto, motivo y
reautenticación con contraseña. La RPC `SECURITY INVOKER` actualiza catálogo y
materializa el lote e invalida checkouts pendientes en una única transacción con
control optimista de importe, versión y `updated_at`. El worker toma hasta 20
ítems, procesa con concurrencia máxima 5 y reintenta errores transitorios hasta
tres veces. Antes de cada cambio verifica la suscripción y el `preapproval`, y
persiste el tipo de mutación y la revisión local exacta antes del `PUT`. Una
caída o respuesta ambigua conserva ese fence y se retoma de forma idempotente;
si la revisión local cambió, entra en compensación con CAS para reaplicar el
precio del lote cuando el objetivo siga vigente o restaurar/cancelar según la
nueva intención. Éxitos, fallos, exclusiones e interrupciones quedan trazables y
reintentables. Un éxito parcial no revierte el catálogo.

El webhook de suscripciones ahora falla cerrado si falta
`MERCADOPAGO_WEBHOOK_SECRET` (salvo opt-in doble y explícito para sandbox), valida firma
y antigüedad del timestamp, trata los eventos de manera idempotente y serializa
actualizaciones locales con comparación de `updated_at`. No promueve acceso ante
importe, moneda, plan o referencia incompatibles; preserva la intención de un
checkout rechazado para su recuperación y no procesa dos veces un pago anterior.
Los cobros de checkouts invalidados u otros vínculos obsoletos se persisten,
auditan y cancelan sin otorgar acceso. Un débito con el precio inmediatamente
anterior que quedó en vuelo durante un lote sí extiende el período pagado, pero
conserva el nuevo snapshot para el siguiente débito y abre una incidencia. La
promoción de un checkout se confirma antes de cancelar el vínculo anterior, cuyo
identificador queda guardado para completar esa limpieza en un retry.

La migración `20260904153000_platform_admin_center.sql` fue aplicada directamente
en Supabase producción el 2026-09-08, como única migración dentro de una sola
transacción y con autorización explícita para la modificación de
`handle_new_user`. La cuenta técnica está confirmada, conserva exclusivamente el
claim de plataforma y no tiene perfiles, roles ni sucursales tenant. Frontend y
Edge Functions están desplegados. Se verificaron los endpoints administrativos,
el origen CORS de `https://www.vittro.com.ar` y el flujo autenticado hasta el
backend.

`PLATFORM_ADMIN_PRICE_MUTATIONS_ENABLED=true` quedó activo en producción el
2026-09-08. Antes de activarlo, el preflight encontró el catálogo en Básico ARS
30.000, Profesional ARS 60.000 y Premium ARS 100.000, todos en versión 1; 29
suscripciones locales activas y 4 en trial; y una sola suscripción activa con un
`preapproval` de Mercado Pago cuyo estado local era `pending`. No había lotes,
ítems ni auditorías de cambio de precio, y el intento bloqueado por
`503 MUTATIONS_DISABLED` no produjo modificaciones.

Después de la activación se ejecutaron tres cambios reales. Básico pasó de ARS
30.000 a ARS 20.000 y versión 2 con resultado `partial`: 26 ítems quedaron
`skipped` por `missing_preapproval` y 1 `failed` por `provider_not_active`.
Profesional pasó de ARS 60.000 a ARS 30.000 y versión 2 con lote `complete` sin
ítems elegibles. Premium pasó de ARS 100.000 a ARS 50.000 y versión 2 con lote
`complete`: 1 ítem terminó exitosamente y 2 quedaron `skipped` por
`provider_not_supported`.

El resultado registrado al 2026-09-08 fue de 3 lotes, 30 ítems y 6 eventos de auditoría. No
quedaron ítems `pending` ni checkouts pendientes reutilizables. Homepage y
Registro fueron verificados mostrando ARS 20.000 / 30.000 / 50.000. Sigue
pendiente el QA de Facturación, `SubscriptionGate` y el webhook posterior;
también falta registrar el QA
responsive autenticado completo. Ante una anomalía, el rollback operativo es
configurar
`PLATFORM_ADMIN_PRICE_MUTATIONS_ENABLED=false`: bloquea nuevas acciones de
mutación, pero no deshace cambios de catálogo ni efectos externos ya confirmados.

**Reconciliación operativa del 2026-10-10:** Mercado Pago confirmó que el vínculo
de BarberMalza pertenecía a la cuenta/aplicación Vittro esperadas, era un checkout
pendiente de Premium ARS 100.000 y no tenía facturas. Se canceló ese único vínculo
(PUT 200, GET `cancelled`, cero facturas) y, con excepción directa autorizada, una
transacción guardada dejó Básico manual activo sin vencimiento y sin referencias
de MP. Se conservaron los snapshots históricos y no se crearon cobros. El retry
canónico acotado y el refresh cerraron Básico con 27 exclusiones y cero fallos;
cero lotes abiertos de Básico. Catálogo intacto en ARS 20.000 / 30.000 / 50.000,
versión 2. Dos auditorías nuevas, lectura independiente y segunda ejecución
idempotente verificadas. Script y request ID en `docs/MODULOS/admin.md`.

Ampliación solicitada: gestión comercial por barbería y datos de contacto, sin
edición de usuarios/Auth ni catálogo/límites en esta fase. Auditoría y propuesta
en `docs/PLAN_ADMIN_GESTION_COMERCIAL.md`. Backend, ficha, drawers e integración
tipada implementados y validados localmente: contacto privado, edición de datos,
acceso manual y extensión de trials, CAS/idempotencia/auditoría atómica,
reautenticación y kill switch comercial independiente. La ficha separa fuente del
acceso de prueba de pago; mantiene el canon Inter/navy, DatePicker/TimePicker,
tablas/cards y errores de lectura. Recuperación persistida solo por request ID
y acción, ligada a actor/barbería; ninguna contraseña en caché o storage.
Migración `20261010130000_platform_admin_commercial.sql` aplicada directamente
en producción con autorización explícita nueva, en una transacción, a las
13:08:48 UTC del 2026-10-10. Lectura independiente confirmó RLS, cero policies,
grants solo service_role para API, RPC INVOKER y contenido del archivo; sin
ejecutar otras migraciones ni alterar conteos/catalogo. Registro y evidencia:
`docs/ADMIN_COMERCIAL_MIGRACION_PRODUCCION.md`. Backend y frontend publicados
posteriormente, con nueva autorización y switch comercial en false. Se recuperó
el merge `2bda5a7` respecto de `df51109` conservando referencia de seguridad:
98 Vitest, 22 Deno y 14 SQL locales aprobados. Query v4/organization v1 ACTIVE
con JWT; Vercel Ready/Production/Current del commit `17450d70`. Sesión Admin real:
directorio, paginación, búsqueda, fichas manual/trial/vencido, contactos nulos e
historial a 390/768/1024/1440; acciones comerciales deshabilitadas. Evidencia:
`docs/ADMIN_COMERCIAL_DESPLIEGUE_PRODUCCION.md`. Catálogo observado: Básico ARS 1/v3
por un lote anterior de las 11:11; Profesional/Premium ARS 30.000/50.000/v2. Sin
intervenir precios ni ejecutar otras migraciones. Posteriormente, con nueva
autorización, se habilitó `PLATFORM_ADMIN_ORG_MUTATIONS_ENABLED=true` a las 13:54
Argentina. Edición de contacto en la barbería de prueba confirmada por el usuario,
una sola auditoría y recarga persistida; contraseña incorrecta rechazada sin
logout. Trial hasta 25/10 y suscripción intactos, cero pagos, Básico ARS 1/v3
preservado por pedido explícito. Manual/extensión no ejecutados sobre esa cuenta
para conservar su trial de compra. Evidencia:
`docs/ADMIN_COMERCIAL_HABILITACION_PRODUCCION.md`. Se repitieron 98 Vitest, 22 Deno
y 14 SQL locales, todas aprobadas. Evidencia local original: 36 pruebas Vitest, 22 Deno y 14 integraciones
PostgreSQL/WASM sintéticas; build, lint focal y chequeo Deno exitosos. TypeScript
global conserva los cinco errores previos; lint focal tiene dos avisos Fast
Refresh. Capturas sintéticas a 390/768/1024/1280/1440 px; revisión independiente
con las tres correcciones puntuadas resueltas (no certifica producción).
Activación: `docs/ADMIN_COMERCIAL_ACTIVACION.md`. Pruebas ampliadas de acceso
manual/trial, recuperación/denegación/convivencia autenticadas, concurrencia
multi-conexión real y enforcement de suspensión
permanecen pendientes; no se modificaron funciones `SECURITY DEFINER` existentes.
La discrepancia entre URL global de webhooks y handler específico sigue abierta:
no se cambió configuración ni se validó entrega real de eventos firmados.

**Admin — vencimientos y recuperación (2026-10-11): publicado y habilitado.**
Incidente diagnosticado por SQL/logs: acortamiento rechazado con 40001,
reintentos PostgREST y POST 500, sin cambio guardado. Nueva acción permite
acortar/extender/vencer un trial elegible, con confirmación contextual.
Rechazos conocidos dejan recibos failed recuperables; not_found sigue incierto.
Migración INVOKER `20261011090000_platform_admin_trial_dates.sql` aplicada
con excepción directa autorizada a las 04:47 Argentina, una transacción y sin
otras migraciones. Query v8/organization v5 ACTIVE con JWT; frontend a2d301da
Ready / Production / Current. Recibo antiguo reconciliado como fallido, consulta
autenticada quitó el bloqueo sin reenviar. Switch comercial restaurado a true
a las 04:53 Argentina. 106 Vitest, 24 Deno y 18 SQL locales aprobados; build/lint
focal correctos y cinco errores TS globales previos conservados.
Trial real hasta 25/10 y Básico ARS 1/v3 conservados. Vencer ahora se preparó
y canceló en el dominio real, no se guardó. Sin nueva mutación de fechas,
prueba HTTP real de rechazo RPC ni concurrencia multi-conexión.
Detalle: `docs/ADMIN_TRIAL_FECHAS_RECUPERACION.md`.

## Sistema de diseño — Operate

**C7.10 — Navegación horizontal accesible con chevrons ✅ técnicamente cerrado — 2026-09-28.**
Corrige la regresión que el QA manual detectó *después* del cierre de C7.9 (ver
`DESIGN_BACKLOG.md` D51): Finanzas dejaba Inversiones y Deudas inaccesibles con
mouse en viewport angosto. **Este build corrige el cierre de C7.9:** la fila
"Navegación" de su matriz figuraba como PASS técnico y no lo estaba — se
verificó que las clases existían, no que la tira fuera usable. Alcance: Tabs
underline (Finanzas, Mi Negocio → General + sucursales), `SectionNav` (Mi Negocio
→ General y Sucursal, Portal público) y la fila de Turnos → Agenda →
Configuración. Fuera de alcance, sin tocar: grillas de Agenda, tablas
comparativas, tira de fechas del Portal, `SegmentedControl`, `ProductoDialog`,
Tabs pill.

- **Ubicación en la app:** transversal → navegación horizontal. **Archivos:**
  `src/components/ui/NavOverflowControls.tsx` (nuevo), `src/lib/nav-strip.ts` y
  `nav-strip.test.ts` (nuevos), `src/components/ui/tabs.tsx`,
  `src/components/ui/SectionNav.tsx`, `src/hooks/use-scroll-affordance.ts`.
  Cuando la tira no entra, aparecen chevrons izquierda/derecha solo del lado con
  contenido oculto (se ocultan al llegar al extremo, también en touch), fuera del
  `role="tablist"`, superpuestos sin reservar ancho. Solo desplazan: cada toque
  pagina alineando un destino completo. El degradé es solo el fondo del chevron.
- **Auto-scroll del activo:** pasó de `TabsTrigger` (dependía de que su wrapper
  React se re-renderizara — no ocurría con `Tabs` no controlado) a `TabsList`, con
  un `MutationObserver` filtrado a `data-state → active` (más un tab activo
  agregado tarde y el montaje). Solo modifica `scrollLeft`, nunca usa
  `scrollIntoView`.
- **Ubicación en la app:** Turnos → Agenda → Configuración → Configuración de
  reservas / Portal público. **Archivo:** `src/components/config/AgendaManagement.tsx`.
  La fila ahora es `w-fit max-w-full` y el `TabsList` va en un `div.min-w-0.flex-1`
  (sin `w-auto`): a 320px desborda por dentro con su propio chevron en vez de ser
  recortada por `<main>`; en desktop mide igual que antes (371×34). La flecha de
  volver sigue fuera del `tablist`. D41 no se tocó.
- `useScrollAffordance` gana `observeContent` (opt-in, apagado por defecto);
  `table.tsx` y las tablas comparativas no cambian.

**QA de C7.10 — separado por tipo:**
- *Técnico:* `bunx tsc --noEmit` exit 0; `bunx tsc --noEmit -p tsconfig.app.json`
  exit 0; `bun run lint` **432 problemas (383/49)**, idéntico al baseline y sin
  hallazgos en los archivos tocados; `bun run build` exit 0; `bun run test` 5
  archivos / **32 tests** (23 nuevos de `nav-strip`, 9 previos). Impeccable
  `detect` sobre los 6 archivos: 4 hallazgos `design-system-font-size`, todos
  `text-[13px]` preexistentes (2026-08-05) de `AgendaManagement.tsx` — no
  suprimidos, registrados en D12.
- *Visual en navegador (componentes reales, harness temporal eliminado, sin
  sesión):* Finanzas a 320/375/640/768/834/1280 (Inversiones y Deudas
  alcanzables por chevrons y por teclado; sin chevrons desde 768 con rail);
  auto-scroll con `defaultValue`, controlado, por teclado (Radix) y con sucursales
  que cargan tarde; el scroll manual y mutaciones irrelevantes del `tablist` no lo
  revierten; el scroll vertical de la página no se mueve; Mi Negocio con 1/3/5
  sucursales (5 desbordan a 834); `SectionNav` de 7 destinos a 320: paginado,
  clic a sección, `aria-current`, foco por teclado revelado, altura del `<nav>`
  idéntica; Agenda → Configuración a 320/375/768/1280; Tareas, Agenda/Configuración
  y Tabs pill sin cambio geométrico. **Limitación del entorno:** el panel de
  vista previa no produce frames de forma continua, así que las animaciones suaves,
  los eventos de scroll y el `IntersectionObserver` se completaban tarde; el
  paginado se verificó con `prefers-reduced-motion` emulado (desplazamiento
  instantáneo) y forzando frames con capturas.
- *Autenticado:* no realizado — sin sesión; las superficies reales (Finanzas,
  Mi Negocio, Configuración) se montaron con los componentes reales pero sin sus
  datos ni su shell.
- *Dispositivo real (touch/tablet, trackpad físico):* **no realizado**. El swipe
  nativo no está bloqueado por ningún código, pero no se probó en hardware.
- **Pendiente D43:** la posible costura del fondo del chevron sobre el `<nav>`
  con blur no se verificó sobre el nav real — sin cambio de estado.

Seguridad: sin cambios en Supabase, RLS, roles, permisos, Auth,
`organization_id`, `sucursal_id`, pricing, cobros, reservas ni datos financieros;
los 6 archivos de código tocados no contienen queries ni callbacks de negocio
(verificado por diff). No se ejecutaron pruebas funcionales de RLS ni de permisos.

**C7 (Responsive + tablet) ✅ CERRADO TÉCNICAMENTE — C7.9, 2026-09-28.**
Pasada de QA de integración final sobre C7.1–C7.8C, sin reabrir auditoría,
Shape ni decisiones responsive ya cerradas. Objetivo cumplido: confirmar que
las nueve etapas funcionan juntas, detectar y corregir solo regresiones
locales atribuibles a C7, y consolidar documentación.

**Regresiones atribuibles a C7: ninguna encontrada.** Verificación de
integración sobre las 12 superficies del contrato (Shell, Overlays,
Navegación, Caja, Finanzas, Agenda, Mi Negocio/Configuración, Clientes,
Tareas, Cobrar, Notificaciones, Portal público, Auth) mediante lectura de
código de los ~48 archivos del diff acumulado de C7 (`git diff --stat`:
49 archivos, +1903/−706) más `git blame` línea por línea sobre cada hallazgo
del detector — no se encontró ningún defecto introducido por C7. Dos
hallazgos reales de deuda **preexistente, no causada por C7** aparecieron
durante el recorrido obligatorio de Caja/Cobrar y se documentaron como
D49/D50 en `DESIGN_BACKLOG.md` en vez de corregirse de pasada (`DailySummary.tsx`
"Cierre por barbero" sin migrar a `RecordRow`/`MetricGroup`/`tabular-nums`
pese a que C7.5 lo había dado por conforme; `PaymentRegistration.tsx:1359`
trunca un nombre de barbero en el resumen compacto del carrito). Ninguno de
los dos se tocó: ambos son código anterior a C7 (jun-2026 y abr-2026
respectivamente, confirmado por `git blame`), fuera del criterio de
corrección local de esta fase.

**Checks técnicos — resultados reales de C7.9:**
- `bunx tsc --noEmit`: exit 0.
- `bunx tsc --noEmit -p tsconfig.app.json`: exit 0 (D47/D48 se confirman
  resueltos — cero errores en el check que sí evalúa `src/` completo).
- `bun run lint`: exit 1, **432 problemas (383 errores, 49 warnings)** —
  idéntico al baseline conocido pre-C7. Sin hallazgos nuevos.
- `bun run build`: exit 0. Mismas advertencias preexistentes (Browserslist
  desactualizado, import mixto estático/dinámico de `supabase/client.ts`,
  chunk principal >500kB) — nada nuevo introducido por C7.
- `bun run test`: 4 archivos, 9 tests, todos pasan (suite de Admin;
  no hay cobertura de tests dedicada a las superficies de C7).
- Impeccable `detect` sobre los 48 archivos del diff de C7: 31 hallazgos,
  **los 31 son `design-system-font-size` advisory** (`text-[10px]`/`text-[11px]`,
  deuda D12 ya conocida). Verificado con `git blame` línea por línea: las 31
  líneas señaladas tienen fecha de commit anterior a C7 (rango abr-2026 a
  ago-2026) — ninguna fue agregada ni modificada por esta fase. Cero
  hallazgos de otras reglas (z-index, layout-transition, side-tab, etc.).
- `src/App.tsx`: sin diff, sin rutas/imports/componentes de QA o harness.
  `git status`/búsqueda por nombre en el repo: cero residuos de harness
  temporal de builds anteriores.

**Seguridad — verificado por diff, no probado funcionalmente.** El diff
acumulado de C7 (49 archivos) no toca ningún archivo bajo `supabase/`,
`contexts/AuthContext.tsx`, `contexts/OrganizationContext.tsx`,
`contexts/SucursalContext.tsx`, ni ninguna migración — confirmado por
`git status`/`git diff --stat` (cero coincidencias al filtrar por
`supabase|migration|rls|auth`). Los archivos de negocio que sí cambiaron
(`PaymentRegistration.tsx`, `PortalPublicoSection.tsx`, `SueldosPanel.tsx`,
`CashClosingHistory.tsx`, `DailySummary.tsx`, `GastosPanel.tsx`,
`GastosRecurrentesList.tsx`, `AgendaDayView.tsx`, `NotificationsBell.tsx`)
se revisaron línea por línea: cada línea agregada o removida toca
únicamente `className`, imports de componentes de presentación
(`RecordRow`/`MetricGroup`/`SectionNav`/`useAgendaBodyHeight`/
`useWindowMode`) o el campo `meta_pixel_id` ya documentado como D47 — cero
cambios de cálculo, query, mutación, PIN, rol, permiso o pricing. **Esto es
"RLS/Auth/pricing sin cambios de C7 verificado por diff", no "RLS/Auth
probado funcionalmente"** — ningún test de aislamiento multi-tenant, PIN o
permisos corrió en esta fase.

**Matriz responsive de cierre (C7.1–C7.9):**

| Superficie | Compact | Medium | Expanded | QA visual | QA autenticado | Pendiente |
|---|---|---|---|---|---|---|
| Shell | PASS técnico | PASS técnico | PASS técnico | Parcial (Login únicamente, ver abajo) | Pendiente | Shell real (`/app/:orgSlug`) requiere sesión — no verificado en navegador esta fase |
| Overlays | PASS técnico | PASS técnico | PASS técnico | Pendiente | Pendiente | Gutter/altura/scroll interno confirmados por código (contrato físico C7.3), no renderizados |
| Navegación (Tabs/SectionNav) | PASS técnico | PASS técnico | PASS técnico | Pendiente | Pendiente | D43 (costura de fade en SectionNav) sigue sin evidencia visual |
| Caja | PASS técnico | PASS técnico | PASS técnico | Pendiente | Pendiente | Ver D49 (Cierre por barbero, deuda preexistente no migrada) |
| Finanzas (Sueldos P0/Gastos) | PASS técnico | PASS técnico | PASS técnico | Pendiente | Pendiente | P0 de Sueldos (A pagar/Pagado/Saldo) confirmado por código, no por render |
| Agenda | PASS técnico | PASS técnico | PASS técnico | Pendiente | Pendiente | D40 (aislamiento) y D46 (medición vs. scrollbar) siguen abiertos; drag táctil real sin probar |
| Mi Negocio / Configuración | PASS técnico | PASS técnico | PASS técnico | Pendiente | Pendiente | D34 (pickers nativos) intacto, fuera de alcance |
| Clientes | PASS técnico | PASS técnico | PASS técnico | Pendiente | Pendiente | — |
| Tareas | PASS técnico | PASS técnico | PASS técnico | Pendiente | Pendiente | — |
| Cobrar | PASS técnico | PASS técnico | PASS técnico | Pendiente | Pendiente | Ver D50 (truncado preexistente en resumen de carrito) |
| Notificaciones | PASS técnico | PASS técnico | PASS técnico | Pendiente | Pendiente | — |
| Portal público | PASS técnico | PASS técnico | PASS técnico | Pendiente | Pendiente | Requiere `orgSlug` real — no ejecutado esta fase |
| Auth | PASS técnico | PASS técnico (no verificado en navegador) | PASS técnico | **PASS visual real** (Login, 320×568 y 768×1024, sin sesión) | No aplica (no requiere sesión) | ResetPassword/VerifyEmail/AuthCallback solo verificados por código esta fase |

"PASS técnico" = confirmado por lectura de código/contrato (incluye verificación cruzada por 4 subagentes de exploración de solo lectura sobre los ~30 archivos de superficie). "PASS visual real" = confirmado en navegador real esta fase. Ninguna fila se marca "probado" donde solo hubo razonamiento de código.

**Backlog — estado final verificado en C7.9 (sin resolver por inferencia):**
D12 (tipografía 10/11px) Pendiente, sin instancias nuevas — confirmado por
`git blame` en las 31 líneas señaladas por el detector. D20 (token de radio
de contenedor) Pendiente, sin cambios. D33 (ignore de `layout-transition`
en `.impeccable/config.json` para `AppSidebar.tsx`) Pendiente, intacto,
sigue esperando revalidación en C11. D34 (pickers nativos en cluster
Equipo) Pendiente, confirmado sin migrar — fuera de alcance a propósito.
D40 (aislamiento de stacking de Agenda) Pendiente, confirmado sin
`isolation` en todo el módulo. D41 (`overflow-x-hidden` de contención en
`Index.tsx`) Pendiente, sin cambios. D42 (protecciones redundantes de
overlays) Pendiente, no re-auditado archivo por archivo esta fase. D43
(costura de fade en `SectionNav`) Pendiente, sin evidencia visual nueva.
D45 (skeletons de Sueldos/Gastos con geometría de tabla) Pendiente,
confirmado sin rediseñar. D46 (medición de ancho vs. scrollbar en Agenda
multi-día) Pendiente, confirmado sin cambios, descripción vigente. **D47 y
D48 reconfirmados Resueltos** (`tsc -p tsconfig.app.json` limpio,
`meta_pixel_id` presente en `PortalPublicoSection.tsx`). D49 y D50 nuevos,
Pendientes (ver arriba).

> **Corrección posterior (C7.10):** la fila "Navegación (Tabs/SectionNav)" de la matriz de arriba figuraba como PASS técnico y el QA manual demostró que no se cumplía en uso real; C7.10 la corrigió (ver la entrada anterior y D51). El resto de esta entrada se conserva tal como se registró.

**Veredicto: C7 queda técnicamente cerrado.** No hay blockers técnicos
causados por C7 ni regresiones sin resolver. Ambos checks de TypeScript,
build y tests disponibles pasan; lint no agregó deuda; sin residuos de
harness. Lo que queda pendiente es exclusivamente QA manual/autenticada
(sesión real en `/app/:orgSlug`, drag táctil en Agenda, flujo de reserva
con `orgSlug` real, Mercado Pago en touch real) — nunca presentada como ya
probada. Checklist manual de cierre para validación humana: ver el reporte
de cierre de C7.9 entregado en la sesión (no duplicado acá).

**C7.8C (Portal público + Auth) ✅ cerrado técnicamente — 2026-09-28.** Tercer
sub-build de C7.8. El Portal ya era una de las superficies responsive más
sólidas — no se rediseñó, se corrigió únicamente deuda demostrada. Hallazgo
real: `FechaHorarioStep.tsx` (paso Fecha y horario) renderizaba su "ribbon"
de 5 días con `shrink-0 w-12` (ancho fijo) sin `overflow-x-auto` ni
`flex-wrap` — 5 botones de 48px + gaps podían superar el ancho real del
contenedor en mobile angosto, la causa concreta detrás del riesgo histórico
de scroll horizontal. Pasó a `flex-1 min-w-0` (ancho fluido, layout
intrínseco) — mismos 5 días, mismo comportamiento de "Ver más"/calendario,
cero cambio de lógica de fechas/disponibilidad, verificado sin overflow
hasta 260px con harness temporal. `BookingSummary.tsx` (Row del resumen
desktop) y `DatosClienteStep.tsx` (nombre de cliente encontrado por
teléfono) truncaban sin ninguna interacción que revelara el valor completo
— `truncate` → `break-words` en ambos, consistente con el criterio ya
aplicado en C7.8A/B. Auditados sin cambios: `BookingStepper.tsx` (no es un
stepper con labels/tabs — es una barra de progreso simple + contador "Paso
X de 6", sin riesgo de wrap/overlap por diseño), `SucursalStep`/
`ServicioStep`/`BarberoStep`/`HorarioStep` (ya usan cards/grid seguros),
`BookingLanding.tsx` (labels de links sociales, corto por naturaleza).
Login/VerifyEmail/ResetPassword/AuthCallback: `min-h-screen` (no `h-screen`
+ `overflow-hidden`) ya permite scroll natural de página — verificado en
vivo (no harness) a 320×568: la acción principal queda alcanzable
scrolleando, sin contenido atrapado ni cortado; sin overflow horizontal en
ninguna de las 4 rutas. Sin cambios de código en Auth.

**D47 resuelto**: `previewPortal` (vista previa de Configuración → Portal
público) no armaba `meta_pixel_id` — el único campo de `PortalDataView` sin
fuente propia en ese `useMemo`. Se conectó a `config?.meta_pixel_id ?? null`
(mismo patrón que sus campos hermanos), sin tocar lectura/escritura/
tracking de Meta Pixel — `BookingLanding.tsx` no lo usa para nada visual,
solo `Reservar.tsx` (portal real) lo consume. **D48 resuelto**:
`bunx tsc --noEmit -p tsconfig.app.json` (el check que sí evalúa `src/`
completo — el check raíz solo no lo hace, `tsconfig.json` tiene `files: []`)
queda incorporado como obligatorio junto al check raíz desde esta fase, en
`CLAUDE.md`. Ambos checks limpios (antes: 1 error real en el scoped, D47).
`.impeccable/design.json` — verificado, sin desfase real relacionado con
este build; no se ejecutó sincronización masiva.

Seguridad: sin cambios en Supabase, RLS, `organization_id`, resolución de
organización por slug, disponibilidad, creación de reservas, `AuthContext`,
`signIn`/`signOut`, `onAuthStateChange`, callback OAuth ni redirects —
verificado por diff línea por línea en los 4 archivos tocados. QA técnico
(`tsc` root, `tsc -p tsconfig.app.json`, lint 432/432, build, detector: 3
hallazgos, los 3 preexistentes fuera del diff) completo. QA visual: harness
temporal (creado y eliminado en este build) para el ribbon de fechas y los
nombres largos; las 4 rutas de Auth probadas en vivo a 320×568. QA
autenticado del flujo de reserva real y de Auth con cuenta real sigue
pendiente, mismo bloqueo de C7.3–C7.8B.

**C7.8B — cerrado técnicamente — 2026-09-28.**
Continuación en Codex del build responsive aprobado. No se reimplementó código
ni se avanzó a C7.8C. La compilación y las pruebas existentes pasan; lint
conserva su baseline. La revisión de alcance confirmó que el error de tipos
preexistente no bloquea C7.8B: se reproduce aun retirando en memoria todos
los cambios de este sub-build. Se registra como deuda independiente D47.
QA autenticado/manual todavía pendiente, como en las etapas anteriores.

**Alcance y continuidad verificados**

- **Ubicación en la app:** Tareas → Tareas / Peticiones / historial de completadas.
  **Archivo técnico:** `src/components/TareasPanel.tsx`.
  Los tres renderizadores de cards ya quitaron `line-clamp-2` de título y
  descripción: seis cambios de clases, sin cambiar texto, acciones ni permisos.
  El texto puede ocupar más líneas; el barbero sin permiso de edición no tiene
  que abrir un editor para recuperar información antes recortada. No se afirma
  que se hayan probado cadenas arbitrarias sin espacios.
- **Ubicación en la app:** Cobrar → productos del paso Barbero y resumen del pago.
  **Archivo técnico:** `src/components/PaymentRegistration.tsx`.
  Los dos nombres de producto usan `break-words`; el resumen conserva el monto
  de cada producto en una línea con `tabular-nums whitespace-nowrap`.
  Barbero/Cliente/Servicio mantienen el label con `shrink-0` y permiten envolver
  el valor mediante `min-w-0 flex-1 break-words`.
  Total a cobrar usa `text-2xl sm:text-3xl tabular-nums whitespace-nowrap`.
  La cifra baseline `$99.999.999` ya entraba; el reporte de implementación
  anterior documentó overflow de la sonda `$1.234.567.890` a 320px y su
  corrección con viewport real. Estas mediciones no se repitieron en Codex.
  Se preservaron cálculos, formato numérico y validaciones.
- **Ubicación en la app:** Cobrar → medios de pago / Pago combinado / estados vacíos.
  **Archivo técnico:** `src/components/PaymentRegistration.tsx`.
  Auditados en la implementación anterior y contrastados ahora contra código y
  diff: las cards de medios de pago, split-mode y estados vacíos no necesitaron
  cambios. Las cards ya tienen grid de 1/2/3 columnas; Pago combinado apila
  cabecera, permite envolver el selector y usa 1/2 columnas para importes;
  los vacíos conservan su presentación existente. No se rediseñaron ni se
  tocaron sus condiciones, selección o callbacks. Tablet 768/834px queda
  pendiente de verificación visual autenticada; no confundir inspección de
  clases con prueba táctil o medición visual.
- **Ubicación en la app:** barra lateral → campana de Notificaciones → No leídas / Leídas.
  **Archivo técnico:** `src/components/notifications/NotificationsBell.tsx`.
  Título y resumen de turno usan `break-words` en lugar de `truncate`.
  El click existente marca como leída cuando corresponde, cierra el popover
  y llama a la navegación existente; no abre una vista que garantice el
  título completo. Acciones, filtros, estado de lectura y callbacks intactos.
  La ubicación efectiva se verificó en el código: es la barra lateral, no un
  header. Los cambios de modo de ventana, posicionamiento, ancho del popover
  y área táctil presentes en el diff acumulado pertenecen a C7.2; no se
  atribuyen a C7.8B ni se rehicieron.

**Dependencias y seguridad**

No fueron necesarias container queries ni nuevas dependencias para C7.8B.
El diff de este sub-build solo cambia clases de presentación. Comparación en
memoria: los dos primeros archivos son idénticos a HEAD al quitar sus
atributos `className`; en el tercero se aislaron las dos sustituciones de
texto respecto de los ajustes de C7.2 ya documentados. Sin cambios C7.8B en
Supabase, RPC, RLS, roles, permisos, PIN, precios, descuentos, medios de pago,
creación de transacciones, callbacks ni lógica funcional. La continuación
en Codex modifica únicamente documentación y conserva el trabajo anterior.

**QA final de la continuación**

- `bunx tsc --noEmit`: exit 0. Limitación verificada:
  **Ubicación en la app:** transversal → calidad técnica.
  **Archivo técnico:** `tsconfig.json` (lista `files: []`, referencias de proyecto)
  y `tsconfig.app.json` (incluye `src`).
  El comando raíz no comprueba por sí solo los archivos referenciados y no
  alcanza como verificación completa de la aplicación. Seguimiento D48:
  para C7.8C y especialmente C7.9, considerar como check explícito
  `bunx tsc --noEmit -p tsconfig.app.json`. Este ajuste es documental;
  no modifica configuración TypeScript.
- `bunx tsc --noEmit -p tsconfig.app.json`: exit 1, un error TS2741:
  **Ubicación en la app:** Turnos → Configuración → Portal público → Vista previa.
  **Archivo técnico:** `src/components/config/PortalPublicoSection.tsx:613`.
  El objeto de vista previa no incluye el campo obligatorio `meta_pixel_id`.
  El mismo diagnóstico aparece al retirar en memoria los cambios de C7.8B,
  conservando las etapas anteriores; no es una regresión de este build.
  No se corrigió. Deuda independiente D47: debe entrar como hallazgo a
  auditar/resolver en C7.8C antes del cierre de esa fase. No bloquea el cierre
  técnico de C7.8B; el resultado fallido del chequeo global se conserva
  explícitamente, sin presentarlo como aprobado.
- `bun run lint`: exit 1, **432 problemas: 383 errores y 49 warnings**,
  baseline mantenido. Comparación de los tres archivos antes/después de
  C7.8B: mismos diagnósticos (2 warnings / 1 error y 3 warnings / 0,
  respectivamente, en el orden del alcance arriba), ninguno introducido.
- `bun run build`: exit 0. Advertencias de Browserslist desactualizado,
  import mixto estático/dinámico y tamaño de chunks; no se modificaron
  dependencias ni se amplió el build para resolverlas.
- `bun run test`: 4 archivos, 9 tests, todos pasan. Son las pruebas existentes
  del repositorio, no una cobertura específica de las tres superficies.
- Impeccable 4.1.1, detector de los tres archivos: 10 avisos
  `design-system-font-size`, todos advisory en el JSON; CLI devuelve exit 2.
  **Ubicación en la app:** Cobrar → descuentos / medios de pago / Pago combinado.
  **Archivo técnico:** `src/components/PaymentRegistration.tsx`,
  líneas 1404, 1487, 1556, 1565, 1574, 1583.
  **Ubicación en la app:** barra lateral → Notificaciones → contador / categorías / filtros.
  **Archivo técnico:** `src/components/notifications/NotificationsBell.tsx`,
  líneas 192, 287, 376, 469.
  Los 10 se contrastaron individualmente: ninguno cae en líneas agregadas
  del diff final y cada línea ya existe idéntica en HEAD. Deuda tipográfica
  preexistente; D12 permanece pendiente, sin nuevos ignores.
- **Ubicación en la app:** transversal → arranque y rutas.
  **Archivo técnico:** `src/App.tsx`.
  Sin diff contra HEAD y sin imports ni rutas de QA. Búsqueda por nombre y
  contenido en fuentes: sin residuos del harness temporal. No se creó uno
  nuevo en el repositorio durante esta continuación.
- QA visual: se conserva como evidencia histórica el reporte del harness
  anterior, incluido 320px real para la sonda superior; no se presenta como
  ejecución nueva. El navegador disponible en Codex no tenía pestañas ni
  sesión autenticada. No se verificaron nuevos viewports ni touch real.

**Verificación independiente del sidecar**

**Ubicación en la app:** transversal → sistema visual.
**Archivo técnico:** `.impeccable/design.json`.
El posible desfase señalado por Impeccable no bloquea C7.8B. Se deja su
verificación para el siguiente build/C7.9, si corresponde. La documentación
instalada no exige repararlo para este cierre; no se ejecutó
`/impeccable document` ni se modificó el sidecar en este ajuste documental.

**Validación manual pendiente**

En las ubicaciones y archivos del alcance arriba: usar una cuenta de prueba
autorizada; a 320/375px revisar nombres largos, títulos, descripciones, total
baseline y sonda superior sin recorte; a 640/650/768/834/1024/1280px revisar
transiciones de columnas, cards, Pago combinado y vacíos; comprobar lectura
completa, acciones y foco de teclado en notificaciones y permisos de lectura
del barbero. Verificar touch en tablet real. No registrar cobros reales para
probar presentación. Las cifras sintéticas requieren un entorno de prueba.

La documentación modular específica de este alcance aún no existe en
`docs/MODULOS/`, según inventario y `docs/INDICE.md`; no se crearon duplicados.
C7.8B queda cerrado técnicamente tras la revisión de alcance, con QA
autenticado/manual explícitamente pendiente. D47 y D48 quedan como seguimiento
independiente para las fases indicadas, no como bloqueo de C7.8B.
C7.8C no iniciado.

**C7.8A (Mi Negocio + Configuración + Clientes) ✅ cerrado técnicamente —
2026-09-28.** Primer sub-build de C7.8 (Resto de Operate + Portal + Auth).
Deuda real encontrada y corregida, sin migración masiva: `BloqueosSection.tsx`
(2 grids), `EquipoSucursalPanel.tsx` (2 grids + fila de email) y
`BarberSucursalesGeneralSection.tsx` (1 grid) usaban `grid grid-cols-2`
rígido para sus campos de fecha dentro de un `DrawerForm size="sm"`
(380px máximo, clamped a `viewport - 48px` en Compact — 224px de contenido
real a 320px de dispositivo) — sin ningún piso, dos columnas se apretaban
sin importar cuánto espacio hubiera de verdad. Migrado a `flex flex-wrap` +
`min-w-[140px]` por campo (mismo mecanismo ya usado en C7.5/C7.6/C7.7): el
picker (`DatePicker`/`TimePicker` en Bloqueos, `input type="date"` nativo en
Equipo — D34 intacto, cero migración de picker) sigue siendo el mismo,
solo cambió cuánto espacio pide su contenedor. La fila de email de
`EquipoSucursalPanel.tsx` tenía un `max-w-[180px]` fijo con el label en
`flex-1` (al revés: el label corto competía por espacio con el valor largo)
— invertido, más `title` como refuerzo para mouse. `MpDevicesConfig.tsx`:
el botón de renombrar terminal usaba `sm:opacity-0 sm:group-hover:opacity-100`
— invisible por defecto ≥640px sin ningún hover real en touch que lo
revelara; corregido a `[@media(hover:hover)]:opacity-0` (arbitrary variant
de Tailwind 3.4, cero dependencias nuevas), siempre visible salvo en
dispositivos con hover real, donde se reduce a hover-reveal. `BonoFijoConfig.tsx`
— sin problema de grid; se reforzó la cifra de "Monto" con `tabular-nums
whitespace-nowrap` (ya cumplía, ahora protegido explícitamente).
`ClienteDetailDialog.tsx` — el bloque de estadísticas de Reservas
(Total/Última/Próxima, `grid grid-cols-3` dentro de un Drawer `size="lg"`
igualmente clamped en Compact) pasó a consumir `MetricGroup` (C7.5) en vez
de crear una solución nueva. Auditados sin cambios: `MiNegocioPanel.tsx`,
`MiNegocioGeneralTabContent.tsx`, `SucursalTabContent.tsx` (sus patrones
`sm:flex-row` viven en el flujo normal de página, no en un Drawer — ancho
real ≈ viewport, decisión legítima) y `ClientesPanel.tsx` (ya era una lista
de una sola columna con `min-w-0`/`truncate` correctos). Ninguna dependencia
nueva — Tailwind 3.4 ya soporta arbitrary media variants, no se instaló
`@tailwindcss/container-queries` (no hizo falta ningún umbral estructural
real). No se tocó Supabase, RLS, roles, permisos, `organization_id`,
`sucursal_id`, lógica de Mercado Pago ni lógica de clientes — verificado por
diff línea por línea en los 6 archivos tocados. QA técnico (tipos, lint
—432 baseline—, build, detector) completo; visual con harness temporal
(creado y eliminado en este build, componentes reales `DatePicker`/
`TimePicker`/`Input`/`MetricGroup`/`Button` sin fetch a Supabase) a los
anchos reales de Drawer en Compact y Expanded, cero overflow de contenedor
en todos los casos — el único hallazgo del harness fue el truncado ya
esperado de `DatePicker` en su placeholder sin seleccionar (comportamiento
preexistente del propio primitivo, no un defecto). Verificación de
`hover`/`pointer` hecha por emulación de dispositivo (mobile preset), no en
touch real — confirmado correcto en dos cargas frescas (`hover:hover` →
oculto hasta hover; `hover:none` → siempre visible). QA autenticado real
sigue pendiente, mismo bloqueo que C7.3–C7.7.

**C7.7 (Responsive integral de Agenda) ✅ cerrado técnicamente — 2026-09-28.**
Séptima etapa de C7. Lleva a 3 días/Semana el contrato que Día ya tenía
(columna con ancho mínimo usable, medido vía `ResizeObserver` sobre el
contenedor real — no CSS Grid `minmax(0,1fr)`, que en mobile podía angostar
cada día de Semana a ~40px, ilegible). `AgendaMultiDayView.tsx` reescrito
sobre el mismo patrón de Día (JS-measured flex, no grid; header/body
`overflow-x-auto` sincronizados a mano) sin tocar `AgendaDayView.tsx` salvo
la fórmula de altura; `AgendaMultiDayColumn.tsx`/`AgendaMultiDayTurnoCard.tsx`
sin cambios (reciben el ancho por el wrapper padre, su propio layout interno
—porcentual/absoluto— no depende de cómo se calculó ese ancho). `MIN_COL`
de multi-día quedó en 128px, medido con el componente real de tarjeta
(evidencia en `docs/DECISIONES.md`) — Día conserva su propio 160px sin
cambios, son contratos del mismo tipo pero con mínimos propios porque
representan cosas distintas (barbero vs. día, y Semana necesita 7 a la vez).
Semana sigue mostrando siempre 7 columnas, 3 días siempre 3 — ninguna vista
redujo su significado funcional para cumplir el ancho mínimo.

Altura: `clamp(600px, calc(100vh - 180px), 1100px)` (el piso de 600px ganaba
en pantallas bajas — 375×667 y 320×568 dan menos de 600px de "100vh -
180px" — forzando scroll vertical anidado) pasó a un hook compartido
(`useAgendaBodyHeight.ts`, usado por `AgendaDayView.tsx` y
`AgendaMultiDayView.tsx`) que mide en runtime cuánto ocupa lo que va arriba
de la grilla y expresa el máximo como `clamp(240px, calc(100svh -
offsetMedido), 1100px)`. Verificado con harness a 320×568: antes hubiera
forzado 600px sobre ~388px reales; ahora da 352px, dentro del espacio real.
La propiedad del scroll no se movió — se descartó eliminar el
`overflow-y-auto` propio de la grilla para no arriesgar el
auto-scroll-a-hora-actual de `AgendaDayView.tsx` (ver `docs/DECISIONES.md`).

Toolbar (`AgendaPanel.tsx`): la fecha completa ("miércoles 24 de septiembre
de 2026") podía forzar overflow del toolbar en mobile, recortado
visualmente por el `overflow-clip` del wrapper `rounded-lg` — no era el
`overflow-clip` el problema (sigue ahí, solo redondea esquinas), era que
nada evitaba que el botón de fecha se saliera de su fila. Ahora usa una
abreviación semántica por debajo de `sm:` ("mié 24 sep 2026", no truncado/
ellipsis) y ambos grupos del toolbar pueden envolver internamente además de
que el contenedor ya podía partir en dos líneas.

Drag & drop, ghost (`z-[80]`), `resolveDrop`, `touchAction`, hit-test por
`data-col-root` — sin cambios, verificado por diff en `AgendaDayView.tsx`
(el único archivo del módulo con drag). 3 días/Semana nunca tuvieron drag.
**D40 (aislamiento de stacking) sigue abierto** — auditado, no tocado, no
cerrado por inferencia (ver `DESIGN_BACKLOG.md`). Deuda nueva menor
registrada (D46): el mismo patrón de medición de ancho que ya usaba Día
hereda una imprecisión de ~15px cuando el cuerpo muestra scrollbar vertical
— nunca oculta datos, solo activa el scroll horizontal local con un margen
más chico del necesario en casos límite.

Seguridad: sin cambios en queries, Supabase, RLS, `organization_id`,
`sucursal_id`, roles ni permisos — verificado por diff línea por línea en
los 3 archivos tocados del módulo. QA técnico (tipos, lint —432 baseline—,
build, detector) completo; visual con harness temporal (creado y eliminado
en este build, monta `AgendaDayView`/`AgendaMultiDayView` reales con datos
explícitos — ambos son puramente presentacionales, sin fetch propio) a
320×568 hasta 834×768, columnas nunca por debajo del mínimo, scroll
horizontal local confirmado programáticamente, cero overflow de página. QA
real autenticado (drag táctil real, sidebar Compact conviviendo con
Agenda) sigue pendiente por el mismo bloqueo de cuenta de prueba de
C7.3–C7.6 — checklist manual entregado en el reporte del build.

**C7.6 (Migración responsive de Finanzas) ✅ cerrado — 2026-09-28.** Sexta
etapa de C7, sobre los patrones probados en C7.5. Cierra el P0 original de
Sueldos: `SueldosPanel.tsx` → "Resumen por Empleado" pasaba `A pagar`/`Pagado`/
`Saldo (histórico)` en una fila `flex items-center justify-between` con
`gap-6` fijo, sin wrap — en mobile el bloque de métricas se salía del
viewport y `Pagado`/`Saldo` quedaban inalcanzables, sin scroll que los
trajera. Migrado a `RecordRow` (identidad → `MetricGroup size="metric"`): las
tres métricas ahora reflowean y nunca desaparecen, verificado sin overflow ni
solapamiento a 320/375/768/1440px con harness temporal (`$99.999.999` y sonda
`$1.234.567.890`, más un nombre de barbero de 68 caracteres). Clasificación
aplicada en Sueldos: Resumen por Empleado, Historial de Pagos (global y por
empleado dentro de la fila expandida) → Tipo A (Registro), migrados a
`RecordRow`; Cierres de Caja (dentro de la fila expandida) → Tipo B (Tabla
comparativa), primer consumidor productivo real de `Table comparative`
(D44, ver `DESIGN_BACKLOG.md`), con `min-width` explícito medido por columna.
`GastosPanel.tsx` → Historial (Tipo A, 6 columnas no lo vuelven comparativo) y
`GastosRecurrentesList.tsx` (Tipo A) migraron igual a `RecordRow`; la lógica
de "gasto automático" (deshabilita anular) no se tocó, solo su posición.
`estadisticas/MetricDetailDialog.tsx` y `DonutDetailDialog.tsx` — Tipo B
genuino (comparan el mismo valor entre meses/categorías) — sumaron como
consumidores adicionales de `Table comparative`. Antes de este build se
verificó y corrigió que la afordancia de `ui/table.tsx` había quedado
global-pero-inerte en vez de opt-in (ver `docs/DECISIONES.md`); ahora es
`comparative?: boolean` (default `false`), byte-idéntica a la primitiva
anterior a C7.5 para sus ~9 consumidores no tocados. `InversionesPanel.tsx` y
`DeudasPanel.tsx` auditados — ya cumplían la regla del dinero con cards +
`flex-wrap` + `min-w-0` propios, sin desaparición ni solapamiento encontrado;
no migraron (ver `docs/DECISIONES.md`). `EstadisticasPanel.tsx` auditado — ya
es grid de cards, sin tabla ni deuda responsive real, sin cambios. No se tocó
ningún cálculo, callback, query, PIN, permiso ni condición de gasto
automático — verificado por diff línea por línea en los 5 archivos tocados.
QA: técnico (tipos, lint —432 baseline—, build, detector) completo; visual
real con harness temporal (creado y eliminado en este build) a 320/375/768/
1440px, cero overflow/solapamiento programático (`getBoundingClientRect`/
`scrollWidth`); QA autenticado en Operate sigue pendiente por el mismo
bloqueo de cuenta de C7.3–C7.5. Deuda nueva registrada, no resuelta: D45 —
los skeletons de "Resumen por Empleado"/"Historial de Pagos"/"Historial" de
Gastos siguen simulando geometría de tabla mientras su contenido real ya es
`RecordRow` (rediseño de skeletons fuera de alcance explícito de este build).

**C7.5 (Patrones de datos operativos) ✅ cerrado — 2026-09-28.** Quinta etapa
de C7. Dos componentes nuevos, reusables: `MetricGroup` (`ui/MetricGroup.tsx`,
grupo de métricas etiqueta+valor cuya cantidad de columnas surge del espacio
real vía `flex-wrap` + `flex-basis`, no CSS Grid `auto-fit` — probado con
`$99.999.999` y una sonda de `$1.234.567.890`, que rompían la fórmula
`auto-fit`/`minmax(...,1fr)` original por solapamiento de columnas) y
`RecordRow` (`ui/RecordRow.tsx`, identidad + métricas + acciones para
entidades operativas independientes — Tipo A "Registro", DESIGN.md →
Components). Piloto: Caja. `DailySummary.tsx` — el KPI grid
`grid-cols-3 md:grid-cols-4` pasa a `MetricGroup size="kpi"` (el total general
queda como bloque propio, ya no comparte grid con las 3 métricas
secundarias); el resumen del diálogo de cierre también migra. `CashClosingHistory.tsx`
— cada card de cierre pasa a `RecordRow` + `MetricGroup size="metric"`, con el
`min-w-0` que la identidad no tenía (bug real: nombres largos podían
desbordar). "Cierre por barbero" y la lista de transacciones del día quedaron
sin tocar — ya cumplían el contrato, confirmados como referencia. `ui/table.tsx`
gana, de forma aditiva, la misma afordancia de fade de C7.4 sobre su wrapper
`overflow-auto` existente — quedó global-pero-inerte para las ~9 tablas que ya
la consumen; se corrigió a opt-in (`comparative`) antes de C7.6, ver la
entrada de C7.6 arriba y `docs/DECISIONES.md`. Auditado
a fondo: **Caja no tiene un consumidor real de tabla comparativa** — tanto el
resumen como el historial de cierres son Tipo A (Registro), no Tipo B; el
contrato de tabla se probó igual con datos financieros realistas en un
harness temporal (creado y eliminado en el mismo build). Primera columna
sticky: evaluada, no implementada sin piloto real (D44). No se tocó ningún
cálculo, callback, query, PIN ni permiso — verificado por diff línea por línea
en ambos archivos de Caja. QA visual real sigue pendiente por el mismo
bloqueo de cuenta autenticada de C7.3/C7.4; QA técnico (tipos, lint, build,
detector, harness con datos reales en 375px y desktop) completo — ver el
reporte del build.

**C7.4 (Navegación responsive) ✅ cerrado — 2026-09-27.** Cuarta etapa de C7,
sobre overlays (C7.3) y shell (C7.2) ya cerrados. `TabsList variant="underline"`
(`src/components/ui/tabs.tsx`) deja de poder partirse en dos filas: se volvió
`flex-nowrap` + `overflow-x-auto` con una afordancia de fade de 24px (solo del
lado con contenido oculto, vía el nuevo hook `useScrollAffordance`,
`src/hooks/use-scroll-affordance.ts`) y auto-scroll de la pestaña activa a la
vista (`scrollIntoView({ block/inline: 'nearest' })`, eje horizontal
únicamente). Se quitó el `flex-wrap` local que traían `FinanzasPanel.tsx` y
`MiNegocioPanel.tsx` — ya redundante y contradictorio con la primitiva — y en
`MiNegocioPanel.tsx` se eliminó el doble mecanismo que envolvía las tabs de
sucursal en un `overflow-x-auto scrollbar-hide` interno además del `flex-wrap`
externo, dejando un solo mecanismo (el de la primitiva). `AgendaManagement.tsx`
y `TareasPanel.tsx` (también consumidores de `variant="underline"`) no
necesitaron ningún cambio — heredan el fix sin tocarlos.

Nuevo componente `src/components/ui/SectionNav.tsx`: navegación interna de
página larga (desplaza a una sección ya montada, no cambia contenido — Tabs
sigue siendo lo otro). Reemplaza la navegación de anclas duplicada
carácter-por-carácter en `MiNegocioGeneralTabContent.tsx`, `SucursalTabContent.tsx`
y `PortalPublicoSection.tsx`, las tres con el mismo defecto: `hidden md:block`
hacía que la navegación interna desapareciera completamente por debajo de
768px en páginas largas. `SectionNav` no depende de ningún breakpoint para su
composición — mismo mecanismo de overflow/afordancia que `TabsList`. Ajuste de
cierre (mismo día): `SectionNav` resalta la sección activa vía
`IntersectionObserver` (offset medido contra la altura real de su propio
`<nav>`, `aria-current="location"`) y la mantiene visible en su tira —
completaba una responsabilidad ya aprobada en el Shape, no una decisión de
producto nueva.

No se tocó lógica de negocio, datos, RLS, roles, permisos ni PIN. QA visual
real sigue pendiente por el mismo bloqueo de cuenta de prueba autenticada
documentado en C7.3 — ver el reporte del build para el detalle de qué se
validó por código/build y qué queda manual.

**C7.3 (Física responsive de overlays) ✅ cerrado — 2026-09-27.** Tercera etapa
de C7, sobre el shell ya cerrado en C7.2. Garantiza por construcción de la
primitiva (no por protección local de cada consumidor) que `DrawerForm`,
`Dialog`, `AlertDialog`, `Popover` y `DropdownMenu` nunca exceden el viewport.
`DrawerForm` (`src/components/ui/drawer-form.tsx`) resuelve sus tres anchos
(`sm`/`md`/`lg` = 380/520/680) con `min(máximo deseado, viewport − 48px de
gutter)` en vez de un `sm:w-[…]` fijo — elimina por construcción el defecto
medido en la banda 640–679px (drawer `lg` de 680px sobre un viewport de
~650px, `left: -30px`). `Dialog`/`AlertDialog` (`ui/dialog.tsx`,
`ui/alert-dialog.tsx`) pasan de `w-full` sin techo a
`w-[calc(100%-2rem)] max-w-lg max-h-[85svh] overflow-y-auto` — gutter, alto
máximo y scroll interno por default, sin restructurar su DOM en
header/body/footer fijo (hubiera roto la API de ~90 consumidores para un
problema que la garantía exterior ya resuelve). `Popover`/`DropdownMenu`
(`ui/popover.tsx`, `ui/dropdown-menu.tsx`) leen la altura real que expone
Radix (`--radix-popover-content-available-height` /
`--radix-dropdown-menu-content-available-height`) en vez de asumir un máximo
fijo, más un `max-w-[calc(100vw-24px)]` de gutter. `Select` (`ui/select.tsx`)
y `Sheet` (`ui/sheet.tsx`) fueron auditados y ya cumplían el contrato —
`max-h-96` + viewport interno de Radix el primero, `w-3/4 sm:max-w-sm` +
`h-svh` el segundo — no se tocaron. No se cambió lógica de negocio, datos,
RLS, roles, permisos ni PIN — shell/UI únicamente, sobre la misma superficie
que C7.2 dejó cerrada. QA visual real (viewports 320–1440, banda 640–679 en
particular, teclado virtual, swipe-to-close) queda pendiente por el mismo
bloqueo de navegación del entorno documentado en C7.2 — ver el reporte del
build para el detalle exacto de qué se validó por código/build y qué falta.

**C7.2 (Shell responsive de Operate) ✅ cerrado — 2026-09-27.** Segunda etapa
de C7 (responsive), sobre las fronteras compartidas de C7.1
(`src/lib/breakpoints.ts`). Unifica el binding responsive del shell interno
(`AppSidebar`, `PageHeader`, `Index.tsx`) alrededor de los tres modos de
ventana de DESIGN.md: **Compact** (<640px, drawer + hamburguesa),
**Medium** (640–1023px, riel persistente de 64px con etiqueta `Micro`
visible por ítem, único estado disponible) y **Expanded** (≥1024px, sidebar
persistente colapsable a riel con un toggle exclusivo de este modo). Elimina
por construcción la contradicción 640/768 que la auditoría de C7 midió como
solapamiento real entre la hamburguesa y `PageHeader`: `useIsMobile`
(corte en 768px) dejó de gobernar el shell, reemplazado por clases
`sm:`/`lg:` de Tailwind para ancho/posición/visibilidad y por
`useWindowMode()` (`src/hooks/use-window-mode.ts`, sobre las fronteras
compartidas) solo donde una API de JS no tiene equivalente CSS —
`side`/`align` de Radix en `NotificationsBell`, el filtro de pasos de
`OnboardingProvider`, el cierre del drawer al navegar en Compact y el fork
bottom-sheet/tooltip posicionado de `OnboardingTooltip`.

`PageHeader.tsx` no se tocó: su `pl-14 sm:pl-0` ya asumía que la
hamburguesa desaparece en `sm` — quedó correcto por construcción en cuanto
el shell dejó de contradecir esa frontera, sin parches locales de padding.
`Index.tsx` migró su shell fullscreen de `h-screen` a `h-svh` (política de
viewport height de C7.1); `overflow-x-hidden` de su `<main>` se conserva a
propósito como contención temporal de módulos con deuda de reflow propia
(nueva: D41). `hooks/use-mobile.tsx` no se eliminó — sigue importado por
`src/components/ui/sidebar.tsx` (shadcn sin consumidores reales en la app) y
`src/hooks/use-compact-picker.ts` (fuera de alcance de C7.2), ambos fuera
del shell.

Validaciones: TypeScript y build de producción sin errores; lint idéntico al
baseline (432/383/49, sin hallazgos nuevos); Impeccable detect sin
hallazgos nuevos en los 6 archivos tocados. QA visual autenticada: ver el
reporte del build para el detalle de qué se validó y qué quedó pendiente de
validación manual. Backlog: D14 resuelto (evidencia en `DESIGN_BACKLOG.md`);
D33 y D40 permanecen abiertos, sin tocar; D41 nueva.

**C4C.1A (Errores de lectura y falsos vacíos en rutas críticas) ✅ cerrado —
2026-08-27.** Primer sub-build de C4C (Error/Retry), sobre la base del
diagnóstico y plan aprobados el 2026-08-26. Objetivo: una lectura fallida
nunca se representa como un vacío real.

Implementado: utilidad de clasificación/retry/timeout/cancelación
(`src/lib/readRetry.ts`), máquina de estados de lectura
(`src/hooks/useReadState.ts`), `InlineReadError` y `StaleDataNotice`
(`src/components/ui/`), y una acción de retry sobre Sonner con id estable
por superficie en `src/lib/feedback.ts`. Migrados a esta política: Agenda
(`useAgendaData.ts`, `AgendaPanel.tsx`, `DailyTurnosViewer.tsx`) con lectura
todo-o-nada de sus 4 consultas; el paso Barbero de Cobrar
(`useCobrarBarbers.ts`, `Index.tsx`, `PaymentRegistration.tsx`) con un
tercer estado de error distinto del `EmptyState` real de "sin equipo"; y
los historiales de Caja (`CashClosingHistory.tsx`,
`AnulacionesCierreHistory.tsx`), que conservan sus datos y no cierran su
diálogo ante un error de lectura. Protección contra respuestas tardías y
cruces de organización/sucursal vía `contextKey` propio por superficie +
`requestIdRef` monotónico + `AbortController` por ciclo, mismo mecanismo
consolidado en C4B.2.

Política: reintento automático solo ante error transitorio (red, timeout,
408/429/5xx y equivalentes de Postgres/PostgREST), con esperas de 1 y 5
segundos y timeout de 10 segundos por intento — máximo dos reintentos.
Errores desconocidos o permanentes (auth, RLS, permisos, validación) fallan
de inmediato, sin reintentar. Nunca se muestra `e.message` crudo al
usuario.

Validaciones: TypeScript aprobado; lint focal sin hallazgos nuevos respecto
del baseline; Impeccable detect sin hallazgos nuevos en los archivos
tocados; build de producción exitoso; 23 aserciones deterministas de
`readRetry.ts` aprobadas (ejecutadas con `bun`, sin agregar un runner de
test nuevo, ya que el repo no tiene uno). QA autenticado manual: validado
por el usuario y aprobado.

Pendiente explícito, no resuelto en este build: la marca de "datos
desactualizados" del resumen diario de Caja (su lectura está mezclada con
mutaciones dentro de `useTransactions.ts` — ver `DESIGN_BACKLOG.md` D35);
C4C.1B (Estadísticas, Clientes, configuración, Mercado Pago, gastos
recurrentes — ver D37); la investigación de atomicidad de escrituras
parciales en Cobrar/cierres (ver D36); `useSubscriptionAccess` sin cambios
(ver D38). Sin cambios en queries, filtros, cálculos, mutaciones, permisos
ni RLS. Detalle de la regla en `DESIGN.md` → Feedback ("Una lectura fallida
nunca es un vacío") y → Empty States.

**C3 (Navegación jerárquica) cerrado — build de normalización visual, 2026-08-22.**
Tres controles migraron de `Tabs` a `SegmentedControl` canónico, sin cambio de
comportamiento funcional: Recurrencias (Tareas → Tareas → Recurrencias),
Horarios de atención (Mi Negocio → [Sucursal]) y Marcas (Productos, ambos
accesos). `SegmentedControl` sumó roving focus + flechas/Home/End para no
perder la navegación por teclado que aportaba Radix Tabs. Detalle completo en
`DESIGN_BACKLOG.md` (D08 resuelto, D09 descartado) y `DESIGN.md` → Components
→ Navigation.

**C4B (Loading + Skeleton) ✅ CERRADO — 2026-08-25.** Segundo sub-build de C4.
Skeleton es el patrón dominante de carga de contenido, con dos piezas
compartidas nuevas — `hooks/useDelayedVisible.ts` (delay de ~180ms, gatea
solo la presentación; si los datos llegan antes se va directo al contenido)
y `ui/SkeletonRow.tsx` (fila para listas de ítems previsibles). Migraron
**20 superficies** de texto "Cargando…"/spinner a skeleton con geometría
fiel: Finanzas (Gastos/Inversiones/Deudas), Tareas, Recurrencias, Clientes,
Caja (Historial de cierres y Anulaciones, que hasta ahora divergían entre
sí), Productos (global, por sucursal, historial de stock, picker de Cobrar),
config (Horarios, Reservas, Bloqueos, Plan, PIN), sub-bloques de Equipo, y
Turnos del día. **D28 y D29 resueltos** (ver `docs/MODULOS/turnos-agenda.md`).
Sin cambios en queries, hooks de datos, permisos ni cálculos.
`MiNegocioGeneralTabContent` se evaluó y **no** se migró: su banner
colapsable no reemplaza contenido, convive con él.

Último punto pendiente cerrado el 2026-08-25: el loader branded
(`src/components/LoadingScreen.tsx`, arranque global de Operate) aplicó la
composición **V5 — Fila** de las 5 variantes exploradas en
`scratchpad/loader-variantes.html` (artefacto de comparación, no tocado).
Polish estático únicamente — marca (`VittroMark`) + divisor + mensaje en fila
horizontal (mobile apila a columna), la marca reduce su tamaño/protagonismo
a propósito, el bloque crece hacia abajo sin recomponer el eje al aparecer
aviso de demora/retry/estado fatal. Unificados en la misma composición y con
los mismos botones compactos los 3 estados reales (`useProgressiveLoading`:
normal, demora 8s, retry 25s) y el fatal a los 90s (que antes tenía un layout
completamente distinto, sin marca). Sin cambios en `useProgressiveLoading`,
thresholds, retry, logout, ni en `RecoverableErrorScreen` (componente
separado, no tocado). **Motion del loader (curvas, timings, entrada/salida)
sigue intacto y sigue siendo responsabilidad de C11** — este build es
exclusivamente estático. Reglas y composición en `DESIGN.md` → Components →
Loading.

**C4B.1 (Skeletons faltantes en Sueldos + Cobrar) ✅ cerrado — 2026-08-26.**
Micro-build derivado de una auditoría focal: dos superficies quedaron fuera
del barrido de C4B. En `SueldosPanel.tsx`, `isLoading` se usaba para carga
inicial, cambio de período y refetch posterior a un pago por igual — los tres
desmontaban toda la pantalla y la reemplazaban por un spinner, violando la
Silent-Refetch Rule. Ahora un `hasLoadedOnce` distingue la primera carga real
(→ skeleton fiel a la geometría de las 3 cards resumen + `SkeletonRow` en
"Resumen por Empleado" + tabla con `Skeleton` en "Historial de Pagos", tras el
delay de `useDelayedVisible`) de cualquier refetch posterior, que ahora
mantiene el contenido visible sin desmontar `PageHeader` ni filtros. En
`Cobrar` → paso Barbero, el `isLoading` de `useCobrarBarbers()` se descartaba
en `Index.tsx` y nunca llegaba a `PaymentRegistration`: mientras cargaba,
`barbers=[]` disparaba el mismo `EmptyState` de "no tenés equipo asignado"
que un caso real de cero barberos — un estado de carga se veía como problema
de configuración. Ahora `barbersLoading` se propaga como prop y el paso
Barbero distingue en orden: cargando → skeleton de grid (geometría de
`SelectableCard`), carga terminada y sin barberos → `EmptyState` real, con
barberos → grid real. Sin cambios en queries, cálculos, mutaciones, RLS,
permisos ni en `useCobrarBarbers.ts` (sin diff). Detalle en `DESIGN.md` →
Components → Loading (reglas sin cambios, ya cubrían este caso).

**C4B.2 (Loader global disparado por navegación interna a Cobrar) ✅ cerrado
— 2026-08-26.** Micro-build derivado de un diagnóstico posterior a C4B.1: el
skeleton de Cobrar quedaba invisible porque, un nivel por encima, el refetch
que `Index.tsx` dispara al entrar a Cobrar reutilizaba el mismo `isLoading`
global de `useSupabaseData` que gatea el `LoadingScreen` de pantalla
completa — cada entrada a Cobrar desmontaba todo el shell (sidebar incluido)
y mostraba "Cargando datos..." antes de volver a montar la pantalla, en vez
de ser un refetch silencioso dentro del contexto ya cargado. La corrección
separa dos conceptos que antes vivían en la misma bandera: carga bloqueante
del contexto (organización + sucursal) actual, y refetch silencioso dentro
de un contexto que ya tiene datos válidos. Una clave derivada de
organización+sucursal (`contextKey`) determina, sin necesidad de un efecto
que la resetee, si el contexto seleccionado ahora mismo ya tuvo una carga
exitosa (`loadedContextKey`). Dos mecanismos protegen contra respuestas
tardías: un `requestIdRef` monotónico descarta respuestas de una llamada
vieja al mismo contexto, y una ref del contexto actualmente seleccionado
(actualizada por `useLayoutEffect`, no durante el render) descarta respuestas
de un contexto que el usuario ya abandonó — cubriendo también la ventana
entre el render que cambia de contexto y el efecto que dispara el nuevo
fetch. Cada error queda asociado a su propio `errorContextKey`, así un error
de un contexto anterior nunca bloquea el nuevo, y un refetch silencioso
fallido en un contexto que ya tenía datos buenos no se convierte en pantalla
de error. El loader global se conserva intacto para arranque, login/
restauración de sesión inicial y cambio de sucursal; la navegación interna
hacia Cobrar ya no lo dispara, el shell y los datos previos se mantienen
visibles durante el refetch, y un error de refetch silencioso se comunica
sin desmontar nada. Archivos modificados: `src/hooks/useSupabaseData.ts` y
`src/pages/Index.tsx`. C4B.1 no fue modificado. Sin cambios en queries,
filtros, cálculos, mutaciones, permisos ni RLS.

Validaciones — checks mecánicos: TypeScript aprobado; lint focal sin
hallazgos nuevos respecto del baseline; Impeccable detect con 0 hallazgos en
los archivos modificados; build de producción exitoso, solo warnings
preexistentes. QA visual autenticado: validado manualmente por el usuario y
aprobado — navegación Caja → Cobrar sin "Cargando datos..."; navegación
Finanzas → Cobrar sin loader global; shell y sidebar preservados; entrada y
regreso a Cobrar sin falso estado vacío; cambio de sucursal conservando el
loader global; refresco completo conservando el loader de arranque.

**C4A (Empty states + Feedback foundations) cerrado — 2026-08-22.** Primer
sub-build de C4 (Estados y feedback); **no cierra C4 completo** — con C4B ya
cerrado, quedan C4C (Error/Retry) y C4D (Success matrix). Dos piezas
compartidas nuevas: `ui/EmptyState.tsx` (vacío rico: ícono + título +
descripción opcional + acción opcional, sin imponer contenedor ni conocer
permisos) y `lib/feedback.ts` (helper `success/error/info` sobre sonner).
Migrados los 4 empties ricos duplicados (Tareas, Recurrencias, Cobrar ×2 con
CTA real, Mi Negocio con lógica de rol intacta) y los 8 consumidores legacy
de toast shadcn (2 en Notificaciones, 6 en Cobrar); el `<Toaster/>` legacy
se desmontó de `App.tsx` tras confirmar cero consumidores. Sin cambios de
comportamiento, permisos, cálculos ni datos — solo presentación. Detalle en
`DESIGN_BACKLOG.md` (D10 resuelto, D15 resuelto) y `DESIGN.md` → Components
→ Feedback / Empty States.

## Turnos / Agenda

**Configuración de reservas**: migrado al canon (RHF+Zod, modo lectura/edición
por card, accesibilidad P1 resuelta). Score impeccable: 18/20.

**Portal público**: migración a modo lectura/edición prácticamente completa.
Fase 1+2+3 (accesibilidad + ruido de contenido + consistencia de chip)
completa. Fase 7 (bloque Compartir + Vista previa arriba, no sticky)
completa. Fase 4 (flash de esqueleto al guardar) completa. **Fase 9+10+11
completa** (esta última junta 2 fases originalmente separadas, a pedido
explícito): las 4 secciones de la pantalla — Logo y portada, Nombre y
color, Contenido del portal, Integraciones — están migradas. Las 3 con
campos que requieren guardado explícito (Nombre y color, Contenido,
Integraciones) usan `EditableSectionHeader` + `useForm` propio, cada una
con guardado independiente. "Logo y portada" es la única sin modo edición
— sigue siendo autosave puro, por decisión de producto (no tiene sentido
forzar un ciclo Editar/Guardar sobre campos que ya persisten al instante).

**Fase 13 (limpieza del form legacy) completa.** El `<form id="portal-form">`
y el `useForm` que sostenían logo/portada como "contenedor reactivo" ya no
existen — se reemplazaron por un `useState<PortalMedia>` simple. Motivo: el
schema de ese form estaba vacío (`z.object({})`, con un cast `as unknown as`
que tapaba el desajuste de tipos) y su `isDirty` era matemáticamente
imposible de volverse `true` (los 13 `setValue` que lo alimentaban pasaban
`shouldDirty: false` sin excepción) — un componente RHF completo sosteniendo
5 campos que nunca se validan ni ensucian. Cero cambio de comportamiento:
el autosave de logo/portada (subir, quitar, ajustar encuadre) funciona
idéntico, y `previewPortal` sigue reflejando esos campos en vivo.

**Las 5 secciones de la pantalla usan `<Card>` de forma consistente** —
"Compartir tu portal" fue la última en migrar (mantiene su chip `bg-muted`,
sin modo edición, solo cambia el envoltorio visual).

La vista previa en vivo (`previewPortal`) ya combina fuentes condicionales
por primera vez: mientras Contenido o Nombre y color están en edición, la
preview sigue el borrador de su `useForm`; si no, refleja lo último
guardado (`config`/`organization`). Logo y portada, al ser autosave sin
`editing`, no lleva condicional — siempre refleja el valor más reciente.
Con esto, **Fase 12 (preview en vivo durante edición) queda resuelta** como
efecto colateral de esta fase, no como fase aparte.

**"Compartir tu portal" con pestañas** (mismo `SegmentedControl`, ancho
acotado `sm:max-w-xs`): Link público / QR en vez de apilados; abre en Link,
que es la acción más frecuente. "Descargar QR" vive dentro del panel QR.
La sección mantiene su chip `bg-muted` — sigue sin campos editables.
Pendiente derivado: el `<Skeleton>` de carga inicial todavía espeja el
layout apilado anterior (muestra URL + cuadrado de QR a la vez), quedó
fuera del alcance de ese build — ver `MODULOS/turnos-agenda.md`.

**"Logo y portada" con pestañas** (`SegmentedControl`, no `EditableSectionHeader`
— sigue sin modo edición): el dropzone de portada dominaba la pantalla con
un rectángulo desproporcionado al mostrarse siempre junto al logo; ahora
alterna Logo/Portada con el mismo pill navy que usa el resto de la app para
filtros, abre en "Logo" por defecto. Autosave sin cambios de comportamiento
— cambiar de pestaña con una subida en curso no la interrumpe.

Pendientes: Fase 5 (unificar modelo de guardado instantáneo vs. diferido —
con esta fase la convivencia de los dos modelos quedó más nítida, no
resuelta: Logo/portada es instantáneo por decisión de producto, las otras 3
secciones son diferidas por Editar/Guardar; sigue siendo una decisión de
producto pendiente, no técnica), Fase 6 (cajas nativas al componente
compartido). El h2 anidado dentro de la vista previa (BookingLanding)
sigue sin resolver — requiere tocar el componente del portal público real.
Deriva conocida sin resolver: el `<Skeleton>` de carga inicial de Compartir
tu portal sigue espejando el layout apilado anterior a las pestañas
Link/QR — ver `MODULOS/turnos-agenda.md`.

**Horarios de trabajo**: reubicados de Turnos a Mi Negocio → ficha de
Sucursal, sección "Horarios de atención" con pestañas Sucursal/Barberos.
Turnos conserva un acceso directo.

## Resto de módulos

Tareas documentado en `docs/MODULOS/tareas.md` (Etapa 2). El resto no está relevado a fondo en el sistema de documentación actual. Ver
`CRITERIOS_DISEÑO.md` para auditorías puntuales previas (Mi Negocio,
Estadísticas, Finanzas) que no se trasladaron todavía a este formato.

## Deuda técnica conocida, sin resolver

- 187 issues del linter de seguridad de Supabase (RLS gaps, SECURITY DEFINER
  views, funciones con search_path mutable) — pendiente de sesión de auditoría
  dedicada. La Etapa 1 de Notificaciones (2026-10-12) cerró las
  funciones `_notif_*`, `notif_*` y `upsert_notification*` y las tablas de
  notificaciones y ya está aplicada en Supabase; tras la Etapa 2 el conector devuelve 7 hallazgos
  agrupados (2 listan funciones `SECURITY DEFINER` ejecutables, entre ellas cuatro `trg_*` heredados de
  Tareas/Equipo). No es comparable con los 187 anteriores y no se midió la reducción; el resto de las
  funciones y vistas sigue pendiente.
- Bug de notificaciones leídas que reaparecen (hipótesis: `notification_reads`
  legacy huérfano al cambiar `notifications.type`) — sin fix.
- Bug post-login intermitente — corrección de cliente implementada y validada
  localmente el 2026-09-16; pendiente despliegue, QA autenticado en producción
  y comprobación de límites de sesión vigentes en Supabase antes de retirarlo
  de la deuda. La secuencia Auth→Org→Sucursal sigue siendo dependiente por
  seguridad, pero cada fase tiene retry/cancelación y recuperación propia.
