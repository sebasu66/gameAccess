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

## Juegos de Steam (Seba, 2026-10-25)
- [x] **Steam Account Manager** (Claude, 2026-10-25; `apps/launcher/steam_account_manager`): encuentra Steam (registro o carpetas de siempre), lee las cuentas recordadas (`loginusers.vdf`), las bibliotecas (`libraryfolders.vdf`) y los juegos instalados (`appmanifest_*.acf`); la cuenta dueña de un instalado es `LastOwner`. **Solo cuentas con "Recordarme"** (Seba, 2026-10-25): las demás y sus juegos quedan afuera. Los que tienen sin instalar los pide el launcher al servidor (`POST /steam/owned-games`, `apps/api/app/steam_owned_routes.py`), que tiene la clave `STEAM_WEB_API_KEY` en su entorno, guarda cada respuesta 12 h y limita 30 pedidos por hora por dirección; el usuario nunca carga una clave. Un perfil privado solo aporta sus instalados.
- [x] **Importación automática** (Claude, 2026-10-25): al abrir la app se vinculan los instalados y se suman los propios sin instalar (sección "por instalar"); Configuración › Steam la apaga. También "Importar biblioteca de Steam" en el administrador de biblioteca y en Configuración. Un juego que el usuario quita no vuelve (`steam_hidden.json`).
- [x] **Jugar con la cuenta dueña** (Claude, 2026-10-25): si Steam está en otra cuenta, Game Access lo cierra, pone `AutoLoginUser` en la dueña y lo abre; espera el inicio de sesión (hasta 3 min, por si Steam pide la contraseña) y corre `steam://rungameid`. Se apaga en Configuración › Steam.
- [x] **Instalar con Steam** (Claude, 2026-10-25): los propios sin instalar muestran "Instalar con Steam" (`steam://install/<appid>`); nunca por las fuentes de Game Access. La cuenta dueña se ve en el menú de la tarjeta y en el administrador.
- [x] **Instalador: Steam es requisito** (Claude, 2026-10-25): sin Steam, el instalador ofrece la página de descarga de Steam y se cierra (`GAMEACCESS_REQUIRE_STEAM` en `hooks.nsh`); las actualizaciones no lo revisan.
- [x] Cambio real de cuenta (Claude, 2026-10-25): GTA V Legacy de `salidruki` lanzado por la acción `play`; Steam entró a esa cuenta en 4 s y corrió el juego.
- [ ] Seba: confirmar que `STEAM_WEB_API_KEY` está cargada en Render (gameaccess-api-dev > Environment) y publicar el servidor (Render publica desde `main`); hasta entonces la lista de juegos sin instalar solo funciona con una API local.
- [ ] Seba: probar Jugar desde la ventana de la app y el instalador en una PC sin Steam.
- [ ] Página web: listar la importación de juegos de Steam como feature.

