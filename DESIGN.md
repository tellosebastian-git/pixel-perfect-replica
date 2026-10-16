---
name: Vittro
description: Sistema de gestión integral para barberías — sistema visual "El mostrador ordenado"
colors:
  navy: "hsl(224 43% 20%)"
  navy-ring: "hsl(224 43% 30%)"
  paper: "hsl(0 0% 100%)"
  ink: "hsl(232 75% 14%)"
  ink-muted: "hsl(232 20% 38%)"
  mist: "hsl(231 80% 97%)"
  frost: "hsl(231 80% 95%)"
  hairline: "hsl(232 30% 90%)"
  input-border: "hsl(232 30% 88%)"
  status-success: "hsl(142 76% 36%)"
  status-warning: "hsl(38 92% 50%)"
  status-error: "hsl(0 72% 50%)"
  status-info: "hsl(217 91% 60%)"
  status-purple: "hsl(270 70% 55%)"
  status-indigo: "hsl(243 75% 59%)"
typography:
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.33
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.4
  title-overlay:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.35
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  tile: "10px"
  container: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "hsl(224 43% 20% / 0.9)"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
    height: "40px"
  button-destructive:
    backgroundColor: "{colors.status-error}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
    height: "40px"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.container}"
  input:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    height: "40px"
    padding: "8px 12px"
---

# Design System: Vittro

> **Fuente de verdad activa del sistema visual.** Jerarquía documental:
> `PRODUCT.md` (verdad de producto) → **este archivo** (cómo debe diseñarse Vittro de acá en adelante) →
> `DESIGN_BACKLOG.md` (deuda y migraciones pendientes para que el código cumpla estas reglas) →
> `docs/DECISIONES.md` (porqués históricos) → `docs/MODULOS/` (documentación funcional).
> `docs/archivo/CRITERIOS_DISEÑO.md` es la bitácora de auditorías que precedió a este archivo — archivada al cierre de C2 (2026-08-22), sin ninguna regla activa pendiente de migrar. Consultarla como historial, no como instrucción vigente.

## Overview

**Creative North Star: "El mostrador ordenado"**

Vittro debe sentirse como el mostrador de una barbería bien llevada: todo está donde
tiene que estar, lo importante está a mano, se puede trabajar rápido y el orden
transmite profesionalismo. La metáfora no es estética de barbería — no introduce
decoración temática — sino un criterio de evaluación: ¿esto ayuda a encontrar lo
necesario? ¿agrega ruido? ¿el operador puede actuar rápido? ¿el detalle aporta o
estorba? Convive con el principio operativo de PRODUCT.md: *la herramienta que no
estorba*.

El sistema es **light-only** hoy. Existe una variante dark completa de los tokens,
congelada: no se documenta como experiencia soportada, no se escriben variantes
`dark:` nuevas, y no se elimina (si dark mode llega, será una iniciativa propia).

**Cuatro superficies, un núcleo.** La app interna tenant (Operate), el portal
público de reservas (white-label del cliente final de cada barbería), la homepage
comercial (Persuade) y el centro de administración de plataforma (`/admin`,
Operate interno) comparten un núcleo obligatorio — color de marca, tipografía
Inter, criterios de forma, foco y accesibilidad, calidad de interacción — y
conservan libertad de composición y densidad según su función. Las páginas de
Auth (Login/VerifyEmail/AuthCallback) **pertenecen al núcleo**: su micro-sistema
actual de valores propios es un gap conocido (ver DESIGN_BACKLOG), no un sistema
paralelo válido. Admin comparte el lenguaje visual de Operate, pero su shell y
sesión son deliberadamente propios: nunca reutiliza navegación ni contexto tenant.

**Key Characteristics:**
- Denso donde se escanea, legible donde se lee; nada compite con la tarea.
- Navy como única voz de marca; el color de estado habla por semántica, no por decoración.
- Sobrio por defecto; expresivo solo en hitos del negocio.
- Patrones repetidos con nombre: la consistencia es la forma de la confianza.

## Colors

Paleta de un solo acento: navy profundo sobre neutros fríos de la misma familia índigo, con seis familias semánticas de estado.

### Primary
- **Navy Vittro** (hsl(224 43% 20%), token `--primary`): la identidad. Botón primario, tile de PageHeader, pill activo de SegmentedControl, nav activa del sidebar. Su anillo de foco es `--ring` (hsl(224 43% 30%)). La vieja escala `--color-50…950` ("Vittro indigo") es legacy, prácticamente sin uso: queda un solo consumidor pendiente de migración (el scrim mobile del sidebar). No es fuente de verdad de marca y no debe tomarse como referencia ni usarse en código nuevo; su eliminación completa está registrada en DESIGN_BACKLOG.md (D17).
- **Tinte de edición** (`bg-primary/10` + ícono `text-primary`): tratamiento del chip de header de card cuando la card **se edita en esta pantalla** (ver la Named Rule abajo).

### Neutral
- **Paper** (hsl(0 0% 100%), `--background`/`--card`): fondo de página y de superficie.
- **Ink** (hsl(232 75% 14%), `--foreground`): texto principal.
- **Ink Muted** (hsl(232 20% 38%), `--muted-foreground`): texto secundario, labels, metadata.
- **Mist** (hsl(231 80% 97%), `--muted`): fondos suaves, chips informativos, pistas de segmented.
- **Frost** (hsl(231 80% 95%), `--secondary`/`--accent`): hover y superficies de apoyo. Nunca como color de texto.
- **Hairline** (hsl(232 30% 90%), `--border`) y **Input Border** (hsl(232 30% 88%), `--input`): bordes de 1px.

### Status
Seis familias, cada una con tres tokens: `--status-X` (acento/dot), `--status-X-foreground` (texto sobre fondo claro) y `--status-X-bg` (fondo de pill/alerta): **success** (verde 142), **warning** (ámbar 38), **error** (rojo 0), **info** (azul 217), **purple** (270) e **indigo** (243). Los colores de gráficos (`--chart-cash/mp/cost/...`) derivan de estas familias; `--chart-orange` y `--chart-amber` son provisionales hasta que se cierre la paleta con el socio.

### Colores que son dato, no UI
Excepción nombrada del sistema: los colores elegidos por el usuario (o que representan una entidad suya) viven como valores literales, no como tokens — colores de marcas de productos, de líneas/categorías, y el color del portal de cada barbería.

