# Tareas para Gemini — 2026-10-16

> Especificaciones escritas por Seba y Claude. Claude revisa los commits después.
> Estado y seguimiento en `vault/Tareas.md`; comunicación con Claude en `vault/Mensajes.md` (leerlo al empezar y entre tareas). Definición del proyecto en `vault/Proyecto.md`.
> Antes de empezar cada tarea, mirá `git log` en `dev`: algo puede estar hecho a medias.

## Reglas para todas las tareas

- Una sola rama (`dev`), commits chicos (uno por paso) **con push a `dev` después de cada paso verificado**, sin ramas ni PR intermedios. Todavía no hay usuarios: `main` solo se actualiza cuando Seba decide el primer test en vivo.
- No tocar `apps/desktop/public/brand/logo-opening.mp3`.
- Mantener paleta, efecto glass y fondo pixelado animado; textos simples en español (i18n es/en cuando haya texto nuevo).
- Tras cada paso: `npm test` y `npx tsc --noEmit` en `apps/desktop`, `cargo check` en `src-tauri`, y tests Python del launcher si se toca `apps/launcher`.
- Game Access es una herramienta genérica y extensible por plugins: la secuencia concreta de cada juego (pasos, parámetros, admin, idioma) viene del perfil del plugin o del formulario del usuario, no se hardcodea.

Orden recomendado: A (catálogo) → B (fuentes en la base, depende de A) → C (instalación). C es independiente y puede ir en paralelo.

---

## A. Catálogo sin cargar los ~39.000 juegos en memoria

**Problema (medido):** el cliente usa ~1,7 GB y ~85 % de un núcleo en dev. Causa: `catalog/DiscoveryCatalog.ts` → `readCatalogCache()` invoca `catalog_cache_read` y trae TODOS los juegos al JS; `DigitalCatalog.readCatalog` los copia varias veces (rawRecords Map, `digitalDownloadService.registerRecords`, `normalizeGames`, `applyBundledCatalogArtwork`, `cachedGames`) y `App.tsx` los guarda en `games`; cada `setGames` rehace listas de 39k.

**Ya existe, NO reescribir:** Rust `catalog_cache.rs` con `catalog_cache_query` (query, genres, features, sources, has_downloads, language, sort_by, sort_direction, limit (def. 60), offset), `catalog_cache_get_facets`, `catalog_cache_set_temp_sources`, `catalog_cache_sync` (revision/base_revision) y los wrappers `queryCatalogCache`, `setCatalogTempSources`, `getCatalogFacets` en `src/catalogCache.ts` (con tests). Hoy la UI casi no los usa.

**Decisión de producto:** tope de resultados por búsqueda/filtro (~1000); sin búsqueda se muestra el top por popularidad; filtros por defecto prendidos pero fáciles de quitar (rating mínimo 6 y antigüedad máxima ~1 año); aviso corto bajo el buscador cuando se excede el tope; mostrar igual cuántos juegos hay en el catálogo.

