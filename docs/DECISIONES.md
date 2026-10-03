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
