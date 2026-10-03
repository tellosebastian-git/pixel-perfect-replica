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

- [x] `turnos-agenda.md` — Configuración de reservas, Portal público, Horarios de trabajo
- [ ] Cobrar
- [ ] Finanzas
- [ ] Mi Negocio (general)
- [ ] Clientes
- [ ] Estadísticas
- [ ] Tareas
- [ ] Notificaciones

Los módulos sin marcar no tienen documentación propia todavía — no auditados
a fondo. No asumir que están al día con el canon de diseño solo porque no
aparecen acá.

## Cuándo actualizar esto

Después de cada build cerrado y validado que toque un módulo: actualizar
`ESTADO_ACTUAL.md`, sumar la entrada correspondiente en `DECISIONES.md` si
hubo una decisión de criterio, y crear/actualizar el archivo de `MODULOS/`.
