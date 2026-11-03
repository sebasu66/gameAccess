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
  instancia muestra los juegos reales de la PC. Por eso todavía no hay ciclo de descarga e instalación automático.
- Lo que es del sistema se comparte: la instancia ve tu Steam (juegos instalados), la activación PLUS de la PC y el
  plugin de fuentes registrado. Descargar, instalar o congelar desde la prueba actúa sobre esas cosas reales.
- Los argumentos de cada comando se recortan a 1000 caracteres en los informes: al abrir, `catalog_sources_apply`
  manda 13,5 MB por IPC, y una respuesta de más de 10 MB corta la conexión del cliente MCP.
