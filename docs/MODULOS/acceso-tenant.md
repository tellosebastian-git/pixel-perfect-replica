# Acceso tenant

Estado: implementado y validado localmente el 2026-09-16; pendiente despliegue
y QA autenticado en producción.

## Recorrido

- El cliente Supabase tenant usa `localStorage`, `persistSession: true` y
  `autoRefreshToken: true`. No comparte almacenamiento con el Admin.
- `AuthProvider` toma `INITIAL_SESSION` como arranque único; los eventos
  posteriores son idempotentes por usuario. Perfil (incluye `organization_id`
  y `default_sucursal_id`) y roles se consultan en paralelo.
- En `/login`, se espera la restauración. Con sesión vigente se navega a
  `/app/_` sin mostrar el formulario. Sin sesión se muestra el formulario.
  `?mode=signup` conserva el registro aun si había una sesión anterior.
- `ProtectedRoute` carga/verifica perfil, organización, sucursales y estado de
  suscripción; resuelve el slug real o muestra la pantalla recuperable de la
  fase fallida. El login nuevo solo navega cuando la sesión aceptada pertenece
  al usuario que acaba de ingresar.

## Fallos y aislamiento

Perfil, roles, organización y sucursales usan la política de lectura de
`src/lib/readRetry.ts`: intento inicial + hasta dos reintentos para error
transitorio, esperas de 1 y 5 segundos, timeout de 10 segundos por intento.
Cada intento recibe una señal de aborto. 401, permisos y errores permanentes
fallan sin retry automático. Una respuesta vacía confirmada se distingue de un
error de red. “Reintentar” inicia una lectura nueva sin cerrar la sesión.

El estado derivado de perfil, roles, organización, sucursales y suscripción se
invalida/oculta al cambiar de usuario u organización. Cada ciclo cancela su
petición anterior y descarta respuestas tardías por generación y clave de
tenant. La consulta de suscripción conserva su comportamiento de retry manual;
no usa reintentos automáticos de `readRetry`.

## Límites y comprobación pendiente

No se modificó la configuración central de sesiones de Supabase ni se reparó
el API Gateway externo. No hay promesa de duración indefinida: límites como
time-box, inactividad o sesión única pueden invalidar el refresh token. Hay que
leer sus valores efectivos en el proyecto de producción y probar con la misma
cuenta y navegador: homepage → “Ya tengo cuenta” → app; cerrar pestaña →
reabrir homepage → acceso sin contraseña; logout → formulario. Repetir para
owner y cuenta de sucursal, y probar red transitoria y retry manual. Solo tras
ese QA se puede retirar la deuda post-login de `ESTADO_ACTUAL.md`.

Validación local: `npx tsc --noEmit`, `npm test` (25 tests), `npm run build` y
lint focal sin errores. Tests nuevos cubren arranque con/sin sesión, renovación,
401, fallo transitorio, retry agotado/manual, login nuevo, registro y cambio
rápido de tenant con respuestas tardías. Las pruebas Admin existentes siguen
aprobadas.
