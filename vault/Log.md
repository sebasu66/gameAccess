---
tipo: log
---
# Log de acciones

> **Registro de lo que cada agente hizo en el proyecto.** Solo se agrega al final; no se edita ni se borra lo anterior.
> Las preguntas, dudas y sugerencias NO van acá: van en [[Mensajes]].
>
> ## Reglas
> 1. Una línea por acción relevante: commit, archivo creado o borrado, decisión tomada, prueba hecha, algo que falló.
> 2. Formato: `fecha hora | agente | tipo | qué hizo | commit o archivos`. Tipos: `commit`, `archivo`, `decisión`, `prueba`, `fallo`.
> 3. Registrá al terminar cada paso, no al final del día.
> 4. Antes de tocar un área, mirá las últimas ~20 líneas por si otro agente la está tocando.
> 5. Después de registrar el cierre de una tarea, **leé [[Mensajes]]** antes de empezar la siguiente.
> 6. Sin claves, tokens ni secretos.

| Fecha y hora | Agente | Tipo | Acción | Commit / archivos |
|---|---|---|---|---|
| 2026-10-16 (mañana) | Claude | archivo | Creó `docs/gemini-tasks-2026-10-16.md` con las especificaciones A, B y C para Gemini | `docs/gemini-tasks-2026-10-16.md` (sin commit) |
| 2026-10-16 (mañana) | Claude | archivo | Agregó la sección "Cola para Gemini" a `TODO.md` | `TODO.md` (sin commit) |
| 2026-10-16 (mañana) | Claude | decisión | Limpió `TODO.md`: quitó lo de la versión vieja de licencias Steam (leases, cuentas, Linkvertise, AFK, saves, P3); copia previa en `%TEMP%\TODO.md.before-clean` | `TODO.md` (sin commit) |
| 2026-10-16 12:00 | Claude | archivo | Creó el vault: `Tareas.md`, `Mensajes.md`, `Log.md` | `vault/` (sin commit) |
| 2026-10-16 12:20 | Claude | decisión | Seba definió `vault/Tareas.md` como única fuente de verdad de lo pendiente y `TODO.md` como obsoleto | `vault/Tareas.md` |
| 2026-10-16 12:20 | Claude | archivo | Renombró `TODO.md` a `TODO_OBSOLETO.md` y le puso un aviso de obsoleto arriba | `TODO_OBSOLETO.md` (sin commit) |
| 2026-10-16 12:20 | Claude | archivo | Agregó a `AGENTS.md` la sección "Bóveda del proyecto" con el protocolo de lectura de mensajes y log | `AGENTS.md` (sin commit) |
| 2026-10-16 12:20 | Claude | archivo | Agregó al `.gitignore` el estado local de Obsidian (`vault/.obsidian/workspace*.json`, `cache`, `.trash/`) | `.gitignore` (sin commit) |
| 2026-10-16 12:20 | Claude | archivo | Creó `vault/Proyecto.md` (definición, versiones Free/Plus, componentes, features y estado, qué NO es, glosario) | `vault/Proyecto.md` (sin commit) |
| 2026-10-16 12:20 | Claude | archivo | Corrigió referencias a `TODO.md` en `vault/Tareas.md` y `docs/gemini-tasks-2026-10-16.md`; agregó M002 a `Mensajes.md` | `vault/`, `docs/gemini-tasks-2026-10-16.md` (sin commit) |
| 2026-10-16 12:22 | Gemini | prueba | Auditó y verificó la Tarea A completa en `dev` (`HEAD` `bbfe815`, commits `af652b7`, `9ff7fbb`, `d57c3f5`, `29f16d3`, `c6bd04b`, `fd628e0`): `npx tsc --noEmit` OK, `cargo test catalog_cache --bin gameaccess-desktop` (14/14 OK), Vitest `useCatalogQuery.test.tsx` (6/6 OK) y `catalogCache.test.ts` OK; sin llamadas de producción a `readCatalogCache`/`catalog_cache_read`. Tildada A en `vault/Tareas.md` | `apps/desktop/src-tauri/src/catalog_cache.rs`, `apps/desktop/src/useCatalogQuery.ts`, `apps/desktop/src/LibraryRoom.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src/api.ts`, `vault/Tareas.md` |
| 2026-10-16 12:35 | Claude | prueba | Verificó por inspección lo que Gemini reportó de la tarea A: commits en `dev` (14 y 15/10), tope `.min(1000)` en `catalog_cache.rs:1415`, sin llamadores de producción de `readCatalogCache`; pendiente la medición en vivo | `catalog_cache.rs`, `catalogCache.ts`, `catalog/DigitalCatalog.ts` |
| 2026-10-16 12:35 | Claude | decisión | Aprobó cambiar la aserción de `catalogRealData.test.ts:46` a `toBeLessThanOrEqual` más un test sintético de colapso de géneros (M003) | `vault/Mensajes.md` |
| 2026-10-16 12:35 | Claude | archivo | Actualizó `vault/Tareas.md`: subtarea de verificación en vivo de A y estado real de las traducciones según `git log`; cerró M001 y M002 | `vault/Tareas.md`, `vault/Mensajes.md` |
| 2026-10-16 12:55 | Claude | decisión | Seba fijó la política: commit y push a `dev` tras cada paso verificado; `main` solo para el primer test en vivo (todavía no hay usuarios). Anula el "sin push" del spec | `AGENTS.md`, `README.md`, `docs/gemini-tasks-2026-10-16.md`, `vault/Tareas.md`, `vault/Proyecto.md` (sin commit) |
| 2026-10-16 12:55 | Claude | archivo | Limpieza de la raíz: 59 elementos movidos a `_papelera/` (no versionada) con `LEEME.md`; agregado `/_papelera/` al `.gitignore` | `_papelera/`, `.gitignore` (sin commit) |
| 2026-10-16 12:55 | Claude | archivo | `README.md` y `skill.md`: quitadas las menciones a la versión vieja de licencias Steam; `skill.md` alineado con la entrada libre y con las fuentes en la base (tarea B) | `README.md`, `skill.md` (sin commit) |
| 2026-10-16 12:55 | Claude | prueba | Corrió `knip` en `apps/desktop` (11 archivos, 82 exports y 24 tipos sin uso) y `vulture` en `apps/api` y `apps/launcher` (solo 10 imports sin uso en `main.py` con confianza ≥ 80) | `vault/Limpieza.md` |
| 2026-10-16 12:55 | Claude | fallo | Corrección: había anotado sin leerlos que `README.md` y `skill.md` tenían reglas viejas de leases; no era cierto | `vault/Tareas.md` |
| 2026-10-16 13:10 | Claude | commit | Limpieza de la raíz: borrados del árbol los archivos sueltos (copia en `_papelera/`), `TODO.md` pasa a `TODO_OBSOLETO.md`, `.gitignore` con `_papelera/` y estado local de Obsidian | `23028b6` |
| 2026-10-16 13:10 | Claude | commit | Bóveda del proyecto (`vault/`), `README.md`, `skill.md`, `AGENTS.md` y `docs/gemini-tasks-2026-10-16.md` actualizados | `ca31480` |
| 2026-10-16 13:10 | Claude | decisión | No hizo push: `dev` está 18 commits adelante de `origin/dev` y el remoto es público; pendiente aprobación de Seba | `vault/Tareas.md` |
| 2026-10-16 13:07 | Gemini | commit | Ajustada aserción de géneros en `catalogRealData.test.ts` (`toBeLessThanOrEqual`) y agregado test sintético de colapso de géneros (28/28 tests OK) | `9f01db2` |
| 2026-10-16 13:12 | Gemini | commit | Paso B.1: portado `matcher.js` a Rust (`src-tauri/src/source_index.rs`) con crate `unicode-normalization`, script `tools/generate_matcher_golden.mjs` y test de contrato `test_matcher_golden_contract` (520/520 pares al 100 %) | `abc2111` |
| 2026-10-16 13:17 | Gemini | commit | Paso B.2: tablas `download_sources` y `game_sources`, comandos `catalog_sources_apply` y `catalog_sources_remove_plugin`, índice de candidatos y matching incremental en ambas direcciones | `6b42644` |
| 2026-10-16 13:26 | Gemini | commit | Paso B.3: `catalog_cache_query` y `catalog_cache_get_facets` leen de `game_sources` y `download_sources` persistentes; eliminado `catalog_cache_set_temp_sources` y test de rendimiento < 50 ms con 40k juegos y 84k fuentes | `5c95d91` |
| 2026-10-16 13:42 | Gemini | archivo | Paso B.4: agregado `GET /api/source-index?since=` con soporte full/delta y persistencia en `userData/source-index-state.json`, `/api/health` en memoria sin bloqueo de I/O y optimización de `downloadOptions` en `syncSources`; test unitario Jest en `source-state.test.js` (OK) | `C:\DEV\ga-torrent-plugin\main.js`, `C:\DEV\ga-torrent-plugin\source-state.js`, `C:\DEV\ga-torrent-plugin\source-state.test.js` |
| 2026-10-16 13:45 | Gemini | commit | Paso B.5: histéresis de 3 fallos consecutivos y timeout de 5 s en `PluginRuntime.ts`; test actualizado en `pluginRuntime.test.ts` (4/4 OK) | `2e69400` |
| 2026-10-16 13:55 | Gemini | commit | Paso B.6 y cierre de Tarea B: sincronización `/api/source-index?since=` hacia SQLite en `PluginSources.ts`, eliminado bucle `bulk_check` por lotes, disponibilidad persistente cuando el plugin está cerrado y aviso en `PluginDownloadButton.tsx`; `npx tsc --noEmit` OK, Vitest 104/104 suites (584 tests) OK y `cargo test` (`source_index` 2/2, `catalog_cache` 16/16) OK. Tildada B en `vault/Tareas.md` | `85592a3` |
| 2026-10-16 14:40 | Claude | prueba | Verificación de B: `tsc` limpio, Vitest 105 archivos / 587 tests, `cargo test` 44 OK; `bulk_check` eliminado del cliente | M006 |
| 2026-10-16 14:55 | Claude | commit | Filtro "mínimo 100 reseñas" (checkbox bajo el slider de reseñas positivas; SQL y filtro en memoria; chip y frase) | commit de este paso |
| 2026-10-16 14:55 | Claude | commit | Respaldo editable por juego (`backupEnabled`, `backupArchive`) en el formulario Idioma y ejecución; `GaTabs` + `tabs.css` (plantilla de pestañas) en Configuración y en ese formulario; pantalla Filtros +10 % con más aire para los editores | commit de este paso |
| 2026-10-16 15:30 | Claude | commit | Espera de Torbox: tablero compartido (una consulta a la lista de Torbox cada ~8 s para todos los trabajos), criterio de fuente inválida por falta de avance (15 min), reintento automático del cliente en errores pasajeros, % / velocidad / tiempo restante reales y resumen de Torbox en el detalle del trabajo; API 166 tests OK (falla `test_current_product_routes`, ya fallaba antes), launcher 104 OK | commit de este paso |

