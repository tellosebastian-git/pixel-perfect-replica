# Índice de documentación — Vittro

Mapa de la documentación del proyecto. Objetivo: que un agente nuevo pueda
hacer verificación dirigida en vez de auditoría exploratoria completa.

## Fuentes activas

Instrucción vigente para cualquier agente. En caso de conflicto entre un
archivo activo y cualquier otro documento, el activo gana.

| Archivo | Qué contiene |
|---|---|
| `AGENTS.md` (raíz) | Contexto universal para cualquier agente de IA: stack, reglas no negociables, proceso de trabajo |
| `CLAUDE.md` (raíz) | Redirección a `AGENTS.md` + reglas específicas de Claude Code |
| `PRODUCT.md` (raíz) | **Verdad de producto**: qué es Vittro, usuarios, roles, superficies, principios |
| `DESIGN.md` (raíz) | **Fuente de verdad activa del sistema visual**: tokens, tipografía, componentes, reglas nombradas |
| `DESIGN_BACKLOG.md` (raíz) | Deuda visual, migraciones y tareas pendientes para que el código cumpla `DESIGN.md` |
| `docs/DECISIONES.md` | Contexto y razones históricas de decisiones todavía vigentes — no repite la especificación normativa, que vive en `DESIGN.md` |
| `docs/ESTADO_ACTUAL.md` | Foto del estado funcional/técnico de cada módulo grande de la app |
| `docs/MODULOS/` | Un archivo por módulo, con detalle de su funcionamiento actual |
| `docs/FLUJO_PUBLICACION.md` | Publicación de código: original primero, sincronización del fork después y verificación de Vercel |

Plan aprobado: `docs/PLAN_ADMIN_GESTION_COMERCIAL.md` — gestión por barbería y
contacto; backend, ficha e integración validados localmente, migración aplicada
en producción con excepción directa autorizada; backend/frontend publicados y
QA autenticado de lectura realizado, escrituras comerciales habilitadas y una
edición de contacto real comprobada. El usuario mantuvo el trial de su cuenta
de prueba y confirmó Básico ARS 1.
Evidencia: `docs/ADMIN_COMERCIAL_MIGRACION_PRODUCCION.md` y
`docs/ADMIN_COMERCIAL_DESPLIEGUE_PRODUCCION.md` y
`docs/ADMIN_COMERCIAL_HABILITACION_PRODUCCION.md`. Activación paso a paso:
`docs/ADMIN_COMERCIAL_ACTIVACION.md` — migración/deploy/lectura completados;
habilitación/contacto completados; pruebas ampliadas de concurrencia,
recuperación, acceso manual/trial y convivencia real siguen pendientes.

Corrección de vencimientos/rechazos del 2026-10-11, publicada y habilitada:
[ADMIN_TRIAL_FECHAS_RECUPERACION.md](ADMIN_TRIAL_FECHAS_RECUPERACION.md).
Incluye excepción de migración, recibo puntual autorizado y recuperación
autenticada; complementa la evidencia del rollout anterior, sin cambiar el trial.

## Historial — no es instrucción vigente

Documentación de contexto o de auditorías superadas. Útil para entender
*cómo se llegó* al estado actual, nunca como fuente de la regla vigente.

| Archivo | Por qué es histórico |
|---|---|
| `docs/archivo/CRITERIOS_DISEÑO.md` | Bitácora de auditorías que precedió a `DESIGN.md`. Archivada al cierre de C2 (2026-08-22): las 2 reglas declaradas (§1.9 chip, §1.10 label/heading) y las 5 reglas de formularios que quedaban sin migrar (obligatorio/opcional, escala de `maxLength`, errores inline vs. toast, `EmptySelectHint`, `QuickApplyCard`) ya están en `DESIGN.md` — no queda ninguna regla activa sin representar |
| `docs/archivo/AUDITORIA_VISUAL_MI_NEGOCIO.md` | Auditoría de Mi Negocio/Configuración (jun 2026), previa a la migración de esos módulos al canon `DrawerForm` + RHF/Zod (cerrada jul 2026) |

**`AUDITORIA_DATOS_ESTADISTICAS.md` (raíz) — pendiente de clasificar.** No es
documentación de diseño (es inventario de datos/schema de Supabase para
Estadísticas). No se archivó todavía: es la única documentación escrita del
modelo de datos `venta`/`ingresos` y no hay forma de confirmar, sin una
auditoría de datos dedicada, si el build de reestructuración de Estadísticas
la dejó obsoleta.

## Módulos documentados en `MODULOS/`

- [x] `admin.md` — Centro de administración de plataforma, seguridad, métricas y precios
- [x] `acceso-tenant.md` — Restauración de sesión, carga del contexto tenant y recuperación de fallos
- [x] `turnos-agenda.md` — Configuración de reservas, Portal público, Horarios de trabajo
- [x] `notificaciones.md` — Modelo evento/entrega, autorización, productores, permisos de funciones y cómo agregar eventos (Etapa 1 de seguridad, aplicada en Supabase el 2026-10-12; Etapa 2 suma `_notif_barbero_users` y el evento `tarea_automatica_pausada`)
- [ ] Cobrar
- [x] Finanzas — `finanzas.md` (modo ficticio implementado, uso, límites y validación; no implica auditoría completa del módulo)
- [ ] Mi Negocio (general)
- [ ] Clientes
- [ ] Estadísticas
- [x] `tareas.md` — Tareas y Tareas automáticas: motor/cron e integridad de Etapas 2–3; BUILD 4A completo localmente (2026-10-14): datos, acciones seguras/PIN, permisos, concurrencia y deshacer; sin despliegue. 43 SQL, 12 mutaciones y 199 Vitest aprobadas; QA de publicación documentado. Ubicación: Principal → Tareas (`src/components/TareasPanel.tsx`), seguridad en `supabase/migrations/20261014120000_tareas_acciones_controladas.sql`.

Los módulos sin marcar no tienen documentación propia todavía — no auditados
a fondo. No asumir que están al día con el canon de diseño solo porque no
aparecen acá.

## Cuándo actualizar esto

Después de cada build cerrado y validado que toque un módulo: actualizar
`ESTADO_ACTUAL.md`, sumar la entrada correspondiente en `DECISIONES.md` si
hubo una decisión de criterio, y crear/actualizar el archivo de `MODULOS/`.