### Color de turnos en Agenda
El color principal de cada turno sale de la **línea/categoría del servicio**: `lineas.color` es dato persistido, elegido por el dueño desde Configuración. `servicios` no tiene color propio — hereda el de su línea. `barberos` no tiene color persistido en absoluto.

`useBarberColors` no es una paleta de identidad de barbero ni representa un dato del producto — genera únicamente un acento auxiliar de UI, hoy sin token, acotado a: el borde del encabezado de columna por barbero en la vista Día, el badge "eligió barbero", y un fallback puntual en Multi-Día/Cobrar cuando el servicio no tiene línea asignada. Su tratamiento (si merece token, y cuál) se decide junto con el sistema visual de Agenda, no acá.

### Named Rules
**La regla del chip.** El chip de ícono en el header de una card comunica qué podés hacer: `bg-primary/10` + `text-primary` = *se edita acá*; `bg-muted` + `text-muted-foreground` = *atajo o información, no se edita en el lugar*. El criterio es "¿se edita acá?", nunca importancia ni peligrosidad — no existe chip destructivo de header; lo destructivo se comunica en el botón de la acción concreta.

**La regla del estado con token.** Todo color de estado de UI (éxito, advertencia, error, activo/inactivo) sale de las familias `--status-*` o de `--destructive`/`--success`. Clases directas de la paleta Tailwind (`green-*`, `emerald-*`, `amber-*`) están prohibidas en la app interna.

**Neutros por superficie.** La homepage puede usar su propia escala neutra (slate) como parte de su expresividad Persuade, siempre que el navy ancle las acciones clave y no construya una identidad de marca distinta. La app interna, Admin y Auth usan exclusivamente los neutros del sistema.

## Typography

**Única familia:** Inter (fallback `ui-sans-serif, system-ui`).

**Character:** una sola voz tipográfica, sin display font — la jerarquía se construye con tamaño y peso, no con cambios de familia. Sobria, densa y legible: tipografía de herramienta.

### Hierarchy
- **Headline** (600, 24px / `text-2xl`): título de página, solo dentro de `PageHeader`.
- **Title — card** (500, 18px / `text-lg`): título de card/contenedor en reposo. Peso medio **a propósito**: muchas cards conviven en pantalla y no deben competir entre sí.
- **Title — overlay** (600, 18px / `text-lg`): título de Dialog/DrawerForm/Sheet. Peso firme **a propósito**: el overlay es una tarea única enfocada y el título la ancla. La diferencia con el título de card es una regla intencional, no una inconsistencia.
- **Body** (400, 14px / `text-sm`): el texto de lectura de la app.
- **Label** (500, 12px / `text-xs`): labels, metadata, celdas densas, descripciones cortas de campo.
- **Micro** (600, 10px): badges, contadores, section labels uppercase del sidebar y la etiqueta compacta de cada ítem del riel de navegación en Medium (ver Components → Navigation → Sidebar). Nada de texto de producto por debajo de 10px.

### Named Rules
**La regla de densidad legible.** 12px es válido donde el usuario **escanea** (tablas, listas densas, metadata, labels). 14px es el mínimo donde el usuario **lee** (descripciones, mensajes, explicaciones, empty states). La prioridad es densidad útil, no densidad máxima.

**La regla de los 16px en mobile.** Todo control editable que pueda recibir foco y abrir el teclado virtual (input, textarea, búsqueda, teléfono, número, componentes custom que enfocan un campo) usa `font-size` ≥ 16px en mobile — el patrón canónico es `text-base md:text-sm`, ya implementado en el `Input` base. Evita el auto-zoom de iOS Safari. Esta regla tiene prioridad sobre cualquier regla de densidad, y **nunca** se resuelve con hacks de viewport (`maximum-scale=1` está prohibido). Labels y helper text pueden seguir en 12px.

**La regla del dinero.** Todo importe monetario usa `tabular-nums` cuando corresponda y nunca se trunca, usa ellipsis, se solapa, desaparece o queda parcialmente fuera del viewport. `$ 99.999.999` (8 dígitos) es el **baseline obligatorio de diseño y QA** para todo layout financiero — no el máximo soportado por Vittro: una cifra mayor debe seguir siendo legible, nunca recortarse. Ante falta de espacio, en este orden: (1) el bloque crece si hay espacio; (2) el grupo reduce cantidad de columnas; (3) reflowea; (4) llega a una sola columna si hace falta. Nunca crop. Las reservas mínimas (`--metric-min`, `--kpi-min`) viven en `src/index.css` — ver Layout → "Métricas financieras".

**La regla del label vs. heading.** Un título de bloque de formulario con **un solo control** es su `FormLabel` (nombre accesible), no un heading. Un bloque con **varios controles** lleva heading real (`h3` bajo el `h2` de sección) y cada control se nombra por su cuenta. No convertir todo a `FormLabel sr-only` (borra la navegación por encabezados) ni poner headings sobre campos únicos (doble anuncio en lector de pantalla).

## Layout