## Pasos ya decididos (ejecutar en orden)
- [ ] **Importar juegos ajenos al catálogo**: usar `GameExecutionManager.prepare` para dejarlos listos dentro de Game Access (la importación todavía no existe). Pendiente también: marca de advertencia en la tarjeta del juego en la biblioteca (hoy solo en el menú y en el diálogo de Play fallido).
- [ ] **Autoactualización segura** con el updater de Tauri: firmada, chequeo al abrir, aplica al reiniciar, conserva la versión anterior y revierte si crashea, config remota para arreglos sin release; repo público aparte para binarios/manifest. Debe estar en el primer build público.
- [ ] **Traducciones es/en completas e instalador NSIS profesional.** Traducciones: avanzadas según `git log` (`f72557e` catálogos es/en con test de paridad, `79f52da` y `bbfe815` etiquetas movidas a los catálogos, script de control); falta confirmar que no queden textos fijos y la selección automática de idioma por ubicación (verifica Claude). Revisión 2026-10-18: traducidas las etiquetas de biblioteca y filtros, los estados de descarga y la descripción de respaldo. Textos del launcher: los de la ruta de descarga acelerada y sus errores ya viajan como claves traducibles (`ui_text.py` → `launcherText.ts`, 2026-10-24); pendiente pasar igual el resto (cola, torrent, descompresión, instalación) y las pistas (hints) de multijugador en `librarySearch.ts`. Plugin: envía textos traducidos por `?lang=` (ga-torrent-plugin, sin publicar todavía). Instalador NSIS pendiente: idioma automático y registro del protocolo `gameaccess://`.
- [ ] **Landing en GitHub Pages** (qué es, cómo funciona, FAQ, privacidad, descarga), enlazada desde Patreon; Patreon solo para pago y comunidad.
- [ ] **Pestaña nueva "Librería"**: estadísticas de uso de juegos por día y por mes (reutilizar `UsageChart` y los datos `usage` de `library-list`). Solo pendiente; el Library Manager ya trae los componentes shadcn/Recharts.
- [ ] **Selector de idioma ES/EN**: moverlo a Configuración y quitarlo de las pantallas (hoy solo se oculta en las pantallas con `.ga-screen-header`, p. ej. el Library Manager). Usar `.ga-screen-header`/`.ga-screen-title` (gameaccess-theme.css) como cabecera estándar en todas las pantallas completas.
- [x] **Versión instalada en la tarjeta** (Claude, pedido por Seba 2026-10-19; falta verlo en la app con una descarga real): cada instalación guarda en su registro (`.cache/digital_games/<appid>.json`, campo `source`) el nombre que le da su fuente y de qué fuente vino; la tarjeta de la biblioteca lo muestra debajo del nombre (el tooltip dice la fuente). Las instalaciones anteriores no lo tienen.
- [x] ~~**Varias versiones del mismo juego instaladas a la vez**~~ **Descartado** por Seba 2026-10-19: demasiado trabajo para algo poco probable (plan archivado en [[Varias versiones]]). Regla: **un solo juego por AppID**. Bajar un juego ya instalado muestra "ya está instalado; para instalar otra versión, primero desinstalalo" (sin reemplazar automáticamente) e importar uno que ya está en la biblioteca sigue rechazado.
- [x] **Nombre propio en la biblioteca** (Claude, 2026-10-19; falta verlo en la app): "Cambiar nombre" en el menú de la tarjeta guarda `label` en el registro del juego (o en el del vínculo); la tarjeta muestra el nombre propio o, si no hay, "proveedor · nombre de la fuente" (como lo muestra el plugin). No cambia la base de juegos ni la imagen.
- [x] **Gestor de biblioteca: tabla y búsqueda única** (Claude, pedido por Seba 2026-10-25; falta verlo en la app instalada): sin buscador propio, lo filtra el buscador del catálogo y la librería; la lista pasa a una tabla con portada, nombre, estado, carpeta, tamaño, origen (cuenta de Steam o proveedor), partidas y última partida, ordenable por cada columna (flecha naranja en la activa) y con las acciones de cada fila fijas a la derecha.
- [x] **Gestor de biblioteca: descarga pendiente** (Claude, 2026-10-19): una descarga en la cola, pausada o corriendo (`queue.json` del Download Manager) marca el juego como sin terminar aunque todavía no tenga archivos temporales: insignia "Descarga pendiente", sin "Corregir" ni pasar a `ready`, no cuenta en "Con error" ni en el aviso de la tarjeta.
- [x] **Descarga que no es un juego** (Claude, 2026-10-19): si lo bajado no tiene ningún ejecutable ni instalador (`.exe/.bat/.cmd/.msi/.com`) ni archivos por descomprimir, se borra de la carpeta de juegos y de la temporal, no queda en la biblioteca y la app avisa qué traía (música, imágenes, videos, documentos) y recomienda buscar otra fuente (código `not_a_game`, `NotAGameDialog`), sin ofrecer reintentar ni arreglar.
- [x] **Importación: AppID de emuladores y fixes** (Claude, 2026-10-19): el escáner lee `OnlineFix.ini` (`RealAppId=`), `steam_emu.ini` y `ColdClientLoader.ini` (`AppId=`) y `steam_appid.txt` hasta 5 niveles adentro (ignora 480/Spacewar); el diálogo muestra de qué archivo salió. En la PC de Seba identifica Trail Out, Dynasty Warriors 8 y The Mound Omen of Cthulhu.
- [x] **Importación: limpieza del escaneo** (Claude, 2026-10-21; falta verlo en la app): el escáner saltea programas y carpetas de soporte (Blender, ShapeLab, Foundry VTT, EasyPose, Nucleus, CoreFX, Open Brush, Blocks, Ubisoft Connect, Steamworks Common Redistributables, Spacewar), lo que Steam lista como herramienta o aplicación (`appinfo.vdf`), carpetas de descargas, carpetas con solo instaladores o sin `.exe` y descargas a medias; el mismo juego encontrado dos veces se marca «Repetido» y solo se importa el primero; un juego hallado por AppID toma el nombre del catálogo/Steam; el diálogo de importación ya no crece más que la ventana. Un juego vinculado se quita de la biblioteca sin tocar sus archivos (el menú no ofrece «Desinstalar»).
- [ ] **Importación: pulir**: elegir manualmente el juego del catálogo con buscador (hoy un desplegable con sugerencias), opción «aplicar a todos» vincular/mover, progreso del escaneo por disco, opciones de lanzamiento (ejecutable/argumentos) para juegos vinculados, probar con discos reales y con una biblioteca Steam real.

