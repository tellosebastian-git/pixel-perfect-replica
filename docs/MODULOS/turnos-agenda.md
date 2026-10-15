# Módulo: Turnos / Agenda

## Estructura de pestañas

BUILD 4A de Tareas (cambio local, sin despliegue): Turnos → Agenda conserva su carga/filtros de
integrantes en `src/components/TurnosAgendaPanel.tsx`, pero solicita campos explícitos mediante
`src/lib/barberoColumns.ts`, excluyendo el hash del PIN. Es compatibilidad con la protección de esa
columna del mismo build; no modifica agenda ni configuración. Detalle y QA en `docs/MODULOS/tareas.md`.

Nivel 1: Agenda | Configuración (título superior dinámico: "Turnos" en
Agenda, "Configuración" en la otra).

Nivel 2 (dentro de Configuración): Configuración de reservas | Portal
público, con flecha "atrás" hacia Agenda en la misma fila.

## Configuración de reservas

Archivos: `AgendaConfigSection.tsx`, `HorariosAccesoDirectoCard.tsx`,
`BloqueosSection.tsx`. RHF+Zod completo, modo lectura/edición por Card
(2 useForm separados, exclusión mutua). Chips: `SlidersHorizontal` (Reglas),
`CalendarX` (Límites), ambos `bg-primary/10`.

## Portal público

Archivos: `PortalPublicoSection.tsx` (orquestador), `PortalLinksEditor.tsx`,
`PortalCoverUploader.tsx`, `PortalColorPalette.tsx`,
`PortalCoverPositionDialog.tsx`, `PortalPreview.tsx`, `usePortalConfig.ts`.

Layout actual: bloque superior (Compartir tu portal + Vista previa, no
sticky) + columna única de 768px debajo, 4 `<Card>`: **Logo y portada**,
**Nombre y color**, **Contenido del portal**, **Integraciones** (ese orden,
también el de la barra de accesos rápidos).

**Migración al patrón de modo lectura/edición COMPLETA** (mismo canon que
`AgendaConfigSection.tsx`). Recorrido: Fase 9 (Integraciones, piloto) →
Fase 9+10+11 (Contenido del portal + Nombre y color + Logo y portada, las 3
juntas en un solo build a pedido explícito, sin validación intermedia entre
piezas) → pestañas `SegmentedControl` en Logo/Portada y en Compartir tu
portal → Fase 13 (limpieza del contenedor reactivo legacy) + "Compartir tu
portal" a `<Card>` (build B+A conjunto, B primero por ser el cambio visual
validable a simple vista, A después por ser un refactor sin cambio visual
esperado).

`type EditingSection = 'integraciones' | 'contenido' | 'nombreColor' | null`
— 3 `useForm` independientes (`integracionesForm`, `contenidoForm`,
`nombreColorForm`), cada uno con su Zod schema recortado, comparten este
único puntero de exclusión mutua. **"Logo y portada" queda deliberadamente
fuera de `editing`** — no tiene `EditableSectionHeader`, sigue siendo
autosave puro (decisión de producto ya tomada): es la única sección que
puede modificarse en simultáneo con cualquiera de las otras 3 en edición.

`saving` de cada `EditableSectionHeader` usa `xForm.formState.isSubmitting`
(no el `saving` global de `usePortalConfig()`) — evita que un autosave de
logo/portada haga parpadear el spinner de guardado de una Card ajena que
esté en edición al mismo tiempo. `PortalCoverPositionDialog` es la única
excepción: sigue recibiendo el `saving` del hook porque su guardado no pasa
por ningún `useForm` (y al ser un diálogo modal, no hay otra acción posible
en simultáneo mientras está abierto).

**`previewPortal` ya combina fuentes condicionales** (primer caso real,
resuelve también la Fase 12): mientras Contenido o Nombre y color están en
`editing`, la preview sigue el `watch()` de su form; si no, lee de
`config`/`organization` (lo último guardado). Logo/portada, sin `editing`,
nunca lleva condicional. El derivado `orgName` (usado en 5 lugares: QR,
`PortalPreview`, avatar sin logo, placeholder de descripción, y
`PortalCoverPositionDialog`) sigue el mismo criterio, calculado una sola
vez a nivel de componente.