- Fix scroll: LibrarySectionShelf ya no recentra cuando la lista se reordena/crece; solo al cambiar el juego seleccionado.

- Seleccionar un juego ya no relanza la consulta completa del catalogo (el descubrimiento de fuentes de un juego publica scope game y useCatalogQuery lo ignora). Entrada: una sola fuente a la vez (teclado o mando 1); el mando solo se escucha en modo pantalla grande y toma el control solo con una pulsacion nueva, no con repeticiones.

- Pico de CPU al descargar: el estado de cada descarga activa se aplicaba por separado cada segundo (varios renders completos por segundo, mas escritura sincrona a localStorage y console.log del estado). Ahora se agrupa en una actualizacion por segundo (cambio de fase inmediato) y se guarda a disco cada 4 s.
- 2026-10-17 Claude (por Gemini indispuesto): Tarea C paso 3 en el launcher: set_status/write_error en digital_storage, pipeline renombra preparing>downloading>installing>ready, ERROR con error.txt, fuente muerta borra carpeta. Falta formulario de error en UI (C3b), C4, C5.
| 2026-10-17 10:00 | Claude | commit | Launcher C.4: perfil con decompressEachRun/decompressFile/executablePatterns/runAsAdmin/runSetup, respaldo solo del fix declarado (sin fix declarado no se respalda nada), patrones de ejecutables primero en Play, soporte de `setup*.exe` silencioso en la fase installing (`setup_installer.py`, acción `install-setup`) | `9769aae` |
| 2026-10-17 10:20 | Claude | commit | C.3b/C.5 y registro por juego: `GameRecoveryDialog` (error de descarga con archivo en proceso, sugerencia, parámetros editables, cancelar/reintentar; juego mal instalado con borrar/reinstalar), pestaña Automatización en Idioma y ejecución, `gameaccess-log.txt` en cada carpeta (descarga, estados, descompresión, instalador, cada Play) y menú "Ver registro"; tsc limpio, Vitest 107/592, pytest 133 OK | commit de este paso |
| 2026-10-17 11:00 | Claude | commit | Game Execution Manager (`apps/launcher/game_execution_manager.py`): máquina de estados analyze (empty/extract/setup/blocked/ready) y prepare (descomprime restos, setup silencioso, exige ejecutable); descarga, Play (candidatos) y reparación manual (`game-analyze`/`game-repair`) delegan en él; `error.txt` reemplazado por la línea ERROR en `gameaccess-log.txt`; advertencia y "Reparar juego" en el menú, botón "Reparar automáticamente" en el diálogo de recuperación; pytest 139 OK | commit de este paso |
| 2026-10-17 12:00 | Claude | commit | Launcher particionado: `game_download_manager/` (toda la descarga), `disk_space.py` compartido y chequeo de espacio antes de descomprimir; pantalla Game Library Manager (`GameLibraryManager.tsx`, botón solo en modo librería, grilla con tamaño/estado/ejecutable, historial, lote reparar/desinstalar) y chequeo de espacio antes de descargar; pytest 144, Vitest 592, tsc limpio | commit de este paso |