- **Contenedor de las superficies Operate:** `max-w-7xl` centrado con padding lateral responsivo (`px-4 sm:px-6 md:px-8`). Excepción única: la Agenda usa ancho completo. Admin aplica el mismo ancho dentro de su shell propio.
- **Grid bidimensional (Agenda, C7.7):** una grilla donde tanto la posición horizontal (columna) como la vertical (hora) contienen información no se resuelve reflowendo a una sola columna — la posición es el dato. Contrato: cada columna (barbero en Día, día en 3 días/Semana) tiene un ancho mínimo usable, medido con el contenido real (no un breakpoint) vía `ResizeObserver` sobre el contenedor propio — la columna crece si sobra espacio, nunca baja del mínimo; si el conjunto no entra, scroll horizontal local con header y body sincronizados, nunca se reduce la cantidad de columnas (Semana siempre son 7 días). Detalle de implementación y el valor medido de cada mínimo en `docs/MODULOS/turnos-agenda.md`.
- **Densidad por superficie:** la app interna y Admin son densos y escaneables; la homepage respira como landing; el portal es una columna angosta centrada (max-w-md en landing de reserva).
- **Modos de ventana (Compact / Medium / Expanded):** el viewport decide **solo** cuestiones globales — navegación persistente vs. colapsada, regiones principales, shell, distribución macro. **Compact** < 640px · **Medium** 640–1023px · **Expanded** ≥ 1024px. Sus fronteras coinciden con `sm` (640) y `lg` (1024) de Tailwind; `md` (768), `xl` (1280) y `2xl` (1536) siguen existiendo como utilities normales para decisiones **dentro** de una región (una segunda columna, un cambio tipográfico) — no son un cuarto modo de ventana ni deciden shell. Los modos de producto y las utilities técnicas de Tailwind no son la misma cosa: `768px` deja de significar simultáneamente "mobile", "desktop", "tablet" y "cambio de shell" — cada bullet de este documento que decide algo por ancho dice explícitamente si habla de un modo de ventana o de una utility puntual.
- **Fuente única de breakpoints:** `sm`/`md`/`lg`/`xl`/`2xl` (640/768/1024/1280/1536, los defaults de Tailwind, sin cambios) se declaran una sola vez en `src/lib/breakpoints.ts` y `tailwind.config.ts` los consume desde ahí — nunca se vuelven a escribir a mano en un segundo lugar. El layout se decide mediante CSS. JavaScript puede **leer** las mismas fronteras compartidas (vía `useWindowMode()`, `src/hooks/use-window-mode.ts`) únicamente cuando una API no pueda expresar ese comportamiento mediante CSS (hoy: `side`/`align` de Radix en `NotificationsBell`, el filtro de pasos de onboarding, el cierre automático del drawer de `AppSidebar` al tocar un ítem en Compact, la presentación Popover/Drawer de los pickers de fecha/hora). El ancho, la posición y la visibilidad del shell en sí (drawer/riel/sidebar persistente, hamburguesa, scrim, toggle) son puramente CSS — `useWindowMode()` nunca decide esas clases. JavaScript también puede **medir** el ancho real de su propio contenedor (`ResizeObserver`, `clientWidth`/`scrollWidth`) para responder "¿esto entra?" — no es lo mismo que leer un modo de ventana, porque depende del contenido, no de un umbral fijo. Lo único que JS nunca puede hacer es inventar un número de corte propio, hardcodeado, que no salga de `src/lib/breakpoints.ts`.
- **Resolución de layout, en este orden — `layout intrínseco → medición del contenedor → container query → media query`:** (1) **intrínseco** primero — `auto-fit`/`minmax`, `flex-wrap`, `min-w-0`, tamaños fluidos — resuelve la mayoría de los casos sin ninguna query; (2) **medición del contenedor** cuando la pregunta depende del contenido real ("¿esto entra?") y no de un umbral conocido; (3) **container query** solo cuando existe un cambio de **composición** (no solo cuántas columnas entran) dependiente de un umbral fijo del contenedor, y lo anterior no alcanza — el proyecto no instala `@tailwindcss/container-queries` hasta que un caso real lo demuestre; (4) **media query** solo para shell, navegación global, regiones principales y macro-layout de ventana (los modos de arriba). No resumir esta secuencia de otra manera en ningún otro lugar del documento.
- **Altura de viewport:** `svh` en superficies fullscreen donde controles importantes deben quedar a salvo del chrome móvil (drawers, sheets, dialogs, shell de Admin). `dvh` solo donde el comportamiento dinámico es realmente deseado (`.resumen-sheet`). `vh` no se usa como nueva referencia fullscreen operativa salvo excepción documentada — no reproduce el viewport real en mobile.
- **Overflow y reflow:** `overflow-x-hidden`, `overflow-clip` y `overflow-hidden` no son estrategias responsive — solo se usan sobre contenido cuyo ancho ya está garantizado, nunca como red de contención de un layout que podría desbordar. Ningún dato funcional puede desaparecer, cortarse ni quedar inaccesible por falta de espacio. Cuando existe contenido desplazable debe existir una señal visual inequívoca de que hay más contenido (fade lateral, el siguiente ítem parcialmente visible, scrollbar, o equivalente) — `scrollbar-hide` no está prohibido, pero es inválido cuando deja al usuario sin ninguna otra señal de desplazamiento. **En una navegación (Tabs, SectionNav) una señal sola no alcanza:** "scrollbar oculta + fade" resultó insuficiente en el QA real de C7 (destinos importantes quedaron inaccesibles con mouse), así que además de señalar hay que ofrecer un mecanismo explícito — ver Components → Navigation → "Tabs nunca envuelve".
- **Métricas financieras:** `--metric-min` (96px) y `--kpi-min` (180px), definidos en `src/index.css`, son reservas mínimas de ancho para datos financieros — no anchos fijos ni un máximo soportado. Ver Typography → Named Rules → "La regla del dinero" para el comportamiento. Consumidos por `MetricGroup` (`ui/MetricGroup.tsx`, C7.5) vía `flex-basis`, no como `minmax()` de CSS Grid — ver Components → "Datos operativos".
- **Spacing:** escala default de Tailwind (múltiplos de 4px). Ritmo típico: `gap-2`/`gap-3` dentro de componentes, `space-y-4`/`space-y-6` entre bloques, `p-6` interno de cards. Valores arbitrarios `[Npx]` solo cuando un requisito real lo exige (anchos de columna, offsets de alineación), nunca como spacing general.
- **Toolbar + panel scrolleable:** toda sección que combine un toolbar de controles con un panel de contenido scrolleable se envuelve en un único card, con el toolbar como header separado por `border-b`. El wrapper usa `overflow:clip` — nunca `overflow:hidden` si contiene elementos `sticky` (hidden crea un contexto de scroll propio y rompe el sticky). [Regla vigente de AGENTS.md.]
- **z-index por bandas** (documentado en `src/index.css`): 0–20 capas locales (contenido de pantalla/módulo, incluida la sub-escala numérica de Agenda) · 40 chrome global overlay de Operate (sidebar mobile, su scrim, hamburguesa, backdrop de notificaciones) — nunca sticky de contenido, aunque quede fijo durante el scroll · 50 overlays Radix · 60–70 onboarding · 80 ghost de drag · 100 toasts. Agenda documenta una sub-escala dentro de la banda local, no un stacking context aislado (deuda D34 en DESIGN_BACKLOG.md). Ningún componente inventa valores fuera de las bandas, y dentro de una misma banda no puede haber dos elementos que necesiten orden entre sí.

## Elevation & Depth

Sistema de sombras de **tres niveles**, con la escala default de Tailwind (decisión formalizada):

### Shadow Vocabulary
- **Reposo** (`shadow-sm`): cards, pill activo de tabs, thumb de SegmentedControl.
- **Flotante** (`shadow-md`): popovers, dropdowns, selects, tooltips, hover de cards clickeables.
- **Modal** (`shadow-lg`): dialogs, sheets, DrawerForm, toasts.

