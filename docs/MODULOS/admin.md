# Centro de administración de plataforma

## Estado de rollout

**Desplegado en producción y con mutaciones de precio habilitadas desde el
2026-09-08.** La migración, la cuenta técnica, el frontend y las Edge Functions
están aplicados en el entorno productivo. Se verificaron el acceso autenticado,
los endpoints administrativos y la política CORS para
`https://www.vittro.com.ar`.

`PLATFORM_ADMIN_PRICE_MUTATIONS_ENABLED` está en `true`, pero todavía no se
ejecutó ni validó el primer cambio real de precio después de habilitarlo. Por lo
tanto, la propagación completa a Mercado Pago, el resultado del lote y el
webhook posterior continúan pendientes de una prueba controlada. Habilitado no
equivale aún a validado de punta a punta.

La migración es `supabase/migrations/20260904153000_platform_admin_center.sql`.
Modifica una función `SECURITY DEFINER` preexistente (`handle_new_user`), por lo
que fue aplicada como una excepción puntual autorizada, en una sola transacción
y sin ejecutar otras migraciones. No debe reaplicarse durante el rollout.

Preflight productivo registrado antes de habilitar las mutaciones:

- Catálogo: Básico ARS 30.000, Profesional ARS 60.000 y Premium ARS 100.000;
  todos en `price_version = 1`.
- Había 29 suscripciones locales `active` y 4 `trialing`.
- Solo una suscripción activa tenía `preapproval` de Mercado Pago; su estado
  local del proveedor era `pending`, por lo que no debe asumirse como una
  renovación autorizada sin revalidar el preview y el proveedor.
- No existían lotes, ítems ni eventos de auditoría de cambio de precio. El
  intento que devolvió `503 MUTATIONS_DISABLED` no modificó el catálogo.

El impacto debe recalcularse con `preview` inmediatamente antes de confirmar
cada cambio. El rollback operativo del permiso es volver a configurar
`PLATFORM_ADMIN_PRICE_MUTATIONS_ENABLED=false`; esto bloquea nuevas acciones
`apply`, `process` y `retry`, pero no revierte precios ni efectos externos que ya
hayan sido confirmados.

## Propósito y alcance v1

`/admin` es el plano de control interno de Vittro. Permite observar la salud
comercial global y operar cambios de precio sin entrar a la aplicación de una
barbería ni consultar sus datos operativos.

Incluye:

- Resumen de barberías con acceso, MAU 30 días, cobros aprobados e incidencias.
- Barberías, con búsqueda y filtros de plan/estado.
- Usuarios tenant, roles, fecha de alta, último ingreso y condición MAU.
- Planes, suscripciones y pagos de plataforma.
- Edición auditada del precio de un plan y propagación a Mercado Pago.
- Auditoría administrativa y seguimiento/reintento de lotes.

No incluye en v1 datos operativos, clientes finales, ventas, cajas o finanzas de
las barberías; impersonación; extensión manual de trials; asignación manual de
planes; suspensión de organizaciones; bloqueo/reset de usuarios; conciliación
manual; ni administración de cuentas de plataforma.

## Rutas y composición

| Ruta | Contenido |
|---|---|
| `/admin/login` | Acceso con alias administrativo y contraseña |
| `/admin` | Resumen global |
| `/admin/barberias` | Listado de organizaciones |
| `/admin/usuarios` | Listado de cuentas tenant |
| `/admin/suscripciones` | `Planes`, `Suscripciones` y `Pagos` |
| `/admin/auditoria` | Acciones administrativas y resultado de lotes |

El árbol Admin se monta antes y fuera de `OrganizationProvider`,
`SucursalProvider`, onboarding y `SubscriptionGate`. Usa `AdminShell` y no
reutiliza `AppSidebar`, `Login`, `UserManagement` ni `BillingSettings`, porque
esas piezas tienen supuestos de tenant que no deben entrar al plano de control.

## Identidad, sesión y autorización

- El alias visible es `admin`. No es un email ni un rol de base de datos.
- `VITE_PLATFORM_ADMIN_EMAIL` resuelve ese alias al email técnico de una cuenta
  dedicada de Supabase Auth. El email puede formar parte del bundle; la
  contraseña nunca.
- La cuenta debe estar confirmada, vigente y tener
  `app_metadata.platform_role = "platform_admin"` asignado desde un entorno
  server-side. El permiso no se guarda en `app_role` ni `user_roles`.
- `handle_new_user` retorna antes del provisioning tenant para ese claim: la
  cuenta no crea organización, sucursal, perfil owner ni trial.
- El cliente Supabase de Admin usa `sessionStorage`, una clave propia y
  `detectSessionInUrl: false`. Puede convivir con la sesión tenant del cliente
  principal.
- Tras 30 minutos sin actividad se cierra únicamente la sesión local de Admin y
  se limpia su caché React Query.
