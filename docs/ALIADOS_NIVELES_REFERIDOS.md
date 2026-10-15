# Aliados — niveles por referidos y comunicación de ingresos

Solicitud del usuario del 2026-10-14: presentar la comisión como subida de niveles,
usar un elemento gráfico de barbería, quitar seguidores de Instagram, dirigirse
tanto a quien recomienda a sus amigos como a un creador con comunidad, ocultar
condiciones en un desplegable y mejorar el correo nativo mostrado en la captura.

## Etapa lógica validada localmente

- Nivel 1: 10% desde el alta; nivel 2: 20% con cinco barberías calificadas;
  nivel 3: 30% con veinte. Sigue siendo una organización con dos mensualidades
  distintas aprobadas/sin reversión, contada una vez. Convenios vigentes prevalecen.
- Instagram deja de influir tanto en TypeScript como en SQL, aunque lleguen métricas
  históricas. La conexión queda retirada incluso si se cambian switches de entorno.
  Se mantiene desconexión para limpieza de una conexión antigua. No se programan
  refresh jobs nuevos y los trabajos antiguos se retiran sin llamadas a Meta.
- Términos v2 para nuevas adhesiones/atribuciones/cotizaciones. La aceptación de
  miembros existentes y snapshots financieros ya fijados siguen intactos; no se
  fabrican aceptaciones ni se reescriben comisiones o convenios históricos.
- API conserva un campo Instagram vacío para clientes anteriores en caché; no
  revela métricas ni permite el nivel por audiencia. Tablas antiguas siguen privadas.

Inspección previa de producción: un aliado, cero cuentas/credenciales/jobs de
Instagram. Cambio SQL dirigido: `20261014230000_partner_referral_levels.sql`, solo
funciones INVOKER, sin alterar handle_new_user, tablas ni RLS. Es una modificación
solicitada del mismo programa cuyo despliegue directo autorizó el usuario; se
conserva el orden de publicación original/fork establecido por AGENTS.md.

Pruebas locales: 34 de dominio, 27 PostgreSQL/PGlite y chequeo Deno de API/worker.
Se sustituyó la prueba de OAuth por retiro de conexión/métricas/refresh y se
preservaron las pruebas de descuentos, cobros, reversiones, lotes y aislamiento.

## Etapa visual y correo

Dirección: “Generá ingresos con tu código de referidos”; una sola voz para amigos
y comunidad, registro externo sin requerir ser creador. Frasco de loción como
medidor geométrico de nivel, con porcentajes y requisitos escritos. No sustituye
los números por color. El panel usa progreso real; la landing presenta niveles
ilustrativos seleccionables. Condiciones cerradas por defecto y accesibles por
teclado; un enlace a #condiciones las abre.

El correo mostrado usa la plantilla nativa Magic Link de Supabase, compartida
con cualquier acceso por enlace del proyecto. Se rediseña esa plantilla en español
con marca Vittro y CTA de ingreso genérica, conservando ConfirmationURL. No se
envían emails de prueba a terceros ni se cambia SMTP, remitente o otras plantillas.

Build visual cerrado y validado localmente: landing, panel, registro y CTA de
Homepage usan “código de referidos”. El frasco tiene tres estados seleccionables
en landing y avance real entre umbrales en panel; un convenio se comunica aparte
del nivel automático. Details nativo conserva teclado/foco y abre por #condiciones.

QA acotado, primera ronda sin defectos: 11 escenarios (landing/panel/Admin a
390/768/1440 y correo a 390/680), sin overflow ni errores; interacción de niveles
y desplegable por teclado, enlace directo y cifras de hasta diez dígitos. Siete
pruebas nuevas de UI cubren progreso, convenio y disclosure. Build/lint focal
aprobados. Capturas y reporte: `.impeccable/review/partners/`.

El HTML versionado está en `supabase/templates/magic-link.html`, con tablas e
inline styles para clientes de correo, logo público, fallback de fuente y enlace
de respaldo. Tiene dos ConfirmationURL nativas y ningún enlace de autenticación
fabricado. El preview usa preview.invalid. Auditoría Auth real: subject “Your Magic
Link”, body de 105 caracteres, sin template URL externo; coincide con la captura.
PATCH aplicado solo sobre subject/content de Magic Link, conservando los demás
campos de Auth. [Referencia oficial](https://supabase.com/docs/guides/auth/auth-email-templates).

## Integración productiva

Aplicado solo `20261014230000_partner_referral_levels.sql`, en transacción y con
guard de hash del RPC anterior. No se ejecutó db push ni se modificó el DEFINER
de Auth. Nueva versión registrada en schema_migrations. Alta pausada durante
rollout, manteniendo billing y worker para obligaciones existentes. Rollback
productivo pasó con términos v2 y cero fixtures persistentes.

Magic Link: PATCH exacto de mailer_subjects_magic_link y
mailer_templates_magic_link_content; lectura posterior coincide con el HTML
versionado (5848 caracteres), subject “Tu acceso a Vittro”. Comparación de todos
los demás campos Auth: sin cambios. Remitente, SMTP, redirects, política de
confirmación y otras plantillas conservados. No se envían emails a terceros.

Funciones ACTIVE observadas: partner-program v4, worker v3, callback retirado v3,
subscription-create-checkout v28 y subscription-mp-webhook v27. Se redeplegaron
solo esas cinco por compartir las reglas del programa. Verificación global:
207 Vitest/29 archivos, 32 Deno y 27 SQL aprobadas, más 11 escenarios de UI/correo.

Frontend publicado primero en el original y después en el fork, sin divergencia
ni force push. SHA funcional/documental verificado en ambos main:
`3d83397ac1745e7270974d9661050a539a7b5bab`. Vercel deployment
`9hWi4P3geAMojg6wBwsmmeZonEhn`: Ready / Production / Current, dominio
www.vittro.com.ar y source de ese SHA. La página pública muestra el mensaje de
ingresos, niveles por barberías y condiciones cerradas; sin Instagram.

Alta reabierta con billing_ready conservado y términos v2. Nueve probes reales
aprobados: status habilitado, código inexistente 409, sesión/Admin no autenticados
401, origen ajeno 403, credencial worker inválida 401 y CORS exacto. Prueba nativa
Auth/API: identidad externa sin tenant/trial, login, código único normalizado,
adhesión idempotente, 10% inicial, panel y rechazo a Admin/lectura bancaria cruda.
Cuenta, perfil e intención temporales eliminados; no se enviaron emails.

Comprobación final de datos: un miembro real con aceptación v1 conservada, cero
fixtures/intenciones de QA, 20 tablas con RLS, cero funciones propias DEFINER,
cero cuentas/jobs activos de Instagram. Cron activo y cinco respuestas worker
200 sin fallos en los últimos cinco minutos. Se conserva la validación financiera
real pendiente del primer rollout; esta revisión no realizó cobros ni transferencias.

El commit de cierre posterior actualiza únicamente documentación y conserva este
código validado. Los correos Magic Link futuros usan la plantilla nueva; mensajes
ya recibidos no se modifican. Entrega SMTP real no se probó enviando un correo.
