---
tipo: tareas
actualizado: 2026-10-19
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
- [x] **B. Fuentes de descarga en la base** — tablas `download_sources` / `game_sources`, matching por nombre portado a Rust con test de contrato, deltas del plugin (`/api/source-index?since=`), filtro "con fuente" por SQL, fin del escaneo por lotes y del parpadeo online/offline. Dueño: Gemini (cliente y plugin). Verifica: Claude.
- [x] **C. Instalación y detección** (C.1–C.5 hechos 2026-10-17; falta prueba en vivo de Seba: error de descompresión, `setup*.exe` de GOG, registro por juego) — carpeta `<appid>-<nombre>-<status>` (preparing/downloading/installing/ready/ERROR), `error.txt` + formulario de error, desinstalar/abortar borra la carpeta, instalado = carpeta con contenido y status `ready`, backup solo del fix, perfil de ejecución editable. Dueño: Gemini. Verifica: Claude.

## Pasos ya decididos (ejecutar en orden)
- [ ] **Importar juegos ajenos al catálogo**: usar `GameExecutionManager.prepare` para dejarlos listos dentro de Game Access (la importación todavía no existe). Pendiente también: marca de advertencia en la tarjeta del juego en la biblioteca (hoy solo en el menú y en el diálogo de Play fallido).
- [ ] **Autoactualización segura** con el updater de Tauri: firmada, chequeo al abrir, aplica al reiniciar, conserva la versión anterior y revierte si crashea, config remota para arreglos sin release; repo público aparte para binarios/manifest. Debe estar en el primer build público.
- [ ] **Traducciones es/en completas e instalador NSIS profesional.** Traducciones: avanzadas según `git log` (`f72557e` catálogos es/en con test de paridad, `79f52da` y `bbfe815` etiquetas movidas a los catálogos, script de control); falta confirmar que no queden textos fijos y la selección automática de idioma por ubicación (verifica Claude). Revisión 2026-10-18: traducidas las etiquetas de biblioteca y filtros, los estados de descarga y la descripción de respaldo. Pendiente: textos que llegan del launcher en español y las pistas (hints) de multijugador en `librarySearch.ts`. Plugin: envía textos traducidos por `?lang=` (ga-torrent-plugin, sin publicar todavía). Instalador NSIS pendiente: idioma automático y registro del protocolo `gameaccess://`.
- [ ] **Landing en GitHub Pages** (qué es, cómo funciona, FAQ, privacidad, descarga), enlazada desde Patreon; Patreon solo para pago y comunidad.
- [ ] **Pestaña nueva "Librería"**: estadísticas de uso de juegos por día y por mes (reutilizar `UsageChart` y los datos `usage` de `library-list`). Solo pendiente; el Library Manager ya trae los componentes shadcn/Recharts.
- [ ] **Selector de idioma ES/EN**: moverlo a Configuración y quitarlo de las pantallas (hoy solo se oculta en las pantallas con `.ga-screen-header`, p. ej. el Library Manager). Usar `.ga-screen-header`/`.ga-screen-title` (gameaccess-theme.css) como cabecera estándar en todas las pantallas completas.
- [x] **Versión instalada en la tarjeta** (Claude, pedido por Seba 2026-10-19; falta verlo en la app con una descarga real): cada instalación guarda en su registro (`.cache/digital_games/<appid>.json`, campo `source`) el nombre que le da su fuente y de qué fuente vino; la tarjeta de la biblioteca lo muestra debajo del nombre (el tooltip dice la fuente). Las instalaciones anteriores no lo tienen.
- [x] ~~**Varias versiones del mismo juego instaladas a la vez**~~ **Descartado** por Seba 2026-10-19: demasiado trabajo para algo poco probable (plan archivado en [[Varias versiones]]). Regla: **un solo juego por AppID**. Bajar un juego ya instalado muestra "ya está instalado; para instalar otra versión, primero desinstalalo" (sin reemplazar automáticamente) e importar uno que ya está en la biblioteca sigue rechazado.
- [x] **Nombre propio en la biblioteca** (Claude, 2026-10-19; falta verlo en la app): "Cambiar nombre" en el menú de la tarjeta guarda `label` en el registro del juego (o en el del vínculo); la tarjeta muestra el nombre propio o, si no hay, "proveedor · nombre de la fuente" (como lo muestra el plugin). No cambia la base de juegos ni la imagen.
- [x] **Gestor de biblioteca: descarga pendiente** (Claude, 2026-10-19): una descarga en la cola, pausada o corriendo (`queue.json` del Download Manager) marca el juego como sin terminar aunque todavía no tenga archivos temporales: insignia "Descarga pendiente", sin "Corregir" ni pasar a `ready`, no cuenta en "Con error" ni en el aviso de la tarjeta.
- [x] **Descarga que no es un juego** (Claude, 2026-10-19): si lo bajado no tiene ningún ejecutable ni instalador (`.exe/.bat/.cmd/.msi/.com`) ni archivos por descomprimir, se borra de la carpeta de juegos y de la temporal, no queda en la biblioteca y la app avisa qué traía (música, imágenes, videos, documentos) y recomienda buscar otra fuente (código `not_a_game`, `NotAGameDialog`), sin ofrecer reintentar ni arreglar.
- [x] **Importación: AppID de emuladores y fixes** (Claude, 2026-10-19): el escáner lee `OnlineFix.ini` (`RealAppId=`), `steam_emu.ini` y `ColdClientLoader.ini` (`AppId=`) y `steam_appid.txt` hasta 5 niveles adentro (ignora 480/Spacewar); el diálogo muestra de qué archivo salió. En la PC de Seba identifica Trail Out, Dynasty Warriors 8 y The Mound Omen of Cthulhu.
- [ ] **Importación: pulir**: elegir manualmente el juego del catálogo con buscador (hoy un desplegable con sugerencias), opción «aplicar a todos» vincular/mover, progreso del escaneo por disco, opciones de lanzamiento (ejecutable/argumentos) para juegos vinculados, probar con discos reales y con una biblioteca Steam real.

