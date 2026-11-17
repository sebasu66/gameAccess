# gameaccess-mcp

Servidor MCP para probar Game Access de forma automática. Abre una **instancia de prueba** de la app (build de debug,
datos propios) al lado de la que tengas abierta, y deja llamar a sus funciones con los mismos parámetros que arma la
interfaz.

## Registrarlo en Claude Code

Desde la raíz del repo:

```bash
claude mcp add gameaccess -- node tools/gameaccess-mcp/server.mjs
```

Antes, una vez: `npm ci` en esta carpeta. Hace falta Rust (la primera compilación tarda unos minutos) y el `npm ci`
de `apps/desktop`, porque la instancia carga el frontend desde Vite (puerto 38148; si no está corriendo, el servidor lo
arranca y lo cierra al terminar).

## Cómo se usa

1. `ga_start` (con `fresh: true` borra el perfil de prueba) y `ga_status` hasta que diga `ready`.
2. Llamar a las funciones directamente:
   - `ga_catalog_search`: filtros (`LibrarySearchFilters`, como los guarda la pantalla) → la consulta exacta de la
     grilla del catálogo (`catalogParamsFromFilters`, política parental, orden) → resultado real. Devuelve los
     parámetros enviados, el total y los juegos.
   - `ga_module`: cualquier función exportada de `apps/desktop/src`, cargada desde Vite en la ventana (mismo módulo y
     mismo estado que usa la interfaz). Ej.: `tasteProfile.ts` › `buildTasteProfile`.
   - `ga_call`: cualquier comando Tauri (`invoke`) con sus argumentos: descargas, instalación, congelado, ejecución.
     Responde con el resultado y lo que provocó.
3. Comprobar: `ga_events` (comandos, errores de la página, navegación), `ga_files` (lo que quedó en disco en el perfil).
4. `ga_stop`.

Las herramientas de pantalla (`ga_snapshot`, `ga_screenshot`, `ga_click`, `ga_drag`, `ga_fill`, `ga_press`,
`ga_hover`, `ga_scroll`, `ga_wait`) quedan para mirar una pantalla o reproducir un problema visual. Para probar lógica
no hacen falta: son más lentas y dependen de textos que cambian.

## Pruebas guardadas

```bash
npm test
```

Prueba lo que no necesita la app (`lib.test.mjs`).

```bash
npm run smoke
```

Abre la instancia por el protocolo MCP, como lo haría un agente, y corre `steps/catalog.mjs`: la búsqueda de carreras
de la comparación con Steam (misma pantalla, ≥ 70 %, últimos 5 años), el orden y el perfil de gustos.
`npm run smoke -- otra.mjs` corre otro guion; cada uno exporta `run(call, log)`.

## Pasada de regresión (sin agente)

```bash
npm run regress
```

Se corre cada tanto, no en cada build. Abre la instancia de prueba y:

1. Ejecuta las búsquedas de `regress/searches.json` con el código de la app (`ga_catalog_search` por dentro) y las
   cruza con la respuesta de Steam guardada en `regress/steam/<id>.json`. Steam no filtra por nota ni por antigüedad:
   eso se aplica sobre lo guardado. Para cada juego que falta dice qué criterio lo deja afuera (se repite la búsqueda
   sin ese criterio, solo sobre esos juegos) o si no está en el catálogo. Para cada juego que sobra dice por qué Steam
   no lo muestra (sin porcentaje por pocas reseñas, nota o fecha distinta, o no tiene esa etiqueta o categoría).
2. Compara cada búsqueda con la pasada anterior: juegos que entraron y que salieron.
3. Saca una captura por pantalla (Inicio, catálogo, filtros, ficha, Actividad, gestor de biblioteca, Configuración),
   con los errores de consola y los comandos fallidos de cada una.

Antes de empezar anota si el cliente de Steam está abierto y con una cuenta con sesión (`regress/steam-status.mjs`:
el proceso `steam.exe` y `ActiveUser` en `HKCU\Software\Valve\Steam\ActiveProcess`). Ejecutar juegos lo necesita;
si falta, el informe lo dice como paso no listo, no como falla del juego.

Con `--cycle` (o `--only cycle`) suma la vida entera de un juego fijo, Terraria (105600), por los mismos servicios que
usan los botones (`regress/cycle.mjs`): fuentes del plugin, nivel de la cola (base: 1 descarga; PLUS: hasta 4),
descarga e instalación, carpeta en disco con su ejecutable, verificación, jugar (que el proceso siga vivo 15 s y se
cierra), congelar, descongelar, verificar y jugar otra vez, congelado profundo, descongelar y verificar, y desinstalar
(que la carpeta ya no esté). Baja unos
600 MB y usa la carpeta de juegos real de la PC; si Terraria ya está instalado no corre, para no borrarlo. Jugar
necesita Steam con sesión: si falta, el paso queda como **no listo** (la máquina), no como falla del juego.
Las mismas fases sin la app ni red, con un juego de prueba y una carpeta de juegos propia (segundos):
`apps/launcher/run_lifecycle_tests.ps1` (`tests/test_lifecycle.py`, a demanda).

