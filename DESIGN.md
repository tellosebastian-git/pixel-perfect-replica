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

**Tres superficies, un núcleo.** La app interna (Operate), el portal público de
reservas (white-label del cliente final de cada barbería) y la homepage comercial
(Persuade) comparten un núcleo obligatorio — color de marca, tipografía Inter,
criterios de forma, foco y accesibilidad, calidad de interacción — y conservan
libertad de composición y densidad según su función. Las páginas de Auth
(Login/VerifyEmail/AuthCallback) **pertenecen al núcleo**: su micro-sistema
actual de valores propios es un gap conocido (ver DESIGN_BACKLOG), no un sistema
paralelo válido.

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

**Neutros por superficie.** La homepage puede usar su propia escala neutra (slate) como parte de su expresividad Persuade, siempre que el navy ancle las acciones clave y no construya una identidad de marca distinta. La app interna y Auth usan exclusivamente los neutros del sistema.

## Typography

**Única familia:** Inter (fallback `ui-sans-serif, system-ui`).

**Character:** una sola voz tipográfica, sin display font — la jerarquía se construye con tamaño y peso, no con cambios de familia. Sobria, densa y legible: tipografía de herramienta.

### Hierarchy
- **Headline** (600, 24px / `text-2xl`): título de página, solo dentro de `PageHeader`.
- **Title — card** (500, 18px / `text-lg`): título de card/contenedor en reposo. Peso medio **a propósito**: muchas cards conviven en pantalla y no deben competir entre sí.
- **Title — overlay** (600, 18px / `text-lg`): título de Dialog/DrawerForm/Sheet. Peso firme **a propósito**: el overlay es una tarea única enfocada y el título la ancla. La diferencia con el título de card es una regla intencional, no una inconsistencia.
- **Body** (400, 14px / `text-sm`): el texto de lectura de la app.
- **Label** (500, 12px / `text-xs`): labels, metadata, celdas densas, descripciones cortas de campo.
- **Micro** (600, 10px): exclusivo de badges, contadores y section labels uppercase del sidebar. Nada de texto de producto por debajo de 10px.

### Named Rules
**La regla de densidad legible.** 12px es válido donde el usuario **escanea** (tablas, listas densas, metadata, labels). 14px es el mínimo donde el usuario **lee** (descripciones, mensajes, explicaciones, empty states). La prioridad es densidad útil, no densidad máxima.

**La regla de los 16px en mobile.** Todo control editable que pueda recibir foco y abrir el teclado virtual (input, textarea, búsqueda, teléfono, número, componentes custom que enfocan un campo) usa `font-size` ≥ 16px en mobile — el patrón canónico es `text-base md:text-sm`, ya implementado en el `Input` base. Evita el auto-zoom de iOS Safari. Esta regla tiene prioridad sobre cualquier regla de densidad, y **nunca** se resuelve con hacks de viewport (`maximum-scale=1` está prohibido). Labels y helper text pueden seguir en 12px.

**La regla del label vs. heading.** Un título de bloque de formulario con **un solo control** es su `FormLabel` (nombre accesible), no un heading. Un bloque con **varios controles** lleva heading real (`h3` bajo el `h2` de sección) y cada control se nombra por su cuenta. No convertir todo a `FormLabel sr-only` (borra la navegación por encabezados) ni poner headings sobre campos únicos (doble anuncio en lector de pantalla).

## Layout

- **Contenedor de la app interna:** `max-w-7xl` centrado con padding lateral responsivo (`px-4 sm:px-6 md:px-8`). Excepción única: la Agenda usa ancho completo.
- **Densidad por superficie:** la app interna es densa y escaneable; la homepage respira como landing; el portal es una columna angosta centrada (max-w-md en landing de reserva).
- **Breakpoints:** el ancho gobierna **layout** (columnas, densidad, apilado); las capacidades táctiles se resuelven por media queries de capacidad (`pointer`, `hover`), no por ancho. Si JS necesita reaccionar al mismo corte que CSS, usa la misma condición — nunca dos números distintos contestando la misma pregunta. No introducir breakpoints nuevos sin razón clara. El corte dominante de la app es `sm:` (640px).
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

### Forms — DrawerForm es el canon
- **Toda alta/edición de entidad** usa `DrawerForm` (sheet lateral derecho: header fijo + body scroll + footer; tamaños sm 380 / md 520 / lg 680) con React Hook Form + Zod y `isDirty` conectado (cerrar con cambios pide confirmación "¿Descartar cambios?"). Sin excepción por tamaño de operación: alta rápida y edición completa comparten contenedor.
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

