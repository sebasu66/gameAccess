# gameAccess — Central TODO

> **Authoritative prioritized implementation queue**  
> Last reviewed: 2026-09-13
>
> Keep this file ordered by priority. When a task is completed, mark it `[x]` and add a short result/commit note where useful. New work should be inserted according to dependency/priority rather than simply appended.


## P0 — Beta de acceso por tiempo (plan vigente)

> Este bloque recoge las decisiones recientes. El acceso plano por tiempo sustituye las fichas, el saldo y el cobro por juego de las secciones históricas de este TODO. Las suscripciones mensuales y el actualizador automático se posponen.

### Activación y arranque

- [x] Pantalla de clave con portadas reales del catálogo, mensaje de acceso temporal y enlace a una página interna para obtener la clave. Se verificó el canje de una clave de 12 horas desde el frontend contra una base de prueba aislada.
- [x] Claves de cortesía reutilizables para desarrollo y testers desde el archivo privado `apps/api/courtesy-keys.json`. Cada canje crea una sesión distinta por instalación, válida un mes; editar o quitar la clave invalida sus sesiones vigentes. El archivo queda fuera de Git.
- [ ] Terminar la pantalla inicial de Tauri: bloquear catálogo, descargas y juego hasta verificar una activación vigente; incluir campo de clave manual, vencimiento, errores y reintento, usando los diálogos propios de Game Access.
- [ ] Generar un identificador persistente por instalación. El servidor emite claves aleatorias de un solo uso con duración configurable (primera oferta: 12 horas), registra activación y vencimiento en UTC desde el primer canje, vincula el canje a una instalación y permite revocar. Preparar emisión administrativa segura. No confiar en el reloj ni en un contador continuo del cliente.
- [ ] Aplicar la activación en cada endpoint protegido del servidor, incluidos catálogo, asignación y lanzamiento. Definir contenido previo a la activación, renovación, comportamiento sin conexión, reintento y tratamiento de sesiones en curso al vencer.
- [ ] Añadir splash/tablero con logo, bienvenida beta, explicación expandible, instrucciones y enlace para obtener acceso. Al abrir, consultar estado del servidor, avisos, versión mínima y URL de descarga; mostrar actualización recomendada u obligatoria y bloquear versiones viejas también en la API. Actualización manual por ahora.
- [ ] Quitar las fichas del flujo activo y contratos de la beta; preservar los datos anteriores hasta definir su migración. El plazo de acceso habilita todas las funciones previstas de forma uniforme.

### Linkvertise

- [ ] Grabar e incorporar el video real del recorrido de Linkvertise en la página de instrucciones. Conectar el botón de salida al enlace emitido por el servidor una vez configurada la cuenta y la verificación oficial; no mostrar una clave sin esa comprobación.
- [ ] Mantener un enlace corto reutilizable y destino propio. Verificar en el servidor la prueba oficial de finalización de Linkvertise antes de emitir cada clave; rechazar pruebas ausentes, vencidas o repetidas. Guardar credenciales solo en el servidor, registrar emisión/canje y limitar abusos. Las 12 horas corresponden al acceso, no al enlace.
- [ ] Tras verificar Linkvertise, asociar de forma segura el navegador con un intento de activación de la instalación que abrió el enlace; Tauri consulta ese intento y entra automáticamente al recibir el permiso. Preparar página de retorno que muestre estado, vencimiento y, como respaldo, clave con botón de copia. No incluir claves ni sesiones en URLs; probar extremo a extremo con la cuenta real antes de abrirlo. Otros acortadores quedan para después.

### Español e inglés

- [ ] Agregar selector persistente español/inglés y traducir UI, acceso, splash, ayuda, diálogos, mensajes del servidor y errores. Definir idioma inicial y alternativa cuando falta una traducción.
- [ ] Obtener y almacenar metadatos de Steam por AppID e idioma (descripciones, géneros y funciones). Usar identificadores estables para filtros y búsqueda, sin mezclar etiquetas ni duplicar juegos. Completar antes del catálogo definitivo.