Deja `report.json`, `summary.md` y `shots/` en `%LOCALAPPDATA%\GameAccess-MCP\runs\<fecha>` (u otra carpeta con
`GA_RUNS`). Cada informe nombra la pasada anterior y su captura de la misma pantalla. `--no-build` reusa la última
build; `--only search` u `--only screens` hace solo una parte.

Las respuestas de Steam se renuevan a mano, cuando están viejas: `npm run steam` (o `npm run steam -- <id>`). Steam
corta con 429 si se le pide rápido; el script espera y reintenta.

Para sumar una búsqueda: agregarla en `searches.json` con su versión de Steam (`tags`, `category3`) y la nuestra
(`query`, `filters` como `LibrarySearchFilters`), más `minScore` y `maxAgeDays`, y bajar su respuesta.

## Aislamiento y límites

- Solo existe en builds de debug: `GAMEACCESS_TEST_INSTANCE` hace que `main.rs` no tome la instancia única,
  `gameaccess://` ni las actualizaciones de la app instalada. La versión publicada lo ignora.
- El puerto de depuración de WebView2 se abre solo en el proceso que lanza este servidor.
- Perfil en `%LOCALAPPDATA%\GameAccess-MCP` (`profile\local`, `profile\launcher`, `profile\webview`), con
  `build.log`, `app.log` y `server.log`. La build va a `apps/desktop/src-tauri/target/mcp`.
- **La biblioteca no está aislada.** La carpeta de juegos sale del registro del instalador (HKLM `GamesDir`) o de
  `C:\juegos_GameAccess` si existe (`launcher_data.py`), no del perfil de prueba: el gestor de biblioteca de la
  instancia muestra los juegos reales de la PC, y el ciclo instala ahí (Seba lo aceptó, 2026-11-04).
- Lo que es del sistema se comparte: la instancia ve tu Steam (juegos instalados), la activación PLUS de la PC y el
  plugin de fuentes registrado. Descargar, instalar o congelar desde la prueba actúa sobre esas cosas reales.
- Los argumentos de cada comando se recortan a 1000 caracteres en los informes: al abrir, `catalog_sources_apply`
  manda 13,5 MB por IPC, y una respuesta de más de 10 MB corta la conexión del cliente MCP.

## Windows Sandbox (instalación limpia)

Prueba la app como la recibe un usuario, en un Windows recién creado que se borra al cerrarlo.

1. Instalador de prueba, desde `apps/desktop`:

   ```bash
   VITE_GA_TEST=1 CARGO_TARGET_DIR="$PWD/src-tauri/target/sandbox" npx tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'
   ```

   `VITE_GA_TEST=1` suma `src/testHook.ts`: deja en `window.__gameAccessTest` los mismos módulos que llaman los
   botones (catálogo, descargas, congelado, activación…), porque una app instalada no tiene el código en Vite. Una build
   normal no lo incluye. Esta build escribe `apps/desktop/dist` con el hook; la próxima build normal lo regenera.
2. `node regress/sandbox/make-kit.mjs` arma `%LOCALAPPDATA%\GameAccess-MCP\sandbox`: el instalador, esta carpeta con
   sus `node_modules`, el `node.exe` de esta PC y, en `secret\`, copias de lo que vive solo en `vault/Cuentas`
   (ignorada por git):
   - `accFull.csv`: cuentas de Steam de prueba;
   - `plugin-page.txt`: la dirección de la página del plugin de fuentes; el kit lee el enlace
     `gameaccess://install-plugin…` de su botón en ese momento, así prueba la versión publicada (o `plugin-link.txt`
     con el enlace tal cual);
   - `plus-key.txt`: una llave PLUS (primera línea), del servidor de prueba o la de cortesía de Render.
3. Abrir `gameaccess.wsb`. Adentro, `in-sandbox.ps1`:
   1. instala Game Access con `/S`;
   2. instala Steam (`SteamSetup.exe /S`, bajado de Steam si no se pasó `--steam-setup`) y entra con la primera
      cuenta que funcione (`steam-login.ps1`; el informe dice "account N", nunca la cuenta);
   3. abre la app con el enlace del plugin y contesta "Sí" a su pregunta, como el botón de la página;
   4. corre la pasada con el ciclo sin llave (`run.mjs --installed <exe> --cycle`: acceso base, 1 descarga);
   5. si hay llave, la carga como la pantalla de activación (`--activate`, `activation.ts › redeemActivation`) y repite
      el ciclo (PLUS, hasta 4). El informe dice el acceso antes y después, nunca la llave.

   Al terminar borra `secret\` y escribe `out\done.txt`. Todo queda en `out\`: `sandbox.log`, `steam-login.json`,
   `plugin.json` y `runs\<fecha>` por pasada.

Lo abre Seba: inicia sesión en Steam con contraseñas. Steam Guard por correo o móvil frena el ingreso de una cuenta
que lo tenga; esa cuenta queda como fallida y se prueba la siguiente.