### Fecha y hora — `DatePicker` / `TimePicker`
Canon nuevo (C2): `DatePicker` y `TimePicker` (`ui/date-picker.tsx`, `ui/time-picker.tsx`) reemplazan el picker nativo del navegador/SO en formularios de Vittro. `input type="date"`/`type="time"` **no** es un patrón válido para código nuevo — los usos nativos que aún quedan son deuda de migración, no excepciones del canon (ver `DESIGN_BACKLOG.md`).

- **`DatePicker`** — valor interno `yyyy-MM-dd` (compatible directo con schemas y persistencia), presentación `dd/MM/yyyy`. Reutiliza el `Calendar` (react-day-picker) ya instalado. Parseo/formato siempre explícito con `date-fns` (`parse`/`format` con formato dado); `new Date("yyyy-MM-dd")` está prohibido por el riesgo de interpretación UTC/off-by-one.
- **`TimePicker`** — valor `HH:MM` como string libre. Ofrece sugerencias cada 15 minutos (el `SLOT_MIN` de Agenda) como ayuda, nunca como restricción: cualquier minuto válido (`09:10`, `14:37`) se tipea, se edita y se guarda tal cual — el componente no redondea ni normaliza un valor existente.
- **Presentación por plataforma, mismo componente**: desktop y tablet abren un `Popover`; mobile (<640px) abre el mismo cuerpo de selección dentro de un `Drawer`. Es un corte propio de estos dos componentes, no la política general de breakpoints de la app — tablet se comporta como desktop a propósito.

### Navigation — la regla jerárquica
- **Tabs (`variant="underline"`)** = **primer nivel** de navegación de un módulo: arriba, cerca del header, representando las grandes áreas (Finanzas, Mi Negocio, Turnos, Tareas).
- **SegmentedControl** (pill navy deslizante, contador integrado) = **segundo nivel / navegación contextual** dentro de la sección activa: filtros (Activos/Inactivos), subsecciones, vistas relacionadas.
- **Excepciones documentadas, no precedentes:** `ProductoDialog` (secciones de un mismo formulario con indicador de error por pestaña), `BackfillWizard` (modos de un paso de wizard) y `NotificationsBell` (No leídas/Leídas dentro de un Popover de 380px) usan Tabs pill fuera del rol de primer nivel. `AgendaPanel` (Día/3 días/Semana, toolbar de Agenda) usa `ToggleGroup` — es un selector de modo de vista, no navegación entre secciones, y por eso no es ni Tabs ni SegmentedControl.
- **Sidebar:** rail colapsable con tile de logo navy, section labels uppercase 10px, ítem activo navy sólido. El detalle de su coreografía vive en el código y en `docs/DECISIONES.md`.

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
- **Do** dar a acciones principales y frecuentes en táctil targets cómodos (→44px cuando el contexto lo permita); en controles secundarios de listas densas, ampliar el **área táctil real** más allá del ícono visible.
- **Do** reservar la expresividad para hitos del negocio (cobro registrado, cierre de caja completado, turno creado): animación breve, memorable, nunca bloqueante — feedback reforzado, no decoración.
- **Do** escribir todo copy en rioplatense con voseo (verdad de PRODUCT.md; el tuteo es un bug).
- **Do** usar Lucide como único set de íconos (`h-4 w-4` en controles, `h-5 w-5`+ en énfasis).
- **Do** mantener el patrón `text-base md:text-sm` en todo control editable nuevo.
- **Do** gatear todo skeleton con `useDelayedVisible(isLoading)` — sin delay, una carga de 80ms produce un parpadeo peor que la espera.

### Don't:
- **Don't** usar clases de color directas de Tailwind (`green-600`, `amber-500`, `slate-*`) en la app interna — todo estado y neutro sale de tokens. (Homepage es la excepción de neutros.)
- **Don't** escribir variantes `dark:` nuevas — dark está congelado.
- **Don't** usar `overflow:hidden` en wrappers que contienen `sticky` — usar `overflow:clip`.
- **Don't** introducir radios, sombras, easings o z-index fuera de los vocabularios definidos.
- **Don't** montar un segundo sistema de toasts, tabs con contador propio, o cualquier duplicado de un patrón canónico existente.
- **Don't** usar el patrón rico de empty state en vacíos de filtro, ni la línea seca en primeras-veces de sección.
- **Don't** deshabilitar el zoom del navegador (`maximum-scale`) para esconder problemas tipográficos.
- **Don't** volver al skeleton en un refetch cuando ya hay contenido en pantalla, ni escribir un skeleton cuya geometría no corresponda al layout que va a aparecer.
- **Don't** usar el loader branded (`LoadingScreen`) dentro de una sección — es exclusivo del arranque global.
- **Don't** usar densidad como excusa para controles difíciles de tocar, ni convertir la metáfora del mostrador en decoración temática de barbería.
