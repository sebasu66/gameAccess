---
tipo: diseño
actualizado: 2026-11-04
---
# Página web nueva (gameaccess.site)

Pedido de Seba (2026-11-04): una página más profesional y moderna, con efecto «wow», pero sin exagerar ni complicarla. Mantiene el estilo actual, el logo y todo lo que ya tiene, y suma capturas reales de la app. Idea de Seba para el movimiento: se entra con **la tapa cerrada**; al bajar **la tapa se abre** y muestra el contenido; más abajo, una animación con GSAP **presenta las funciones con efecto 3D**. La descarga es la normal desde GitHub, con la guía para el aviso de Windows ([[Instalador web]] quedó descartado porque Defender bloquea el comando pegado).

## Qué se anuncia
**Ya está en la app** (se muestra como función):
1. Catálogo de más de 60.000 juegos de PC con búsqueda, géneros, etiquetas, reseñas de Steam y juegos gratis.
2. Fichas completas: tráiler, capturas, valoraciones y requisitos.
3. Juegos de Steam de todas las cuentas de la PC, con **cambio automático a la cuenta dueña** al jugar. Nunca pide contraseñas.
4. **Control parental / modo niño**: cuenta de Windows propia para cada chico, juegos permitidos, horarios y horas por día, todo cuidado con la clave del padre.
5. **Descargas aceleradas con PLUS**: hasta 4 a la vez, y las lentas pasan por nuestro servidor.
6. Biblioteca y **administrador de biblioteca**: el avance de cada tarea, su registro y reintentar lo que falló.
7. Jugar más seguro: antes de abrir un juego revisa Steam, las librerías que faltan y el driver de video.
8. Importar los juegos que ya están en los discos.
9. Pantalla grande con mando.
10. Se actualiza solo y conserva juegos, ajustes y la llave de PLUS.
11. **Conectar IA**: el asistente crea la cuenta de Ollama y toma la clave solo (Configuración › IA).

**En camino** (con la etiqueta «Próximamente», y pasa a «ya está» cuando se publique; plan en [[IA en la app]]):
12. Búsqueda y filtros con IA: el botón mágico del filtro le pide a Gemma mejores sugerencias.
13. Recomendaciones con IA según tus gustos.
14. Diagnóstico con IA: si un juego no abre, la IA revisa, explica qué pasa y lo arregla con las herramientas de la app.
15. Administrador de biblioteca guiado por IA.

## Sistema de diseño
Es el de la app y el de la página actual; no se inventa otro.
- **Tokens** (`site.css :root`): naranja `--ga-orange #ff6a00`, fondo `#0a0a0c`, blanco `#f4f4f2`, gris `#929ba2`, líneas `#ffffff20`. Se suman los de la app: metal (degradado gunmetal y la textura `brushed-steel.jpg` de la app) y el dorado de PLUS (`--ga-plus-*`, los mismos valores que `gameaccess-theme.css`).
- **Tipografía**: Bebas Neue para títulos y números, Manrope para el texto. Escala: título de portada `clamp(56px, 9vw, 128px)`, título de sección `clamp(40px, 5vw, 72px)`, texto de 17 a 18 px.
- **Componentes**:
  - Botón LED (el actual) y botón de vidrio.
  - Panel de vidrio con borde degradado.
  - **Marco de dispositivo**: el bisel metálico de la app alrededor de cada captura; con PLUS, sus líneas doradas.
  - Chips de confianza, fila de función (texto y captura), línea de pasos, acordeón y la guía de instalación.
- **Grilla**: ancho máximo de 1200 px y margen `clamp(16px, 4vw, 48px)`. Escritorio a dos columnas; desde 768 px hacia abajo, una sola.
- **Fondo**: el campo de píxeles actual (`pixel.js`) sigue detrás de todo.

