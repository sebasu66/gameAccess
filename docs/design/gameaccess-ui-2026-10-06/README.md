# GameAccess — mockup independiente

Abrí `gameaccess-mockup.html` con doble clic en un navegador. Es un único HTML con portadas, capturas y reproductor incluidos; no necesita instalar dependencias ni levantar un servidor. Los tráileres y la fuente Manrope utilizan conexión a Internet. Sin conexión, las imágenes funcionan y se usa la fuente del sistema.

## Probar

- Escribí un título, un género o una etiqueta en el buscador inferior; Ctrl+K enfoca la búsqueda.
- Dos botones circulares independientes del buscador eligen Catálogo/Biblioteca. Su nombre se revela al pasar el mouse o enfocar con el teclado. Los favoritos también aparecen en Biblioteca aunque no estén instalados.
- Los controles del footer permiten filtrar por género/modo, ordenar, ver descargas y ajustar el reflejo/tamaño de las portadas.
- Clic o Enter en una portada abre la ficha. Escape o X la cierra y mantiene el punto de la grilla.
- Las flechas mueven el foco. Tab recorre los controles.
- La estrella de la ficha cambia favoritos; estos siempre preceden al resto del ordenamiento, incluso en resultados filtrados.
- Elden Ring, Cyberpunk 2077 y Baldur’s Gate 3 incluyen capturas y un tráiler de Steam. El video empieza silenciado.
- Modo de juego incluye Un jugador, Co-op Local/LAN/Online, Multiplayer Local/LAN/Online y MMO. Son casillas inclusivas: seleccionar varias muestra la unión de sus resultados, sin duplicar juegos. El género y la búsqueda siguen restringiendo ese conjunto.
- Se muestran como máximo 50 juegos por página. El ancho de referencia se calcula con el espacio real de la ventana: la escala proporcional va de 0,70× (muchos resultados) a 1,50× (cinco o menos). También se aplican límites de 120–360 píxeles CSS, un máximo según la altura disponible y la cantidad de columnas que caben. El zoom y escalado del sistema ya están reflejados en el viewport CSS. No se agregó información a las tarjetas.

## Alcance

Los iconos de la pantalla principal usan siluetas SVG rellenas. La lupa mide 30 px, los iconos de Catálogo/Biblioteca 30 px dentro de sus botones de 62 px, y los controles del footer 22 px. En ventanas estrechas se ajustan a 26, 27 y 20 px respectivamente. Los contenedores mantienen su tamaño; las estrellas y marcas de instalación también tienen mayor presencia.

No se modificó el repositorio de GameAccess. Descargar/Jugar, cuenta y progreso de descarga son demostraciones. Tamaños, valoraciones, años, modalidades y estados son muestras de presentación, no una auditoría del catálogo. Las portadas/capturas y las descripciones de los tres juegos destacados provienen de Steam.

Reflejo de vidrio sobre la portada seleccionada, elevación sutil al enfocar y transición breve de la ficha. `prefers-reduced-motion` desactiva las animaciones.

La ficha muestra el Library Hero ultrapanorámico de Steam en una franja superior que ocupa todo el ancho, con recorte adaptable. Los 19 juegos incluyen esa imagen integrada en el HTML. El título en Bebas Neue y los datos principales quedan debajo, en la columna izquierda; la galería ocupa la derecha. El acento naranja #ff6a00 aparece en el título, las líneas, los estados y los botones de acción con texto negro. El círculo del tráiler mantiene los 65 px del diseño original: se amplía el SVG del triángulo de 20 a 48 px. El botón Jugar también muestra un triángulo negro relleno, con SVG de 32 px. Jugar tiene iluminación de borde, reflejo y movimiento breve del icono; Favoritos anima la estrella. Las animaciones responden al mouse y al foco del teclado, y respetan `prefers-reduced-motion`. Estos efectos usan SVG y CSS, sin reproductor Lottie.

La fuente es Manrope (Google Fonts). El reproductor incorpora hls.js 1.7.3: https://github.com/video-dev/hls.js; licencia incluida en `hls-LICENSE.txt`. Imágenes: Valve/Steam y sus respectivos titulares.
