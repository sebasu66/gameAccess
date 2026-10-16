---
tipo: tareas
actualizado: 2026-10-16
---
# Tareas pendientes — Game Access

> **Fuente de verdad de lo pendiente** (el `TODO_OBSOLETO.md` de la raíz ya no tiene validez). Consolida las especificaciones en `docs/` y lo conversado con Seba hasta 2026-10-16. Definición del proyecto y features: [[Proyecto]].
> Dueños: **Gemini** (codifica), **Claude** (diseña, verifica, revisa commits), **Seba** (decide, prueba, da datos).
> Al completar una tarea: tildarla, anotarlo en [[Log]] con el commit y, si hubo una decisión o una duda, en [[Mensajes]]. Después, **revisar [[Mensajes]] antes de empezar la siguiente**.
> Reglas de git: una sola rama (`dev`), commits chicos **con push a `dev` después de cada paso verificado**, sin ramas ni PR intermedios. Todavía no hay usuarios: `main` solo se actualiza cuando Seba decide el primer test en vivo (único PR válido `dev → main`).

## En curso / siguiente para Gemini
Especificación completa: `docs/gemini-tasks-2026-10-16.md`. Orden: A → B (depende de A); C es independiente.
- [x] **A. Catálogo sin cargar los ~39.000 juegos en memoria** — consultas por vista (tope 1000), `useCatalogQuery`, filtros por defecto (rating mín. 6, antigüedad máx. ~1 año), aviso de tope. Dueño: Gemini. Verifica: Claude.
  - [ ] Claude: verificación en vivo de A (memoria del WebView < ~500 MB con `C:\DEV\measure.ps1`, CPU en reposo ≈ 0, la búsqueda "a" devuelve ≤ 1000). Revisión por inspección de código ya hecha (2026-10-16).
- [ ] **B. Fuentes de descarga en la base** — tablas `download_sources` / `game_sources`, matching por nombre portado a Rust con test de contrato, deltas del plugin (`/api/source-index?since=`), filtro "con fuente" por SQL, fin del escaneo por lotes y del parpadeo online/offline. Dueño: Gemini (cliente y plugin). Verifica: Claude.
- [ ] **C. Instalación y detección** — carpeta `<appid>-<nombre>-<status>` (preparing/downloading/installing/ready/ERROR), `error.txt` + formulario de error, desinstalar/abortar borra la carpeta, instalado = carpeta con contenido y status `ready`, backup solo del fix, perfil de ejecución editable. Dueño: Gemini. Verifica: Claude.

## Pasos ya decididos (ejecutar en orden)
- [ ] **Autoactualización segura** con el updater de Tauri: firmada, chequeo al abrir, aplica al reiniciar, conserva la versión anterior y revierte si crashea, config remota para arreglos sin release; repo público aparte para binarios/manifest. Debe estar en el primer build público.
- [ ] **Traducciones es/en completas e instalador NSIS profesional.** Traducciones: avanzadas según `git log` (`f72557e` catálogos es/en con test de paridad, `79f52da` y `bbfe815` etiquetas movidas a los catálogos, script de control); falta confirmar que no queden textos fijos y la selección automática de idioma por ubicación (verifica Claude). Instalador NSIS pendiente: idioma automático y registro del protocolo `gameaccess://`.
- [ ] **Landing en GitHub Pages** (qué es, cómo funciona, FAQ, privacidad, descarga), enlazada desde Patreon; Patreon solo para pago y comunidad.

## Cola de funciones (de más fácil a más difícil)
- [ ] Aviso "¿descarga lenta?" (monitor de velocidad del torrent + planes de aceleración). Necesita el texto completo del plan de 4 USD (Seba).
- [ ] Registro de tiempo de juego (solo grabar, sin límites todavía).
- [ ] Detalle del juego enriquecido: videos de gameplay/walkthroughs y notas de prensa.
- [ ] Congelado de juegos (freezer): comprimir un juego de forma fácil de descomprimir.
- [ ] Congelado automático tras 1, 2 o 3 meses sin uso (parámetro), con ícono de frío junto a Play y tooltip.

## Descargas y servidor
- [ ] Cablear el cliente al endpoint de Viking/Torbox y agregar tests; mostrar en la consola, al apretar Download, la petición, el link procesado y los errores.
- [ ] Viking Files: cuenta VIP ya paga; pendiente respuesta del administrador por hotlinking (Seba).
- [ ] Comparar descarga directa vs torrent en el servidor cuando no está en Viking ni cacheado en Torbox.
- [ ] Retransmisor online (Torbox no debe ver muchas IPs de clientes); links de piezas en archivo, no en Supabase; piezas de 500 MB → 1 GB; aguantar ~100 usuarios.
- [ ] Tabla de tareas en ejecución en la web del servidor.
- [ ] Servidor en Render funcionando igual que en local.
- [ ] Publicar deltas del catálogo en el servidor (`kind: "delta"`, `base_revision`, `revision`) — spec en `docs/game-access-todo.md`.
- [ ] Logs de la app dentro del proyecto (`apps/launcher/logs` o `api/logs`).

