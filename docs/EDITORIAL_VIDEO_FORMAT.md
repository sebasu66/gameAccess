# Protocolo editorial para videos de juegos

Versión 2 · 2026-10-19
Idioma inicial: español latinoamericano. Cada idioma se produce como una versión independiente con guion, voz, subtítulos y tiempos propios. El video publicado y la ficha de Game Access deben compartir la misma pieza y el mismo expediente factual.

## Propósito y criterio editorial

Cada episodio responde de forma narrativa y útil a «¿de qué se trata este juego?». Explica qué hace el jugador, qué experiencia propone, qué dicen sus reseñas, con quién se puede jugar, cómo se organiza el multijugador, si tiene VR, cuándo salió y qué clasificación de edad tiene. Esos temas se presentan en un orden reconocible, como una explicación continua, no como una lista de preguntas y respuestas.

El video dura lo que necesite la información y el gameplay para resultar claros e interesantes. No existe un límite obligatorio de un minuto ni se alarga con metraje repetido. Como referencia de edición, se busca una presentación compacta de aproximadamente 90–180 segundos y se extiende cuando los datos o una secuencia de juego representativa lo justifican. La prioridad es que la gente entienda el juego y pueda evaluar si le interesa.

La primera serie se elige entre juegos recientes con actividad visible en Steam. Las listas de más vendidos y más jugados sirven para encontrar candidatos; una posición alta no prueba calidad, ventas de copias ni interés duradero. Registrar la fecha de consulta y por qué se eligió cada juego.

## Fuentes y jerarquía de evidencia

Usar Steam AppID como clave de unión entre fuentes y versiones de plataforma. Antes de escribir, comprobar que cada fuente habla del juego, edición, plataforma y región correctos. Guardar URL, entidad responsable, fecha de consulta y el campo que respalda.

1. **Steam Store y editor/desarrollador:** base para título, descripción, fecha de lanzamiento en PC, géneros, etiquetas, requisitos y funciones declaradas. Las etiquetas y marcas de Steam son pistas, no prueba del número de jugadores, la campaña cooperativa, el modo local ni el soporte VR. Confirmar funciones con FAQ, manuales, notas de actualización o anuncios oficiales cuando sea posible. El endpoint público de detalles de la tienda se usa como conveniencia de recolección; no tiene un contrato público de Steamworks documentado y su esquema puede cambiar. La ficha visible es la referencia que se cita.
2. **Reseñas de usuarios de Steam:** capturar porcentaje, cantidad y alcance exactos. Usar `IUserReviewsService/GetAppReviews` para nuevas integraciones: Valve indica que reemplaza el endpoint legacy `store.steampowered.com/appreviews`. Las consultas anónimas no requieren publisher key, tienen límites bajos, pueden devolver 429 y sus resultados se cachean hasta 10 minutos. Registrar idioma, tipo de compra, tipo de reseña, filtro (`all` o `recent`), momento de consulta y si el porcentaje es general o reciente. No comparar cifras con filtros distintos ni presentar el recuento como total de ventas. La consulta `all` idiomas no representa específicamente a Latinoamérica.
3. **Temas de reseñas de Steam:** revisar una muestra equilibrada y explícita de reseñas recomendadas y no recomendadas; como pauta, 15–20 de cada grupo cuando haya suficiente volumen. Registrar ID, enlace, idioma, fecha, filtro y tamaño de muestra. Resumir temas recurrentes con palabras propias, distinguir críticas antiguas de problemas vigentes y revisar hotfixes/notas recientes. La muestra es cualitativa, no una encuesta ni un consenso estadístico; no reproducir párrafos de usuarios.
4. **Prensa y agregadores:** usar páginas de análisis identificables. Metacritic describe su Metascore como un promedio ponderado de críticas seleccionadas; mostrarlo como una métrica editorial distinta de las reseñas de Steam e indicar plataforma, escala, fecha y cantidad de análisis cuando esté disponible. OpenCritic puede ser una referencia de consulta, pero no asumir un API público ni extraerlo automáticamente sin permiso. No combinar puntuaciones de escalas distintas. Preferir resumir dos o tres críticas nombradas y equilibradas; no copiar el análisis.
5. **Modos cooperativos:** Co-Optimus ofrece un catálogo especializado con filtros de cooperativo online, local/couch, pantalla dividida, cantidad de jugadores y alcance de campaña. Guardar la ficha exacta y contrastar los datos con el editor, el juego o una fuente actual de la versión PC. Es una fuente complementaria: la ausencia de una ficha no demuestra que un modo no exista y no se debe asumir que ofrece API. IGDB puede estructurar modos y límites (cooperativo de campaña, local/online, LAN, pantalla dividida y máximos), sujeto a verificación y condiciones de uso.
6. **Clasificación por edad:** consultar el sistema oficial que corresponda a la región y plataforma: ESRB, PEGI o ClassInd/IARC para Brasil cuando exista una clasificación verificable. Registrar organismo, etiqueta/edad, región, plataforma y descriptores. «Sin clasificación localizada» se expresa como dato no confirmado; jamás equivale a «apto para todas las edades». La clasificación de contenido no mide dificultad ni accesibilidad.
7. **Enriquecimiento opcional:** RAWG o IGDB pueden aportar géneros, fechas, plataformas, clasificaciones, modos o identificadores para descubrimiento. Antes de automatizar, revisar atribución, uso comercial, redistribución, caché y límites de cada plan. Los datos de agregadores no reemplazan la fuente primaria.