## Interfaz nueva (estilo de la demo GSAP)
Guía completa, valores y orden: `docs/TAREA-interfaz-nueva.md` (leerla entera antes de empezar). Referencia visual: `docs/design/gameaccess-gsap-demo-2026-10-23/index.html`. Skill: `.claude/skills/gameaccess-motion-ui`. Un commit probado por tarea en `dev`.
- [x] T0 · Actualizar `docs/GUI_DESIGN.md` con los componentes y valores nuevos.
- [x] T1 · Instalar GSAP + `@gsap/react` y crear `src/motion/gsap.ts` (plugins, movimiento reducido).
- [x] T2 · Botones como componentes: `GaButton` (naranja de vidrio), `GaIconButton` (cubo), `GaClose`, `GaBack`.
- [x] T3 · Aviso único abajo a la derecha (reemplaza toasts, diálogo al jugar, descarga terminada y confirmaciones simples).
- [x] T4 · Pie: cubos sin texto que se encienden, campana con no leídos, globo de idioma.
- [x] T5 · Catálogo para descubrir: sin instalados salvo al buscar, banner de lo nuevo en Steam, sin pastillas de filtro arriba, ▶ verde en vez de "INSTALADO", salida de tarjetas limpia.
- [x] T6 · Palabra gigante del costado (CATALOGO / LIBRERIA, sin tilde) y giro 3D entre catálogo y librería.
- [x] T7 · Librería en grilla bento por bandas, congelados (jugable / profundo a la derecha), pastillas Solo instalados / Solo favoritos.
- [x] T8 · Hamburguesa tras 2 s y menú en el dorso de la tarjeta (Jugar/Instalar, Cambiar nombre, Administrar).
- [x] T9 · Ficha: abrir desde la tarjeta sin portada gigante; cerrar con la grilla de cuadraditos.
- [x] T10 · Paneles laterales (≥ 1800 px) y modo una pantalla por vez; paneles en gris y perspectiva sin foco.
- [x] T11 · Administrador de biblioteca compacto con dona del disco y acciones avanzadas.
- [x] T12 · Descargas rediseñadas (gráfico de velocidad, cola, sesión).
- [x] T13 · Novedades como panel con contador de no leídos.
- [x] T14 · Resto de las pantallas (configuración, ayuda, importar, etc.) con los mismos componentes.
- [x] T15 · Revisión final (movimiento reducido, anchos, mando, teclado, rendimiento, app instalada).
- [x] T16 · Marco de dispositivo en la app (Seba, 2026-10-25): bisel con pestañas, logo animado en la esquina y GAME / ACCESS dibujado en la columna derecha, activado por defecto (antes solo `?deviceFrame=1` en desarrollo); en la ventana de escritorio empieza debajo de la barra de título. `?deviceFrame=0` lo apaga; tablet y TV no lo usan. Falta verlo en la app Tauri.

