---
tipo: plan
actualizado: 2026-10-19
estado: plan propuesto, sin implementar
---
# Varias versiones del mismo juego instaladas a la vez

> Pedido por Seba el 2026-10-19. Tareas VV.0–VV.7 en [[Tareas]]. Base ya hecha: cada instalación guarda el nombre que le da su fuente y la tarjeta lo muestra (commit `a392985`).

## Objetivo
Poder tener en la misma PC dos o más descargas del mismo juego, por ejemplo de dos fuentes con versiones que no juegan online juntas. Cada una tiene su propia tarjeta en la biblioteca, con el nombre que le da su fuente, y se juega, se arregla y se desinstala por separado.

## Por qué hoy no se puede
Todo usa el AppID como identificador de la **instalación**, no solo del juego:
- **Launcher**:
  - una carpeta `<appid>-<nombre>-<estado>` (`storage.folder()` falla con "Hay varias carpetas para este AppID");
  - un registro `digital_games/<appid>.json`;
  - perfil `execution_profiles/<appid>.json`, opciones `digital_launch/<appid>.json` y vínculo `digital_linked/<appid>`;
  - descarga temporal `<appid>-<nombre>` y estado del worker `digital_downloads/<appid>.json`.
- **Download Manager**: un trabajo por AppID (`queue.jobs[app_id]`; pedir de nuevo un juego en cola no hace nada).
- **Rust**: los comandos reciben `app_id: u32` (`run_digital_process`, cola, perfiles, desinstalar, congelar en `game_freeze.rs`).
- **Interfaz**: la biblioteca es una lista de juegos del catálogo (`libraryMembership`). Descargas y estados van en mapas por AppID (`Record<number, ManagedDownloadStatus>`, unos 30 lugares). Las tarjetas usan `game.id` como clave.

## Diseño: clave de instalación
Se separan dos cosas:
- **AppID**: qué juego es. Sigue mandando para el catálogo, la metadata de Steam, las imágenes, las fuentes, Co-Optimus y la búsqueda.
- **Clave de instalación**: qué copia instalada es. Es un texto:
  - `"<appid>"` para la primera instalación. Es la de hoy, así que **no hace falta migrar nada**.
  - `"<appid>.<n>"` (n ≥ 2) para las demás, por ejemplo `620.2`.

| Dónde | Hoy | Con clave de instalación |
|---|---|---|
| Carpeta del juego | `620-Portal 2-ready` | `620-Portal 2-ready` y `620.2-Portal 2-ready` |
| Registro | `digital_games/620.json` | `digital_games/<clave>.json` (con `app_id`, `source`) |
| Perfil de ejecución / opciones / vínculo | por AppID | por clave; si no hay archivo propio, se usa el del AppID |
| Descarga temporal, estado del worker | `620-…`, `620.json` | `<clave>-…`, `<clave>.json` |
| Cola del Download Manager | un trabajo por AppID | un trabajo por clave |
| Historial y partidas | `game_journal` en la carpeta | igual (ya es por carpeta); la estadística por juego suma sus instalaciones |

`split_folder_name` acepta el prefijo `\d+(\.\d+)?` y devuelve AppID y clave. Una carpeta vieja sigue leyéndose igual.

## Qué ve el usuario
- **Bajar un juego ya instalado** desde la ficha pregunta: "Ya tenés instalada *Portal 2 v2.0 – Repack (SteamRIP)*. ¿Reemplazarla o instalar esta versión además?".
  - **Reemplazar** desinstala la versión anterior al terminar bien la nueva (la vieja no se borra si la descarga falla).
  - **Además** crea la clave siguiente libre.
- **Biblioteca**: una tarjeta por instalación. Debajo del nombre va el de la fuente; si hay más de una, el tooltip lo aclara ("2 versiones instaladas").
- **Ficha del juego**: si hay varias versiones, un selector "Versión" elige a cuál se refieren Jugar, Opciones, Abrir carpeta y Desinstalar.
- **Gestor de biblioteca**: una fila por instalación, con la fuente en la segunda línea.
- **Importador**: una carpeta de un juego que ya está en la biblioteca deja de esconderse. Se ofrece como versión adicional (hoy `known_app_ids` la filtra).
- **Steam**: un juego vinculado desde Steam es siempre una sola instalación (la de Steam). Puede convivir con copias en carpeta.

## Fases (cada una se puede publicar sola)
- **VV.0 Decisiones de Seba**: formato de la carpeta (`620.2-…`), pregunta al bajar un juego instalado (reemplazar / además), tope de versiones (sugerido: sin tope).
- **VV.1 Launcher, almacenamiento**: clave de instalación en `storage` (carpeta, registro, estado, desinstalar, congelar), perfiles y opciones por clave con respaldo al AppID; `library-list` devuelve `install_key`; las acciones de `digital_process_runner.py` aceptan `--install-key` (por defecto el AppID). Con una sola instalación nada cambia; tests de dos instalaciones del mismo AppID.
- **VV.2 Download Manager**: trabajos por clave; worker con `--install-key`; carpeta temporal y estado por clave; pedido "instalar además" que reserva la clave libre siguiente; "reemplazar" que desinstala la anterior solo al terminar bien. Test e2e con el Download Manager real y dos fuentes del mismo AppID.
- **VV.3 Rust**: los comandos pasan `installKey: Option<String>` hasta el launcher (`run_digital_process`, relé de la cola, `execution_profiles.rs`, `game_uninstall.rs`, `game_freeze.rs`); sin clave = AppID, compatible.
- **VV.4 Interfaz, modelo**: la biblioteca pasa de "juegos" a "instalaciones" (`{ installKey, appId, game, source }`). Los mapas de descargas y estados pasan a la clave (texto). Las tarjetas usan la clave como `key` y como selección. Es el paso más grande: tocar `useLibraryDownloads.ts`, `DigitalDownloadService.ts`, `DigitalCatalog.ts`, `GameStateManager`, `LibraryRoom*`, `DownloadCatalogPanel.tsx`, `LibraryDetailPanel.tsx`.
- **VV.5 Interfaz, flujos**: pregunta reemplazar / además, selector de versión en la ficha, gestor de biblioteca por instalación, menú contextual por tarjeta.
- **VV.6 Importador**: ofrecer como versión adicional una carpeta de un juego ya instalado.
- **VV.7 Prueba en la app** (Seba): bajar el mismo juego de dos fuentes, jugar cada una, desinstalar una sin tocar la otra.

## Riesgos
- **VV.4 toca muchos archivos de la interfaz** (estado de descargas, selección, tarjetas). Conviene hacerlo en una sesión dedicada y con la app abierta para probar.
- **Perfiles de ejecución**: hoy un perfil por juego. Si dos versiones necesitan fixes distintos, cada clave tiene el suyo; la segunda copia el de su fuente al bajarse.
- **Espacio en disco**: dos versiones ocupan el doble. El aviso de espacio ya existe; conviene mostrar el tamaño de la otra versión al preguntar "además".