### Continuidad de partidas

- [ ] Medir cobertura y calidad de rutas por juego en `game_data_path` e importación PCGamingWiki; comprobar rutas Windows, Steam userdata, Documentos y AppData antes de alterar archivos del usuario.
- [ ] Crear perfil local de progreso por usuario de Game Access y juego. En juegos compatibles, respaldar originales, preparar rutas para la cuenta Steam asignada antes de jugar, capturar progreso al salir y permitir restauración. Evaluar enlaces/junctions solo por ruta verificada, con juego y Steam cerrados, sin escrituras simultáneas ni conflictos de Steam Cloud.
- [ ] Registrar compatibilidad por juego y excluir transferencia automática si el guardado exige SteamID interno u otra condición especial. Avisar en la ficha y en Ayuda, con Dark Souls III y Elden Ring como ejemplos que requieren prueba real; esos casos quedan a cargo del usuario.

### Publicación y operación

- [ ] Migrar el estado central de SQLite a PostgreSQL/Supabase con migración de datos, secretos solo en servidor, respaldos y recuperación. Evaluar la pausa por inactividad del plan elegido.
- [ ] Publicar API HTTPS en un host independiente del cliente (Replit, no Replicate, es candidato beta). Medir arranque en frío, disponibilidad y capacidad; pasar a instancia siempre activa/VPS cuando sea necesario.
- [ ] Publicar landing y descarga Windows en URL estable (Cloudflare Pages es candidato). Configurar dirección/resolvedor estable para que el cliente encuentre la API aunque cambie el host real. Versionar el instalador.
- [ ] Verificar instalación limpia y flujo completo: bloqueo, emisión/canje único, vencimiento/revocación, Linkvertise, versión mínima, ambos idiomas, juego, cambio de cuenta y guardados compatibles. Revisar credenciales Steam, concurrencia real y condiciones de plataforma antes del lanzamiento comercial.
- [ ] **Pendiente — prueba local Tauri del nuevo catálogo cacheado.** No ejecutar ahora. Retomar después para validar en Windows dos arranques consecutivos del cliente con los cambios de caché/disponibilidad actuales: primer arranque con snapshot ausente/obsoleto, segundo arranque reutilizando `%LOCALAPPDATA%\\GameAccess\\cache\\catalog.sqlite` sin volver a descargar el snapshot si la revisión no cambió; confirmar que sólo se consulta el overlay liviano `/catalog/availability`, que no reaparece el race de sincronización ni refresh duplicado, y medir tiempo total de arranque/carga. Incluir verificación del manifest vía GitHub API, revisión local, cantidad de juegos y fallback si la caché no está disponible. Cambios relacionados: `fab128d`, `9fc1791`.


## Current operating model — two parallel fronts

El desarrollo se organizará desde ahora en dos frentes paralelos. El frente Steam es la puerta de entrada del producto y debe alcanzar una interacción confiable antes de agregar demasiadas capas de experiencia. El frente 3D/social debe investigar y validar recursos reutilizables, construir un prototipo independiente y luego integrarlo en Tauri.

### Frente A — Maestría de manejo de Steam

**Objetivo:** conocer, probar y encapsular todas las acciones que Game Access necesita realizar alrededor de Steam, tomando como referencia las acciones observadas en Night Light y mejorándolas dentro de flujos autorizados, seguros y mantenibles.

