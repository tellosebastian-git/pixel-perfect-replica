# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Vittro es dueño-céntrico: el `owner` (dueño de la organización) es el comprador y el
principal destinatario del valor global del producto. El equipo usa Vittro como
extensión de la operación diaria, no como audiencia primaria.

Roles (semántica conceptual — los permisos actuales de UI pueden ser más
permisivos o restrictivos que esta definición, y eso es estado, no la definición):

- **owner** — dueño de la organización.
- **general_manager** — administración general delegada; gestiona ampliamente el
  negocio sin ser necesariamente el propietario. Hoy comparte casi todos los
  permisos de UI con `owner`, pero conceptualmente es un rol distinto.
- **manager** — encargado de la operación de una sucursal.
- **sucursal_account** — cuenta compartida de una sucursal, pensada para un
  dispositivo del local (mostrador). La usa quien esté operando esa sucursal en
  cada momento; no representa una persona ni un cargo fijo. Por eso existen PIN
  en acciones sensibles, restricciones de visibilidad y auditoría de su uso.
- **barber** — acceso operativo acotado, centrado en su trabajo y su agenda.
- **Cliente final** — no tiene cuenta interna; reserva y gestiona turnos desde el
  portal público de cada barbería.

El **administrador de plataforma** es una identidad interna de Vittro, no un rol
tenant ni un usuario de una barbería. Su permiso vive exclusivamente en
`app_metadata.platform_role = "platform_admin"`; no forma parte de `app_role`,
`user_roles` ni del modelo de permisos delegables por una organización.

## Product Purpose

Vittro es un SaaS multi-tenant de gestión integral para barberías. Sostiene dos
promesas del mismo nivel, sin jerarquía entre ellas:

1. Ordenar y centralizar la operación diaria de la barbería (cobros, caja,
   turnos, equipo, finanzas).
2. Dar claridad sobre el negocio para tomar mejores decisiones.

Éxito: el dueño deja de necesitar planillas, papel o herramientas sueltas para
operar y entender su negocio.

## Positioning

El claim central es la **integralidad**: Vittro reemplaza el collage de
planillas, papel, WhatsApp y herramientas separadas por un único sistema desde
el cual gestionar la barbería completa. Ese es el mecanismo que un competidor
parcial no puede copiar con facilidad.

Ser vertical para barberías (no un software genérico de turnos/salones
adaptado), tener Mercado Pago integrado nativamente (cobro presencial y
suscripción) y soportar multi-sucursal con roles reales son capacidades
importantes que sostienen el claim, pero no son el claim en sí.

## Operating Context

Estructura del negocio: **organización → sucursales → equipo**. Todo dato
operativo pertenece a una organización y, cuando corresponde, a una sucursal —
la separación multi-tenant y el aislamiento de datos entre organizaciones son
restricciones fundamentales del producto, no un detalle técnico incidental.

Uso durante la jornada laboral, con frecuencia dentro del local. Convive:

- dispositivos compartidos en el mostrador (`sucursal_account`);
- uso personal del dueño desde su propio celular, incluyendo fuera del local;
- notificaciones push que traen información operativa al dueño y al equipo.

Debe funcionar correctamente en desktop, tablet y mobile. **Tablet tiene
importancia especial**: es el dispositivo típico del contexto operativo del
local (mostrador).

Mercado actual/principal: **Argentina** — pesos argentinos, Mercado Pago,
español rioplatense, operatoria habitual de barberías argentinas. Esto describe
el mercado de hoy, no una restricción permanente: el producto debe poder
internacionalizar moneda, medios de pago, idioma, terminología e integraciones
locales en el futuro. Ningún principio de producto debe asumir Argentina como
condición estructural.

Cuatro superficies con objetivos distintos, que no deben contaminarse entre sí:

- **App interna** (modo Operate) — superficie principal; prioriza claridad,
  rapidez, previsibilidad, densidad útil, estados comprensibles, baja fricción
  y consistencia. No adopta automáticamente tratamientos visuales de marketing.
- **Portal público de reservas** (modo Operate/cliente final) — white-label por
  barbería: usa el logo, la portada, el color y la identidad de cada barbería,
  no la de Vittro.
- **Homepage comercial** (modo Persuade) — explica valor y convierte. Sus
  necesidades visuales no deben condicionar el diseño de la app operativa.
- **Centro de administración de plataforma** (`/admin`, modo Operate interno) —
  permite observar y controlar la salud comercial global de Vittro sin entrar en
  la operación de una barbería. Tiene autenticación, sesión, shell y APIs propios;
  no hereda el contexto de organización/sucursal de la app interna.

## Capabilities and Constraints

