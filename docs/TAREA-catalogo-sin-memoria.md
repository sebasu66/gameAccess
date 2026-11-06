# Tarea: catálogo sin cargar los ~39.000 juegos en memoria

Para el modelo barato: codifica. Claude verifica después. El lookup título → app ID de las fuentes se queda como está en el cliente (no moverlo al plugin ni tocar la lógica del plugin).

## Problema (medido)

El cliente usa ~1,7 GB y ~85 % de un núcleo en dev, incluso en el commit "responsivo" 1def424.

Causa: `catalog/DiscoveryCatalog.ts` llama a `readCatalogCache()`, que invoca `catalog_cache_read` y trae TODOS los juegos al JS. Después `DigitalCatalog.readCatalog` los copia varias veces (`rawRecords` Map, `digitalDownloadService.registerRecords`, `normalizeGames`, `applyBundledCatalogArtwork`, `cachedGames`) y `App.tsx` los guarda en `games`. Cada `setGames` (fuentes, metadata Steam) rehace listas de 39k.

## Ya existe (NO reescribir)

- Rust `catalog_cache.rs`: `catalog_cache_query` (params: query, genres, features, sources, has_downloads, language, sort_by, sort_direction, limit (def. 60), offset), `catalog_cache_get_facets`, `catalog_cache_set_temp_sources`, `catalog_cache_sync` (revision / base_revision).
- Wrappers en `src/catalogCache.ts`: `queryCatalogCache`, `setCatalogTempSources`, `getCatalogFacets` (tests en `catalogCache.test.ts`).
- Hoy la UI casi no los usa.

## Reglas

- Rama `dev`, un commit chico por paso, sin push.
- No tocar plugins ni `apps/desktop/public/brand/logo-opening.mp3`.
- Mantener glass / fondo pixelado / naranja. Textos simples en español (i18n es/en).
- Tras cada paso: `npm test` y `npx tsc --noEmit` en `apps/desktop`, y `cargo check` en `src-tauri`.
- Los commits terminan con las dos líneas de trailer que usa el repo (Co-Authored-By y Claude-Session).

## Pasos (en orden)

1. **Rust, filtros y tope.** Extender `CatalogQueryParams` con `min_rating` (f32, opcional), `max_age_days` (opcional, sobre fecha de lanzamiento) e `include_recent_unrated` (regla de Seba: solo ocultar juegos con algunas reseñas y más de 1 mes de salida; los lanzamientos recientes no se ocultan por rating). `catalog_cache_query` devuelve `total` real (antes del LIMIT) y aplica tope duro `limit <= 1000`. Tests unitarios Rust del filtro y del tope.
2. **Rust, consulta por conjunto.** Aceptar `app_ids: Option<Vec<i64>>` (biblioteca, favoritos, juegos con fuente) y orden por popularidad por defecto cuando no hay búsqueda.
3. **TS, hook `useCatalogQuery`** (en `src/`). Llama a `queryCatalogCache` con debounce (~250 ms) según búsqueda, filtros, orden y ventana (~70 juegos), cancelando respuestas viejas. Devuelve `{ items, total, capped }`, con `capped` = total mayor que el tope o que lo traído.
4. **TS, grilla.** `LibraryRoom` / `DownloadCatalogPanel` usan solo `items` del hook; dejar de depender de `games` completo para la grilla, ordenar y filtrar (quitar sorts/filtros en memoria de `App.tsx` sobre la lista grande).
   - Filtros por defecto prendidos y fáciles de quitar: rating mínimo 6 y antigüedad máxima 1 año.
   - Sin búsqueda: top por popularidad (tope 500–1000).
   - Mostrar el total del catálogo ("39.000 juegos en el catálogo").
   - Si se excede el tope, aviso corto bajo el buscador: "Más de 1000 resultados: mostrando los primeros 1000. Afiná la búsqueda."
5. **TS, no traer la lista completa.** `DiscoveryCatalog.loadDiscoveryCatalog` / `DigitalCatalog.readCatalog` solo sincronizan (`syncCatalogCache`) y devuelven conteo/revisión. Las demás pantallas piden por `app_ids` solo lo que necesitan (biblioteca, favoritos, juego abierto, descargas). Quitar `rawRecords` / `cachedGames` de 39k y el `registerRecords` masivo: registrar bajo demanda el juego que se va a instalar o descargar.
6. **Fuentes.** `useCatalogSources` / `PluginSources` mantienen el lookup actual, pero publican el resultado a la base con `setCatalogTempSources` (~2.500 títulos, no 39k) y solo cuando cambia la revisión de algún plugin. Sin cambios no se hace nada ni se llama a `setGames`. El filtro "con fuente" se resuelve en la consulta (`has_downloads` / `sources`), no en memoria.
7. **Sync servidor → cliente.** Verificar que `catalog_cache_sync` use diff por `base_revision` / `revision` (bajar solo lo nuevo) y que corra al instalar, al abrir (si pasó más de 1 h) y luego cada hora o una vez al día. Si hoy baja el snapshot completo, dejarlo documentado en el commit y en `game-access-todo` (no rediseñar el servidor en esta tarea).
8. **Limpieza.** Eliminar el estado y derivados grandes de `App.tsx` que ya no se usan (`heroPool` / `newGames` / `suggestedGames` salen de consultas con límite chico), borrar código muerto y actualizar tests.

## Verificación (la hace Claude después)

- En dev con el catálogo real: memoria del WebView < ~500 MB y CPU ~0 en reposo. Se mide con `C:\DEV\measure.ps1` (cerrar antes `GameAccess-latest.exe`).
- Grilla fluida al hover.
- Aviso de tope visible y búsqueda "a" devuelve máximo 1000.
- Filtro "con fuente" sigue funcionando después de escanear fuentes.
- Prueba con screenshots en la ventana "Gameaccess-desktop" (F5 recarga).

## Notas

- La causa de memoria es de base, no de un commit de hoy.
- Sospecha aparte del tirón al hover: `backdrop-filter: blur(14px)` más animación de ancho en los botones del footer (`dock.css`, commit a696981) sobre el fondo pixelado. Probar quitando el blur.