Para cada dato en conflicto, conservar ambas fuentes y dejarlo como «no confirmado» hasta resolverlo. Nunca convertir ausencia de un campo en `false`. Si una fuente está desactualizada o no distingue PC de consolas, no presentarla como prueba de la versión de PC.

## Expediente por episodio

El archivo de datos del episodio es la fuente común del guion, las tarjetas, capítulos, subtítulos, descripción de YouTube y revisión final. La narración y los rótulos deben salir del mismo expediente para evitar que el video diga algo distinto de lo que muestra.

Como mínimo debe incluir:

```json
{
  "app_id": 123456,
  "platform": "PC / Steam",
  "edition": "edición verificada",
  "language": "es-419",
  "checked_at": "2026-10-19T00:00:00Z",
  "release": { "date": "YYYY-MM-DD", "source": "URL" },
  "genres": [{ "value": "Acción", "source": "URL" }],
  "steam_reviews": {
    "positive_percent": 0,
    "review_count": 0,
    "scope": "all-time / recent",
    "language": "all",
    "purchase_type": "steam",
    "review_type": "all",
    "filter": "all",
    "checked_at": "ISO-8601",
    "source": "URL"
  },
  "critics": [{ "outlet": "Medio", "score": "8/10", "platform": "PC", "date": "YYYY-MM-DD", "source": "URL", "summary": "Paráfrasis" }],
  "modes": [{
    "kind": "co-op",
    "scope": "entire campaign / separate mode / unknown",
    "network": ["online", "local", "LAN"],
    "players_min": 1,
    "players_max": 4,
    "split_screen": "yes / no / unknown",
    "crossplay": "yes / no / unknown",
    "source": "URL"
  }],
  "vr": { "status": "native / required / optional / no / unknown", "source": "URL" },
  "age_ratings": [{ "body": "PEGI", "age": "16", "region": "EU", "platform": "PC", "descriptors": [], "source": "URL" }],
  "footage": [{ "path": "media/gameplay.mp4", "type": "captured gameplay", "owner": "creator", "permission": "basis and URL", "game_audio": "licensed / muted / unknown" }],
  "sources": [{ "field": "release.date", "url": "URL", "checked_at": "ISO-8601", "confidence": "primary / corroborated / unconfirmed" }]
}
```