## Cola de funciones (de más fácil a más difícil)
- [ ] Aviso "¿descarga lenta?" (monitor de velocidad del torrent + planes de aceleración). Necesita el texto completo del plan de 4 USD (Seba).
- [ ] Registro de tiempo de juego (solo grabar, sin límites todavía).
- [ ] Detalle del juego enriquecido: videos editoriales por Steam AppID/idioma, gameplay/walkthroughs y notas de prensa. El protocolo editorial v2 está documentado en `docs/EDITORIAL_VIDEO_FORMAT.md`; sigue pendiente diseñar e implementar el registro del video publicado y su reproducción en la ficha.
- [ ] Congelado de juegos (freezer): comprimir un juego de forma fácil de descomprimir.
- [ ] Congelado automático tras 1, 2 o 3 meses sin uso (parámetro), con ícono de frío junto a Play y tooltip.

## Modo niño (diseño en [[Modo niño]]; no implementar hasta que Seba lo pida)
Decidido con Seba 2026-10-19: cuenta local estándar para el niño con Game Access como escritorio (modo quiosco); el adulto usa Game Access normal en su cuenta. Orden:
- [x] **MN.1 Instalación para toda la PC** (Claude, pedido por Seba 2026-10-19; falta prueba de Seba instalando y actualizando): `"installMode": "perMachine"` (`Program Files\gameAccess`); el estado del launcher (`.cache`, `logs`) pasa a `%LOCALAPPDATA%\gameAccess\launcher` (`GAMEACCESS_LAUNCHER_DATA`, `launcher_data.py`); página nueva del instalador para elegir la carpeta de juegos (por defecto `C:\juegos_GameAccess`) y la de descargas (por defecto `Descargas\GameAccessDownloads` de cada usuario), guardadas en `HKLM\Software\gameAccess`. Plantilla NSIS propia (`src-tauri/windows/installer.nsi`, copia de Tauri 2.11.4 con un agregado) + `windows/hooks.nsh`. Pendiente: confirmar que la autoactualización (pide administrador) funciona; desinstalar a mano la instalación vieja por usuario (`C:\gameAccess`).
- [ ] **MN.2 Prueba de concepto del quiosco**: a mano, una cuenta local estándar de prueba con Game Access como shell (`HKCU\...\Winlogon\Shell`), Administrador de tareas deshabilitado y `net user /times`; confirmar en Windows 11 Home y Pro. Anotar vías de escape encontradas (Steam, diálogos de archivo).
- [ ] **MN.3 Detección del modo**: leer el SID de la sesión y `ProgramData\GameAccess\familia.json` (solo lectura para usuarios); en cuenta de niño, interfaz restringida (solo juegos permitidos y tiempo restante; sin configuración, tienda, descargas ni importador; "Salir" cierra la sesión).
- [ ] **MN.4 Control parental en modo adulto**: elegir/crear la cuenta del niño, juegos, horarios, límites y PIN; aplicar con Game Access relanzado elevado (crear cuenta, shell, `DisableTaskMgr`, horario de inicio de sesión, `familia.json`). Guía para la Vista familiar de Steam y carpeta compartida de juegos.
- [ ] **MN.5 Tiempo y cierre**: contar tiempo por juego y por día, avisos previos ("quedan 5 minutos"), cerrar el juego y la sesión al agotarse; relanzar Game Access si se cuelga.
- [ ] **MN.6 (Opcional) Servicio SYSTEM**: lleva el tiempo sin que el niño pueda tocarlo y, si hicieron falta, vigila procesos (ETW + firma digital) como refuerzo.

