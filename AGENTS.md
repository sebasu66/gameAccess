# GameAccess agent rules

Before changing this repository, read `docs/EXECUTION_PROTOCOL.md`, `skill.md`, and the relevant project documentation.

## Bóveda del proyecto (obligatoria)

La carpeta `vault/` (se abre con Obsidian) es la fuente de verdad del proyecto. Si `README.md`, `skill.md` o `docs/` la contradicen, manda la bóveda.

- `vault/Proyecto.md`: qué es Game Access y qué features busca. Leelo primero.
- `vault/Tareas.md`: lista de tareas y su estado. Es la **única** fuente de verdad de lo pendiente; `TODO_OBSOLETO.md` no tiene validez.
- `vault/Mensajes.md`: comunicación entre agentes (preguntas, respuestas, sugerencias). Leelo **al empezar, al terminar cada tarea y entre una tarea y la siguiente**; actualizá tu fila de "Estado de lectura" y respondé lo que esté abierto para vos.
- `vault/Log.md`: registrá cada acción relevante (commit, archivo, decisión, prueba) al terminar cada paso. No se usa para preguntas.

Al cerrar una tarea: tildarla en `Tareas.md`, registrar el commit en `Log.md` y leer `Mensajes.md` antes de empezar la siguiente.

## Diseño de la interfaz (obligatorio para cambios visuales)

Antes de crear o cambiar pantallas, diálogos, paneles o botones de `apps/desktop`, leé `docs/GUI_DESIGN.md` (tokens, componentes y lista de comprobación) y usá la skill `.claude/skills/gameaccess-gui-design`. La ficha de juego es la referencia visual. Un solo botón de cierre (`ga-close`), acciones principales en naranja, botones de una fila con la misma altura, paneles de vidrio con borde degradado.

## Local and remote development workflow

GameAccess uses `dev` for development and `main` for stable releases. Work on the existing `dev` branch; do not create a branch or worktree for each task. Do not delete historical branches or move work into `main` without an explicit request.

**Local agents with direct filesystem access work locally first.** Inspect the checkout and remote state, edit files directly in the existing checkout, build/run/test locally, then commit and push the verified changes on `dev`. AI_Local_Access / monigote is optional for local execution, not a prerequisite for editing.

**GitHub-first applies only to remote agents without direct filesystem access.** Author changes on the existing GitHub `dev` branch, commit/push them, synchronize that commit through AI_Local_Access / monigote, then build/run/test on the user's working copy. Do not create a new branch for routine work or rewrite source through ad-hoc monigote payloads.

For both workflows:

- Commit and push every verified step to `dev`. There are no users yet: `main` is only updated when Seba decides the project is ready for its first live test.
- Preserve pre-existing user changes and private configuration. Never discard or overwrite them while synchronizing.
- Inspect branch divergence before pulling or pushing; reconcile safely without force pushes.
- Stage only files belonging to the task, not unrelated dirty or untracked files.
- Report the exact tested commit and any subsequent untested changes. A build alone is not runtime or visual acceptance.