La elevación responde a jerarquía de capa, no a importancia del contenido. El patrón correcto para cards interactivas es reposo `shadow-sm` → `hover:shadow-md` con `transition-shadow`. No existen sombras decorativas mayores (`shadow-xl`/`2xl` no forman parte del vocabulario).

## Shapes

**Tres radios, tres roles — y nada más:**

- **Controles** (`--radius` = 8px, `rounded-lg`): botones, inputs, chips de header, ítems de nav. Los derivados `md` (6px) y `sm` (4px) salen del mismo token.
- **Contenedores** (12px, `rounded-xl`): cards, dialogs, drawers, sheets. La jerarquía visual entre "un control" y "una superficie" depende de esta diferencia — no colapsarlos.
- **Tile de identidad** (`--radius-tile` = 10px): exclusivo del tile cuadrado ~40×40 de marca (logo del sidebar, ícono de PageHeader, tiles del resumen mensual). Es identidad, no un tercer radio genérico: prohibido fuera de ese rol. (El token está definido acá; su creación en CSS y la migración de los usos literales está en el backlog.)
- `rounded-full` para pills, dots y avatares.

**Bordes:** hairline de 1px con `--border`/`--input`. Sin radios arbitrarios nuevos sin función clara.

## Components

### Buttons
- **Forma:** `rounded-lg` (8px), altura 40px default (`h-9` sm / `h-11` lg), `text-sm font-medium`.
- **Primario:** navy sobre blanco; hover `bg-primary/90`.
- **Interacción:** `active:scale-[0.97]` + `duration-150 ease-out` — el "clic" físico de la app.
- **Variantes:** `outline` (borde `--input`, hover `--accent`), `ghost`, `destructive`, `link`. Lo destructivo vive en el botón de la acción, nunca en headers.

### Cards
- **Forma:** `rounded-xl`, borde hairline, `bg-card`, `shadow-sm`.
- **Título:** `text-lg font-medium` (ver Typography). Chip de header según la regla del chip.
- **Padding interno:** `p-6` (header `pb-4`).
- **Interactivas:** `hover:shadow-md transition-shadow`.

### Datos operativos — MetricGroup, RecordRow, Registro vs. Tabla comparativa (C7.5)

**`MetricGroup`** (`ui/MetricGroup.tsx`) presenta N métricas (etiqueta + valor) cuya cantidad de columnas surge del espacio real, nunca de `sm:`/`md:`/`lg:` ni JS. Implementación: `flex flex-wrap` + `flex-basis: var(--metric-min|--kpi-min)` — **no** CSS Grid `auto-fit`. Probado con datos reales: `repeat(auto-fit, minmax(var(--kpi-min), 1fr))` reparte el espacio con `1fr` sin mirar el contenido, y una cifra más ancha que su parte (`$1.234.567.890` en una fila de 3–4 columnas) queda más angosta que su propio texto y se solapa con la columna vecina — falla exactamente el baseline financiero que debía garantizar. Flexbox, sin tocar el `min-width: auto` por defecto de un flex item, nunca deja que uno encoja por debajo del ancho de su propio contenido: el wrap ocurre solo, sin ese riesgo. `size="metric"` (96px, `--metric-min`) para filas densas tipo Sueldos; `size="kpi"` (180px, `--kpi-min`) para cards con cifra destacada. No impone color, ícono ni énfasis de cada métrica — eso lo decide el consumidor.

**`RecordRow`** (`ui/RecordRow.tsx`) presenta una entidad operativa independiente (Tipo A — Registro) mediante tres zonas: identidad → métricas (típicamente un `MetricGroup`) → acciones. La identidad usa `min-w-0` y permite dos líneas — no depende de `title` ni trunca salvo que exista una interacción real (detalle, drawer) que revele el valor completo; si no existe esa interacción, no trunca. Las acciones son siempre visibles, `shrink-0`, nunca detrás de hover.

**Registro vs. Tabla comparativa — decisión semántica, no de código actual.** Tipo A (`RecordRow`): la fila es una entidad independiente con acción propia (un cierre de caja, un gasto, un pago). Tipo B (Tabla, `ui/table.tsx`): el valor está en comparar la misma columna entre filas. No se decide por cantidad de columnas ni por lo que el código ya hace hoy — un historial de cierres armado como cards puede seguir siendo Tipo A si cada fila es un evento auditable con su propia acción destructiva, aunque sus columnas también podrían compararse.

**Contrato de tabla comparativa** (`ui/table.tsx`, opt-in — `comparative?: boolean`, default `false`): sin la prop, `Table` es byte-idéntica a la primitiva anterior a C7.5 — es la rama que usan sus ~9 consumidores existentes (Admin, Sueldos → Resumen/Historial, Gastos, Gastos recurrentes), sin correr `useScrollAffordance` ni cambiar su markup. Con `comparative`, agrega sobre el wrapper `overflow-auto` existente la misma afordancia de fade de C7.4, inerte salvo que la tabla realmente desborde. Se hizo opt-in en la verificación de alcance previa a C7.6: la afordancia había quedado global-pero-inerte, y dos consumidores reales sin `min-width` (Sueldos, Gastos) podían desbordar por razones ajenas a ser comparativos y ganar la afordancia sin haber sido tocados — ver `docs/DECISIONES.md`. El consumidor `comparative` declara su propio `min-width` legible por columna — la primitiva no impone uno genérico. Scroll horizontal queda contenido en el wrapper local, nunca se propaga a scroll global de página. Primer consumidor productivo real (C7.6): Sueldos → Cierres de Caja (`SueldosPanel.tsx`), con `MetricDetailDialog`/`DonutDetailDialog` de Estadísticas como consumidores adicionales. Primera columna sticky: evaluada en Cierres de Caja, no implementada — no agregó valor suficiente sobre el scroll local ya afordado.

**Baseline financiero:** `$ 99.999.999` (8 dígitos) es el piso de QA, no un máximo — toda cifra usa `tabular-nums` + `whitespace-nowrap`, nunca trunca, nunca hace ellipsis. Ver Typography → Named Rules → "La regla del dinero" para el orden de resolución ante falta de espacio.