- [ ] Crear una matriz de capacidades Steam: autenticación, selección de cuenta local, cierre de sesión, cambio de identidad, Steam Guard, biblioteca, licencias, Family Sharing, instalación, pausa/reanudación, actualización, lanzamiento, cierre, detección de proceso, capturas, Steam Cloud y cleanup.
- [ ] Documentar paso a paso las acciones observadas en Night Light: seleccionar un juego, preparar una cuenta autorizada, iniciar la sesión de Steam, aplicar las restricciones necesarias, entregar la sesión temporal, lanzar el juego, controlar duración, detectar finalización y limpiar/restaurar el estado.
- [ ] Separar qué parte de cada acción hace Night Light, qué parte hace Steam y qué parte puede hacer Game Access sin romper las reglas de Steam.
- [ ] Reproducir las acciones primero con cuentas de prueba propias o expresamente autorizadas; no extraer ni reutilizar contraseñas, tokens o sesiones de terceros.
- [ ] Definir un adaptador de Steam reemplazable, con logs de diagnóstico y estados explícitos: AUTH_REQUIRED, ACCOUNT_SELECTED, LIBRARY_LOADING, GAME_READY, INSTALLING, RUNNING, EXITED, CLEANUP_REQUIRED y ERROR.
- [ ] Detectar de forma fiable la instalación de Steam, sus bibliotecas y los usuarios locales conocidos mediante estado local no secreto.
- [ ] Obtener y reconciliar la biblioteca por cuenta, distinguiendo juegos propios, juegos Family Sharing, juegos instalados por otra cuenta y juegos no disponibles para la identidad actual.
- [ ] Probar los mecanismos permitidos para seleccionar una cuenta local sin exigir reintroducir credenciales cuando Steam ya conserva una sesión válida.
- [ ] Documentar exactamente cuándo Steam exige interacción visible, Steam Guard, confirmación, cambio de usuario o una ventana propia.
- [ ] Probar instalación, descarga, pausa, reanudación, actualización, verificación y lanzamiento desde Game Access mediante handoff a Steam.
- [ ] Crear monitor de procesos para Steam, launchers secundarios y juegos; detectar inicio, cierre normal, crash, timeout y relanzamiento.
- [ ] Probar cierre/restauración de sesión y limpieza después de una sesión temporal sin borrar datos personales ni dejar una cuenta en estado inesperado.
- [ ] Investigar el Family Mode observado en Night Light como posible restricción de interfaz, sin asumir que sustituye permisos ni controles de Steam.
- [ ] Completar la matriz de Family Sharing: juegos elegibles, exclusiones, uso simultáneo, múltiples copias, partidas guardadas, logros y limitaciones actuales.
- [ ] Probar el flujo con Baldur's Gate 3 y otros juegos representativos solamente después de verificar la elegibilidad real de las cuentas.
- [ ] Definir qué acciones deben quedarse siempre en Steam y cuáles puede presentar Game Access como UI simplificada.
- [ ] Implementar un flujo de fallback que abra Steam cuando una acción no sea soportada, cambie entre versiones o requiera una decisión del usuario.
- [ ] Registrar evidencias de cada prueba: versión de Steam, sistema operativo, cuentas de prueba, juego, pasos, resultado y limitaciones.
- [ ] Convertir cada caso validado en un perfil de compatibilidad por juego, sin prometer compatibilidad universal.
- [ ] Priorizar una prueba end-to-end: seleccionar cuenta autorizada -> detectar juego -> instalar si falta -> iniciar -> ejecutar -> detectar cierre -> restaurar Game Access.

### Frente B — Recursos open source para prototipo 3D/social

**Objetivo:** investigar, probar y seleccionar recursos reutilizables para construir rápidamente el entorno tridimensional y su primera experiencia social, evitando reinventar networking, voz, sincronización multimedia, edición de escenas y avatares.

