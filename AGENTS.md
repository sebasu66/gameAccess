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

### Plantillas de diseño — los tres niveles (política de Seba, 2026-11-05; reafirmada 2026-11-19)

**Toda vista de la aplicación, sin excepción, se arma con los tres niveles de estilo.** No es una recomendación ni algo
para «pasarle después»: una vista nueva o tocada nace así, desde el primer commit. Es lo que evita que haya estilos de
interfaz distintos entre pantallas, y lo que evita los bordes, los rellenos, los márgenes, la distribución y el
alineamiento improvisados. Esto es una aplicación profesional.

1. **Nivel general:** los componentes de `components/ga` y las clases de `components/ga/content.css`
   (`ga-stack`, `ga-group`, `ga-settings-group`, `ga-label`, `ga-hint`, `ga-status`, `ga-heading`, `ga-actions`,
   `ga-path-control`, `ga-style-toggle`, `ga-disclosure`, `GaAccordion`, `GaSwitch`, `GaButton`, `GaClose`…).
   Si una pieza ya existe, se usa tal cual. Si falta, **se agrega a este nivel**, no en la pantalla.
2. **Nivel del sabor:** `templates/flavor-terminal.css` (y los sabores numerados). Ahí viven los colores, las letras y
   los roles visuales. Una vista nunca elige un color ni una fuente: lee un rol.
3. **Nivel específico:** un CSS propio de la pantalla **solo con distribución** (grillas, posiciones, qué va al lado de
   qué). Ni colores, ni fuentes, ni radios, ni márgenes, ni altos de control escritos a mano: todo sale de
   `templates/base.css` (medidas y estructura) o del sabor (aspecto). Si falta una variable, se agrega a esa capa.

**Cómo se nota que está mal hecho** (y por qué se revisa antes de dar algo por terminado): una etiqueta en negrita
pegada arriba de un campo, campos de anchos distintos en la misma columna, separaciones que cambian de una sección a la
otra, una vista que no carga los mismos ajustes que las demás porque sus clases solo están definidas dentro de otro
contenedor. Un campo es siempre **nombre arriba en `ga-label`, control abajo, los dos del mismo ancho** (`ga-path-control`).

**Coherencia entre vistas parecidas:** una vista de detalle nueva se parece a las que ya hay. Los encabezados de sección
del detalle del Manager usan la misma letra, el mismo ámbar y el mismo tamaño de ícono que los paneles de la ficha de
juego (§4.43 y §4.50), porque son la misma familia.

**Se controla:** la pantalla nueva entra en `templates/flavor.test.ts`, y `npm run check:css` y `npm run check:i18n`
pasan. Mirá el resultado en la vista previa antes de darlo por hecho.

**Animaciones (Seba):** en Game Access, ignorá la preferencia de movimiento reducido del sistema. No desactives ni atenués animaciones por `prefers-reduced-motion`.

## Local and remote development workflow

GameAccess uses `dev` for development and `main` for stable releases. Work on the existing `dev` branch; do not create a branch or worktree for each task. Do not delete historical branches or move work into `main` without an explicit request.

**Local agents with direct filesystem access work locally first.** Inspect the checkout and remote state, edit files directly in the existing checkout, build/run/test locally, then commit and push the verified changes on `dev`. AI_Local_Access / monigote is optional for local execution, not a prerequisite for editing.

**GitHub-first applies only to remote agents without direct filesystem access.** Author changes on the existing GitHub `dev` branch, commit/push them, synchronize that commit through AI_Local_Access / monigote, then build/run/test on the user's working copy. Do not create a new branch for routine work or rewrite source through ad-hoc monigote payloads.

For both workflows:

- Commit and push every verified step to `dev`. There are no users yet: `main` is only updated when Seba decides the project is ready for its first live test.
- Preserve pre-existing user changes and private configuration. Never discard or overwrite them while synchronizing.
- Inspect branch divergence before pulling or pushing; reconcile safely without force pushes.
- Stage only files belonging to the task, not unrelated dirty or untracked files.
- Every library has an exact version (Seba, 2026-10-27): npm without `^`/`~` (`.npmrc` has `save-exact=true`), Cargo with `=x.y.z`, Python with `==` (indirect ones in `apps/launcher/requirements.txt` and `apps/api/constraints.txt`), CI installs with `npm ci` and pinned tools. Updating a library is its own tested commit.
- Report the exact tested commit and any subsequent untested changes. A build alone is not runtime or visual acceptance.