## Plugin como script (diseño en [[Plugin como script]]; acordado con Seba 2026-10-19)
Reemplaza al plugin Electron (`.exe` + servidor en `127.0.0.1:45000`) por una carpeta `manifest.json` + `provider.js` que Game Access ejecuta en una ventana oculta aislada. Orden:
- [x] **PS.0 Transición** (Claude, 2026-10-19; sin probar desinstalando): el desinstalador cierra los procesos del plugin y borra `%APPDATA%\GameAccess\plugins` de cada usuario y el protocolo `gameaccess://` (salvo en actualizaciones), en `windows/hooks.nsh`.
- [ ] **PS.1 Formato**: definir `manifest.json` (id, nombre, versión, hosts permitidos, intervalo) y el resultado (mismo contrato que `/api/source-index`, con revisión y deltas); test de contrato.
- [ ] **PS.2 Cargador en Game Access**: ventana oculta sin capabilities de Tauri salvo un canal de resultados validado por esquema, navegación limitada a los hosts del manifiesto; corre al abrir la app y cada tanto mientras está abierta. Basado en el patrón de `query_cooptimus`.
- [ ] **PS.2b Servicios para plugins**: (a) seeds de un magnet (UDP scrape con libtorrent del launcher, con caché); (b) "abrir página y devolver el enlace de descarga" en una ventana propia limitada a los hosts del manifiesto (reemplaza `gofile.js`/`links.js`); (c) sección de configuración del plugin generada desde `manifest.json` (reemplaza su `index.html`, p. ej. la lista de feeds).
- [ ] **PS.3 Carpeta e instalación**: plugins en `%LOCALAPPDATA%\gameAccess\plugins`; `gameaccess://install-plugin` instala el zip chico (ya verifica SHA-256); desinstalar = borrar la carpeta; quitar el arranque de procesos y el `endpoint`/`pid` cuando el formato viejo deje de usarse.
- [ ] **PS.4 Repo del plugin** (con la cuenta del plugin): portar la lógica del Electron a `provider.js` + `manifest.json` y publicar el release nuevo.