## Cola de funciones (de más fácil a más difícil)
- [ ] Aviso "¿descarga lenta?" (monitor de velocidad del torrent + planes de aceleración). Necesita el texto completo del plan de 4 USD (Seba).
- [ ] Registro de tiempo de juego (solo grabar, sin límites todavía).
- [ ] **Aviso de driver de video viejo** (Seba 2026-10-22, Cyberpunk lo avisó y Game Access no): al abrir la app y antes de jugar, detectar GPU y versión del driver (NVIDIA: NVAPI `GetDriverAndBranchVersion` ya probado en `tools/benchmark/nvidia_profile.py`; AMD/Intel: `Win32_VideoController` DriverVersion/DriverDate) y compararla con la última publicada; si está vieja, aviso con enlace a la descarga oficial (NVIDIA App / AMD Adrenalin / Intel). Sin instalar nada por nuestra cuenta.
- [ ] **Game Boost** (investigación y prototipo en `docs/GAME_BOOST_RESEARCH.md` y `tools/benchmark/`): opciones antes de jugar (cerrar/pausar apps elegidas, prioridad + EcoQoS, servicios, efectos visuales, un solo monitor, límite de FPS por perfil NVIDIA = Hz − 3) y restaurar al salir. Medido: límite de FPS en Heaven −66% consumo de GPU y mitad de CPU; alivianar +6-8% FPS pero la purga de RAM en espera empeoró los tirones de Superposition (falta aislar). Pendiente: medir en Cyberpunk con la configuración real de Seba.
- [ ] Detalle del juego enriquecido: videos editoriales por Steam AppID/idioma, gameplay/walkthroughs y notas de prensa. El protocolo editorial v2 está documentado en `docs/EDITORIAL_VIDEO_FORMAT.md`; sigue pendiente diseñar e implementar el registro del video publicado y su reproducción en la ficha.
- [ ] Congelado de juegos (freezer): comprimir un juego de forma fácil de descomprimir.
- [ ] Congelado automático tras 1, 2 o 3 meses sin uso (parámetro), con ícono de frío junto a Play y tooltip.