- [ ] Inventariar librerías y proyectos open source para Three.js, Tauri, React, WebGL/WebGPU, navegación en primera persona, colisiones, salas y objetos interactivos.
- [ ] Comparar Three.js integrado en Tauri con Godot como alternativa futura; medir tamaño, consumo, carga, video, integración web y facilidad de distribución.
- [ ] Investigar herramientas para crear casas, salones, arcades, museos y habitaciones modulares: Blender, exportación glTF/GLB, iluminación cocinada, LOD, instancing y generación procedural.
- [ ] Buscar assets low-poly, mobiliario, luces, pantallas, consolas, máquinas arcade y decoración con licencia comercial compatible.
- [ ] Investigar networking para presencia, movimiento de avatares, salas, lobbies, mensajes y comunicación entre peers: WebSocket, WebRTC DataChannels y alternativas autoalojables.
- [ ] Investigar voz de sala, voz por proximidad, grupos, silenciamiento y reconexión con WebRTC, LiveKit u opciones open source equivalentes.
- [ ] Probar video sincronizado con HTML video, THREE.VideoTexture, estado autoritativo de sala, corrección de drift, permisos de control y fallback por cliente.
- [ ] Investigar streaming/casting de una PC host hacia los demás participantes con Sunshine/Moonlight, WebRTC y alternativas; medir latencia, calidad e input.
- [ ] Diseñar una primera arquitectura de host explícito y dejar documentada la futura alternancia del host entre componentes de la red.
- [ ] Investigar host migration, elección de nuevo host, reconexión y recuperación sin implementarlo antes de tener una sala estable.
- [ ] Investigar generadores de personajes y avatares 3D fáciles de integrar, modelos humanoides glTF, rigging, retargeting, animaciones y lip sync; revisar licencias antes de elegir.
- [ ] Crear un prototipo visual de una sala pequeña con navegación WASD/flechas, mouse, Enter/E y Escape.
- [ ] Crear objetos interactivos genéricos: máquina, pantalla, cartel, puerta, sillón, estantería y portal a la biblioteca.
- [ ] Diseñar el entorno híbrido: salón público compartido y sección privada personalizable por usuario.
- [ ] En el salón público, mostrar solamente contactos autorizados que estén conectados al sistema y representarlos con avatares simples.
- [ ] En la sección privada, permitir inicialmente muebles básicos, distribución de juegos, banners, videos en pantallas, luces y estilos visuales predeterminados.
- [ ] Crear modelo de datos de sala, permisos public/friends/private, muebles, pantallas, colecciones y posiciones persistentes.
- [ ] Validar la primera función social: dos amigos ven el mismo entorno tridimensional, conversan por voz y reproducen/pausan el mismo video sincronizado.
- [ ] Integrar el prototipo 3D/social en Tauri solamente después de validar la escena y sus recursos fuera del flujo principal.
- [ ] Mantener un modo 2D/grilla, modo de compatibilidad y standby para equipos modestos o cuando el juego está ejecutándose.
- [ ] Documentar una matriz de licencias, mantenimiento, seguridad, tamaño, rendimiento y facilidad de reemplazo para cada dependencia elegida.

### Dependencias entre frentes

- [ ] Mantener ambos frentes desacoplados: el prototipo 3D no debe bloquear la estabilización de Steam y la integración Steam no debe obligar a terminar el mundo completo.
- [ ] Compartir solamente contratos comunes: GameRecord, Room, Presence, SharedMediaState, SteamSessionState y eventos de lanzamiento/retorno.
- [ ] Integrar primero un vertical slice pequeño: salón público + sección privada mínima + video sincronizado + voz + lanzamiento de un juego representativo mediante Steam.

## P0 — Authoritative catalog build + packaged artwork

**Objetivo:** generar el catálogo de Game Access como un artefacto autoritativo y reproducible del backend, con sólo juegos reales y con todo el artwork estático necesario listo antes de construir el instalador. Este proceso debe ser atómico: un scan incompleto nunca reemplaza el último catálogo bueno.