- El guard React es solo UX. Cada Edge Function vuelve a comprobar bearer JWT,
  usuario actual y claim vigente antes de inicializar `service_role`.
- Mensajes de acceso no distinguen alias inexistente, contraseña incorrecta o
  falta de rol. La credencial no se registra en logs ni auditoría.

La identidad compartida permite atribuir acciones a `admin`, no a la persona
física que la realizó. MFA y administradores nominales quedan recomendados para
una fase posterior, especialmente antes de sumar más mutaciones.

## Contratos backend

### `platform-admin-query`

Operaciones públicas tipadas:

- `overview`
- `organizations`
- `users`
- `subscriptions`
- `payments`
- `audit`
- `price_change_status`

Los listados responden `{ items, page, pageSize, total }`, aceptan búsqueda,
filtros y orden procesados en servidor, y limitan `pageSize` a 50. La lectura de
Supabase Auth pagina hasta agotar usuarios, por lo que no se trunca en el límite
habitual de 1.000. Los DTO usan una lista permitida de campos: no exponen
`raw_payload`, tokens, metadata arbitraria ni información operativa de tenants.
Las métricas y colecciones operativas se resuelven sobre vistas de lectura
`platform_admin_*_v`, revocadas a `anon`/`authenticated`, para paginar, ordenar y
agregar en Postgres. Solo el cruce de `last_sign_in_at` para MAU se completa en
Edge mediante Auth Admin, porque ese dato no pertenece al esquema público.

### `platform-admin-price-change`

Acciones:

- `preview`: devuelve plan actual, impacto, renovaciones elegibles, checkouts
  pendientes y exclusiones; no requiere habilitar mutaciones.
- `apply`: reautentica la misma cuenta con la contraseña ingresada, verifica el
  catálogo esperado y crea el cambio/lote transaccional.
- `process`: reclama un grupo acotado y sincroniza sus objetivos con Mercado
  Pago.
- `retry`: reabre ítems fallidos o interrumpidos válidos y exclusiones por
  `preapproval` faltante cuando la referencia ya fue reparada.

Todas las acciones excepto `preview` están bloqueadas mientras
`PLATFORM_ADMIN_PRICE_MUTATIONS_ENABLED` no sea `true`.

## Modelo de control

Las siguientes tablas tienen RLS activa, ninguna policy de acceso para
`anon`/`authenticated` y privilegios reservados a `service_role`:

- `platform_admin_audit_log`: actor, alias, acción, objetivo, motivo, estado
  anterior/siguiente permitido, resultado, request ID y fecha. Registra
  mutaciones administrativas, no intentos de login ni secretos.
- `subscription_price_change_batches`: plan, importes/versiones, estado,
  contadores, actor, motivo y timestamps del lote.
- `subscription_price_change_items`: objetivo de renovación o checkout,
  `preapproval`, referencia externa congelada, claim, tipo de mutación externa,
  revisión exacta de la suscripción, intentos normales/de compensación, resultado
  y error sanitizado.

`subscription_plans.price_version` identifica la versión del precio.
`organization_subscriptions` conserva `billing_amount_ars`,
`billing_price_version`, `pending_checkout_amount_ars` y
`pending_checkout_price_version` para distinguir catálogo actual, contrato
vigente e intención de checkout.

Las RPC nuevas son `SECURITY INVOKER`, revocadas a `anon` y `authenticated`, y
ejecutables solo por `service_role`. Incluyen creación/reclamo/finalización/retry
de lotes, el fence y la compensación de mutaciones externas, y finalizadores CAS
para checkout, cambios programados, reactivación y cancelación.

## Semántica de métricas

- **Barbería con acceso:** organización habilitada con trial vigente o período
  de suscripción vigente. No equivale a `status = active` aislado de fechas.
- **MAU 30 días:** cuenta tenant cuyo `last_sign_in_at` cae dentro de los últimos
  30 días. Excluye identidades con rol de plataforma y no significa “online”.
- **Cobro aprobado 30 días:** pago `approved` cuya fecha efectiva es `paid_at`
  cuando existe; la creación es solo fallback.
- **Incidencias:** incluye pagos/suscripciones estancados, fallos de lotes,
  rechazos recientes y webhooks sin procesar dentro de los umbrales del backend.
- **Estados:** trial, vigente, vencida, cancelada y legacy se muestran por
  separado; no se colapsan bajo una etiqueta genérica de “activa”.

## Fuente única y cambio de precios

`subscription_plans.amount_ars` es la única fuente de precio. Homepage,
Registro, Facturación, `SubscriptionGate` y checkout leen el mismo catálogo; el
campo `plan_features.price_monthly` se elimina al aplicar la migración. La
migración lleva Profesional a ARS 60.000 mediante el mismo mecanismo auditable,
solo si el importe anterior difiere.