Pasos:
1. Rust: extender `CatalogQueryParams` con `min_rating` (f32, opcional), `max_age_days` (opcional) e `include_recent_unrated` (solo ocultar juegos con algunas reseñas y más de 1 mes de salida; los lanzamientos recientes sin reseñas no se ocultan). `catalog_cache_query` devuelve `total` real (antes del LIMIT) y aplica tope duro `limit <= 1000`. Tests unitarios Rust.
2. Rust: `catalog_cache_query` acepta `app_ids: Option<Vec<i64>>` (biblioteca, favoritos, juegos con fuente) y `sort_by` de popularidad por defecto sin búsqueda.
3. TS: hook `useCatalogQuery` (en `src/`) que llama a `queryCatalogCache` con debounce (~250 ms) según búsqueda, filtros, orden y ventana (~70 juegos), cancelando respuestas viejas; devuelve `{items, total, capped}`.
4. TS: la grilla (`LibraryRoom`/`DownloadCatalogPanel`) usa solo `items` del hook; quitar sorts/filtros en memoria de `App.tsx` sobre la lista grande. Mostrar "39.000 juegos en el catálogo" y, si se excede el tope: "Más de 1000 resultados: mostrando los primeros 1000. Afiná la búsqueda." (i18n es/en).
5. TS: `DiscoveryCatalog.loadDiscoveryCatalog`/`DigitalCatalog.readCatalog` NO traen la lista completa: solo sincronizan (`syncCatalogCache`) y devuelven conteo/revisión; las demás pantallas piden por `app_ids` solo lo que necesitan. Quitar `rawRecords`/`cachedGames` de 39k y `registerRecords` masivo (registrar bajo demanda el juego que se va a instalar/descargar).
6. (Reemplazado por la tarea B; no hacer.)
7. Verificar que `catalog_cache_sync` use diff por `base_revision`/`revision` (bajar solo lo nuevo) y que corra al instalar, al abrir (si pasó >1 h) y luego cada hora o una vez al día; si hoy baja el snapshot completo, documentarlo en el commit y en `docs/game-access-todo.md` (no rediseñar el servidor aquí).
8. Eliminar estado/derivados grandes en `App.tsx` que ya no se usan (heroPool/newGames/suggestedGames salen de consultas con límite chico), borrar código muerto, actualizar tests.

**Verificación (Claude):** memoria del WebView < ~500 MB (`C:\DEV\measure.ps1`), CPU ~0 en reposo, grilla fluida al hover, aviso de tope visible, búsqueda "a" devuelve máx. 1000, scroll carga ventanas.

---

## B. Fuentes de descarga en la base (reemplaza el paso 6 de A)

**Decisión de Seba:** la query del catálogo puede exigir una fuente de descarga como criterio, así que no se puede traer 1000 registros y vincular después: se resuelve en una sola query SQL con índices. Al conectarse, el plugin le manda su lista completa de fuentes; Game Access hace el lookup por nombre contra su base de juegos (lo que hoy hace el plugin) y guarda la relación en una tabla. Desde ahí todo son queries SQL simples. El plugin mantiene el registro de sus fuentes y manda solo actualizaciones (agregadas y borradas). Game Access no escanea todo el catálogo ni compara por lotes en cada vista.

**Problema medido en el log:** el cliente consulta `/api/health` cada 3 s con timeout 2 s (`catalog/PluginRuntime.ts`); `POST /api/bulk_check` del plugin recorre las 83.828 entradas de `cachedDownloads` por cada juego (`optionsFor` en `links.js`, bucle síncrono) y bloquea Node, `health` no contesta, el estado flapea online/offline cada ~14 s, cada flapeo dispara un escaneo de 41.729 juegos (`check()` en `PluginSources.ts`: baja `/api/titles`, filtra con `gamesWithPossibleSources`, 119 lotes de 100), el botón de descarga parpadea y hay FRAME_DROP de 300 ms.

**Regla de matching** (hoy en `ga-torrent-plugin/matcher.js` + `links.js`; portar tal cual a Rust, sin "mejorarla"):
- `cleanTitle(t, split)`: quitar ®™©℠; NFKD y quitar diacríticos; quitar contenido entre () y []; si split, insertar espacio entre minúscula+mayúscula (DeadSpace→dead space; con split=false GunMan→gunman); quitar apóstrofes; `&`→" and "; todo lo que no sea letra/número→espacio; trim y minúsculas.
- `calculateScore(game, title)` = max(scoreWith(split=true), scoreWith(split=false)). `scoreWith`: nombres limpios iguales→1; tokens del título sin los prefijos iniciales fitgirl/dodi/repack/repacks/onlinefix; todos los tokens del juego deben ser los primeros del título (si no, 0); si no sobra nada→0.95; si el primer token sobrante empieza con `v\d|build|version|ver|free|download|repack|repacks|multi\d|update|all|dlc|deluxe|ultimate|complete|edition|goty|onlinefix|fitgirl|dodi|steamrip|gog|incl|including|with|win|windows`→0.9 (es "empieza con": "allstars" cuenta; portarlo igual y dejar nota); o versión con puntos (dos tokens numéricos seguidos y el título crudo tiene `\d+\.\d+`)→0.9; si no, 0. Es match si score ≥ 0.55.
- Candidatos (como `catalog/sourceTitleIndex.ts`): HashMap nombre limpio→juegos (ambos modos split); por cada título de fuente, recorrer los prefijos de tokens (tras quitar prefijos de release) y buscar en el índice; luego verificar con `scoreWith`.

