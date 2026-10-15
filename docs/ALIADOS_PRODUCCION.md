# Programa de aliados — evidencia de producción

Este registro conserva el rollout inicial v1. Revisión vigente v2 (niveles solo
por referidos, comunicación y correo): [ALIADOS_NIVELES_REFERIDOS.md](ALIADOS_NIVELES_REFERIDOS.md).

Fecha: 2026-10-14. Proyecto Supabase: `azqpyfoobpovqosbayvz` (Vittro).
Estado: backend/frontend publicados y programa habilitado. Alta pública abierta,
worker periódico activo e Instagram deshabilitado. La habilitación se comprobó
después de publicar y de corregir el orden real del alta de Supabase Auth.

## Autoridad y alcance

El usuario respondió «podemos ir a produccion directamente» a la consulta sobre
Lovable o excepción puntual SQL. Autoriza este rollout de DB/RLS, backend y
frontend; la excepción se documenta aquí conforme AGENTS.md. No cambia la regla
general de Lovable ni autoriza otras migraciones o intervenciones financieras.

Se reportó antes de aplicar la adaptación de `handle_new_user`, SECURITY DEFINER
existente: identidad externa con perfil sin barbería/trial, y atribución validada
al final del alta tenant. El cuerpo productivo original era `md5(prosrc)=
db13ead169c47bb2052cda933af11fef`; la migración aborta si no coincide. Se conservan
las ramas originales de Admin, invitaciones, sucursales y aprovisionamiento.

## Migraciones y aislamiento

Aplicadas en una transacción dirigida, con lock timeout y guard de reaplicación:

- `20261014130000_partner_program.sql`: 19 tablas, RPC y motor transaccional.
- `20261014130100_partner_auth.sql`: Auth y atribución en signup.
- `20261014130200_partner_checkout_storage.sql`: wrapper del finalizador de
  catálogo existente y Storage privado/restrictivo para comprobantes.

La prueba real detectó que service_role tiene SELECT, sin UPDATE, sobre Auth.
Se corrigió mediante `20261014130300_partner_auth_lock.sql`: advisory lock por
identidad al adherir, sin ampliar permisos de Auth. La prueba volvió a pasar.
La prueba Auth/API real detectó que GoTrue inserta primero y aplica app_metadata
después: el guard original no podía reconocer a un creador en ese INSERT. Se
cerró el alta, se reportó nuevamente el ajuste del DEFINER existente y se aplicó
`20261014130400_partner_identity_intent.sql`. Guardia del cuerpo previo:
`fa773c6d1c7cc67008719ac62b3fc476`. La quinta migración agrega una tabla privada
RLS y tres funciones INVOKER: reservar, consumir por email/nonce una sola vez
en 10 minutos y descartar. Edge reserva antes de auth.admin.createUser; el
trigger consume antes de aprovisionar. Un nonce declarado sin intención válida
aborta el alta; user_metadata no puede asignar account_kind ni rol de plataforma.
El test SQL reproduce INSERT-before-app_metadata y el test API usa GoTrue real.

Las cinco versiones están registradas en schema_migrations con su fuente.
No se usó db push ni se reparó/reaplicó el historial anterior con timestamps
locales distintos. Generadores y pruebas en `supabase/tests/`.

Inspección productiva final: 20/20 tablas con RLS; cero tablas del programa legibles
por anon/authenticated; cero funciones propias nuevas DEFINER. Las funciones
solo ejecutan con service_role y revalidan actor/tenant explícitamente.
Las filas financieras tenant llevan FK compuesta organización/sucursal inicial.
Identidad, convenios y agregados de plataforma no fabrican un tenant.

## Runtime y recuperación

Desplegadas únicamente estas funciones, todas ACTIVE:

| Función | Versión observada | verify_jwt |
| --- | ---: | --- |
| partner-program | 3 | false, validación explícita de sesión/actor |
| partner-program-worker | 1 | false, secreto servidor o HMAC reciente |
| partner-instagram-callback | 1 | false, nonce de un uso y gate de Instagram |
| subscription-create-checkout | 26 | true |
| subscription-mp-webhook | 25 | false, firma MP existente |

APP_ORIGIN es `https://www.vittro.com.ar`. Secrets nuevos aleatorios: worker,
rate limit y AES-GCM; no se guardan en Git ni se publican en respuestas. Se
configuraron los switches de programa/billing y se activó DB readiness después
de verificar Vercel. Ambos están true, junto con enrollment_enabled y billing_ready.
Instagram ENABLED/VERIFIED permanecen false.

Se reportó y habilitó la extensión oficial pg_net, que tiene funciones internas
privilegiadas. Job `partner-program-worker`, cada minuto: consulta Vault y firma
timestamp/nonce con HMAC-SHA256. La cola no recibe el secreto permanente.
El worker acepta firmas durante 120 segundos; leases, unicidad y CAS impiden
que invocaciones repetidas dupliquen una comisión o liquidación. Invocación
autenticada: HTTP 200, processed=0, failed=0. Cron SQL: succeeded. Las respuestas
HTTP del cron confirmaron 200 y processed=0/failed=0 en tres ejecuciones consecutivas.

Bucket `partner-payout-receipts` privado, 10 MiB, PDF/PNG/JPEG. Políticas
restrictivas cubren políticas permisivas anteriores y prohíben sobrescritura/
eliminación desde cliente. Solo Admin ve comprobantes y datos bancarios completos.

