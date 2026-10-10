# Videos editoriales GameAccess — formato v1

Fecha: 2026-10-10. Idioma inicial: español latinoamericano (es). Canal y fichas de juegos comparten el mismo video. Inglés (en) se produce después como versión independiente.

## Identidad y estructura

- Master horizontal 16:9, 1920×1080, 30 fps, H.264/AAC, MP4 con faststart.
- Intro: 2 segundos del logo existente apps/desktop/public/brand/logo-intro.webm; charcoal #111416 y naranja #ff6a00. Evitar una apertura larga antes del juego.
- Gancho: nombre del juego y una razón concreta para seguir mirando.
- Presentación: qué hace el jugador, mecánicas distintivas, género y experiencia.
- Steam: porcentaje positivo, número de reseñas, alcance de la consulta y fecha. Diferenciar valoración general de reciente; popularidad no equivale a calidad.
- Con quién jugar: solo, amigos, hijos o pareja, cuando corresponda. Explicar jugadores, local/online, pantallas, equipos y crossplay con evidencia de la versión PC. No recomendar para niños sólo porque haya multijugador: revisar clasificación, dificultad y contenido.
- Una limitación útil: compras adicionales, requisitos, acceso anticipado o modos separados cuando ayude a decidir.
- Transición a gameplay: footage que muestre una partida o situación representativa. Mantenerlo mientras aporte interés; sin límite obligatorio de un minuto.
- Cierre breve. El master dura lo que requiera el contenido; 4–10 minutos es una hipótesis inicial a medir. El guion no necesita forzar todos los apartados en cada juego.

Narración clara, cálida y práctica, sin afirmar que probamos personalmente un juego si no lo hicimos. Evitar repetir la ficha comercial literalmente: el borrador automático es materia prima, no el guion editorial final.

## Fuentes y selección de juegos

Empezar por lanzamientos ya disponibles que tengan actividad/ventas actuales; cruzar fecha de estreno con https://store.steampowered.com/charts/topselling/global y https://store.steampowered.com/charts/mostplayed. Las ventas incluyen ingresos y pueden incluir preventas/DLC: comprobar la ficha antes de recomendar.

Steam Store + reseñas son la base. Co-Optimus amplía modos cooperativos y número de jugadores; contrastar con documentación del editor. El recolector no raspa Co-Optimus automáticamente: guardar su URL y la información comprobada en editorial.play_with y editorial.distinctive_features de facts.json. Otros sitios pueden aportar datos si quedan identificados en sources. Ante un conflicto, dejar el dato pendiente.

Documentación técnica:
- Steam reviews: https://partner.steamgames.com/doc/store/getreviews
- Gemini TTS: https://ai.google.dev/gemini-api/docs/speech-generation
- YouTube embeds: https://developers.google.com/youtube/player_parameters
- YouTube rendimiento: https://support.google.com/youtube/answer/141805

## Pipeline reproducible

Herramientas: Python 3.10+ (biblioteca estándar), ffmpeg y ffprobe en PATH. En este PC usar py -3.11: el Python incluido en Inkscape falló en la validación de certificados HTTPS. No desactivar TLS.

Para ingresar o cambiar la clave con un campo oculto:

~~~powershell
powershell -NoProfile -STA -ExecutionPolicy Bypass -File tools/editorial_video/configure-gemini-key.ps1
~~~

La clave se guarda en el Administrador de credenciales de Windows para el usuario actual, bajo GameAccess/GeminiAPIKey. La pipeline prioriza esa entrada y conserva GEMINI_API_KEY o GOOGLE_API_KEY como alternativa para otros entornos. Si la clave existente funciona, el formulario permite cerrar con “Usar actual”. Nunca guardar claves en Git, frontend, JSON del episodio ni logs.

Desde la raíz del repositorio:

~~~powershell
python tools/editorial_video/pipeline.py collect 4078430 --output debug/visual/editorial/4078430/facts.json
python tools/editorial_video/pipeline.py draft debug/visual/editorial/4078430/facts.json --output debug/visual/editorial/4078430/episode.es.json
~~~

El recolector guarda título, descripción, modos declarados, fuentes, fecha y valoración de compradores Steam en todos los idiomas. No confundir ese porcentaje con el filtro de reseñas en inglés que una página puede mostrar.

Antes de renderizar, el agente/editor transforma el borrador en un guion conciso, agrega detalles contrastados de cooperativo y características, y elige imágenes/footage. Cada section contiene:

~~~json
{
  "id": "about",
  "title": "Qué ofrece",
  "text": "Narración literal en español latinoamericano.",
  "media": { "path": "media/official-trailer.mp4", "start": 12 }
}
~~~