### Forms — DrawerForm es el canon
- **Toda alta/edición de entidad** usa `DrawerForm` (sheet lateral derecho: header fijo + body scroll + footer; anchos máximos sm 380 / md 520 / lg 680 — máximos deseados, no anchos obligatorios: ver Overlays más abajo) con React Hook Form + Zod y `isDirty` conectado (cerrar con cambios pide confirmación "¿Descartar cambios?"). Sin excepción por tamaño de operación: alta rápida y edición completa comparten contenedor.
- **Excepciones vigentes y nombradas** (no precedentes): el stepper de Cobrar, los wizards (`BackfillWizard`, importador de clientes) sobre Sheet, `PinConfigSection`, `ProductoPickerDialog`, `QuickApplyCard` (herramienta contextual de aplicación rápida de horarios dentro de Horarios — no es un flujo independiente de alta/edición, así que no adopta el contenedor).
- **Inputs:** `h-10 rounded-lg border-input bg-background`, foco `focus-visible:ring-2 ring-ring`, `text-base md:text-sm` (regla 16px).
- **Edición en el lugar** (detalle de cliente/turno, portal): secciones con `EditableSectionHeader` + un `useForm` por sección + exclusión mutua por un único puntero de estado.

**Obligatorio y opcional.** Un campo obligatorio no lleva ninguna marca (nada de asteriscos). Un campo opcional agrega `"(opcional)"` al final de su label. `*` para representar required está prohibido — es ambiguo sin una leyenda aparte y el sistema no la usa.

**Escala de `maxLength`.** Todo texto libre persistente declara un límite de la escala vigente, y el `maxLength` del HTML y el `.max()` de Zod se mantienen siempre sincronizados (nunca uno sin el otro):
- **80** — nombres, títulos breves (ej. nombre de servicio, nombre de sucursal).
- **120** — direcciones, emails, redes sociales y campos equivalentes de una línea.
- **240** — motivos, notas breves.
- **1500** — notas largas.

Esta escala es la guía por defecto, no una prohibición absoluta: un campo con una razón funcional explícita para otro límite puede apartarse, con esa razón dejada por escrito donde se declara el schema.

**Errores: inline vs. toast.** Un error de campo (obligatorio, formato inválido, fuera de rango) se muestra inline con `FormMessage`, nunca por toast. Un error de servidor, red o de negocio devuelto por el backend (constraint, conflicto, timeout) se muestra por toast (`sonner`). Un toast nunca sustituye el error de un campo específico.

**`EmptySelectHint`.** Un `Select` sin opciones disponibles nunca se muestra como un desplegable vacío: explica qué falta y, cuando corresponde, ofrece un CTA hacia dónde se crea o configura ese dato.

### Overlays — contrato físico (C7.3)
Todo overlay de Vittro (`DrawerForm`, `Dialog`, `AlertDialog`, `Popover`, `DropdownMenu`, `Select`, `Sheet`) entra siempre en el viewport **por construcción de la primitiva**, no porque cada consumidor recuerde protegerse. El consumidor puede pedir un tamaño más chico; nunca necesita agregar `max-h`, gutter u `overflow-y-auto` defensivo para evitar que el overlay se salga de pantalla — eso es responsabilidad de la primitiva base, no una protección opt-in.

- **Ancho:** `ancho = min(máximo deseado, viewport disponible − gutter)`. `DrawerForm` resuelve sus tres tamaños con esa fórmula sobre el mismo gutter de 48px que ya usaba en Compact — nunca `sm:` impone un ancho fijo que pueda superar la pantalla. `Dialog`/`AlertDialog` centrados usan gutter de 2rem (`w-[calc(100%-2rem)] max-w-lg`) — el mismo valor que un consumidor (`PortalCoverPositionDialog`) ya había resuelto a mano.
- **Alto:** `Dialog`/`AlertDialog` acotan a `max-h-[85svh]` con `overflow-y-auto` — `svh`, no `vh`, por la misma razón que drawers y sheets (Layout → Altura de viewport): estabilidad frente al chrome móvil. `Popover`/`DropdownMenu` leen la altura real que expone Radix (`--radix-popover-content-available-height` / `--radix-dropdown-menu-content-available-height`) en vez de asumir un máximo fijo, con `overflow-y-auto` propio.
- **Body scrolleable, header/acciones alcanzables:** `DrawerForm` ya separaba header fijo + body scroll + footer fijo (sin cambios). `Dialog`/`AlertDialog` no fuerzan esa partición en su DOM — sería una ruptura de API sobre ~90 consumidores — pero sí garantizan el límite exterior; un consumidor que necesita header/footer fijos propios (ej. `ProductoPickerDialog`) ya lo resuelve con `flex flex-col` + su propio scroll interno, sin que la primitiva se lo impida ni se lo exija.
- **Consumidor puede reducir, nunca necesita proteger:** cualquier `className` de ancho/alto que un consumidor ya pasaba (`max-w-2xl`, `max-h-[85vh]`, etc.) sigue funcionando igual — se fusiona sobre el default por Tailwind, nunca lo contradice. Las protecciones que ya existían no se retiraron (ver Backlog).
- **Safe areas y teclado virtual:** ya resueltos donde corresponden — `Sheet`/`DrawerForm` reservan `env(safe-area-inset-bottom)`. `Dialog`/`AlertDialog`/`Popover`/`DropdownMenu` no tocan el borde del viewport por diseño (gutter propio), así que no necesitan safe-area duplicado. El teclado virtual no se resuelve con lógica nueva: el contenedor scrolleable ya alcanza para que el navegador lleve el campo enfocado a la vista.
- **`Select`** ya cumplía el contrato (`max-h-96`, viewport interno de Radix, scroll buttons) — auditado, no tocado.

### Avisos al entrar — uno solo por entrada (4C)
Onboarding, resumen mensual y aviso semanal de Tareas son los avisos **automáticos** al entrar a Vittro. Los coordina `AvisosGlobalesProvider` (`src/components/avisos/AvisosGlobales.tsx`, reglas puras en `src/lib/avisosGlobales.ts`); un aviso nuevo de este tipo se suma al coordinador, nunca abre su propio overlay automático por fuera.

- **Prioridad fija:** onboarding > resumen mensual > Tareas. El de menor prioridad espera mientras uno de mayor prioridad no se resolvió.
- **Uno solo por entrada:** nunca dos a la vez ni encadenados (cerrar el resumen no abre el de Tareas); el que no tocó vuelve en una entrada posterior.
- **Nunca interrumpe:** no se abre encima de un `Dialog`/`Drawer`/PIN/menú/selector, con un campo en edición, con una acción guardándose, ni si la persona ya tocó o escribió en el contenido principal (`<main>`) — en ese caso queda para la próxima entrada.
- **Forma:** `.resumen-sheet` (sheet inferior en Compact, centrado desde 640px), encabezado y pie fijos, cuerpo con scroll propio. Escape, clic afuera y la X equivalen a "más tarde": un cierre accidental nunca lo da por resuelto. Nunca toast ni banner.