Las cantidades y valores `unknown` son ilustrativos. No inventar ni rellenar con cero. Adjuntar al expediente el guion aprobado, la procedencia de assets y la decisión editorial. Guardar los IDs/enlaces de las reseñas revisadas sin conservar material que no se necesita.

## Guion y ritmo del video

El orden base puede ajustarse si el juego pide otra entrada, pero cada tema debe aparecer donde ayude a entender la experiencia:

1. **Apertura y gancho:** logo Game Access con la identidad y firma sonora ya usadas por la aplicación; presentar nombre y motivo concreto para seguir. Tras la formación, el logo se acopla a la esquina y permanece flotando de forma discreta. Usar el fondo aportado en escenas de marca/cierre según el protocolo de producción.
2. **Qué haces en el juego:** mostrar gameplay real mientras la voz explica el objetivo, acciones principales, bucle de juego, género y qué lo distingue. Evitar leer la descripción de la tienda.
3. **Lanzamiento y contexto:** fecha de estreno de la versión PC, estado actual (por ejemplo, acceso anticipado) y plataforma. Si una fecha es de consola o de la franquicia, identificarla correctamente.
4. **Qué opina la gente:** porcentaje y número de reseñas Steam con alcance/filtro y fecha; luego dos o tres elogios frecuentes y una o dos críticas concretas, indicando qué proviene de usuarios y qué de prensa. Incorporar Metacritic/OpenCritic solo como métricas separadas, si aportan contexto.
5. **Con quién y cómo se juega:** explicar si invita a jugar solo, con amistades, en familia o en pareja, sin forzar una recomendación. Aclarar por modo si es cooperativo o versus, local, online o LAN, si cubre toda la campaña o una modalidad aparte, jugadores por partida, tamaño de grupo, pantalla dividida y crossplay. Diferenciar partida máxima del grupo que se puede invitar.
6. **VR, edad y PC:** decir si hay VR nativa, opcional, requerida, ausente o sin confirmar; mostrar clasificación y región; dar una orientación práctica de PC básica, gama media o alta según requisitos publicados, con fecha. No prometer FPS ni ajustes sin mediciones.
7. **Gameplay y cierre:** terminar la explicación y dejar una secuencia más larga de gameplay cuando aporte valor. La música y el audio original se mezclan según permisos; no repetir clips para inflar duración. Cerrar con una pregunta ligada al juego, invitar a dejar una opinión/comentario y suscribirse para conocer próximos juegos, con despedida breve.

La voz es cálida, directa y expresiva; adapta ritmo y tono al juego (energía en carreras, tensión contenida en terror, calma en juegos cozy). Reducir velocidad al pronunciar cifras o restricciones. No decir que el equipo probó un juego si no lo hizo. Revisar pronunciación de nombres, siglas, porcentajes y topónimos. Gemini TTS recibe el texto literal; la dirección de voz va en el estilo, no dentro de la narración. No acelerar artificialmente la voz para ajustarla al metraje.

## Imagen, tarjetas y sincronización

El gameplay ocupa el cuadro principal siempre que exista material autorizado y representativo. Elegir segmentos que muestren el bucle real, decisiones, movimiento, interfaz y cooperación cuando aplique. Priorizar captura propia. Los trailers oficiales pueden complementar la presentación, pero no sustituyen gameplay ni se presumen reutilizables por estar publicados en Steam o YouTube. Revisar la política del editor para cada título y los derechos de la música/recursos de terceros; dar crédito no concede licencia. No descargar ni reutilizar videos de terceros sin permiso.

Formato de master vigente: horizontal 16:9, 1920×1080, 30 fps, H.264/AAC MP4 con faststart. Mantener la estética charcoal `#111416`, acento naranja `#ff6a00`, títulos grandes y wordmark auténtico. La firma sonora se conserva con las apariciones animadas del logo; recortar únicamente la cola silenciosa según el activo maestro y su decaimiento. No modificar los assets de la aplicación.