## Premium y comercial (Paso 1 hecho, falta cerrar)
- [ ] Seba: pasar las URLs reales de Patreon y de pago en pesos (hoy todo apunta al placeholder `https://gameaccess.app`).
- [ ] Reiniciar/redeployar el API para publicar `/premium/content` y ver el diálogo con planes en vivo; revisar los textos de planes (2 y 4 USD).
- [ ] Probar la clave en vivo contra el server real desde el diálogo nuevo.
- [ ] Probar el instalador `.exe` del plugin y el botón de la página (Seba). Plugin en `https://github.com/Gizi789/source_manager`.
- [ ] Cuenta `gh`: la activa quedó `Gizi789`; volver a `sebasu66` (`gh auth switch -u sebasu66`).

## UI y cliente
- [ ] Diseño Digital aprobado: aceptación visual y validación de ficha/descargas con datos reales (detalle del diseño en `TODO_OBSOLETO.md`, sección P1; mockup en `docs/design/gameaccess-ui-2026-10-06/`).
- [ ] Secuencia de inicio: fondo de portadas en diagonal → logo con cubitos + sonido → lluvia de cubitos → pantalla principal.
- [ ] Migrar Dialog y ScrollArea (Radix) si Seba aprueba la preview.
- [ ] Tirón en hover: probar quitar `backdrop-filter: blur(14px)` del footer (`dock.css`) sobre el fondo pixelado.
- [ ] Validar con mando físico el modo Pantalla grande (`docs/BIG_SCREEN_CONTROLS.md`).
- [ ] Auditoría de teclado/foco; acción primaria Descargar/Cancelar/Jugar sin contradicciones; reconciliar estado tras cerrar y reabrir.
- [ ] Nice-to-have: "me gusta / no me gusta" para juegos afines y recomendados.

## Release
- [ ] Instalador exacto desde el commit probado (commit, hash, build stamp); instalación en VM limpia; revisar textos visibles; logo/splash nuevo en el instalador.
- [ ] Smoke test de release (catálogo corrupto, assets faltantes, tipos no-juego); empaquetar artwork estático; trailers on-demand.
- [ ] Firmar instalador (evitar SmartScreen); backups, rate limiting y revisión legal antes de la beta abierta.

## Mantenimiento y dudas abiertas
- [ ] Commitear `TODO_OBSOLETO.md` (renombrado desde `TODO.md`), `AGENTS.md`, `.gitignore`, `docs/gemini-tasks-2026-10-16.md` y `vault/` (hoy sin commit).
- [ ] Seba: confirmar los estados marcados † en `vault/Proyecto.md` (biblioteca, cola de descargas, versión Plus, importador de juegos propios, planes y precios).
- [x] `README.md` y `skill.md`: quitadas las menciones a la versión vieja de licencias Steam (2026-10-16) y alineados con el vault (entrada libre sin llave, disponibilidad de fuentes desde la base). Corrección: antes anoté por error que seguían con reglas viejas de leases; no los había leído.
- [ ] Docs viejos que todavía hablan de licencias/leases de Steam (12 archivos, ver [[Limpieza]]): decidir si se archivan en `docs/archivo/`. Dueño: Seba decide, Claude mueve.
- [ ] Seba: revisar lo que dejé sin mover en la raíz (`dev.ps1`, `run_local_api.bat`, scripts `*_DEV_LAB.cmd`, `automation/`, `examples/`, `debug/`) y confirmar que `_papelera/` se puede vaciar (cuidado: los `.psd` del logo y `accFull*.csv` solo existen ahí).
- [ ] Baja prioridad, después de B: revisar los 11 archivos sin uso que reporta `npx knip` en `apps/desktop` (ver [[Limpieza]]) y borrar los que sean de la versión vieja de licencias Steam. Dueño: Gemini; verifica Claude.
- [ ] Baja prioridad: sacar de `apps/api` lo que queda de la versión vieja (`linkvertise_access.py`, campos `credits` y `credit_cost_per_hour` de `models.py`, imports sin uso de `main.py`) si Seba confirma que Linkvertise y los créditos no vuelven.
- [ ] Duda de Seba: el fix de idioma (.ini en ruso, etc.) se aplica una sola vez, marcado en el manifiesto de instalación; hoy corre en cada Play. ¿Confirmado?
- [ ] Nota del matcher: la lista de palabras de versión (`all`, `with`, `win`…) se compara con "empieza con" ("allstars" cuenta). Se porta igual a Rust; corregirlo después, en plugin y Rust a la vez.