**El `<form id="portal-form">` legacy y su botón "Guardar cambios" se
eliminaron** en el build que cerró Fase 9+10+11 — tras sacarle
Nombre/Color/Descripción/Links, no le quedaba ningún campo editable que
guardar.

**Fase 13 (limpieza del contenedor reactivo) completa.** El `useForm`
legacy y la etiqueta `<form id="portal-form">` que envolvían "Logo y
portada" (para sostener `logoPath`/`coverPath`/`coverPosX/Y`/`coverZoom`)
se reemplazaron por `type PortalMedia` + `const [media, setMedia] = useState<PortalMedia>(emptyMedia)`.
Motivo verificado antes de tocar nada: `portalFormSchema` era literalmente
`z.object({})` — cero validación — sostenido con un cast
`as unknown as Resolver<PortalFormValues>` que tapaba el desajuste de
tipos frente al `useForm`; y `formState.isDirty` de ese form era
matemáticamente `false` siempre, porque los 13 `setValue` que lo tocaban
pasaban `{ shouldDirty: false }` sin una sola excepción (verificado con
grep antes del build) — término muerto en el `onDirtyChange` OR, ahora
retirado (`contenidoDirty || nombreColorDirty || integracionesDirty`).

Migración mecánica de los 5 handlers de autosave: cada `setValue('campo', v, { shouldDirty: false })`
pasó a `setMedia(m => ({ ...m, campo: v }))`; en los 3 handlers que tocan
varios campos de portada a la vez (`handleCoverFile`, `handleRemoveCover`,
`handleSaveCoverPosition`) quedó una sola actualización atómica del objeto
en vez de 4 llamadas sueltas. El seeding (antes `reset({...})`) pasa a un
`setMedia({...})` único, bajo el mismo `hasSeededRef`. `previewPortal` y
los `useMemo` de `logoUrl`/`coverUrl` leen de `media.*` en vez de
`watch()` — misma reactividad (`useState` re-renderiza igual que una
suscripción `watch()` de RHF), cero cambio de comportamiento visible. El
`<Form {...form}>` raíz que envolvía toda la pantalla se reemplazó por un
fragment (`<>...</>`) — no tenía consumidores propios: los 3 `FormField`
reales siempre usaron `contenidoForm.control`/`nombreColorForm.control`/
`integracionesForm.control`, cada uno con su propio `<Form>` anidado.
`PortalCoverPositionDialog` (portaleado por Radix) es indiferente a este
cambio de wrapper raíz.

**Las 5 secciones de la pantalla usan `<Card>` de forma consistente** —
"Compartir tu portal" fue la última en convertir (antes un `<div>` suelto
con `min-w-0` para que la URL con `break-all` no desbordara el track de la
grilla; ese `min-w-0` se mudó al propio `<Card>`, sin cambio de
comportamiento). Mantiene su chip `bg-muted` y su clasificación de
CRITERIOS_DISEÑO §1.9 (sección sin campos editables) — solo cambió el
envoltorio visual, no se le agregó `EditableSectionHeader` ni modo edición.
El layout de dos columnas (Compartir + Vista previa) de la Fase 7 y las
pestañas Link/QR quedaron intactos.

**"Compartir tu portal" con pestañas** (mismo `SegmentedControl`): antes
apilaba Link público + QR verticalmente; ahora alterna entre ambos vía
`useState<'link' | 'qr'>('link')` — abre en **Link público**, que es la
acción más frecuente (fue la razón por la que esta sección subió arriba de
todo en la Fase 7). El botón "Descargar QR" vive **dentro** del panel QR,
no fuera: eso hace imposible por construcción que `handleDownloadQR` corra
con `qrRef.current` en `null` (el botón y el `<div ref={qrRef}>` montan y
desmontan juntos). Si el botón hubiera quedado siempre visible, en la
pestaña Link el `if (!canvas) return;` cortaría en silencio — un fallo mudo.
El `SegmentedControl` acá lleva `className="sm:max-w-xs"` (~320px) en vez
de full-width, porque vive en una columna de grid de ~768px sin Card, y
estirado a ese ancho se vería desproporcionado. La sección **mantiene su
chip `bg-muted`** — sigue sin campos editables, la clasificación de
CRITERIOS_DISEÑO §1.9 no cambia por pasar a pestañas.