Auth allowlist actualizado mediante PATCH de **uri_allow_list solamente**,
conservando las entradas previas de Lovable y reset-password. Añadidos
`https://www.vittro.com.ar/aliados/panel` y su variante `?mode=reset`. site_url
sigue en el dominio productivo; sin config push de Auth global.

## Evidencia de validación y límites

- 200 Vitest / 28 archivos, 32 Deno, build Vite y lint focal aprobados.
- 27 pruebas SQL reales en PGlite: unicidad, scope, CAS, cotización, comisiones,
  reversión parcial/completa antes/después de liquidar, lotes, leases, OAuth,
  Storage frente a políticas permisivas. Auth sintético replica ausencia de UPDATE
  y el orden real de escritura de metadata, con intención privada de un uso.
- `partners-production-rollback.sql` pasó en el esquema real: creador sin tenant,
  código sin distinción de mayúsculas, registro tenant con trial y atribución en
  sucursal inicial, cotización introductoria, resumen agregado, aislamiento y ACL.
  ROLLBACK verificado: cero usuarios fixture; restaura los flags previos. Se
  repitió tras la quinta migración con enrollment false/billing true previo.
- Nueve probes productivos: status cerrado 200; panel/Admin sin sesión 401;
  origin no confiable 403; worker sin secreto/incorrecto 401; checkout sin JWT
  401; código con programa cerrado 503 y después inexistente 409 con programa
  habilitado; CORS permite origen productivo exacto. Status final enabled=true,
  instagramEnabled=false.
- `partners-production-identity.mjs` pasó usando Auth y funciones reales, sin
  envío de email: cuenta externa confirmada, login nativo, cero org/sucursal,
  adhesión idempotente, porcentaje inicial 10, código sin distinción de mayúsculas,
  resumen propio, Admin 403 y tabla bancaria cruda 403. Fixture eliminada y GET
  Auth posterior 404. La confirmación en este probe usa Admin; no prueba entrega SMTP.
- Las dos primeras ejecuciones del probe detectaron el aprovisionamiento nativo
  anterior al app_metadata. Sus cuentas/códigos y los dos tenants vacíos fueron
  eliminados de forma dirigida, con IDs/timestamps/nombre fixture, cero perfiles,
  pagos o actividad y guard de dueño existente. No se deshabilitaron triggers ni
  se alteró una organización de cliente. Script de evidencia:
  `partners-fixture-cleanup-20261014.sql`; resultado remaining_fixture_organizations=0.
  Inspección final: cero cuentas fixture y cero intents pendientes.
- QA visual sintético: nueve escenarios a 390/768/1440px, sin errores/overflow,
  con importes grandes y drawers; `.impeccable/review/partners/report.json`.

No se generaron cargos, devoluciones, transferencias ni emails a terceros.
Las pruebas de dinero son sintéticas; no acreditan recepción real de primer/
segundo cobro, devolución/contracargo o transferencia bancaria. Quedan esas
comprobaciones y concurrencia ampliada con conexiones independientes. Instagram
solo se habilita después de una cuenta profesional externa y permisos reales.
tsc app mantiene cinco errores preexistentes abortSignal/readRetry; build pasa.

## Publicación y habilitación

Build lógico registrado en `0635215f`; build visual separado en
`f0904fb23a4ea4843924cff5c6a4f26f669f9732`. Se publicó primero origin desde
`43bd9ce6` y se comprobó ese SHA; después el fork existente production desde
`7d2947a5`, también comprobado. Ambos fueron avances normales, sin divergencia,
sin force push ni reemplazar cambios ajenos. El fork estaba diez commits detrás
del original; se preservó ese historial al sincronizar.

Vercel `barber-app` confirmó **Ready / Production / Current**, main, dominio
`www.vittro.com.ar`, commit `f0904fb` y deployment `Huywr74RApkrC2TpmMYKqVZLtmji`
(build remoto 26 segundos). Se abrió readiness después de esa confirmación. La
corrección de identidad detectada después se validó, aplicó y redeplegó en
partner-program v3; su código/documentación se publican con el mismo orden.

Cierre funcional verificado: `d3439ec8e13c891fa146cade6e649c066d49fcc6` en
origin/main y production/main, comprobando el original antes del fork. Vercel
deployment `D2tfeeKbPzB47HqL4N81v52RZD6X`: **Ready / Production / Current**, ese
commit, main y www.vittro.com.ar (build de 30 segundos). El cierre documental
posterior conserva el mismo código. Inspección final: cinco migraciones,
readiness habilitado, Vault sin SELECT para anon/authenticated y worker 200.
Los archivos temporales de rollout con claves se retiraron del workspace;
no se añadieron a Git. El cambio preexistente de supabase/.temp/cli-latest
se preservó fuera de los commits.

QA sobre el dominio real: /aliados muestra condiciones y niveles; “Soy creador”
abre el formulario habilitado; Homepage “Crear mi código” enlaza /aliados sin
errores de consola. Formulario a 390px sin overflow. /admin/aliados sin sesión
redirige a /admin/login. No se certifica UI Admin con sesión real en este rollout;
esa superficie está probada con fixtures sintéticos y sus APIs/RLS con permisos.

Para cerrar altas: PARTNER_PROGRAM_ENABLED=false y enrollment_enabled=false.
Conservar billing/worker activos para liquidar obligaciones ya atribuidas.
PARTNER_BILLING_ENABLED=false es apagado de emergencia del motor; también
detiene sus trabajos y exige reconciliar obligaciones al reactivarlo.