- [ ] Ejecutar nuevamente un **full SteamKit scan de todas las cuentas proveedoras** usando el scanner corregido actual; no reutilizar como catálogo final snapshots generados antes de los últimos fixes de ownership/Family/licencias.
- [ ] Mantener el scan como operación atómica: si cualquier cuenta termina `temporarily_unavailable`, falla Steam Guard/login, quedan packages sin resolver o el scan no es completo, guardar diagnóstico/retry pero **no promover ni reemplazar** el catálogo autoritativo anterior.
- [ ] Extender el resultado SteamKit/PICS para clasificar cada AppID antes de publicar: `game`, `dlc`, `tool`, `demo`, `soundtrack`, `software`, etc. Publicar sólo juegos reales utilizables por Game Access; DLC/tools/software/soundtracks y otros tipos no-juego deben quedar fuera del catálogo.
- [ ] Tratar AppIDs todavía no clasificados como **pendientes**, no como descartados: durante desarrollo pueden seguir visibles como `Steam <appid>` y resolverse en background, pero un build de catálogo final no debe declararse completo mientras queden tipos desconocidos.
- [ ] Consolidar ownership + Family access + clasificación PICS en un único catálogo de juegos deduplicado y registrar el conteo canónico esperado para poder detectar regresiones entre scans.
- [ ] Completar en el backend la metadata de todos los juegos del catálogo: nombre, tipo, plataformas y los campos que usa la UI. Los fallos/rate limits de Steam Store deben reintentarse sin perder ownership ni convertir un juego válido en inexistente.
- [ ] Descargar **todas las imágenes estáticas que usa Game Access** para cada juego del catálogo: carátula/capsule vertical, header, hero/background, screenshots oficiales y thumbnails estáticos necesarios para la ficha/tráiler. Validar archivo, dimensiones/tipo y evitar duplicados cuando sea posible.
- [ ] Mantener los **videos/tráilers fuera del paquete**. Los videos continúan obteniéndose on-demand con el mecanismo/caché actual de la ficha; empaquetar sólo imágenes estáticas y posters/thumbnails.
- [ ] Generar un manifest versionado del catálogo/artwork con AppID, nombre, tipo, rutas relativas de assets, hashes/checksums, metadata version y estado de completitud.
- [ ] Empaquetar catálogo + artwork en un bundle comprimido de release y hacer que el build del instalador de Game Access lo incluya como recurso instalado. Una instalación nueva debe arrancar con las imágenes del catálogo ya disponibles, sin tener que poblar un caché desde Internet juego por juego.
- [ ] Ajustar el frontend con el mínimo cambio necesario para **preferir siempre el artwork local empaquetado**. Mantener fallback de red sólo para juegos añadidos después de la versión del paquete o assets ausentes; no usar el cache/localStorage del cliente como fuente primaria del catálogo empaquetado.
- [ ] Mantener la actualización incremental actual para metadata pendiente: placeholders visibles mientras se resuelven; frontend actualiza silenciosamente; sólo cuando el backend confirma que un AppID es DLC/no-juego desaparece del catálogo.
- [ ] Hacer que abrir **Detalles** de un placeholder pueda priorizar la resolución de metadata de ese AppID, sin bloquear la navegación ni esperar toda la cola general.
- [ ] Añadir una validación de release que falle antes de construir/publicar el instalador si el catálogo/artwork declarado como completo contiene juegos sin clasificar, metadata imprescindible ausente, assets faltantes/corruptos o referencias a DLC/no-juegos.
- [ ] Probar el instalador desde cero en **Windows Sandbox o una VM Windows limpia**, sin Node/Rust/Python ni dependencias de desarrollo preinstaladas. Verificar WebView2/prerrequisitos, instalación, primer arranque, catálogo, artwork local y conexión al backend. Si Steam es requisito del producto, instalar/configurar Steam como precondición explícita del test y comprobar también el mensaje/fallback cuando falta.
- [ ] Convertir esa instalación limpia en un smoke test repetible de release para evitar que futuras builds dependan accidentalmente del entorno de desarrollo de esta PC.

## P0 — Validate blocking assumptions