Flujo de una modificación:

1. Admin abre un `DrawerForm` y solicita un preview.
2. Confirma un importe ARS positivo, un motivo de 10–500 caracteres, el impacto
   y su contraseña. La contraseña solo viaja en esa solicitud de reautenticación
   y no se persiste.
3. `apply` compara importe, `price_version` y `updated_at`. Si otra sesión cambió
   el catálogo, responde conflicto y obliga a refrescar.
4. Una RPC bloquea el plan y las suscripciones afectadas, incrementa la versión,
   actualiza el catálogo, crea el lote/ítems e invalida todo checkout pendiente
   anterior en la misma transacción.
5. El worker reclama hasta 20 pendientes y procesa con concurrencia máxima 5.
   Reintenta red, 408, 429 y 5xx hasta tres intentos; los errores permanentes
   quedan visibles.
6. Antes de cada `PUT /preapproval/{id}` revalida organización, suscripción,
   plan e identificador; recupera y congela una referencia externa faltante
   solo si el proveedor prueba el mismo tenant/plan; y persiste el tipo de
   mutación junto con la revisión local exacta antes del efecto externo.
7. Una caída o respuesta externa ambigua conserva el fence y se retoma con el
   mismo efecto idempotente. Si la revisión local cambió, el mismo ítem restaura
   la intención vigente o completa el precio nuevo si la suscripción sigue
   siendo elegible. La compensación también tiene CAS y retry.
8. Cada resultado completa su ítem de forma idempotente. El lote solo termina
   cuando todos los elegibles llegaron a estado terminal; fallos o interrupciones
   se pueden reabrir sin duplicar efectos.

Los checkouts pendientes se convierten en tombstones inmutables y se cancelan
en Mercado Pago; si un pago ganó la carrera y promovió el checkout antes de la
invalidación, el worker lo reconoce como renovación activa y aplica el importe
nuevo al próximo débito. Los éxitos parciales no revierten el catálogo: Mercado Pago no ofrece una
transacción global y algunas renovaciones ya pueden haber cambiado. El operador
ve el resultado y reintenta los objetivos pendientes. Los checkouts de una
versión anterior se invalidan o reemplazan; nunca se reutilizan por conveniencia.
Un downgrade programado mantiene separado el plan de facturación actual del
plan/importes previstos para la próxima renovación.

## Checkout y webhook de Mercado Pago

Un checkout existente solo se reutiliza si coinciden plan, importe, versión,
ARS, estado pendiente y referencia de organización tanto localmente como en
Mercado Pago. Si el catálogo cambia durante la creación, la finalización
transaccional rechaza el snapshot y la función cancela el `preapproval` recién
creado.

El webhook:

- exige `MERCADOPAGO_WEBHOOK_SECRET` y valida HMAC y frescura del timestamp;
- permite omitir firma únicamente con
  `MERCADOPAGO_ALLOW_UNSIGNED_WEBHOOKS=true` junto con
  `MERCADOPAGO_ENVIRONMENT=sandbox`;
- persiste eventos con unicidad, reanuda duplicados todavía no procesados y
  devuelve error reintentable cuando la sincronización no termina;
- compara importe, moneda, plan, referencia, vínculo y orden temporal antes de
  extender acceso;
- usa CAS por `updated_at` para evitar carreras entre eventos;
- no retrocede períodos ante pagos antiguos y conserva una intención pendiente
  ante rechazos recuperables;
- persiste y audita cobros de vínculos obsoletos, cancela esos vínculos y nunca
  los usa para otorgar acceso;
- acepta un cobro legítimo con el importe inmediatamente anterior si quedó en
  vuelo durante un lote ya confirmado, mantiene el snapshot nuevo para el
  próximo débito y genera una incidencia auditable;
- primero confirma por CAS la promoción del checkout nuevo y deja un marcador
  durable del vínculo anterior; recién después lo cancela, de modo que un retry
  pueda terminar la limpieza sin cancelar la suscripción todavía vigente.

## Experiencia y responsive

Admin usa Inter, navy, tokens semánticos, radios y elevación del modo Operate.
El shell es propio. Desktop/tablet presentan tablas densas; mobile transforma la
misma información en cards. Toolbar y panel de resultados comparten un único
card con `overflow:clip`. La edición de precio nunca es inline.

Las lecturas aplican delayed skeleton solo en la primera carga, conservan datos
anteriores durante refetch, muestran `InlineReadError` si no existe contenido
utilizable y reservan el empty state para una ausencia confirmada. Los errores
técnicos y respuestas completas del proveedor no se muestran al operador.

## Variables de entorno

Frontend:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_PLATFORM_ADMIN_EMAIL`

Edge Functions / secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PLATFORM_ADMIN_ALLOWED_ORIGINS`
- `PLATFORM_ADMIN_PRICE_MUTATIONS_ENABLED` — `true` en producción desde el
  2026-09-08; volver a `false` es el kill switch para bloquear nuevas mutaciones