### Fecha y hora — `DatePicker` / `TimePicker`
Canon nuevo (C2): `DatePicker` y `TimePicker` (`ui/date-picker.tsx`, `ui/time-picker.tsx`) reemplazan el picker nativo del navegador/SO en formularios de Vittro. `input type="date"`/`type="time"` **no** es un patrón válido para código nuevo — los usos nativos que aún quedan son deuda de migración, no excepciones del canon (ver `DESIGN_BACKLOG.md`).

- **`DatePicker`** — valor interno `yyyy-MM-dd` (compatible directo con schemas y persistencia), presentación `dd/MM/yyyy`. Reutiliza el `Calendar` (react-day-picker) ya instalado. Parseo/formato siempre explícito con `date-fns` (`parse`/`format` con formato dado); `new Date("yyyy-MM-dd")` está prohibido por el riesgo de interpretación UTC/off-by-one.
- **`TimePicker`** — valor `HH:MM` como string libre. Ofrece sugerencias cada 15 minutos (el `SLOT_MIN` de Agenda) como ayuda, nunca como restricción: cualquier minuto válido (`09:10`, `14:37`) se tipea, se edita y se guarda tal cual — el componente no redondea ni normaliza un valor existente.
- **Presentación por plataforma, mismo componente**: desktop y tablet abren un `Popover`; mobile (<640px) abre el mismo cuerpo de selección dentro de un `Drawer`. Es un corte propio de estos dos componentes, no la política general de breakpoints de la app — tablet se comporta como desktop a propósito.

### Navigation — la regla jerárquica
- **Tabs (`variant="underline"`)** = **primer nivel** de navegación de un módulo: arriba, cerca del header, representando las grandes áreas (Finanzas, Mi Negocio, Turnos, Tareas).
- **SegmentedControl** (pill navy deslizante, contador integrado) = **segundo nivel / navegación contextual** dentro de la sección activa: filtros (Activos/Inactivos), subsecciones, vistas relacionadas.
- **Excepciones documentadas, no precedentes:** `ProductoDialog` (secciones de un mismo formulario con indicador de error por pestaña), `BackfillWizard` (modos de un paso de wizard) y `NotificationsBell` (No leídas/Leídas dentro de un Popover de 380px) usan Tabs pill fuera del rol de primer nivel. `AgendaPanel` (Día/3 días/Semana, toolbar de Agenda) usa `ToggleGroup` — es un selector de modo de vista, no navegación entre secciones, y por eso no es ni Tabs ni SegmentedControl.
- **Sidebar:** tile de logo navy, section labels uppercase 10px, ítem activo navy sólido. Su binding responsive sigue los modos de ventana (C7.2): **Compact** — drawer temporal con hamburguesa y scrim, se cierra solo al navegar. **Medium** — riel persistente de 64px, único estado disponible (sin hamburguesa, sin toggle, sin sidebar expandido): cada ítem muestra ícono + etiqueta compacta visible (rol Micro), nunca depende de `title`/hover. **Expanded** — sidebar persistente, colapsable a riel o expandido con un toggle exclusivo de este modo; el riel colapsado de Expanded sigue apoyándose en `title` para mouse, a diferencia del de Medium. El detalle de su coreografía vive en el código y en `docs/DECISIONES.md`.
- **Tabs nunca envuelve (C7.4, revisado en C7.10):** una `TabsList variant="underline"` es siempre una sola línea — nunca `flex-wrap`. Cuando no entra, la tira se vuelve horizontalmente scrolleable (`overflow-x-auto`, sin scrollbar nativa visible) y suma **controles direccionales explícitos** (chevrons izquierda/derecha, `ui/NavOverflowControls.tsx`): aparecen solo del lado donde queda contenido oculto, se ocultan (no quedan deshabilitados) al llegar al extremo, están también en touch/tablet, y **solo desplazan la tira — nunca activan un tab**. Cada toque pagina alineando un destino completo (el primero que no se ve hacia la derecha, el último que no se ve hacia la izquierda): nunca un salto fijo en píxeles ni un destino a medias contra el borde. Los controles se superponen al borde de la tira (no reservan ancho), viven **fuera** del `role="tablist"` como hermanos — orden DOM = orden de foco (flecha izquierda → tira → flecha derecha), sin `tabindex` — y llevan `aria-label` ("Mostrar opciones anteriores" / "Mostrar opciones siguientes"), `aria-controls` y un área táctil de ~44px vía `.hit-area-expand`. El degradé de `background` es únicamente el fondo del control, ya no una señal independiente; si la flecha enfocada desaparece, el foco pasa a la opuesta o al tab activo. La pestaña activa se lleva sola al área útil (completa y fuera de los chevrons) moviendo únicamente `scrollLeft` de la tira — nunca `scrollIntoView` ni el scroll de la página — y **solo cuando un tab realmente pasa a `active`** (o se agrega ya activo): ninguna otra mutación ni el scroll manual del usuario la reposicionan. Funciona igual con `Tabs` controlado y con `defaultValue`. El desplazamiento es suave, e instantáneo con `prefers-reduced-motion` (la regla global de motion no cubre el scroll). Semántica y foco de Radix sin cambios; la variante `pill` no participa de este contrato — no desborda su fila por diseño.
- **Tabs vs. SectionNav — semánticas distintas, nunca intercambiables:** Tabs cambia qué contenido está montado (navegación de primer nivel, ver arriba). `SectionNav` (`ui/SectionNav.tsx`) desplaza a una sección que ya está montada dentro de una página larga (Mi Negocio → General/Sucursal, Portal público) — mismo mecanismo de overflow que Tabs (`NavOverflowControls`, etiquetas "Mostrar secciones anteriores" / "Mostrar secciones siguientes"), pero es `<nav>` con botones que hacen `scrollIntoView` hacia la sección, no un `Tabs.Root`. No decide su composición por `hidden md:block` ni ningún breakpoint de viewport: responde al espacio real de su propia fila, igual en Compact que en Expanded — antes de C7.4 desaparecía por completo debajo de `md` (768px), dejando páginas largas sin navegación interna en mobile/tablet; ahora no. `SectionNav` sabe en qué sección está el usuario (`IntersectionObserver` contra los ids reales, `aria-current="location"` en el ítem activo) y mantiene ese ítem — y el ítem enfocado por teclado — completo y fuera de los chevrons dentro de su propia tira, moviendo solo su `scrollLeft`: nunca desplaza la página verticalmente ni altera la altura del `<nav>` (de ella depende el `rootMargin` del observer). El detalle de la medición vive en el código y en `docs/DECISIONES.md`.