- [ ] **Steam Families applicability study.** Test/document current eligibility, household/family restrictions, invitation/cooldown behavior, game opt-outs, simultaneous-copy behavior and whether it can legitimately improve UX for a user's own eligible family accounts. Do not build fulfillment around it until validated.
- [x] **Check automated Steam store-country change assumption.** Result: do not implement an Argentina-region switcher. Valve requires store country to reflect actual residence; a legitimate change after moving is completed through Steam purchase flow with a local payment method and is currently limited to once every 3 months. No documented Steamworks consumer API was found for arbitrarily setting store country.
- [ ] **Revalidate provider/account transfer model and supplier/platform terms** before treating dedicated inventory as transferable customer ownership. Keep `private/dedicated access` distinct from `account ownership/transfer` in the domain model.

## P1 — Desktop architecture

- [ ] Make `apps/desktop` build/install as the single customer-facing Windows application (`gameAccess.exe` / installer).
- [ ] Remove production dependency on a separately running localhost FastAPI process.
- [ ] Classify existing API calls: machine-local operations move behind Tauri/native adapters; shared/global operations remain central backend calls.
- [ ] Add environment/config handling for development backend URL vs later production backend URL.
- [ ] Preserve browser/Vite mode only as a development convenience.
- [x] Improve desktop logging so startup, catalog loading and pagination, game opening, and errors can be traced end to end; verify or add log rotation and size limits so log files cannot grow indefinitely. Logs now record catalog page timings, infinite-scroll batches, game detail and launch outcomes, startup recovery, and errors. The dedicated log rotates at 2 MiB with one 2 MiB archive; provider download JSONL logs rotate at 1 MiB with one 1 MiB archive; oversized entries are truncated.
- [x] Audit generated files and folders and their cleanup, especially across game installation and uninstallation, to prevent orphaned directories, leftover files, and uncontrolled disk growth. Startup reconciliation now clears only stale prepared/installed status JSON after every known Steam library has neither its manifest nor install directory, and only when no staging folder exists. Active or resumable staging is preserved. Failed DepotDownloader bootstrap transfers now remove their temporary ZIP. Steam owns installed-game removal; credentials and user-requested automation output are retained. Download and log rotation are bounded.
- [ ] Audit the reported remaining size of more than 5 GB in the Game Access Dev folder. Measure the contributors and distinguish downloaded game data, Rust/Tauri build artifacts, and runtime-required dependencies; identify safe ways to reduce or regenerate excess files without affecting application execution.
- [x] Replace native/browser alerts, confirmations, and prompts across Game Access with reusable in-app dialogs based on the existing styled Play dialog; support the needed message and action variants while preserving the app's visual style and accessible focus behavior. `5805a51`

## P1 — Catalog and library navigation

- [x] Rebuild the library navigation tool strip on one line at the current search field's vertical position, in this order: `Catalog`, `Installed` only when it has games, `Favorites` only when it has games, search input, category selector, and Steam-features selector populated from the database. Replace the `Latest`, `Popular`, and `Top` tabs with the single `Catalog` tab, and restore the category and Steam-features filters if they are missing. `c2e9af7`
- [x] Add a compact sort-icon button to the same tool-strip line; clicking it opens the selector with exactly these criteria: release date (`Latest`), Steam popularity, review rating, and A-to-Z. `c2e9af7`
- [x] Make infinite-scroll batch sizing responsive to the library viewport/container and game-card grid, including window resizes; load enough cards to fill the visible area plus a buffer instead of using a fixed batch of 40 that leaves a blank gap. `59e55f2`
- [x] Move the `Back to top` control from the top toolbar to near the bottom of the viewport, where it remains easy to reach while the user scrolls. `59e55f2`
- [x] After the library controls have been rearranged, review and refine the interface's overall visual styling. Refined the toolbar as a segmented control group with consistent search/filter surfaces, clearer active states, and a compact icon-only sort action. Responsive wrapping now follows the actual library column width instead of the overall window width.
- [x] Fix toolbar vertical alignment: keep the search field at its original height and move the tabs, category and Steam-feature filters, and sort control up to that row. The current implementation moved the search field down to the former tab row, contrary to the requested layout.
- [x] Keep the controls in the shared header above both detail and catalog panes, including searches with no results. This supersedes the earlier request to anchor the strip within the catalog pane.
- [x] Correct filter taxonomy: Categorías lists database genres; Funciones de Steam lists full database Steam categories instead of the limited boolean feature list.
- [x] Highlight the control strip in fluorescent green, enlarge collection labels, distinguish the three tabs with coordinated colors, and space source/collection/search/filter groups.
- [x] Group Volver arriba with Actualizar juegos in the same bottom action bar to prevent overlap.

