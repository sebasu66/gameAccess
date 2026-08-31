# gameAccess — Central TODO

> **Authoritative prioritized implementation queue**  
> Last reviewed: 2026-08-31
>
> Keep this file ordered by priority. When a task is completed, mark it `[x]` and add a short result/commit note where useful. New work should be inserted according to dependency/priority rather than simply appended.


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
- [ ] Añadir soporte previsto para dos monitores: preferir ejecutar Steam/juego en la segunda pantalla y mantener Game Access activo en la primera.
- [ ] Probar posiciones de ventana, pantalla completa, launchers secundarios y juegos que ignoran la posición solicitada.
- [ ] Crear un panel de acompañamiento en la primera pantalla con juego actual, cuenta, estado, amigos, chat, voz, notas y referencias sin inyectarse en el proceso del juego.

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
- [ ] Validar dos monitores dentro de ese vertical slice: Game Access en primera pantalla, juego/Steam preferentemente en segunda pantalla y retorno al entorno después del cierre.

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

## P1 — Local Steam integration and unified library

- [ ] Detect Steam installation reliably on Windows.
- [ ] Discover Steam users/accounts already known on the local machine using supported/non-secret local state.
- [ ] Discover installed games and determine available ownership/library information per local Steam identity as reliably as possible.
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