### Centro de administración de plataforma

- **Shell aislado:** `AdminShell`, incluida su navegación lateral propia,
  conserva Inter, navy, tokens, focos y densidad de Operate, pero no reutiliza
  `AppSidebar` ni componentes que presuponen organización, sucursal, onboarding
  o suscripción tenant.
- **Navegación:** Resumen, Barberías, Usuarios, Suscripciones y Auditoría. Dentro
  de Suscripciones, `SegmentedControl` separa Planes, Suscripciones y Pagos como
  segundo nivel contextual.
- **Lectura responsive:** desktop y tablet priorizan tablas densas; mobile
  presenta cards equivalentes, sin ocultar significado ni acciones. Búsqueda,
  filtros y resultados forman un solo card con toolbar separado por `border-b`
  y wrapper `overflow:clip`.
- **Edición de precios:** siempre ocurre en `DrawerForm`, nunca inline. El drawer
  explicita importe, motivo, contraseña de confirmación e impacto antes de
  aplicar; el progreso y los resultados parciales del lote siguen visibles y se
  pueden reintentar.
- **Estados de lectura:** aplica sin excepción delayed skeleton, datos anteriores
  durante refetch, `InlineReadError` ante fallo sin datos y vacío real solamente
  después de una lectura exitosa.

### Status & Badges
- **StatusPill** es el canon de estado: `success/neutral/info/warning/error`, dot o ícono, 100% tokens `--status-*`.
- **TabBadge / contadores:** el contador vive dentro de `SegmentedControl` (integrado), no como badge suelto.
- **Badge** `sm` = 10px; ese es el piso tipográfico de badges.

### Loading — tres clases, tres patrones
La espera se resuelve según **qué** espera el usuario, no según qué componente tenés a mano.

1. **Loading de contenido** (una superficie todavía no tiene nada utilizable) → **Skeleton**, el patrón dominante. Debe **aproximar la geometría real** de lo que reemplaza: mismas filas, mismos anchos relativos, mismo contenedor. Un skeleton decorativo que no corresponde al layout final es peor que no tener skeleton — promete algo que no llega (ver el caso corregido en `docs/MODULOS/turnos-agenda.md`).
2. **Pending de acción** (guardar, crear, eliminar, procesar, enviar, importar, finalizar) → **spinner dentro del control + texto de progreso** ("Guardar" → "Guardando…"), control deshabilitado durante el ciclo completo (upload + persistencia, no la mitad). **Nunca skeleton para una acción.**
3. **Loading global branded** (`LoadingScreen`) → reservado al arranque, cuando el usuario espera a **Vittro como sistema**, no a una sección. Nunca dentro de una pantalla. Composición **V5 — Fila**: marca (`VittroMark`, sin `clamp` dominante) + divisor + mensaje en una fila horizontal (mobile: apila a columna, divisor rota a horizontal); el bloque crece hacia abajo dentro de esa misma columna de texto al aparecer aviso de demora, retry o el estado fatal — nunca recompone el eje marca↔texto. La marca reduce su protagonismo a propósito frente a versiones previas exploradas. Motion del loader (curvas, timings, entrada/salida) sigue sin tocar — pertenece a C11, no a esta composición estática.

**The Delayed-Skeleton Rule.** El skeleton no aparece instantáneamente: se muestra recién tras ~180ms vía `useDelayedVisible(isLoading)` (`src/hooks/useDelayedVisible.ts`). Si los datos llegan antes, se pasa directo al contenido y nunca hubo parpadeo. El delay gatea **solo la presentación**: no retrasa fetch ni impone duración mínima artificial al skeleton.

**The Silent-Refetch Rule.** El skeleton pertenece a la **primera** carga. Si ya hay contenido utilizable en pantalla, un refetch lo mantiene visible hasta que llegan los datos nuevos — nunca vuelve al skeleton. (Precedentes a preservar: el autosave del portal y el refetch al entrar a Cobrar.)

**Texto de carga suelto ("Cargando…") no es un patrón de superficie.** Sobrevive solo acompañando un loader especializado donde el contexto lo justifique.

**Composiciones compartidas:** `SkeletonRow` (`src/components/ui/SkeletonRow.tsx`) para listas de ítems previsibles — `leading` (`circle` | `bar` | `false`) y `lines` (1 | 2); el consumidor decide contenedor y cuántas repetir. Geometrías específicas (tablas, cards de config) se componen localmente con el primitivo `Skeleton`.

### Feedback
- **Toasts: `sonner` es el único sistema.** Posición bottom-right en la app, top-center en páginas públicas. No montar un segundo store de toasts jamás.
- **`src/lib/feedback.ts`** es el punto recomendado de invocación: `feedback.success/error/info(message, { description? })` sobre Sonner. Los cambios nuevos y las migraciones de código legacy lo usan; la migración de las llamadas directas a `sonner` ya existentes es progresiva, no retroactiva.
- Acciones con estados de envío visibles (disabled + spinner/texto) — cada acción tiene respuesta.

**Una lectura fallida nunca es un vacío.** Un fallo al leer datos no se renderiza jamás como si la entidad estuviera vacía — un empty state describe una ausencia real, no un problema de red o de servidor. Política (C4C.1):
- Intento inicial + hasta dos reintentos automáticos silenciosos, esperando 1 segundo y luego 5 segundos entre intentos. Cada intento individual tiene un timeout máximo de 10 segundos.
- El retry automático es exclusivo de errores transitorios demostrables (red, timeout, 408/429/5xx y equivalentes de Postgres/PostgREST). Errores de autenticación, autorización, RLS, permisos o validación fallan inmediatamente, sin reintentar.
- Mientras queden reintentos disponibles: sin toast, sin mensaje de error, sin falso empty state — se conserva el skeleton inicial o los datos anteriores, según corresponda.
- Si se agotan los intentos **sin datos previos**: error inline con "Reintentar" (`InlineReadError`), nunca un empty state.
- Si se agotan los intentos **con datos previos** (refetch): los datos se conservan en pantalla y se muestra un toast con acción "Reintentar".
- Superficies operativas críticas (hoy: Agenda y el resumen diario de Caja) pueden sumar una marca persistente y discreta de "datos desactualizados" (`StaleDataNotice`) sobre los datos conservados. La marca desaparece sola en cuanto una actualización posterior tiene éxito.
- Los errores técnicos nunca se muestran crudos (`e.message`); el mensaje al usuario siempre es una traducción humana y accionable.
- Un abort por desmontaje o por cambio de contexto (cambio de sucursal, de fecha, de organización) nunca es un error visible.
- Esta política es exclusiva de lecturas. Las escrituras y mutaciones no la usan.