## P1 — Local Steam integration and unified library

- [ ] Detect Steam installation reliably on Windows.
- [ ] Discover Steam users/accounts already known on the local machine using supported/non-secret local state.
- [ ] Discover installed games and determine available ownership/library information per local Steam identity as reliably as possible.
- [x] After a depot download has been copied successfully into the selected Steam library and the copied payload is verified, remove its temporary Game Access staging files; preserve staging if copying or verification fails. Steam target paths and matching pre-existing files are checked before cleanup.
- [x] On Game Access startup, reconcile the download staging folder: identify junk/obsolete files separately from interrupted downloads, preserve downloads that can resume, and show a modal for each resumable interrupted download asking whether to resume it or discard its files. Discard staging only after the user chooses that option. Active workers are checked before reconciliation; discard revalidates status and path identity.
- [ ] Build a unified game-centric local model across multiple local Steam users.
- [ ] Clearly classify each game/access path: `OWNED_LOCAL`, `BUY_STEAM`, `GAMEACCESS_SHARED`, `GAMEACCESS_PRIVATE` (names may evolve).
- [ ] For owned games, select/use the appropriate local Steam identity without involving paid gameAccess allocation.
- [ ] For unowned games, expose a normal Buy on Steam action that exits the gameAccess commercial flow.
- [ ] Keep ficha/token balance persistently visible in the customer UI.

## P1 — Central backend / entitlement allocator

- [ ] Treat `apps/api` as the seed of the hosted central service, not a desktop companion process.
- [ ] Define stable API contracts for customer identity, catalog, fichas, provider profiles, entitlements, availability, leases and sessions.
- [ ] Ensure allocation is authoritative/server-side and concurrency-safe.
- [ ] Model provider account -> contained games/entitlements explicitly.
- [ ] Model shared vs dedicated/private inventory as different entitlement/product types.
- [ ] Implement lease expiration/release and failure recovery.
- [ ] Keep prototype persistence simple for live testing (SQLite acceptable); design repository/storage boundary so it can migrate to PostgreSQL later.

## P1 — Waitlist / reservation UX

- [ ] Add per-game server-side waitlist when compatible shared capacity is exhausted.
- [ ] Define deterministic queue ordering and cancellation.
- [ ] When capacity frees, create a short bounded reservation for the next eligible user.
- [ ] Deliver desktop notification with direct **PLAY NOW** action.
- [ ] Expire an unclaimed reservation and advance the queue automatically.
- [ ] Show queue/wait state clearly in the game detail UI.
- [ ] Record waitlist joins, wait duration, abandonment and conversion as demand telemetry.
- [ ] Allow a separate **GET PRIVATE ACCESS / SKIP THE WAIT** offer only when legitimate dedicated sourcing exists.

## P2 — Internet live-development environment

- [ ] Prepare backend to run independently from the desktop checkout.
- [ ] Import/deploy the backend to an Internet-accessible development environment (Replit is the current candidate, but architecture must remain host-independent).
- [ ] Establish stable DEV backend URL and configuration.
- [ ] Create a web admin application against the same backend/API.
- [ ] Admin: provider profiles/accounts.
- [ ] Admin: games/licenses/entitlements and account contents.
- [ ] Admin: availability, active leases, queues and reservations.
- [ ] Admin: customers and ficha balances for test operation.
- [ ] Admin: disable/quarantine broken inventory.
- [ ] Test two or more Windows clients against the same hosted backend.