## Modo niño (diseño en [[Modo niño]]; no implementar hasta que Seba lo pida)
Decidido con Seba 2026-10-19: cuenta local estándar para el niño con Game Access como escritorio (modo quiosco); el adulto usa Game Access normal en su cuenta. Orden:
- [x] **MN.1 Instalación para toda la PC** (Claude, pedido por Seba 2026-10-19; falta prueba de Seba instalando y actualizando): `"installMode": "perMachine"` (`Program Files\gameAccess`); el estado del launcher (`.cache`, `logs`) pasa a `%LOCALAPPDATA%\gameAccess\launcher` (`GAMEACCESS_LAUNCHER_DATA`, `launcher_data.py`); página nueva del instalador para elegir la carpeta de juegos (por defecto `C:\juegos_GameAccess`) y la de descargas (por defecto `Descargas\GameAccessDownloads` de cada usuario), guardadas en `HKLM\Software\gameAccess`. Plantilla NSIS propia (`src-tauri/windows/installer.nsi`, copia de Tauri 2.11.4 con un agregado) + `windows/hooks.nsh`. Pendiente: confirmar que la autoactualización (pide administrador) funciona; desinstalar a mano la instalación vieja por usuario (`C:\gameAccess`).
- [ ] **MN.2 Prueba de concepto del quiosco** (primera prueba de Seba 2026-10-29: la sesión abre solo con Game Access —la versión instalada, vieja—; la escala de pantalla no era la nativa; Alt+F4 cerró Game Access y quedó negro hasta Ctrl+Alt+Supr. Ctrl+Alt+Supr no se puede quitar: el script deja solo "Cerrar sesión" en esa pantalla y copia la escala del adulto. Bloqueo por contraseñas mal puestas: Windows ya trae 10 intentos → 10 minutos; el adulto debería usar PIN o una contraseña que el niño no sepa): con `tools/windows/kid-account.ps1` (Claude, 2026-10-29; lo corre Seba como administrador), una cuenta local estándar de prueba con Game Access como shell (`HKCU\...\Winlogon\Shell`), Administrador de tareas y Ejecutar deshabilitados, discos ocultos (`NoDrives`/`NoViewOnDrive`), directivas de restricción de software de usuario (nada corre salvo Windows y Program Files, sin `steamapps`, Epic, GOG ni navegadores) y horario de inicio de sesión; habilitar un juego con `-Allow` y ver que corre y que los demás no. Confirmar en Windows 11 Home y Pro. Anotar vías de escape (Steam, Roblox, diálogos de archivo).
- [ ] **MN.3 Modo niño en Game Access** (pedido de Seba tras la primera prueba, 2026-10-29): leer el SID de la sesión y `ProgramData\GameAccessamilia.json` (solo lectura para usuarios). En cuenta de niño: **Big Picture fijo** (no se puede salir), solo los juegos que puede correr y el tiempo que le queda; sin configuración, tienda, descargas ni importador; tiene que funcionar **con teclado y mouse**, no solo con gamepad. **Cerrar Game Access (Alt+F4 o "Salir") cierra la sesión de Windows** y vuelve a la elección de usuario; si se cuelga o se cae, se relanza o se cierra la sesión (hoy queda la pantalla negra y hay que usar Ctrl+Alt+Supr).
- [ ] **MN.4 Control parental en modo adulto**: elegir/crear la cuenta del niño, juegos, horarios, límites y PIN; aplicar con Game Access relanzado elevado (crear cuenta, shell, `DisableTaskMgr`, horario de inicio de sesión, `familia.json`). Guía para la Vista familiar de Steam y carpeta compartida de juegos.
- [ ] **MN.5 Tiempo y cierre**: contar tiempo por juego y por día, avisos previos ("quedan 5 minutos"), cerrar el juego y la sesión al agotarse; relanzar Game Access si se cuelga. Para cerrar el juego: `process_control::terminate` (src-tauri, `filelocksmith::quit_processes`, TerminateProcess) sobre los procesos del juego, que `game_focus.rs` ya sigue por su carpeta (`game_processes`); conviene pedirle antes que se cierre solo (WM_CLOSE) y forzar unos segundos después (Seba, 2026-10-28).
- [ ] **MN.6 Servicio SYSTEM** (obligatorio desde 2026-10-29): habilita la carpeta de un juego para la cuenta del niño (regla SRP en su registro) cuando Game Access lo pide (named pipe; comprueba cuenta, juego permitido, tiempo y horario), lleva el tiempo, cierra el juego y saca el permiso al acabarse; al arrancar saca los permisos que quedaron. Opcional: vigilar procesos (ETW + firma digital).
- [ ] **MN.7 App del celular del padre** (idea de Seba, 2026-10-29): ver y administrar al niño (tiempo jugado y restante, sumar tiempo, habilitar o bloquear juegos, horario) hablando con el servicio de la PC. Sin diseñar.

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
- [ ] Aguantar ~100 usuarios: links de piezas en archivo, no en Supabase. (2026-10-21: ya no hace falta esconder IPs de clientes de Torbox; su ayuda dice que no rastrea IPs y permite compartir con amigos y familia. El límite real es de volumen: 10/20/30 TB por mes según plan, con 3 avisos que rotan la clave y ban al cuarto.)
- [ ] **Cuentas de Torbox (decisión de Seba 2026-10-21):** una sola cuenta + Viking como caché hasta el primer aviso de Torbox; entonces evaluar más cuentas u otros debrid en paralelo. El programa Partners de Torbox es para proyectos con base de usuarios: verlo más adelante.
- [ ] Tabla de tareas en ejecución en la web del servidor.
- [ ] Servidor en Render funcionando igual que en local.
- [ ] Publicar deltas del catálogo en el servidor (`kind: "delta"`, `base_revision`, `revision`) — spec en `docs/game-access-todo.md`.
- [ ] Logs de la app dentro del proyecto (`apps/launcher/logs` o `api/logs`).