**Esquema SQLite** (en la base de `catalog_cache.rs`):
- `download_sources`: `source_key` TEXT PK (sha256 de source_name + NUL + raw_title), `plugin_id`, `source_name`, `title_raw`, `multiplayer` INT, `revision`.
- `game_sources`: `app_id` INT, `source_key` TEXT, `score` REAL, PK(app_id, source_key); índices por `app_id` y por `source_key`.
- La base guarda solo qué juego tiene qué fuente (filtrar, ordenar, insignias). Links, seeds y ranking NO se guardan: al abrir el detalle se sigue pidiendo `GET /api/sources?app_id&name` al plugin.

Pasos:
1. Test de contrato primero: generar un JSON golden con ~500 pares (nombre de juego, título crudo, score) usando el `matcher.js` real (camelCase, prefijos fitgirl/dodi, versiones con puntos, "allstars", acentos, & y paréntesis) y verificar que el matcher en Rust coincide al 100 %. Si falta, agregar la crate `unicode-normalization` en `src-tauri`.
2. Rust (`catalog_cache.rs` o módulo `source_index.rs`): migración de las dos tablas; comando `catalog_sources_apply(plugin_id, revision, full, added[], removed[])` que borra las fuentes quitadas (y sus `game_sources`), inserta las nuevas y calcula el matching incremental (fuentes nuevas contra el índice de juegos; si `catalog_cache_sync` agrega juegos, matchear solo los nuevos contra el índice de fuentes); si `full`, reemplazar todo lo de ese `plugin_id`; al desinstalar el plugin, borrar sus filas.
3. Rust: `catalog_cache_query` usa las tablas: `has_downloads` = EXISTS en `game_sources`; `sources` filtra por `download_sources.source_name`; devuelve por juego `source_count` y `source_names` en una sola query; reemplaza `catalog_cache_set_temp_sources`. Tests SQL con ~84.000 fuentes y ~40.000 juegos (la query con filtro < 50 ms).
4. Plugin (repo aparte `C:\DEV\ga-torrent-plugin`, commits separados; no tocar ranking ni `calculateScore`): `GET /api/source-index?since=<revision>` → `{revision, full, added:[{key,title,source,multiplayer}], removed:[key]}` (`full=true` si `since` no coincide con una revisión conocida; guardar las claves de la revisión anterior en memoria y disco); al detectar fuentes quitadas o agregadas en `syncSources`, incrementar `revision`; `/api/health` trivial y siempre instantáneo; `/api/bulk_check` y `/api/titles` quedan por compatibilidad pero sin usarse.
5. TS (`PluginSources.ts`, `PluginRuntime.ts`): al conectarse y cuando cambia la `revision`, llamar a `/api/source-index?since=<última guardada>` y pasar el resultado a `catalog_sources_apply`; eliminar `check()` por lotes, `providerTitles`, `getMatchingCatalog`, el uso de `gamesWithPossibleSources` y el mapa `availability` en memoria; online/offline NO borra ni recalcula nada (solo estado de UI) y usa histéresis (3 fallos seguidos y timeout 5 s antes de marcar offline); la grilla lee `source_count`/`source_names` de la query.
6. UI: el filtro "con fuente" y el filtro por nombre de fuente salen de la query; el botón de descarga del detalle sigue consultando al plugin; actualizar `pluginSources.test.ts`.

**Verificación (Claude):** el log ya no muestra "Source availability scan"; sin parpadeo del botón de descarga ni FRAME_DROP periódicos; con el plugin cerrado los filtros por fuente siguen funcionando; quitar una fuente en el plugin la saca de la base en la siguiente sync; el matching en Rust coincide 100 % con el golden.

---

## C. Instalación, detección y perfil de ejecución (launcher Python, `apps/launcher`)