Al comenzar cada sección, introducir un subtítulo corto y debajo una síntesis de una línea que acompañe lo que la voz explica. A medida que se narran, revelar en una tarjeta lateral datos concretos: valoración Steam, recuento/filtro, modos y jugadores, VR, clasificación/edad y fecha. Mantenerlos legibles en móvil, como máximo cuatro filas a la vez; actualizar o retirar los datos al cambiar de bloque. Las tablas de modos pueden usar filas separadas por campaña y modalidad. Mostrar «sin confirmar» cuando aplique. El capítulo y el indicador de progreso marcan la sección, mientras el gameplay sigue siendo el foco.

Las tarjetas no deben adelantarse a la narración ni resumir un dato con más certeza. La puntuación siempre incluye plataforma y sistema de reseñas; el panel de edad incluye organismo/región; el panel de multijugador expresa modo y alcance. Los subtítulos WebVTT/SRT transcriben la voz y se sincronizan después de medir el audio final: los resúmenes visuales no sustituyen subtítulos accesibles.

## Pipeline operativo existente

Herramientas: Python 3.10+, FFmpeg/FFprobe en PATH, Pillow y NumPy según `tools/editorial_video/requirements.txt`. En esta PC, usar `py -3.11` para evitar el problema de certificados observado en el Python de Inkscape. No desactivar TLS.

Configurar la clave Gemini con el formulario oculto de Windows:

```powershell
powershell -NoProfile -STA -ExecutionPolicy Bypass -File tools/editorial_video/configure-gemini-key.ps1
```

La clave se guarda en el Administrador de credenciales de Windows bajo `GameAccess/GeminiAPIKey`. No guardarla en Git, el frontend, el JSON del episodio ni los logs.

Desde la raíz del proyecto:

```powershell
python tools/editorial_video/pipeline.py collect 4078430 --output debug/visual/editorial/4078430/facts.json
python tools/editorial_video/pipeline.py draft debug/visual/editorial/4078430/facts.json --output debug/visual/editorial/4078430/episode.es.json
python tools/editorial_video/pipeline.py render debug/visual/editorial/4078430/episode.es.json --output debug/visual/editorial/4078430/es
```

El recolector actual obtiene datos de Steam y reseñas, requisitos y clasificaciones declaradas. Su código todavía solicita reseñas por el endpoint legacy `/appreviews`; migrar la integración a `IUserReviewsService/GetAppReviews` antes de depender de nuevas ejecuciones automatizadas. El borrador es materia prima: el editor incorpora y cita datos contrastados, decide incertidumbres y deja `editorial_reviewed=true` solo tras revisar fuentes, voz y medios.

Las rutas de medios son relativas al JSON. Un tramo de footage debe cubrir la voz más 0,25 s; el render falla si es corto en vez de repetirlo. El audio del trailer se reemplaza por narración en la presentación. El gameplay extendido puede conservar sonido únicamente con derechos revisados. Registrar procedencia, crédito y permiso en el expediente. No hay descarga automática de videos ajenos ni publicación automática.

El estilo de TTS se ajusta por sección. La música opcional usa una composición instrumental original mediante `music.py` o una pista propia/autorizada; entra después del logo, se atenúa bajo la voz y sale antes de gameplay con audio propio. No tapar la firma del logo ni superponer dos músicas. La pipeline mide la duración real de cada WAV y usa esa medición para cortes, capítulos y subtítulos; revisar los tiempos de frase de VTT antes de publicar.

La sección final puede ir después del bloque de gameplay y mostrar pregunta/suscripción sobre el fondo aportado. La demo de Galactic Racer vive en `tools/editorial_video/examples/galactic-racer.es.json`; sus cifras son un snapshot histórico y deben revisarse de nuevo antes de publicar. Su footage de demo usa trailers oficiales, descritos como tales, no como captura propia.