### Empty States — dos niveles
- **Vacío de sección / primera vez** (la pantalla o card no tiene contenido real): patrón rico vía **`src/components/ui/EmptyState.tsx`** — `{ icon, title, description?, action?, className? }`. `icon` y `title` obligatorios. No impone contenedor (Card, dashed box, etc. los decide el consumidor) ni conoce roles/permisos/navegación — el `action` es un slot React libre que el consumidor arma con su propia lógica.
- **Vacío de filtro** (el segmento/tab activo no tiene resultados pero la entidad existe): una línea simple — `"No hay servicios inactivos"` — sin ícono ni ceremonia. Prohibido usar el patrón rico en cada filtro vacío.
- **`EmptyState` representa un vacío real y confirmado** — la lectura terminó, tuvo éxito, y la entidad efectivamente no tiene datos. Nunca representa una carga todavía pendiente (eso es Skeleton) ni un error de lectura (eso es `InlineReadError` — ver Feedback, "Una lectura fallida nunca es un vacío").

### PageHeader
Tile navy `--radius-tile` de 40px con ícono contextual (prop obligatoria, sin default) + `h1` headline + subtítulo `text-sm text-muted-foreground`. El subtítulo nunca referencia un período específico si la pantalla tiene filtros de rango (se desactualiza al filtrar).

### Kebab de fila
Trigger canónico: `h-7 w-7 rounded-md border-[0.5px] border-border` que abre `DropdownMenu`. Un botón con aspecto de kebab que no abre menú está prohibido (rompe la expectativa).

### Motion
- **Curvas:** `--ease-out-quint` (entradas) / `--ease-in-quint` (salidas) — las únicas dos del sistema.
- **Duraciones:** 140–220ms para micro-feedback y transiciones de estado; hasta ~420ms solo en secuencias de hito.
- **Vocabulario existente:** `item-in`, `pop-in`, `value-change`, `step-in-forward/back`, `overlay-show/hide`, `confirm-*` — reusar antes de inventar.
- **`prefers-reduced-motion` es global y obligatorio** para toda animación nueva.

## Do's and Don'ts

### Do:
- **Do** usar `focus-visible:ring-2 ring-ring` como único patrón de foco — visible para teclado, silencioso para mouse.
- **Do** contratar el área táctil por capacidad de puntero, no por tamaño visual. En `pointer: coarse`: ~44px de área interactiva como objetivo en acciones principales/frecuentes, 40px como piso recomendado — el control puede seguir midiendo 28–32px visualmente si el hit-area se amplía sin alterar la composición (la utilidad `.hit-area-expand` de `src/index.css`, no-op en `pointer: fine`, existe para eso — C7.1 la define, no migra consumidores). Controles secundarios: por frecuencia, importancia, densidad y contexto, no un tamaño universal. En `pointer: fine` puede conservarse mayor densidad visual/interactiva cuando sea apropiado.
- **Do** detectar capacidades de puntero (`hover`, `pointer`, `any-pointer`) para decisiones de interacción — nunca inferirlas del ancho (mobile = touch, desktop = mouse, tablet = hover son inferencias inválidas). Ejemplo real: la acción de renombrar terminal de `MpDevicesConfig.tsx` usaba `sm:opacity-0 sm:group-hover:opacity-100` (invisible por defecto en tablet táctil ≥640px, sin hover real que la revele) — corregido a `[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100` (arbitrary variant de Tailwind, sin dependencias nuevas): visible siempre por defecto, se reduce a hover-reveal solo donde el hover realmente existe.
- **Do** reservar la expresividad para hitos del negocio (cobro registrado, cierre de caja completado, turno creado): animación breve, memorable, nunca bloqueante — feedback reforzado, no decoración.
- **Do** escribir todo copy en rioplatense con voseo (verdad de PRODUCT.md; el tuteo es un bug).
- **Do** usar Lucide como único set de íconos (`h-4 w-4` en controles, `h-5 w-5`+ en énfasis).
- **Do** mantener el patrón `text-base md:text-sm` en todo control editable nuevo.
- **Do** gatear todo skeleton con `useDelayedVisible(isLoading)` — sin delay, una carga de 80ms produce un parpadeo peor que la espera.

### Don't:
- **Don't** usar clases de color directas de Tailwind (`green-600`, `amber-500`, `slate-*`) en la app interna — todo estado y neutro sale de tokens. (Homepage es la excepción de neutros.)
- **Don't** escribir variantes `dark:` nuevas — dark está congelado.
- **Don't** usar `overflow:hidden` en wrappers que contienen `sticky` — usar `overflow:clip`. Tampoco usar `overflow-x-hidden`/`overflow-clip`/`overflow-hidden` como estrategia responsive general: solo son válidos sobre contenido cuyo ancho ya está garantizado (ver Layout → "Overflow y reflow").
- **Don't** usar hover como único mecanismo para revelar o ejecutar una acción interactiva — puede enriquecer un elemento ya accesible, nunca ser la única forma de descubrirlo.
- **Don't** introducir radios, sombras, easings o z-index fuera de los vocabularios definidos.
- **Don't** montar un segundo sistema de toasts, tabs con contador propio, o cualquier duplicado de un patrón canónico existente.
- **Don't** usar el patrón rico de empty state en vacíos de filtro, ni la línea seca en primeras-veces de sección.
- **Don't** deshabilitar el zoom del navegador (`maximum-scale`) para esconder problemas tipográficos.
- **Don't** volver al skeleton en un refetch cuando ya hay contenido en pantalla, ni escribir un skeleton cuya geometría no corresponda al layout que va a aparecer.
- **Don't** usar el loader branded (`LoadingScreen`) dentro de una sección — es exclusivo del arranque global.
- **Don't** usar densidad como excusa para controles difíciles de tocar, ni convertir la metáfora del mostrador en decoración temática de barbería.