**Deriva corregida (C4B, 2026-08-22).** El `<Skeleton>` de carga inicial
(early return de `PortalPublicoSection.tsx`) espejaba el layout apilado
*anterior* de esta sección — mostraba el campo de URL **y** un cuadrado de
166px para el QR, cuando la vista por defecto (Link) no renderiza ningún
QR. Ahora refleja la geometría real de esa pestaña: chip + título,
`SegmentedControl`, encabezado de "Link público del portal", campo de URL
y los botones Copiar / Ver portal. El bloque de QR salió del skeleton. La
columna derecha (Vista previa) y las 3 Cards de abajo no cambiaron.

**"Logo y portada" con pestañas** (`SegmentedControl`, `ui/SegmentedControl.tsx`
— pill navy deslizante): antes apilaba los 2 uploaders completos uno debajo
del otro (dropzone de portada ocupando un rectángulo desproporcionado);
ahora alterna entre panel "Logo" (pestaña por defecto al entrar) y panel
"Portada" vía `useState<'logo' | 'portada'>('logo')` local a la Card — sin
relación con `editing` (esta sección sigue sin modo edición). Primer uso de
`SegmentedControl` en la app para alternar contenido genuinamente distinto
por pestaña, no para filtrar una lista ya visible (sus otros 10 usos son de
ese segundo tipo); por eso cada panel se envuelve a mano en
`<div role="tabpanel" aria-label="...">` del lado de `PortalPublicoSection.tsx`
— `SegmentedControl.tsx` no se tocó, sigue sin conocer nada de este caso.
Cada panel conserva su `<h3>` con ícono + "(opcional)" tal cual estaba
(decisión explícita: no se retira por redundancia con el tab). El autosave
de logo/portada es indiferente a qué panel está montado — una subida en
curso sigue hasta el final aunque se cambie de pestaña a mitad de camino
(el estado `uploading*`/`removing*` vive en el padre, no en el panel).

**Fase 4 (loading local por disparador) completa.** `usePortalConfig.ts`:
`fetch(opts?: { silent?: boolean })` — el refetch interno de `save()` pasa
`{ silent: true }`, así que ya no dispara `setLoading(true)` (eso era lo que
hacía saltar el `<Skeleton>` completo en cada guardado; el `useEffect` de
carga inicial sigue sin `silent`, sin cambios ahí). En
`PortalPublicoSection.tsx`, cada uno de los 5 disparadores tiene su propio
estado local que cubre el ciclo completo (upload + save, no solo la mitad):
`uploadingLogo`/`uploadingCover` (ya existían, se extendió su alcance),
`removingLogo`/`removingCover` (nuevos). Encuadre y submit general ya
estaban correctos (`saving`/`savingAll`) y no se tocaron.