Las rutas de medios son relativas al JSON del episodio. Para una imagen local usar png/jpg/webp. Para footage, seleccionar un tramo que alcance la duración de la voz más 0.25 s; la pipeline falla si no alcanza, en vez de repetirlo para extender la duración. Un archivo largo puede alimentar varios tramos con offsets diferentes. El audio del tráiler se sustituye por la narración en la presentación. El gameplay extendido conserva su audio:

~~~json
"gameplay": { "path": "media/gameplay.mp4", "start": 15, "duration": 180 }
~~~

Registrar origen, crédito y permiso de reutilización del footage en el expediente/sources. Usar gameplay propio o material que el editor/autor permita reutilizar. Localizar un tráiler oficial no demuestra ese permiso. La pipeline consume archivos locales seleccionados; no descarga videos ajenos ni publica automáticamente.

Revisar fuentes, narración, footage y recomendación; establecer editorial_reviewed=true. Ejecutar:

~~~powershell
python tools/editorial_video/pipeline.py render debug/visual/editorial/4078430/episode.es.json --output debug/visual/editorial/4078430/es
~~~

Para revisar el formato sin footage, la muestra sintética está identificada visiblemente y nunca representa gameplay:

~~~powershell
python tools/editorial_video/pipeline.py render tools/editorial_video/examples/format-preview.es.json --preview --height 720 --output debug/visual/editorial/format-preview
~~~

Gemini gemini-3.8-flash-tts recibe el texto literal; acento/ritmo van en speech_metadata.style. La REST Interactions API devuelve WAV completo en unary. La pipeline también convierte audio/l16 a un contenedor WAV válido si se devuelve ese MIME. Cada sección se sintetiza por separado y se reutiliza sólo cuando texto, modelo, voz y estilo coinciden.

Se mide cada WAV con ffprobe. La duración real determina el corte visual, los inicios de sección y los capítulos; la velocidad de voz no se fuerza a una estimación previa. Se normaliza la voz aproximadamente a -16 LUFS, pico -1.5 dB. Render independiente por idioma: la traducción puede durar distinto. En Windows el montaje usa Segoe UI instalada, sin depender de Fontconfig.

Salidas: AppID-es.mp4, WAV por sección, timeline.json, captions.vtt y youtube-description.txt. Los límites de sección son medidos; los tiempos de oraciones en VTT son aproximados y requieren revisión antes de publicar. Añadir subtítulos del gameplay sólo si existe diálogo que transcribir.

## Publicación e integración

1. Revisar visualmente imagen, voz, datos y créditos; comprobar subtítulos/capítulos.
2. Publicar el master en el canal GameAccess y habilitar embedding. El operador aporta el video ID real.
3. Registrar en apps/desktop/src/editorialVideos.ts, usando Steam AppID (no game.id), idioma, ID de YouTube, título y publishedAt.
4. Seguir GitHub-first: cambio/commit en GitHub, sincronización con monigote, build/test.
5. Las fichas priorizan el video publicado y conservan capturas. Sin registro, conservan su contenido de Steam. El registro inicial está vacío: ninguna URL inventada.
6. Si existe en inglés, la UI ofrece Español/English. Si sólo hay español, se muestra español aunque la interfaz esté en inglés.
7. El iframe permite controles, fullscreen, subtítulos y salida “Ver en YouTube”. Sin autoplay con sonido. La CSP nativa permite únicamente www.youtube-nocookie.com como frame externo.
8. Verificar playback en la aplicación Tauri con un ID publicado real. WebViews pueden necesitar identificación/referrer aceptado por YouTube; el enlace externo queda disponible si el embed es rechazado. Compilar no prueba playback.

No generar voces desde el cliente ni exponer la key. No integrar MP4 enormes, secretos o medios descargados en Git. No declarar publicado/integrado un episodio sólo porque exista un render local o un PR.

## Validación y próximos episodios

~~~powershell
python -m unittest discover -s tools/editorial_video -p "test_*.py"
npm --prefix apps/desktop test -- --run src/editorialVideos.test.tsx
npm --prefix apps/desktop run build
~~~

QA por episodio: ver de principio a fin; comprobar textos/porcentajes/fechas; escuchar acento y pronunciación; comprobar cortes, silencio y clipping; probar idioma y reproducción en navegador/Tauri. Medir clics, tiempo visto y caída al pasar a gameplay para ajustar el formato.

Primer candidato editorial: STAR WARS: Galactic Racer (AppID 4078430). La muestra incluida sólo valida el formato; no es su video final ni lleva footage de ese juego.
