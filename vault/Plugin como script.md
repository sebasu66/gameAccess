---
tipo: diseño
actualizado: 2026-10-19
estado: acordado con Seba, sin implementar
---
# Plugin de fuentes como script (sin ejecutable ni servidor local)

> Acordado con Seba el 2026-10-19. Reemplaza al plugin actual (app Electron). Tareas en [[Tareas]] (sección "Plugin como script"). Contexto del producto en [[Proyecto]].

## Por qué
El plugin de fuentes actual es una app Electron completa: ~259 MB, su propio Chromium, un `.exe` y un servidor HTTP en `127.0.0.1:45000` (`torrent_provider.json` con `endpoint` y `pid`). Eso trae casi todos los problemas que vimos:
- aviso del firewall (mDNS de WebRTC en las páginas ocultas),
- antivirus o SmartScreen con el `.exe`,
- procesos que quedan vivos después de cerrar Game Access,
- el puerto local,
- una desinstalación que tiene que cerrar procesos de cada usuario.

## Cómo sería
El plugin pasa a ser **una carpeta con datos y un script**, sin ejecutable:

```
%LOCALAPPDATA%\gameAccess\plugins\<id>\
  manifest.json   ← id, nombre, versión, sitios que necesita leer, cada cuánto actualizar
  provider.js     ← la lógica que hoy corre en las páginas ocultas del Electron
```

- **Game Access lo ejecuta en una ventana oculta propia** (WebView2, que es Chromium). Ya existe el patrón: `query_cooptimus` en `steam_commands.rs` abre una ventana oculta con un script inyectado (`cooptimus_lookup.js`).
- **Devuelve lo mismo que hoy `/api/source-index`**: fuentes por juego, con revisión y deltas. El resto (tablas `download_sources` / `game_sources`, matching por nombre en Rust, torrent embebido) no cambia.
- **Instalar** es copiar unos KB, verificados con SHA-256 (el enlace `gameaccess://install-plugin` ya lo hace), sin permisos de administrador. **Desinstalar** es borrar la carpeta. No hay procesos ni puertos.
- **Carpeta**: `%LOCALAPPDATA%\gameAccess\plugins`, junto a los datos del launcher (`%LOCALAPPDATA%\gameAccess\launcher`). Es por usuario porque Program Files no se puede escribir sin administrador. Hoy los plugins van a `%APPDATA%\GameAccess\plugins` (`plugin_install.rs`, `plugin_registry.rs`).

## Lo que hay que cuidar
1. **Aislamiento.** Game Access ejecuta código de un tercero. La ventana del plugin:
   - no tiene acceso a los comandos de Tauri (sin capabilities), salvo un único canal para entregar resultados (validados por esquema);
   - solo navega a los sitios que declara `manifest.json`.

   Así es más seguro que hoy, porque ahora el `.exe` del plugin puede hacer cualquier cosa en la PC.
2. **Cuándo corre.** Solo con Game Access abierto: al abrir la app y cada tanto mientras está abierta (intervalo del manifiesto). Ya no hay un índice que se arme en segundo plano todo el tiempo.
3. **La separación que define el producto se mantiene.** Game Access no trae fuentes: el plugin sigue siendo opcional, de otro repo, y lo instala el usuario. Cambia el formato (script en vez de programa), no quién lo provee.
4. **Trabajo en el repo del plugin.** Reescribir la lógica del Electron como `provider.js` + `manifest.json` y publicar un zip chico. Se hace en el repo del plugin con su propia cuenta (ver memoria local de Claude; no se nombra acá).
5. **Transición.** Mientras exista el plugin Electron, el desinstalador de Game Access lo cierra y borra su carpeta de cada usuario (`windows/hooks.nsh`, `NSIS_HOOK_POSTUNINSTALL`). Cuando el nuevo formato esté publicado, el registro de plugins deja de buscar el formato viejo.