## P2 — End-to-end Steam session lifecycle

- [ ] Select one representative supported Steam game for the reference flow.
- [ ] Prove: request -> allocation -> local preparation -> launch -> running session -> exit detection -> cleanup -> lease release.
- [ ] Formalize provider/session adapter interface and migrate useful behavior from `apps/launcher`.
- [ ] Handle failure/restart/timeout without leaving capacity permanently leased.
- [ ] Build per-game compatibility records: external launcher/account, Family Sharing eligibility, SteamID-bound state, save locations, Steam Cloud behavior and cleanup requirements.
- [ ] Design/test customer save continuity where technically valid.

## P2 — Steam Families usability experiment

- [ ] Using only accounts genuinely eligible under Valve's current rules, create/test a Steam Family manually first.
- [ ] Verify whether the primary account sees shareable games from the second account without switching Steam identity.
- [ ] Verify saves, achievements, simultaneous use and multiple-copy selection behavior.
- [ ] Identify games that opt out or otherwise fail the desired experience.
- [ ] Only after policy + behavior validation, decide whether any supported Family-management assistance belongs in gameAccess.

## P3 — Demand telemetry and Demand Engine

- [ ] Record search, no-result search, game-page view, download intent, install, Play attempt, successful allocation, blocked Play, waitlist join, private-access interest and completed session.
- [ ] Aggregate unique users, concurrency, occupancy and unmet demand per game/time window.
- [ ] Build opportunity score combining demand, blocked plays, supplier price/depth, expected margin and inventory utilization.
- [ ] Surface procurement recommendations in admin UI.

## P3 — Standalone supplier / offer intelligence module

- [ ] Keep supplier discovery/pricing independent from the Windows launcher.
- [ ] Research permitted/robust G2G data-access approach and current terms before automating crawling.
- [ ] Search offers by game and normalize candidate listings.
- [ ] Extract structured facts: price, included games, seller/reputation signals, delivery/transfer claims and restrictions.
- [ ] Rank roughly the 10 cheapest **viable** offers rather than blindly the 10 lowest prices.
- [ ] Obtain relevant Steam Argentina/reference purchase price through supported sources.
- [ ] Implement deterministic pricing/margin rules.
- [ ] Use an LLM only to translate/summarize verified structured facts into Spanish customer copy; never let it invent commercial facts.
- [ ] Generate proposed gameAccess private-access offer for admin review.
- [ ] Later evaluate external marketplace publication (e.g. Mercado Libre) separately against its current policies/API and economics.

## P4 — Wallet and commercialization hardening

- [ ] Replace prototype credit mutation with immutable ficha ledger.
- [ ] Define ficha packages/top-ups.
- [ ] Implement real payment-provider integration with idempotency/webhooks/refunds.
- [ ] Define pay-per-use charging rules and reservation/refund behavior.
- [ ] Later define subscription vs one-off top-up economics.
- [ ] Later implement trial lifecycle only after core access mechanics work.

## P5 — Production readiness (not current milestone)

- [ ] Production authentication/authorization.
- [ ] PostgreSQL or selected production datastore migration.
- [ ] Secrets management and provider-session revocation strategy.
- [ ] Observability, audit logs, backups and disaster recovery.
- [ ] Rate limiting/abuse/fraud controls.
- [ ] Production hosting/deployment pipeline.
- [ ] Installer signing/update strategy for Windows client.
- [ ] Legal/platform-policy review before public commercial launch.
- [ ] Controlled first-customer beta.

## Deferred / explicitly not now

- Owned GPU/cloud fleet.
- Broad speculative inventory purchasing.
- Fully automated purchasing/repricing before demand economics are demonstrated.
- Automatic Steam region manipulation.
- Treating Steam Families as a generic account-pooling workaround.
