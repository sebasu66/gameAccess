# GameAccess TODO

## Catálogo: sincronización diferencial en servidor

- **Estado actual cliente:** `catalog_cache_sync` en Rust (`apps/desktop/src-tauri/src/catalog_cache.rs`) ya está preparado para deltas: solicita `/library/catalog/manifest?since=<revision>` y si `manifest.kind == "delta"`, descarga únicamente el `CatalogBatch` (JSON con juegos y detalles diferenciales) y los aplica con `apply_batch` sobre la base SQLite existente sin bajar los 39k juegos de nuevo.
- **Estado actual servidor:** El repositorio/servidor estático en GitHub publica actualmente snapshots completos (`catalog-cache-*.sqlite.gz`, `kind` no es delta).
- **Tarea pendiente de infraestructura:** Actualizar el pipeline de generación del catálogo en el backend/servidor para publicar deltas incrementales (`kind: "delta"`, `base_revision`, `revision`, `artifact_url` apuntando a `CatalogBatch` comprimido) para revisiones recientes, de modo que los clientes existentes bajen únicamente novedades (~KB en vez de ~MB).