- [x] Espacio en disco antes de descargar (Seba, 2026-10-25): la app lo revisa al encolar también con el tamaño en texto de las fuentes del plugin; el worker lo revisa apenas sabe el tamaño real (torrent, enlace directo, piezas del servidor), contando lo ya bajado y los dos discos.
- [x] Retomar desde el paso en que se cortó (Seba, 2026-10-25): el registro de instalación guarda el paso (descarga / descompresión), la fuente y el archivo bajado; un error ya no borra lo descargado (solo cancelar); "Reintentar" en el Download Manager (`/jobs/<id>/retry`) y en el administrador de biblioteca sigue desde ahí, sin plugin y también después de reiniciar la app.
- [x] Botón "Abrir carpeta de descarga" mientras descarga, en descargas y en el administrador (Seba, 2026-10-25).
- [x] Menú del catálogo = panel lateral de la biblioteca, solo con Instalar (si hay fuentes y plugin), Añadir a la biblioteca, Página de Steam y Favoritos (Seba, 2026-10-25).
- [ ] **Lo aprendido por juego** (Seba, 2026-10-26; diseño en [[Lo aprendido por juego]]): una lista por juego (AppID) en el servidor, con copia en el SQLite de cada cliente sincronizada con las novedades del catálogo (snapshot y diferencias); las consultas son locales y no esperan a la red. Tipos abiertos: `bad_source` (fuente que no sirve, por huella, nunca la URL), `how_to_run` (requisitos o pasos especiales), `abandoned` (el juego ya no es válido).
  - [x] Servidor (`game_lessons.py`: votos anónimos por instalación, umbral de 2, revisiones, `GET /game-lessons?since=`, administrador), tabla local y comandos en Rust (`game_lessons.rs`; consulta de 24 µs con 50.000 lecciones), fuente mala reportada al dar `not_a_game` y mandada al final del menú; Descargar nunca la elige por defecto.
  - [x] Decisiones de Seba aplicadas: "cómo correrlo" y "abandonado" los carga solo el administrador y requieren aprobación; las fuentes inválidas se publican solas; un juego abandonado se descarga pero sin la aceleración del servidor (rechazada también por el servidor); la fuente marcada baja al final.
  - [ ] Mostrar "cómo correrlo" en la ficha y al jugar, y avisar en la ficha que un juego abandonado no se acelera. Pantalla de administración para cargar y aprobar lecciones.
  - [ ] Reportar también contraseña incorrecta y archivo dañado (falta su `errorCode` en el launcher). Prueba en la app.

