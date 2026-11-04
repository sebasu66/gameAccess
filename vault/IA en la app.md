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

## Primera entrega acordada (Seba, 2026-11-04): sugerencias con IA
Lo primero que se termina y se publica. El resto puede esperar.
- **Datos que recibe Gemma**:
  - Los «me gusta / no me gusta» (`gameaccess:preferences`) con los nombres de esos juegos. Hay que guardar el nombre junto con los rasgos en `rememberTasteGame`.
  - Los juegos jugados (`recentGames.ts`, `gameaccess:last-played`).
  - Los rasgos del perfil (`tasteProfile.ts`).
  - Una **lista corta de candidatos**, no el catálogo entero (60.000 juegos no entran en un pedido): los de `tasteQuery` / `tasteScore`, o los primeros 40 resultados de la búsqueda. Cada uno va compacto: id, nombre, 3 géneros, 5 etiquetas, año y reseña.
- **Respuesta**: `{ "picks": [{ "id": n, "score": 0-100, "why": "..." }] }`, en el idioma de la app. Solo puede elegir ids de la lista de candidatos. El «por qué» nombra juegos que le gustaron o que jugó («te va a gustar porque te gustaron X e Y y se parece a Z»).
- **Nativo**: `ai_chat_json(system, user, schema)` en `ai_connection.rs`, con el mismo cliente que `ai_test`, `format` = el esquema y 60 s de espera. Devuelve el JSON del mensaje y los mismos errores (`no_key`, `rejected`, `limit`, `offline`).
- **Módulo** `aiPicks.ts`:
  - arma los candidatos y valida la respuesta;
  - guarda en caché por 24 h, con una clave hecha del perfil, los candidatos y la búsqueda;
  - guarda el «por qué» de cada juego (`gameaccess:ai-why`), para mostrarlo en la ficha.
- **Interfaz**:
  1. **Sugerencias**: una lista «Elegidos por la IA para vos» con portada y «por qué».
  2. **Búsqueda**: con el botón mágico prendido y la IA conectada, los primeros 40 resultados se reordenan con lo que dice Gemma, con un aviso «Ordenado por la IA».
  3. **Ficha** (`LibraryDetailPanel.tsx`, `DesktopFeature`, en la columna `ga-detail-gallery` junto a `CooptimusDetails`): el panel «Recomendación de la IA» muestra el «por qué» guardado, o el botón «¿Me va a gustar?», que pregunta solo por ese juego.
- **Sin IA**: todo queda como hoy.

### Cómo quedó (Seba, 2026-11-04, cambios durante la entrega)
- **Buscar con tus palabras**: con la IA conectada, el botón mágico del filtro pasa a ser «buscar con IA».
  - El jugador escribe lo que quiere («algo como Portal, cooperativo e indie») y aprieta Enter.
  - Gemma recibe el pedido, los me gusta / no me gusta (por nombre), la biblioteca y lo jugado.
  - Responde con juegos (nombre + **app id de Steam**) que el jugador no tiene. Arriba de la grilla, «La IA te responde».
  - Se prende desde 5 elecciones (pulgares y biblioteca), sin esperar el perfil de gustos.
- **El app id**: Gemma no navega por internet (Ollama en la nube solo corre el modelo), así que el id sale de su memoria y a veces está mal. Se usa solo si el juego del catálogo con ese id tiene el mismo nombre; si no, se busca por nombre. Lo que no está en el catálogo se descarta.
- **Inicio**: la tarjeta «Elegidos por la IA para vos».
  - Explica los pulgares y la biblioteca, y muestra el avance hasta 5 elecciones.
  - Muestra unos 20 juegos con su porqué (cache de 24 h).
  - Una vez por día, Gemma mira los lanzamientos de 30 días y puede marcar hasta 3 como «Nuevo».
- **Ficha**: en los juegos que sugirió Gemma, un panel de vidrio «Recomendación de la IA» con el porqué corto y, al abrir la ficha, su explicación larga (se pide una vez y queda guardada).
- Código: `aiSuggestions.ts` (con pruebas), `AiPicks.tsx`, `ai-picks.css`, `ai_chat_json` en `ai_connection.rs`.

## 3. Recomendaciones y biblioteca con IA
- **Recomendaciones**: Gemma recibe el perfil de gustos y una lista corta de candidatos del catálogo, y devuelve un orden con una línea de «por qué» para cada uno. Solo puede elegir entre los candidatos.
- **Biblioteca**: con las mismas herramientas, sugiere qué juegos ocupan lugar sin usarse, qué congelar o mover y qué falló. Nada se hace sin el permiso del jugador.

## Etapas
1. `ai_chat` con esquema y validación, y su prueba en la app compilada.
2. Botón mágico con IA.
3. `ai-tools.json`, el agente de diagnóstico y las mismas herramientas en el MCP.
4. Recomendaciones y biblioteca.
