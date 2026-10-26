---
tipo: diseño
actualizado: 2026-10-26
---
# Lo aprendido por juego — que lo que descubre un jugador no le vuelva a pasar a otro

Pedido de Seba (2026-10-26). Empezó con un caso: bajó un juego, esperó unos 15 minutos y lo descargado no era un juego (`not_a_game`). Después lo amplió: "No solo fuentes malas. También podemos aprender cómo correr juegos que tienen requisitos o instrucciones especiales. Deberíamos tener una lista para cada juego en el que encontremos algo. También puede ser que el juego ya no sea válido porque los desarrolladores lo abandonaron y haya que descartarlo por completo. O cómo correr un juego. O fuentes de descarga que no sirven." Requisito: que viva en el servidor para todos y que consultarla no tarde. Tarea en [[Tareas]] (sección "Descargas y servidor").

## Qué es una lección
Cada lección es de **un juego** (AppID) y tiene un **tipo** (`kind`). Los tipos quedan abiertos; hoy hay tres:

| Tipo | Qué dice | Sobre qué (`scope` / `subject`) | Acción |
|---|---|---|---|
| `bad_source` | una fuente de descarga que no sirve: no era un juego, contraseña incorrecta, archivo dañado, el antivirus la marcó, faltaban partes | `source` con la huella SHA-256 de la fuente (nunca la URL), o `provider` con el nombre del proveedor | `avoid` |
| `how_to_run` | requisitos o pasos especiales para correrlo (texto; más adelante, el perfil de ejecución que ya existe) | `game` con el AppID | `note` |
| `abandoned` | el juego ya no es válido (los desarrolladores lo abandonaron) | `game` con el AppID | `discard` |

Otros campos: `reason` (código corto, p. ej. `not_a_game`, `run_as_admin`, `developer_dropped`), `text` (las instrucciones, solo las escribe un administrador), `detail` (códigos de lo que vio el cliente: `audio`, `images`…), `reports` (instalaciones distintas), `confidence` (`flagged`, `confirmed`; en el cliente también `mine`), `first_seen` y `last_seen`.

## Dónde vive y cómo viaja
- **Servidor = fuente de verdad** (`apps/api/app/game_lessons.py`, tablas en Supabase que se crean solas al arrancar):
  - `game_lesson_report`: un voto por instalación y por lección. La instalación se guarda como HMAC de su id: sirve para contar personas distintas sin saber quiénes son. Límite de 30 reportes por hora por dirección.
  - `game_lesson`: la lección como la ven los clientes, recalculada en cada voto, con una **revisión** (microsegundos) y `published`. Una fuente mala se publica cuando la reportan **2 instalaciones distintas** (`GAMEACCESS_LESSON_MIN_REPORTS`) y pasa a "confirmada" con el doble; lo que escribe un administrador se publica al instante.
  - `POST /game-lessons/report`: los jugadores (la app, sola) solo reportan fuentes malas con un motivo conocido. `POST /admin/game-lessons`: el administrador escribe cualquier tipo, o lo retira (`retract`). `GET /game-lessons?since=<revisión>`: con 0, todo lo publicado (snapshot); si no, solo lo que cambió (`lessons`) y lo retirado (`removed`).
- **Cada cliente tiene una copia en su SQLite local** (`src-tauri/src/game_lessons.rs`, tabla `game_lessons` en la base del catálogo, con la revisión en `game_lessons_meta`). Se sincroniza **en el mismo paso que las novedades del catálogo** (al arrancar y como mucho una vez por día): snapshot la primera vez, después solo las diferencias. No va dentro del paquete del catálogo porque ese paquete es un archivo estático publicado en GitHub por un job, y las lecciones cambian con cada reporte.
- **Todas las consultas son locales**: instantáneas y sin conexión, nunca esperan a la red. Medido con 50.000 lecciones, un juego, 12 fuentes y 4 proveedores: 24 µs por consulta en release (60 µs en debug); aplicar un snapshot de 50.000 lleva 412 ms en release (968 ms en debug).
- **Los reportes van en segundo plano**: la fuente mala se guarda primero en la copia local (marcada `mine`, así cuenta enseguida para ese jugador y un snapshot no la borra) y después se manda al servidor, sin frenar nada.

## Qué hace hoy la app con la lista
- **Fuentes malas**: el aviso de "no es un juego" (`DigitalDownloadErrorDialog.tsx`) la reporta con la huella de la fuente tal como la listó el plugin. `getPluginSources` consulta la copia local y manda las fuentes marcadas (por huella o por proveedor) **al final** del menú de fuentes, con el motivo ("Otros jugadores: no era un juego" / "Ya te pasó: …"). El botón Descargar y "Instalar" del menú eligen la primera **no marcada**. Si todas están marcadas no arrancan solos: el botón dice "Fuentes marcadas: elegí una" y abre el menú. "Probar otra fuente" no prueba las marcadas.
- **Cómo correrlo** y **abandonado**: ya se guardan y se consultan (`queryGameLessons(appId)`), pero todavía no se muestran: depende de las decisiones de Seba de abajo.
- **La huella** es la misma que usa la caché de ViKiNG del servidor (`viking_cache_service.normalize_source_url`; en el cliente, `sourceFingerprint.ts`). Los dos lados prueban los mismos valores dorados.

## Abierto (decisiones de Seba)
- **Quién carga entradas** de "cómo correrlo" y "abandonado": hoy, solo el administrador. ¿También jugadores (por ejemplo, desde el perfil de ejecución que les funcionó)?
- **Moderación**: hoy los reportes de fuente mala se publican solos con 2 instalaciones distintas, y el administrador puede retirar cualquier lección. ¿Hace falta revisar antes de publicar?
- **Abandonado**: ¿oculta el juego del catálogo y de la oferta, o solo avisa en la ficha?
- **Fuente marcada**: ¿se oculta del todo o solo baja en el orden? Hoy solo baja, con el motivo.
- **Umbral**: hoy 2 instalaciones.
- **Despliegue**: Render despliega desde `main`; las tablas se crean solas en Supabase al primer arranque.
- **Plugin de fuentes**: podría recibir las huellas marcadas para no ofrecerlas. No se tocó; queda como pregunta.
- Falta que el launcher distinga contraseña incorrecta y archivo dañado con su propio `errorCode` para reportarlos.