Programa de aliados (2026-10-14): publicado y habilitado en producción
con excepción autorizada de DB/RLS. Admite owners
existentes y personas externas que recomiendan a amigos o a su comunidad, con
identidad Auth de plataforma sin tenant. Los niveles 10/20/30% dependen solo de
barberías calificadas; los seguidores de redes no intervienen. Suma una
entrada pública Persuade, un panel Operate propio y control de convenios/
liquidaciones en Admin; conserva el núcleo visual y no agrega roles tenant.
El beneficio se atribuye solo al alta de una barbería nueva, con comisión por
primer cobro y pago mensual humano. Estado y detalle: `docs/MODULOS/aliados.md`.

Capacidades principales: Cobrar (registro de cobros), Caja (resumen diario y
cierres), Turnos/Agenda (incluye el portal público de reservas), Clientes,
Finanzas (sueldos, gastos, inversiones, deudas, estadísticas), Tareas, Mi
Negocio (sucursales, equipo, horarios), Configuración, gestión de equipo y
roles, notificaciones, y contexto operativo aislado por sucursal dentro de la
organización.

Modelo comercial: planes **Básico / Profesional / Premium** con feature-gating
real (algunas capacidades requieren un plan superior), trial de 15 días, y
suscripción integrada actualmente con Mercado Pago. `subscription_plans.amount_ars`
es la única fuente de precio para Homepage, Registro, Facturación, gates y
checkout. Cada precio tiene una versión auditable para que el catálogo, los
checkouts y las renovaciones no diverjan.

El centro de administración v1 cubre resumen global, barberías, usuarios,
suscripciones, pagos, auditoría y edición auditada de precios. Quedan fuera de
esta primera versión los datos operativos de las barberías, clientes finales,
ventas, finanzas internas, impersonación y administración de cuentas.

Ampliación comercial aprobada e implementada localmente (2026-10-10): ficha por
barbería, edición de nombre/contacto, asignación de acceso manual y extensión de
trial elegible, con motivo, reautenticación y auditoría. Contacto comercial no
es identidad Auth; acceso manual no prueba un pago ni modifica contratos Mercado
Pago. Su migración ya está aplicada en producción con autorización puntual;
la API/frontend comerciales están desplegados, con escrituras comerciales
habilitadas por autorización nueva y edición de contacto real verificada.
Acceso manual/trial conservan guardas y auditoría; no modifican contratos MP.
Ampliación de vencimientos publicada y habilitada (2026-10-11):
extender, acortar o vencer un trial elegible con una fecha pasada,
motivo, reautenticación y auditoría. No cancela un contrato de Mercado Pago.
Suspensión efectiva,
usuarios, roles y edición de límites/catálogo quedan fuera de este rollout.

Terminología: los nombres de módulo actuales (Cobrar, Caja, Turnos, Clientes,
Finanzas, Tareas, Mi Negocio, Configuración) son el vocabulario vigente, **no
binding** — pueden evolucionar si hay una mejora justificada de producto o UX.
La voz (ver Brand Commitments) sí es un compromiso estable.

## Brand Commitments

Personalidad: profesional, directo, confiable. La herramienta que no estorba.

Voz: español rioplatense con voseo, lenguaje directo, profesional y claro, sin
anglicismos innecesarios. Compromiso estable, independiente del mercado.

Anti-referencias (fronteras conceptuales, no recetas visuales — el detalle
visual vive en DESIGN.md): Vittro no debe sentirse como una app bancaria
genérica, ni como una app consumer de belleza, ni adoptar el aspecto genérico
de un SaaS americano de marketing cuando eso contradiga esta identidad.

## Evidence on Hand

"+100 barberías usando Vittro" (copy actual de la homepage) **no está
verificado** como dato real. Tratarlo como copy comercial/aspiracional: no debe
registrarse como verdad de producto ni habilitar que futuras superficies
persuasivas lo afirmen, salvo confirmación explícita posterior.

## Product Principles

1. La herramienta sirve al flujo de trabajo, no al revés — reduce fricción
   operacional en vez de agregarla.
2. Densidad útil sobre decoración — mostrar lo necesario para operar y decidir,
   ocultar lo accesorio.
3. Consistencia como confianza — los patrones se repiten para que el uso
   repetido durante la jornada sea predecible.
4. Estados y consecuencias claras — cada acción responde con feedback visible
   (éxito, error, pendiente); nada de ambigüedad sobre qué pasó.
5. Cada superficie sirve a su propio objetivo — Operate tenant, cliente final,
   Persuade y administración de plataforma no se resuelven con el mismo
   tratamiento ni comparten contexto de acceso por conveniencia.

## Accessibility & Inclusion

WCAG AA como mínimo. Contraste adecuado en texto sobre fondos coloreados.
Respeto por `prefers-reduced-motion` en toda animación.
