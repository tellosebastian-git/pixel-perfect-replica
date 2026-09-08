# Decisiones de arquitectura y criterio — Vittro

Registro del "por qué", no del "qué". Para el estado actual de cada módulo,
ver `ESTADO_ACTUAL.md`. Para la especificación normativa vigente del sistema
visual, ver `DESIGN.md` — este archivo no repite esa especificación, solo el
contexto y el razonamiento detrás de cada decisión.

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