## Descargas y servidor
- [x] **Descargas: indicadores verídicos, cola y botón sin plugin** (Claude, 2026-10-18; falta prueba de Seba en la app). El launcher informa la ruta real (`route`: midiendo / torrent directo / acelerada · Viking / directa) y la pantalla de Descargas la muestra junto a una píldora PLUS/BASE; pausar libera el lugar (BASE 1, PLUS 4) y la pausada espera su turno; Subir/Bajar en la cola. Detalle sin plugin instalado y sincronizado: Jugar (instalado) o "Ver en Steam"; con plugin, la descarga de siempre y "Ver en Steam" chico al lado.
- [x] Mover la cola y el límite BASE/PLUS de `DigitalDownloadService.ts` al Download Manager del launcher (hecho 2026-10-19; falta prueba de Seba descargando en la app) (un proceso administrador; la app solo muestra y ordena). Pedido de Seba: toda la lógica de descargas dentro del Download Manager.
- [ ] **Producción en `main` con auto-update** (Claude, pedido por Seba 2026-10-18). Orden: auto-update → pantalla de preparación al arrancar → `main` como producción.
  - [x] Auto-update obligatorio (Tauri updater, firma, diálogo con progreso, vigía nativo si la interfaz no arranca, autoprueba `--self-test`, release como pre-release + `promote-release.yml`, prueba de que la actualización conserva juegos/datos). Probado en Windows Sandbox. Falta: Seba carga el secreto `TAURI_SIGNING_PRIVATE_KEY` en GitHub y guarda copia de la clave.
  - [ ] **Diálogo central** (pedido de Seba 2026-10-19): procesos largos con pasos y progreso + tablón de anuncios.
    - [x] Diálogo, anuncios (bienvenida y novedades desde `apps/desktop/public/announcements.json` en `main`, copia incluida en la app; cada uno se ve una vez; botón Novedades) y actualización de la app dentro del diálogo. **Seba: reemplazar el borrador de bienvenida (`"draft": true`).**
    - [x] Base del catálogo al arrancar y cada 24 h dentro del diálogo, con progreso real desde Rust.
    - [x] Plugin recién instalado: sincronizar sus fuentes en el diálogo, sin reiniciar.
    - [ ] Catálogo en Releases de GitHub con deltas, para que la primera sincronización sea chica.
  - [ ] Primer arranque y actualizaciones de base/fuentes en un solo proceso en primer plano, con diálogo y barra de progreso; la app bloqueada hasta terminar. El plugin es opcional y se instala a mano desde su página: el diálogo solo sincroniza fuentes si ya está instalado.
  - [ ] Adelantar `main` al último `dev` estable; Render de producción con deploy manual desde `main`; clientes de producción leen servidor y catálogo desde `main`; el job del catálogo publica también en `main`.
- [x] **Decisión torrent directo vs Torbox → Viking por piezas** (Claude, pedido por Seba 2026-10-18; falta prueba en vivo de Seba con un juego grande y poco compartido). Hoy todo torrent iba a Torbox sin medir nada.
  - [x] Plan de piezas: las 5 primeras de 100 MB; después ~1/10 del juego, mínimo 100 MB, tope 500 MB (primer 10 %) y 1 GB.
  - [x] El servidor retoma desde la pieza a la que llegó el cliente (trabajo perdido tras reinicio = 404); el cliente vuelve a pedir la que quedó a medias y las siguientes.
  - [x] El cliente mide el torrent con libtorrent (seeds, velocidad, tamaño). Directo si: BASE, < 5 GB, ≥ 20 seeds o ≥ 5 MB/s. Si es PLUS, ≥ 5 GB y lento: piezas por servidor. Cacheado en Torbox: piezas.
  - [x] Sacar el camino viejo en que el cliente usa Torbox con su propia clave (`pipeline.py`).
- [x] **Espera de Torbox robusta y barata** (Claude, 2026-10-16): un solo tablero compartido (`torbox_status_board.py`) consulta la lista completa de Torbox cada ~8 s para todos los clientes; un fallo pasajero ya no tira el trabajo; una fuente se da por inválida solo si Torbox no avanza 15 min (la cola de Torbox no cuenta); el cliente reintenta solo los errores pasajeros y muestra % real, velocidad y tiempo restante. Falta probar en vivo con una descarga lenta.
- [ ] Cablear el cliente al endpoint de Viking/Torbox y agregar tests; mostrar en la consola, al apretar Download, la petición, el link procesado y los errores.
- [ ] Viking Files: cuenta VIP ya paga; pendiente respuesta del administrador por hotlinking (Seba).
- [ ] Comparar descarga directa vs torrent en el servidor cuando no está en Viking ni cacheado en Torbox.
- [ ] Retransmisor online (Torbox no debe ver muchas IPs de clientes); links de piezas en archivo, no en Supabase; piezas de 500 MB → 1 GB; aguantar ~100 usuarios.
- [ ] Tabla de tareas en ejecución en la web del servidor.
- [ ] Servidor en Render funcionando igual que en local.
- [ ] Publicar deltas del catálogo en el servidor (`kind: "delta"`, `base_revision`, `revision`) — spec en `docs/game-access-todo.md`.
- [ ] Logs de la app dentro del proyecto (`apps/launcher/logs` o `api/logs`).