**Estado del código leído:** `digital_storage.py` (snapshot/status/register/uninstall), `digital_backup.py` (restore en cada Play), `digital_process_runner.py`, `execution_profile.py`. Carpeta de juegos de dev: `apps/launcher/games` (18 carpetas, algunas vacías).

**Decisiones de Seba:**
- Los juegos se identifican solo por el prefijo `<appid>-` de la carpeta, nunca por el nombre del juego; la detección no depende de la lista del catálogo.
- Estructura: carpeta de nivel 1 `<appid>-<nombre>-<status>`; todo lo que traen los comprimidos se descomprime ahí adentro tal cual, sin adivinar niveles (el fix puede venir en carpeta hermana o en un comprimido aparte que se aplica sobre la carpeta del juego).
- `status` = preparing | downloading | installing | ready | ERROR, asignado solo cuando de verdad está en ese estado (downloading al empezar a bajar; installing al completarse la descarga; ready cuando se descomprimió y se encontró el exe).
- Si un paso falla sin arreglo automático: status ERROR, `error.txt` en la raíz de la carpeta del juego y aviso al usuario con la solución sugerida (link muerto o torrent sin seeds → "intentá otra fuente disponible" y se borra la carpeta; fallo de descompresión → "error intentando descomprimir <archivo>: <error>"). El aviso incluye un formulario con los parámetros de automatización usados (editables), qué archivo se estaba procesando, y las opciones "cancelar y abortar todo" o "intentar de nuevo" (para retomar desde donde se cortó).
- Desinstalar o abortar una descarga borra la carpeta entera del juego por AppID (hoy quedan carpetas vacías); el juego sigue en la biblioteca pero deja de detectarse como instalado. Al arrancar se limpian carpetas vacías.
- Regla de instalado: la carpeta existe con contenido (y status `ready`) = instalado; no se re-comprueba cada vez que corre. Si al hacer Play falta el ejecutable: avisar que está mal instalado y ofrecer borrarlo o reinstalarlo.
- Backup: solo se respalda el comprimido del fix (el que declara el perfil) y se reaplica en cada Play (el antivirus puede borrar archivos del crack); nunca aplicar el criterio de backup al juego completo.
- El usuario puede editar el perfil de ejecución con un formulario de estos campos: (1) "DECOMPRESS FILE EACH RUN?" casilla + ruta (se busca en la carpeta del juego y se descomprime con 7-Zip en el directorio principal del juego); (2) "ARCHIVOS A PROBAR EJECUTAR": lista de patrones (`GAMENAME.EXE`, `*LAUNCHER*.EXE`, otro); (3) "RUN AS ADMIN?" casilla. El idioma (.ini en ruso, etc.) se corrige una sola vez, marcado en el manifiesto de instalación.

**Notas de implementación:**
- Cambia `digital_storage.py` (`folder`, `register`, `snapshot`, `status`, `uninstall`, `local_games`): parsear el status desde el último `-` (los nombres de juego pueden contener `-`); el AppID sigue siendo el prefijo.
- En Windows no se puede renombrar una carpeta con archivos abiertos: renombrar entre fases con los handles cerrados (a `downloading` antes de abrir archivos, a `installing` tras cerrarlos). Si se corta, queda el último status, que es lo deseado para retomar.
- `execution_profile.py` hoy soporta `beforePlay` (ini-set, run) y `archivePasswords`; extenderlo con los campos del formulario y reemplazar la heurística de "archivo más chico" de `digital_backup.py` por el archivo declarado en el perfil.
- `digital_process_runner.py`: hoy restaura el respaldo en cada Play sin comprobar si ya está aplicado y prueba todos los `.exe` ordenados por parecido al nombre; cambiar a re-extraer solo el fix declarado y usar los patrones del perfil.

**Orden de commits sugerido:** (1) escaneo por prefijo + instalado = carpeta con contenido y status `ready`; (2) desinstalar/abortar borran todo y limpieza de vacías al arrancar; (3) estados en el nombre + `error.txt` + formulario de error; (4) perfil editable y backup solo del fix; (5) diálogo de juego roto.