- `APP_ORIGIN`
- `MERCADOPAGO_APP_ORIGIN`
- `MERCADOPAGO_SUBSCRIPTIONS_ACCESS_TOKEN` — preferido para suscripciones
- `MERCADOPAGO_ACCESS_TOKEN` o `MP_ACCESS_TOKEN` — fallbacks legacy del cliente
  compartido
- `MERCADOPAGO_CLIENT_ID` y `MERCADOPAGO_CLIENT_SECRET` — fallback OAuth
- `MERCADOPAGO_WEBHOOK_SECRET`
- `MERCADOPAGO_WEBHOOK_TOLERANCE_SECONDS` — opcional; el backend limita el valor
  efectivo al rango 60–3600 segundos
- `MERCADOPAGO_ALLOW_UNSIGNED_WEBHOOKS` — solo sandbox; nunca producción
- `MERCADOPAGO_ENVIRONMENT` — debe ser exactamente `sandbox` para habilitar el
  modo sin firma; en cualquier otro entorno el webhook falla cerrado
- `MERCADOPAGO_SUBSCRIPTION_WEBHOOK_URL` — opcional si no se deriva del proyecto

`APP_ORIGIN` y `MERCADOPAGO_APP_ORIGIN` siguen siendo orígenes reconocidos por el
helper compartido; `PLATFORM_ADMIN_ALLOWED_ORIGINS` permite declarar la lista
específica de Admin. Ninguna variable documentada debe contener la contraseña de
la cuenta en el repositorio o en un nombre `VITE_*`.

## Estado del despliegue en producción

- [x] Migración aplicada como única migración, en una sola transacción y con
  autorización explícita para el cambio de `handle_new_user`.
- [x] Constraints, índices, RLS, grants, RPC, backfill y funciones desplegadas
  verificados en producción.
- [x] Cuenta técnica confirmada con
  `app_metadata.platform_role = "platform_admin"` y sin datos tenant asociados.
- [x] Email técnico, secrets y origen de Admin configurados sin transportar la
  contraseña por el repositorio ni variables `VITE_*`.
- [x] `platform-admin-query`, `platform-admin-price-change` y las funciones de
  suscripción modificadas desplegadas.
- [x] Endpoints, CORS y autenticación de `/admin` verificados en producción.
- [x] Kill switch de precios habilitado el 2026-09-08.
- [ ] Ejecutar un primer cambio de precio controlado y verificar catálogo, lote,
  auditoría y resultado real en Mercado Pago. Esta prueba no debe marcarse como
  cumplida solamente porque `apply` deje de devolver `503`.
- [ ] Completar la matriz de renovación activa, checkout pendiente, conflicto,
  fallos transitorios, retry y webhook firmado.
- [ ] Registrar QA responsive autenticado en 390, 768/1024 y 1440 px, incluida
  la convivencia y el cierre independiente de sesiones.

Si aparece un comportamiento inesperado durante la primera mutación, configurar
de inmediato `PLATFORM_ADMIN_PRICE_MUTATIONS_ENABLED=false`, conservar el lote y
la auditoría para diagnóstico y no intentar una reversión manual del catálogo o
de Mercado Pago sin reconciliar primero el estado de ambos sistemas.

## Criterios mínimos de aceptación de rollout

- La cuenta de plataforma no crea ningún dato tenant.
- JWT ausente devuelve 401; usuario tenant o claim inválido devuelve 403 en todas
  las APIs globales.
- La sesión tenant sobrevive a login, timeout y logout de Admin.
- La credencial no aparece en bundle, repositorio, respuestas, logs ni auditoría.
- Las métricas respetan sus fechas efectivas y excluyen identidades de plataforma.
- Paginación/búsqueda funcionan con 0, 1, 50 y más de 1.000 usuarios.
- Homepage, Registro, Facturación, `SubscriptionGate` y un checkout nuevo
  reflejan la misma versión/precio de catálogo.
- Un enlace viejo nunca se reutiliza; las renovaciones elegibles reciben el nuevo
  importe para su próximo débito.
- 429, 5xx, faltantes de `preapproval` e interrupciones quedan identificados y
  reintentables; reejecutar no duplica efectos ni auditoría.
- Dos cambios concurrentes no pisan el catálogo y los webhooks fuera de orden no
  retroceden el acceso.

## Próximas fases posibles

Primero, gestión comercial auditada (extender trials, asignar planes y suspender
barberías). Después, salud de webhooks/cron, conciliación de Mercado Pago,
alertas y exportes. Administradores nominales con MFA deben preceder una expansión
significativa de permisos. La impersonación requiere una iniciativa separada con
modelo explícito de privacidad, consentimiento y auditoría.