## Premium y comercial (Paso 1 hecho, falta cerrar)
- [x] **Llaves para testers** (Claude, pedido por Seba 2026-10-19; falta desplegar el servidor y probar con un amigo): en `/admin`, sección "Llaves para testers": nombre del tester, fecha de fin (por defecto un mes) y cantidad → llaves PLUS hasta esa fecha. La primera activación la ata a ese Windows; en otro la rechaza. "Desvincular" la libera si el tester reinstala Windows (no cambia la fecha). La lista muestra para quién es y su Windows (8 primeros caracteres).
  - Cliente: el identificador de instalación sale ahora del `MachineGuid` de Windows (hash, no se envía el GUID), no de un archivo al azar en `%LOCALAPPDATA%`. Copiar la carpeta de activación a otra PC ya no sirve. Las activaciones hechas antes con el identificador viejo hay que hacerlas de nuevo (no hay usuarios todavía).
- [ ] Pendiente previo: `tests/test_current_product_routes.py` falla también sin estos cambios (quedan rutas `/downloads` o `/pool` que el test prohíbe).
- [ ] Seba: pasar las URLs reales de Patreon y de pago en pesos (hoy todo apunta a `https://gameaccess.site/plus`).
- [x] **Dominio definitivo `gameaccess.site`** (Seba, 2026-10-25): la app y el servidor llevan al jugador a `https://gameaccess.site/plus` (cómo conseguir la llave PLUS y pagar); `SITE_URL` y `PLUS_URL` en `apps/desktop/src/projectConfig.ts`. Las actualizaciones siguen siendo automáticas (GitHub), sin enlace.
- [ ] Publicar la web en `gameaccess.site` (hoy sin desplegar) con la página `/plus` y la sección de descarga; hasta entonces el botón de la pantalla PLUS abre una dirección que todavía no responde.
- [ ] Reiniciar/redeployar el API para publicar `/premium/content` y ver el diálogo con planes en vivo; revisar los textos de planes (2 y 4 USD).
- [ ] Probar la clave en vivo contra el server real desde el diálogo nuevo.
- [ ] Probar el instalador `.exe` del plugin y el botón de la página (Seba).
- [x] Cuenta `gh`: vuelta a `sebasu66` (2026-10-24); antes la activa era la del plugin (`gh auth switch -u sebasu66`).

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
- [x] (Ya hecho: `dev` está al día con `origin/dev` el 2026-10-24.) Primer push de `dev` a `origin`: hoy `dev` está 18 commits adelante de `origin/dev` (16 previos + los 2 de hoy). Seba debe aprobarlo antes: el remoto es el repo público `sebasu66/gameAccess` y el vault contiene planes, precios y la estrategia de fuentes.
- [ ] Seba: confirmar los estados marcados † en `vault/Proyecto.md` (biblioteca, cola de descargas, versión Plus, importador de juegos propios, planes y precios).
- [x] `README.md` y `skill.md`: quitadas las menciones a la versión vieja de licencias Steam (2026-10-16) y alineados con el vault (entrada libre sin llave, disponibilidad de fuentes desde la base). Corrección: antes anoté por error que seguían con reglas viejas de leases; no los había leído.
- [ ] Docs viejos que todavía hablan de licencias/leases de Steam (12 archivos, ver [[Limpieza]]): decidir si se archivan en `docs/archivo/`. Dueño: Seba decide, Claude mueve.
- [ ] Seba: revisar lo que dejé sin mover en la raíz (`dev.ps1`, `run_local_api.bat`, scripts `*_DEV_LAB.cmd`, `automation/`, `examples/`, `debug/`) y confirmar que `_papelera/` se puede vaciar (cuidado: los `.psd` del logo y `accFull*.csv` solo existen ahí).
- [ ] Baja prioridad, después de B: revisar los 11 archivos sin uso que reporta `npx knip` en `apps/desktop` (ver [[Limpieza]]) y borrar los que sean de la versión vieja de licencias Steam. Dueño: Gemini; verifica Claude.
- [ ] Baja prioridad: sacar de `apps/api` lo que queda de la versión vieja (`linkvertise_access.py`, campos `credits` y `credit_cost_per_hour` de `models.py`, imports sin uso de `main.py`) si Seba confirma que Linkvertise y los créditos no vuelven.
- [ ] Duda de Seba: el fix de idioma (.ini en ruso, etc.) se aplica una sola vez, marcado en el manifiesto de instalación; hoy corre en cada Play. ¿Confirmado?
- [ ] Nota del matcher: la lista de palabras de versión (`all`, `with`, `win`…) se compara con "empieza con" ("allstars" cuenta). Se porta igual a Rust; corregirlo después, en plugin y Rust a la vez.