**Asimetría resuelta (C4B, 2026-08-22).** "Quitar portada" quedaba solo
`disabled` durante el ciclo, sin texto "Quitando..." — a diferencia de
"Quitar logo". `PortalCoverUploader.tsx` ahora recibe una prop `removing`
propia (separada del `disabled` genérico que comparte con "Ajustar
portada"), y el padre le pasa `removingCover` — el estado que ya existía
desde la Fase 4 y hasta ahora solo alimentaba `disabled`. Ambas acciones de
quitar comunican progreso igual. Sin cambios en subida, borrado, encuadre
ni persistencia.

Dos modelos de guardado sin señal visual que los distinga (instantáneo vs.
diferido) — eso es Fase 5, sigue pendiente, sin tocar acá.

## Horarios de trabajo

Ya no vive en este módulo — ver Mi Negocio → ficha de Sucursal →
"Horarios de atención". Este módulo conserva solo un acceso directo
(`HorariosAccesoDirectoCard.tsx`).

## Responsive de Agenda (C7.7)

**Contrato de columna** (Día — `AgendaDayView.tsx`; 3 días/Semana —
`AgendaMultiDayView.tsx`): cada columna (barbero en Día, día en 3 días/
Semana) tiene un ancho mínimo usable — `MIN_COL_WIDTH = 160` en Día
(sin cambios, ya existía), `MIN_COL_WIDTH = 128` en multi-día (nuevo,
medido con el componente real de tarjeta de turno, ver
`docs/DECISIONES.md`). Ninguna columna se comprime por debajo de ese
mínimo — si el conjunto no entra, el body scrollea horizontalmente en
vez de reducir columnas. Semana siempre muestra 7 columnas, 3 días
siempre 3, sin importar el viewport — no se reduce el significado
funcional de la vista para que "entre".

El ancho no se calcula con CSS Grid `minmax()`: se mide el contenedor
real vía `ResizeObserver` (`containerWidth`) y se computa
`Math.max(MIN_COL, (containerWidth - TIME_RAIL_WIDTH) / n)` — la
columna crece cuando sobra espacio, nunca baja del mínimo. Antes de
C7.7, `AgendaMultiDayView.tsx` usaba
`grid-template-columns: repeat(n, minmax(0, 1fr))` sin ningún piso: en
Semana mobile cada columna podía angostarse a ~40px, ilegible incluso
para la hora. Día ya evitaba este problema — C7.7 llevó el mismo
contrato (medición + scroll local) a 3 días/Semana, sin tocar la
implementación de Día salvo la fórmula de altura (ver abajo).

**Header y body sincronizados**: un solo scroll horizontal percibido —
header (fechas) y body (columnas) son dos elementos `overflow-x-auto`
reales, sincronizados a mano (`scrollLeft` espejado con guarda
anti-loop), igual que Día. El riel horario queda fuera de ambos
scrollers, fijo a la izquierda.

**Altura** (`useAgendaBodyHeight.ts`, compartido por Día y multi-día):
reemplaza `clamp(600px, calc(100vh - 180px), 1100px)` — el piso de
600px ganaba en pantallas bajas (375×667, 320×568: `100vh - 180px` da
menos de 600px) y forzaba un alto mayor al espacio real, generando
scroll vertical anidado (el `<main>` del shell — ya el único scroller
de página real, ver D41 — compitiendo con el `overflow-y-auto` propio
de la grilla). La nueva fórmula mide en runtime cuánto ocupa
realmente lo que va arriba de la grilla (incluido el propio header
sticky de Agenda, que ahora puede ocupar más alto si el toolbar de
`AgendaPanel` se parte en dos líneas) y expresa el máximo como
`clamp(240px, calc(100svh - offsetMedido), 1100px)` — `svh` por
estabilidad frente al chrome móvil dinámico, medición en vez de una
segunda constante adivinada. El propietario del scroll vertical sigue
siendo el mismo de siempre: `<main>` para la página, la grilla de
Agenda para su propio cuerpo — C7.7 no movió esa frontera, solo evitó
que la grilla pidiera más alto del que realmente hay.

**Toolbar** (`AgendaPanel.tsx`): la fecha/contexto (`titleLabel`) ya no
puede forzar overflow del toolbar — a partir de `sm:` (640px) se
muestra completa ("miércoles 24 de septiembre de 2026"), por debajo se
muestra `titleLabelShort` ("mié 24 sep 2026", abreviación semántica,
no truncado ni ellipsis). Los dos grupos del toolbar (contexto/
navegación a la izquierda; vista/zoom/Añadir a la derecha) tienen
`flex-wrap` propio además del `flex-wrap` del contenedor exterior —
si un grupo no entra ni abreviando la fecha, envuelve internamente en
vez de recortarse contra el `overflow-clip` del wrapper `rounded-lg`
(ese `overflow-clip` se conserva — solo redondea esquinas, ya no
recorta contenido real porque la causa del overflow se resolvió en la
fuente).

**Drag & drop**: sin cambios de comportamiento — `usePointerDragDrop`,
el ghost (`z-[80]`), `resolveDrop`, `touchAction: 'pan-y'` y el hit-test
por `data-col-root` siguen intactos en `AgendaDayView.tsx`. 3 días/
Semana no tienen drag (nunca lo tuvieron — `AgendaMultiDayView.tsx`
solo recibe `onTurnoClick`), así que no había ningún gesto que
preservar ahí.

**D40 (aislamiento de stacking) sigue abierto** — C7.7 no lo tocó ni
lo resolvió; ver `DESIGN_BACKLOG.md`.
