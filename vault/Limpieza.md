---
tipo: limpieza
actualizado: 2026-10-16
---
# Limpieza del repo — 2026-10-16

> Resultado de la limpieza de la raíz y de los linters. Tareas derivadas en [[Tareas]].

## 1. Raíz del proyecto
Se movieron **59 elementos** a `_papelera/` (no se versiona: está en `.gitignore`). Nada se borró. El detalle, con el motivo de cada grupo y si el archivo está en git, está en `_papelera/LEEME.md`. Para restaurar, devolver el archivo a la raíz.

Grupos movidos:
- 30 scripts sueltos de parches y refactors de agentes (`fix_*.js`, `refactor_*.js`, `add_steam_endpoint.py`, `clean_test.py`, `patch.py`, `remove_fixed_override.js`): nadie los referencia.
- Notas, parches y utilidades sueltas: `changes.txt`, `recent.patch`, `scratch.txt`, `dev_.skill.md`, `game-access-expansion.md`, `Capture-Procmon.ps1`, `catalog_dump.json`.
- Borradores de logo y un video de prueba (4 imágenes "Imagen de ChatGPT…" y `Colorful_light_rays_shooting.mp4`).
- Los dos `.psd` del logo (**solo existen localmente: no borrar `_papelera` sin copiarlos antes**).
- `accFull.csv` y `accFullOLD.csv`: listado de cuentas proveedoras con credenciales de la versión vieja (**solo existen localmente**).
- `onlinefixsource.json`: una lista de fuentes de descarga dentro del repo, que contradice la regla de que el proyecto no incluye listas de descargas. Sigue en el historial de git.
- Instaladores viejos y artefactos de build que se regeneran.
- Logs sueltos, el `package-lock.json` de la raíz (no hay `package.json` en la raíz) y la carpeta vacía `games/`.

Se dejó en la raíz: `README.md`, `AGENTS.md`, `skill.md`, `.env`, `.gitignore`, `.github/`, `apps/`, `docs/`, `tools/`, `deploy/`, `website/`, `build-and-run.ps1`, `render.yaml`, `GameAccess-latest.exe` y su `.build.json`, `TODO_OBSOLETO.md`, `vault/`.

**A revisar por Seba** (nadie los referencia o parecen de la versión vieja, pero no quise moverlos sin preguntar): `dev.ps1`, `run_local_api.bat`, `START_/STATUS_/STOP_GAMEACCESS_DEV_LAB.cmd`, y las carpetas `automation/`, `examples/`, `debug/`.

Efecto secundario conocido: `apps/api/run_admin_preview.ps1` referencia `accFull.csv`, que ya no está en la raíz (es de la versión vieja de cuentas).

## 2. Linters
### knip (TypeScript, `apps/desktop`) — `npx knip`
- **11 archivos sin uso:** `scripts/capture-ui.mjs`, `scripts/open-dev-preview.mjs`, `scripts/open-tauri-dev.mjs`, `scripts/quality-gate.mjs`, `src-tauri/src/cooptimus_lookup.js`, `src/downloadEstimateService.ts`, `src/gameAvailability.ts`, `src/MultiplayerParentOption.tsx`, `src/SteamInstallFallbackDialog.tsx`, `src/SteamStoreDetail.tsx`, `src/useSteamMetadataWorker.ts`.
- 82 exports sin uso y 24 tipos exportados sin uso (lista completa al correr `npx knip`).
- No se borró nada. Los `scripts/*.mjs` pueden usarse a mano. Por el nombre, `SteamInstallFallbackDialog`, `SteamStoreDetail`, `useSteamMetadataWorker` y `gameAvailability` podrían ser de la versión vieja; hay que verificar antes de borrar.

### vulture (Python, `apps/api/app` y `apps/launcher`) — `py -3 -m vulture apps/api/app --min-confidence 80`
- Con confianza ≥ 80 solo marca 10 imports sin uso en `apps/api/app/main.py` (rutas de `access_*`, `activation_*`, `client_error_*`, `catalog_routes`).
- A confianza 60 devuelve ruido: marca como "sin uso" las rutas de FastAPI porque se registran por decoradores. No sirve para detectar código muerto sin revisión.
- Pistas de la versión vieja que vulture deja ver: campos `credits` y `credit_cost_per_hour` en `models.py` y todo `linkvertise_access.py`.

## 3. Docs que todavía hablan de licencias, leases o cuentas proveedoras de Steam
`docs/ACTIVATION_ENTRY_AUDIT.md`, `DESKTOP_UI.md`, `DIGITAL_DOWNLOADS.md`, `PLUGIN_DOWNLOADS.md`, `POOL_CAPACITY_HANDOFF_2026-09-08.md`, `PRODUCT_PLAN.md`, `STAGE2_FIXES_2026-09-08.md`, `STEAM_DOWNLOAD_MANAGER.md`, `STEAM_LICENSE_ARCHIVE.md`, `TAREA-filtros-wizard.md`, `TAREA-i18n.md`, `architecture.md`.
No se tocaron. Propuesta: mover los claramente históricos (`POOL_CAPACITY_HANDOFF…`, `STAGE2_FIXES…`, `STEAM_LICENSE_ARCHIVE.md`, `STEAM_DOWNLOAD_MANAGER.md`) a `docs/archivo/` y revisar los demás.
