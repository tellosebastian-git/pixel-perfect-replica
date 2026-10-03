# CLAUDE.md — Vittro

Leé primero `AGENTS.md` en la raíz del repo. Ese archivo tiene el contexto completo del proyecto (qué es, reglas de multi-tenant, reglas de diseño, proceso de fases, y la obligación de actualizar `docs/` después de cada build). Es la fuente compartida entre todas las herramientas de IA que trabajan en este repo — no la dupliques acá.

Esto es lo específico de Claude Code:

- Slash commands disponibles en este proyecto: `/impeccable`, `/vittro-ui-patterns`. Usarlos para builds de UI y trabajo visual de precisión.
- Antes de cerrar cualquier build, verificar con `bunx tsc --noEmit` que no se rompió el tipado.
- Este entorno se usa para builds de UI. Cambios de base de datos, RLS o seguridad van por Lovable, no por acá.