## Control de calidad por episodio

**Datos:** confirmar AppID, edición, plataforma PC, fecha de la versión correcta, snapshot de reseñas con filtro y hora, opiniones representativas, alcance de campaña, modalidad, máximo de jugadores, local/online/LAN, pantalla dividida, crossplay, VR y clasificación regional. Revisar actualizaciones recientes y anotar incertidumbres.

**Contenido:** comprobar que se entiende el bucle de juego; que la voz fluye como explicación y no cuestionario; que usuario y crítica están separados; que ninguna opinión de muestra se vende como consenso; que edad no se deduce por estética y que no se afirma una experiencia personal inexistente.

**Edición:** ver y escuchar el video completo; comparar cada rótulo con la voz y el expediente; revisar la lectura en pantalla pequeña, cortes, balance de música/voz, pronunciación, silencios, clipping, capítulos y sincronía de subtítulos. Usar gameplay real en las escenas indicadas o identificar con precisión el material promocional.

**Derechos y publicación:** registrar permiso/política del publisher, capturador y música por separado; revisar Content ID tras subir el borrador privado. Un reclamo puede bloquear, monetizar o rastrear el video. Activar embedding y copiar el ID publicado real. No asumir que duración larga aumenta por sí sola monetización o tiempo visto.

## Publicación e integración en Game Access

1. Publicar en el canal GameAccess y permitir embedding; el operador copia el ID real del video.
2. Mantener el registro de videos por Steam AppID, idioma, ID de YouTube, título y fecha de publicación; no inventar IDs ni URLs.
3. Para cada idioma, publicar la versión correspondiente. Si solo existe español, mostrar esa versión aunque la interfaz esté en inglés.
4. Mostrar el video publicado en la ficha del juego, conservar capturas como contenido complementario y habilitar controles, pantalla completa, subtítulos y salida a YouTube. No reproducir automáticamente con sonido.
5. Usar el reproductor/iframe oficial y probarlo con un video publicado real en Tauri; WebView puede rechazar el embed y debe conservarse el enlace externo como salida. Un build no demuestra reproducción.
6. No integrar MP4 grandes, claves ni medios de terceros en Git. No declarar que el episodio está publicado o integrado porque exista un render o un borrador de cambio.

La ficha ampliada con video y notas de prensa sigue en estado planeado en `vault/Tareas.md`. Este protocolo define el estándar editorial; no afirma que la integración de la app ya esté implementada.

## Fuentes de referencia

- Steam `IUserReviewsService`: https://partner.steamgames.com/doc/webapi/IUserReviewsService
- Steam Store charts: https://store.steampowered.com/charts/topselling/global y https://store.steampowered.com/charts/mostplayed
- IGDB API y condiciones: https://api-docs.igdb.com/ y https://www.igdb.com/api-terms
- Co-Optimus: https://www.co-optimus.com/
- RAWG API y condiciones: https://rawg.io/apidocs
- Metacritic, metodología: https://www.metacritic.com/about-us/
- ESRB: https://www.esrb.org/search/ ; PEGI: https://pegi.info/search-pegi ; ClassInd Brasil: https://www.gov.br/mj/pt-br/assuntos/seus-direitos/classificacao-1/paginas-classificacao-indicativa/jogos-e-apps
- Gemini speech generation: https://ai.google.dev/gemini-api/docs/speech-generation
- YouTube IFrame API: https://developers.google.com/youtube/iframe_api_reference
- YouTube gameplay y monetización: https://support.google.com/youtube/answer/138161 y https://support.google.com/youtube/answer/2490020
- YouTube fair use y Content ID: https://support.google.com/youtube/answer/9783148 y https://support.google.com/youtube/answer/2797370
- La política de uso de gameplay varía por publisher; ejemplo Ubisoft: https://www.ubisoft.com/legal/documents/UbisoftVideoPolicy/en-US
