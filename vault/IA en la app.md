---
tipo: diseño
actualizado: 2026-11-04
---
# IA en la app (Gemma por Ollama)

Pedido de Seba (2026-11-04): usar la clave de Ollama, que ya toma el asistente «Conectar IA», para hablar con **Gemma** (el modelo abierto de Google; no Gemini). Usos:
- Mejores sugerencias de búsqueda y filtros con el botón mágico.
- Diagnosticar y arreglar juegos con las herramientas de la app, explicando el problema al jugador y a nosotros.
- Recomendaciones y un administrador de biblioteca guiado por IA.

## Lo que ya existe
- **Conectar IA** (`AiConnectWizard.tsx`, `ai_connection.rs`): la clave se guarda con DPAPI en `%LOCALAPPDATA%\GameAccess\ai\ollama-key.dpapi`. La prueba usa `ollama.com/api/chat` con `gemma4:31b`.
- **El botón mágico del filtro** (`CatalogFilterToolbar.tsx`, `ga-personal-order`): hoy ordena el catálogo con el perfil de gustos (`tasteProfile.ts`), sin IA.
- **El MCP de pruebas** (`tools/gameaccess-mcp`): abre una instancia de prueba y llama a los comandos de la app (`ga_call`, `ga_module`, `ga_catalog_search`, `ga_events`, `ga_files`…). Es para desarrollo, no para los jugadores.

## Cómo se habla con Gemma
- Un solo comando nativo, `ai_chat`, en Rust. Lee la clave guardada, llama a `https://ollama.com/api/chat` y le pasa a Ollama `format` con un **esquema JSON**: el modelo tiene que responder exactamente ese JSON.
- La app **valida** cada respuesta contra el esquema y contra los valores permitidos: géneros, etiquetas y nombres de herramientas que existen de verdad. Si la respuesta no sirve, se reintenta una vez; si falla otra vez, la app sigue sin IA.
- Nunca se mandan claves, rutas con el nombre del usuario ni datos de la cuenta. Las rutas van como `%USERPROFILE%\…`.

## 1. Búsqueda y filtros con IA (botón mágico)
- Con IA conectada, el botón mágico también acepta lo que escribe el jugador («algo cooperativo para jugar con mi hijo, que no sea violento»).
- Gemma recibe la frase, los filtros disponibles (géneros, etiquetas, modos, edad, precio) y el perfil de gustos. Responde `{ "query": "...", "filters": {...}, "sort": "...", "why": "..." }`.
- La app aplica los filtros con `catalogParamsFromFilters`, que es el mismo camino que la pantalla, y muestra el «por qué» en una línea.
- Sin IA, el botón sigue haciendo el orden personal de hoy.

## 2. Diagnóstico con herramientas (el «MCP» para Gemma)
- **Un solo catálogo de herramientas** (`ai-tools.json`) con nombre, descripción, argumentos (esquema JSON) y riesgo: `read` (solo mira) o `fix` (cambia algo). Lo usan los dos lados:
  - el agente de la app, con Gemma, para los jugadores;
  - el MCP de pruebas, que expone las mismas herramientas para que Claude las use y las pruebe en desarrollo.
- **Herramientas iniciales**:
  - `read`: log del juego, estado de Steam, librerías que faltan, driver de video, espacio en disco, antivirus, verificar los archivos del juego, último error al abrir.
  - `fix`: instalar las librerías que faltan, verificar con Steam, reparar el comando de inicio, sumar la exclusión del antivirus, volver a abrir el juego.
- **El protocolo** es un bucle de pocos pasos (máximo 8). En cada paso Gemma responde uno de dos JSON:
  - `{ "action": "call", "tool": "...", "args": {...}, "reason": "..." }`
  - `{ "action": "answer", "player_message": "...", "dev_report": {...}, "fixed": true|false }`
- **Ejecución**: las herramientas `read` corren solas. Las `fix` le piden permiso al jugador con lo que van a hacer, en sus palabras. Una herramienta que no está en el catálogo se rechaza.
- **El resultado**: el jugador ve qué pasaba y qué se hizo. El `dev_report` (juego, pasos, herramientas, resultado, sin datos personales) queda en el log y, si el jugador quiere, nos llega como reporte.

## 3. Recomendaciones y biblioteca con IA
- **Recomendaciones**: Gemma recibe el perfil de gustos y una lista corta de candidatos del catálogo, y devuelve un orden con una línea de «por qué» para cada uno. Solo puede elegir entre los candidatos.
- **Biblioteca**: con las mismas herramientas, sugiere qué juegos ocupan lugar sin usarse, qué congelar o mover y qué falló. Nada se hace sin el permiso del jugador.

## Etapas
1. `ai_chat` con esquema y validación, y su prueba en la app compilada.
2. Botón mágico con IA.
3. `ai-tools.json`, el agente de diagnóstico y las mismas herramientas en el MCP.
4. Recomendaciones y biblioteca.
