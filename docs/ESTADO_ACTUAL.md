# Estado actual — Vittro

Última actualización: 2026-08-27

## Sistema de diseño — Operate

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

No relevados a fondo en el sistema de documentación actual. Ver
`CRITERIOS_DISEÑO.md` para auditorías puntuales previas (Mi Negocio,
Estadísticas, Finanzas) que no se trasladaron todavía a este formato.

## Deuda técnica conocida, sin resolver

- 187 issues del linter de seguridad de Supabase (RLS gaps, SECURITY DEFINER
  views, funciones con search_path mutable) — pendiente de sesión de auditoría
  dedicada.
- Bug de notificaciones leídas que reaparecen (hipótesis: `notification_reads`
  legacy huérfano al cambiar `notifications.type`) — sin fix.
- Bug post-login intermitente — refactor parcial aplicado, cadena
  Auth→Org→Sucursal sigue siendo secuencial.