## Premium y comercial (Paso 1 hecho, falta cerrar)
- [x] **Llaves para testers** (Claude, pedido por Seba 2026-10-19; falta desplegar el servidor y probar con un amigo): en `/admin`, sección "Llaves para testers": nombre del tester, fecha de fin (por defecto un mes) y cantidad → llaves PLUS hasta esa fecha. La primera activación la ata a ese Windows; en otro la rechaza. "Desvincular" la libera si el tester reinstala Windows (no cambia la fecha). La lista muestra para quién es y su Windows (8 primeros caracteres).
  - Cliente: el identificador de instalación sale ahora del `MachineGuid` de Windows (hash, no se envía el GUID), no de un archivo al azar en `%LOCALAPPDATA%`. Copiar la carpeta de activación a otra PC ya no sirve. Las activaciones hechas antes con el identificador viejo hay que hacerlas de nuevo (no hay usuarios todavía).
- [ ] Pendiente previo: `tests/test_current_product_routes.py` falla también sin estos cambios (quedan rutas `/downloads` o `/pool` que el test prohíbe).
- [ ] Seba: pasar las URLs reales de Patreon y de pago en pesos (hoy todo apunta al placeholder `https://gameaccess.app`).
- [ ] Reiniciar/redeployar el API para publicar `/premium/content` y ver el diálogo con planes en vivo; revisar los textos de planes (2 y 4 USD).
- [ ] Probar la clave en vivo contra el server real desde el diálogo nuevo.
- [ ] Probar el instalador `.exe` del plugin y el botón de la página (Seba).
- [ ] Cuenta `gh`: la activa quedó la del plugin; volver a `sebasu66` (`gh auth switch -u sebasu66`).

## UI y cliente
- [ ] Diseño Digital aprobado: aceptación visual y validación de ficha/descargas con datos reales (detalle del diseño en `TODO_OBSOLETO.md`, sección P1; mockup en `docs/design/gameaccess-ui-2026-10-06/`).
- [ ] Secuencia de inicio: fondo de portadas en diagonal → logo con cubitos + sonido → lluvia de cubitos → pantalla principal.
- [ ] Migrar Dialog y ScrollArea (Radix) si Seba aprueba la preview.
- [ ] Tirón en hover: probar quitar `backdrop-filter: blur(14px)` del footer (`dock.css`) sobre el fondo pixelado.
- [ ] Validar con mando físico el modo Pantalla grande (`docs/BIG_SCREEN_CONTROLS.md`).
- [ ] Auditoría de teclado/foco; acción primaria Descargar/Cancelar/Jugar sin contradicciones; reconciliar estado tras cerrar y reabrir.
- [ ] Nice-to-have: "me gusta / no me gusta" para juegos afines y recomendados.
- [x] Los diálogos del inicio esperan a que termine la animación del logo (`4f29862`).
- [x] Jugar desde el detalle cierra primero el detalle y después muestra el diálogo de ejecución (`4f29862`).
- [ ] Al ejecutar un juego, el foco pasa al juego; cuando el juego termina, vuelve a Game Access.
- [ ] Medir cuánto tiempo corre cada juego (estadística de uso) y mostrar un historial/calendario de cuánto y cuándo se jugó cada juego.
- [x] Importador del Library Manager: una carpeta ilegible (`WpSystem`) cortaba el escaneo de todo el disco y solo aparecía 1 juego; ahora encuentra 122 en la PC de Seba. Vincular dos veces la misma carpeta ya no da error (`b96bb5c`).
- [ ] Seba: probar el importador en la app (escaneo completo y "Vincular" de un juego de Steam); no pude reproducir el "ya está en la biblioteca" en una biblioteca limpia.
- [x] Sincronización con el plugin: el plugin publicado (1.0.0) no tenía `/api/source-index` y la app fallaba en silencio; ahora el diálogo central dice el motivo y ofrece Reintentar; los plugins corren sin ventana (`3a01bbb`).
- [x] Publicado Source Manager 1.0.1 (repo nuevo del plugin, release v1.0.1 marcado como último; la página del botón Instalar apunta a v1.0.1 con SHA-256 `5af57e3a…`, verificado contra la descarga).
- [ ] Seba: probar el botón Instalar de la página del plugin con Game Access abierto (instala, sincroniza sin reiniciar, sin ventana ni firewall).