## Movimiento (GSAP)
**Base técnica**
- GSAP **3.13.0** + **ScrollTrigger**, la misma versión que la app, copiados a `assets/vendor/`. Gratis, versión exacta, sin CDN.
- Solo se animan `transform` y `opacity`. El 3D sale de CSS (`perspective` y `rotateX/Y`), sin WebGL.

**Escenas**
1. **La tapa**: la portada de la app llevada a la página: dos hojas de metal cepillado, la cerradura con el emblema y GAME / ACCESS tenue, dibujado letra por letra.
   - Al cargar, en 1,5 s, se dibujan las letras y la cerradura gira.
   - Con el scroll, la sección queda fija durante una pantalla y media y las hojas se abren según cuánto bajes (`scrub`). Detrás aparece la portada, que crece de 0,94 a 1 y pasa de transparente a visible.
   - Un aviso «Bajá para abrir» con una flecha invita a seguir.
   - Los enlaces del menú (Descargar, etc.) saltan directo a su sección, sin pasar por la tapa.
2. **Portada**: título por líneas, bajada y botones. Al lado, la captura grande de la app dentro del marco metálico.
3. **Funciones en 3D**: una sección fija de unas 4 pantallas.
   - Escritorio: el marco con la captura queda en el centro, inclinado en 3D (`rotateY` −14° → 0° → 14°, con una sombra que acompaña), y cambia de pantalla en cada función con un giro y un fundido. A la izquierda se cruza el texto de cada función y unos puntos marcan el avance.
   - Móvil: sin sección fija; tarjetas que aparecen una debajo de la otra.
4. **Cómo funciona**: 3 pasos unidos por una línea de lápiz que se dibuja con el scroll (`stroke-dashoffset`), el mismo trazo que las letras de la tapa.
5. **PLUS**: al entrar, un brillo dorado recorre una vez el borde de la tarjeta y aparece la marca «+ PLUS».
6. **El resto**: aparece desde 24 px más abajo con fundido, escalonado de 0,08 s, una sola vez. Las preguntas se abren con altura animada.

**Reglas**
- Duraciones de 0,5 a 0,8 s, `power2.out`. Las dos escenas fijas (tapa y funciones) son las únicas que siguen el scroll.
- Con `prefers-reduced-motion` (`gsap.matchMedia`), la tapa no aparece y no hay secciones fijas ni giros: todo se ve directamente.
- Si GSAP no carga, la página se ve completa: el contenido está en el HTML en su orden y la animación solo lo acompaña.

## Capturas de la app
- Las saca Claude de la vista previa de la app (`?uiDemo=1`, 1600 × 1000), en español y en inglés, en `.webp` de unos 150 KB cada una.
- Lista: Inicio, catálogo, ficha de un juego, biblioteca, administrador de biblioteca, cambio de cuenta de Steam, modo niño, pantalla grande, Conectar IA, y la app con PLUS (dorada).
- Llevan ancho y alto fijos y `loading="lazy"`; la de la portada se precarga.

## Guía de instalación
- **Hecha** (2026-11-04, publicada): el desplegable «¿Windows muestra un aviso al instalar?» con 4 pasos. (1) Conservar. (2) Más información. (3) Ejecutar de todas formas. (4) Sí.
- Las capturas reales de Seba van en `assets/guide/paso-1.png` … `paso-4.png` y reemplazan los dibujos.

## Etapas
1. Pasar a la página el sistema de diseño y la estructura de las secciones, con los textos en es/en.
2. Capturas de la app.
3. Escenas GSAP: la tapa, la portada, las funciones en 3D y la línea de los pasos.
4. Revisión: 375 px, 768 px y escritorio; los dos idiomas; movimiento reducido; sin GSAP; Lighthouse (rendimiento y accesibilidad ≥ 90). Publicar.

## A decidir con Seba
- El orden de las funciones (propuesta: catálogo, Steam multi-cuenta, control parental, descargas aceleradas, IA, biblioteca).
- Si se muestra el precio de PLUS.
- Contacto y redes del pie.
- Portada con captura fija o con un video corto de la app.