## Tareas nuevas (Seba, 2026-10-28)
Ordenadas a partir de las notas sueltas de Seba y de lo conversado ese día.

**Errores**
- [ ] El botón Maximizar a veces no funciona.
- [ ] Al volver de un juego, restaurar la ventana como estaba antes de jugar (maximizada o pantalla completa). Algunos juegos cambian la resolución del monitor y la devuelven al cerrar, pero la ventana de Game Access queda chica. Vale también para Big Picture: ahí solo se ve la grilla de tarjetas, A abre el juego y al terminar vuelve a la misma pantalla, que tiene que volver a ocupar toda la pantalla.
- [x] Quitar el logo animado de la esquina superior derecha; el logo nuevo es el de la portada (`2db1f43`, `93abc65`).
- [x] La animación que escribe GAME / ACCESS en la columna derecha se detenía al volver de un juego o del modo de bajo consumo y no volvía; ahora retoma su ciclo (`2db1f43`). Falta confirmarlo en la app.

**Ayuda contextual**
- [ ] Reemplazar la ayuda aislada de su panel por ayuda contextual: en cada pantalla un ícono de ayuda; al mantenerlo apretado aparecen textos como tooltips sobre los botones y el propósito general de la pantalla o función. Objetivo: que se note que es fácil de usar, también para padres y chicos.

**Plugins en su propia pantalla**
- [ ] Un botón 3D más en el borde de la tablet (abajo a la derecha) que lleva a **Plugins**: la lista de plugins instalados, con los ajustes de cada uno.
- [ ] Ahí se muestra la interfaz propia de cada plugin, que hoy no se puede ver. Por ejemplo, la del plugin de fuentes: qué fuentes importa y su buscador por nombre, que devuelve todo lo que encuentra (más ágil que la comparación con el catálogo, que a veces se equivoca o deja fuentes afuera). Hacer clic en un resultado ofrece pasarlo a Descargas e iniciar la descarga; como toda descarga, pide elegir qué juego es (AppID). La comparación automática con el catálogo sigue como está.
- [ ] Diseño a decidir con Seba: cómo se inserta la interfaz del plugin sin darle acceso a la app (página aislada que solo puede pedir acciones permitidas, como "agregar esta descarga"). Se relaciona con PS.1 a PS.3.
- [ ] Separar el botón principal de la ficha del plugin: el botón hace siempre lo mismo (Jugar, Instalar con Steam, Ver progreso o Ver en Steam) y las fuentes del plugin van en un panel aparte. La descarga cargada a mano ya está en el panel de Descargas (sección plegable) y se queda ahí.

**Versión de pago (Patreon)**: no cambia por ahora.
- Cola de descargas y descargas simultáneas, aceleradas o por torrent local.
- Aceleración de torrents, instalación automática y aplicación automática del fix.
- Lista de Seba de funciones de la app que también figuran: administrador de bibliotecas, importador de juegos locales, compresor de juegos (freeze).

**Extensiones del catálogo (deseable, sin prioridad)**
- [ ] Paneles de vidrio a los costados de la ficha, como realidad aumentada, con extras: crítica (Metacritic, que ya está en el catálogo, y OpenCritic), PCGamingWiki, guías de Steam, páginas de mods (Workshop, Nexus, ModDB) y HowLongToBeat; solo enlaces. Con la ventana chica, se muestran aparte. Mencionar Co-Optimus en la web como parte del catálogo enriquecido.
