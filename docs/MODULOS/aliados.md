# Programa de aliados

Revisión v2: niveles exclusivamente por referidos y comunicación para amigos
y comunidades. Seguimiento y evidencia: [ALIADOS_NIVELES_REFERIDOS.md](../ALIADOS_NIVELES_REFERIDOS.md).

Estado 2026-10-14: motor, datos/RLS y frontend publicados y habilitados en el
proyecto operativo con excepción directa autorizada. Alta abierta y worker
periódico activo. Instagram retirado del programa. Evidencia del primer rollout
de rollout: [ALIADOS_PRODUCCION.md](../ALIADOS_PRODUCCION.md).

Reglas: 10/20/30% del primer cobro después del descuento, antes de costos de
procesador; 10% introductorio para la barbería solo con código en signup. Dos
mensualidades distintas aprobadas califican una organización, una sola vez.
Nivel 1: 10%; nivel 2: 20% con 5 calificadas; nivel 3: 30% con 20 calificadas.
Convenio vigente 1–100% prevalece. Hold 30 días; revisión y pago mensual humanos.

`partner-domain.ts`: reglas sin entorno, centavos exactos, tiers/expiración,
estado de comisión, reembolso parcial y ajustes posteriores a liquidación.
`partner-billing.ts`: cotizaciones, reintentos idempotentes del webhook,
reconciliación payment y trabajos durables. La integración Instagram anterior
queda inactiva: no habilita conexión, métricas, upgrades ni refresh por switches.
La API conserva un objeto vacío para clientes antiguos en caché. `partner-program`: acciones
públicas limitadas, identidad verificada, proyección del panel propio y operaciones
admin reautenticadas. Nunca se recibe actor_id, tasa o monto del navegador.

La persistencia implementa el contrato [ALIADOS_LOVABLE_ENTREGA.md](../ALIADOS_LOVABLE_ENTREGA.md).
Los switches ausentes mantienen la facturación existente y el programa cerrado.
Deshabilitar altas conservando billing permite terminar obligaciones existentes.

## Interfaces y recorrido

Build visual independiente del motor: superficies integradas con los DTO aprobados,
con DESIGN.md, DrawerForm y primitives existentes. QA sintético de las tres
superficies y sus drawers completado antes de publicar; reporte versionado,
capturas locales. La validación financiera continúa en la etapa de lógica.

Homepage enlaza `/aliados`, que explica beneficios y condiciones versión
2026-10-14-v2. `/aliados/panel` se monta fuera de TenantProviders: usa la sesión
Auth compartida para owners, pero no exige organización a creadores externos.
Alta externa pasa por Edge y Auth admin con account_kind protegido; una intención
privada de un uso permite al trigger reconocerla antes de que GoTrue actualice
app_metadata. El cliente no puede fabricar esa intención. El email
se confirma mediante un enlace nativo de Supabase. El código se crea después
de email confirmado y aceptación autenticada. Recuperación de contraseña usa
la identidad del enlace, sin pedir un email nuevo. Callback/login generales
reconocen account_kind partner y redirigen a este panel.

Registro tenant acepta `?ref=CODE`, valida el código en Edge antes de enviar
signup y transmite solo referral_code a Auth. La atribución se cierra en la
transacción de alta; esta prevalidación no sustituye esa comprobación.
Código inválido muestra error inline. No existe acción para atribuir después.

El panel usa únicamente PartnerSummary: totales y comisiones anónimas, cuenta
enmascarada, niveles y progreso en un frasco de loción; ningún nombre/email/dato de una
barbería referida. Formularios de código/cobro son DrawerForm con RHF/Zod.

Admin usa su sesión aislada y `/admin/aliados`, paginación servidor, drawers
de convenios, titularidad, preparación/registro de liquidaciones e incidencias.
Comprobantes privados PDF/JPEG/PNG <=10 MiB. Mutaciones reautenticadas, con
motivo/confirmación/request_id; un resultado incierto bloquea repetir hasta
consultar la operación. No se realizan transferencias desde el software.

## Evidencia y pendientes

`src/test/partner-domain.test.ts`: 34 casos aprobados; acceso/recuperación UI:
3 casos; `partner-program/index_test.ts`: 6 pruebas HTTP sin permisos de red.
Build y lint focal aprobados; chequeo Deno de API, callback, worker, checkout y
webhook. QA visual/interacción: 11 escenarios sintéticos (landing/panel/Admin en
390/768/1440px y correo en 390/680px), drawers, códigos largos, cifras de 8 y
10 dígitos y cero errores de página/
overflow; `.impeccable/review/partners/report.json` y PNGs.
Regresión de la revisión: 207 pruebas Vitest en 29 archivos y 32 Deno (24 de Admin
existentes, seis del nuevo handler HTTP y dos de firmas del worker), aprobadas. `tsc -p
tsconfig.app.json --noEmit` conserva los cinco errores preexistentes de
abortSignal/readRetry documentados, sin errores en las superficies nuevas.
Las seis migraciones pasan 27 pruebas PostgreSQL/PGlite: RLS, ACL, unicidad,
snapshot, efectos recalculados, leases, reversiones, lotes y Storage restrictivo.
Se agregó el orden real de GoTrue (INSERT y después app_metadata), nonce
no falsificable/expiración/consumo, y se ajustó el entorno para que service_role solo
lee Auth. La prueba productiva con rollback comprobó alta externa sin tenant,
signup referido con trial intacto, cotización y privacidad; no dejó fixtures.
Prueba real Auth/API con cuenta temporal: login nativo, alta sin organización
ni sucursal/trial, adhesión idempotente, 10% inicial, código normalizado, resumen
y rechazo a Admin/datos bancarios crudos. Cuenta y datos temporales eliminados.

Worker y cron productivos verificados; comprobantes privados y Auth allowlist
configurados. Pendientes: recepción financiera real de primer/segundo cobro y
reversiones en Mercado Pago, transferencia/comprobante real y pruebas ampliadas
de concurrencia con sesiones independientes. Los casos financieros de las 27
pruebas SQL son sintéticos. Los niveles dependen de resultados comprobados de
referidos. No hubo cargos ni transferencias en estos rollouts.

Las condiciones usan details nativo cerrado y se abren por enlace #condiciones.
La landing permite explorar niveles; el panel muestra progreso de calificaciones
reales y separa el convenio del nivel automático. El alta externa se comunica
como cuenta de referidos, sin exigir ser creador. El correo Magic Link compartido
tiene asunto “Tu acceso a Vittro”, diseño de marca y ConfirmationURL nativa.
La revisión v2 está publicada en Vercel Ready / Production / Current, con alta
reabierta y Auth/API nativos comprobados sin enviar correos de prueba.
Evidencia de publicación, migración dirigida y configuración de Auth:
[ALIADOS_NIVELES_REFERIDOS.md](../ALIADOS_NIVELES_REFERIDOS.md).