## Release
- [ ] Instalador exacto desde el commit probado (commit, hash, build stamp); instalación en VM limpia; revisar textos visibles; logo/splash nuevo en el instalador.
- [ ] Smoke test de release (catálogo corrupto, assets faltantes, tipos no-juego); empaquetar artwork estático; trailers on-demand.
- [ ] Firmar instalador (evitar SmartScreen); backups, rate limiting y revisión legal antes de la beta abierta.
- [ ] **Instalar por winget** (`winget install GameAccess`; Seba 2026-10-19): manifiesto en `microsoft/winget-pkgs` con la URL del instalador del release y su SHA-256, cuando haya releases en `main` y el instalador esté firmado. Opcional: `install.ps1` para `irm … | iex` (baja el último release, verifica el SHA-256, corre `/S` y acepta las carpetas como parámetros); solo como alternativa para usuarios técnicos, porque los antivirus desconfían de ese patrón. El camino principal sigue siendo el botón de descarga de la página.

## Mantenimiento y dudas abiertas
- [x] Commitear la limpieza y la bóveda: `23028b6` (limpieza de la raíz) y `ca31480` (vault, README, skill, AGENTS).
- [ ] Primer push de `dev` a `origin`: hoy `dev` está 18 commits adelante de `origin/dev` (16 previos + los 2 de hoy). Seba debe aprobarlo antes: el remoto es el repo público `sebasu66/gameAccess` y el vault contiene planes, precios y la estrategia de fuentes.
- [ ] Seba: confirmar los estados marcados † en `vault/Proyecto.md` (biblioteca, cola de descargas, versión Plus, importador de juegos propios, planes y precios).
- [x] `README.md` y `skill.md`: quitadas las menciones a la versión vieja de licencias Steam (2026-10-16) y alineados con el vault (entrada libre sin llave, disponibilidad de fuentes desde la base). Corrección: antes anoté por error que seguían con reglas viejas de leases; no los había leído.
- [ ] Docs viejos que todavía hablan de licencias/leases de Steam (12 archivos, ver [[Limpieza]]): decidir si se archivan en `docs/archivo/`. Dueño: Seba decide, Claude mueve.
- [ ] Seba: revisar lo que dejé sin mover en la raíz (`dev.ps1`, `run_local_api.bat`, scripts `*_DEV_LAB.cmd`, `automation/`, `examples/`, `debug/`) y confirmar que `_papelera/` se puede vaciar (cuidado: los `.psd` del logo y `accFull*.csv` solo existen ahí).
- [ ] Baja prioridad, después de B: revisar los 11 archivos sin uso que reporta `npx knip` en `apps/desktop` (ver [[Limpieza]]) y borrar los que sean de la versión vieja de licencias Steam. Dueño: Gemini; verifica Claude.
- [ ] Baja prioridad: sacar de `apps/api` lo que queda de la versión vieja (`linkvertise_access.py`, campos `credits` y `credit_cost_per_hour` de `models.py`, imports sin uso de `main.py`) si Seba confirma que Linkvertise y los créditos no vuelven.
- [ ] Duda de Seba: el fix de idioma (.ini en ruso, etc.) se aplica una sola vez, marcado en el manifiesto de instalación; hoy corre en cada Play. ¿Confirmado?
- [ ] Nota del matcher: la lista de palabras de versión (`all`, `with`, `win`…) se compara con "empieza con" ("allstars" cuenta). Se porta igual a Rust; corregirlo después, en plugin y Rust a la vez.
