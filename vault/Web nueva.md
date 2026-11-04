---
tipo: diseño
actualizado: 2026-11-04
---
# Página web nueva (gameaccess.site)

Pedido de Seba (2026-11-04): la página tiene que verse más profesional y más trabajada, con transiciones GSAP, pero sin exagerar ni complicarla. Mantiene el estilo actual, el logo y todo lo que ya tiene. Lleva capturas reales de la app. La descarga es la normal desde GitHub, con la guía para el aviso de Windows ([[Instalador web]] queda descartado: Defender bloquea el comando pegado).

## Lo que se mantiene
- Página estática en here.now (`deploy/website`, `deploy/here-now/publish_site.py`), sin paso de build. El mismo i18n (`assets/i18n.js`, `data-i18n`, es/en).
- Estilo: fondo oscuro con el campo de píxeles (`pixel.js`), naranja `#ff6a00`, títulos en Bebas Neue, texto en Manrope, paneles de vidrio y botones LED. El logo animado sigue igual: los videos de `assets/brand` (header, hero, entrada).
- Descarga: el botón principal baja el instalador de la última release (`release.js`), con la versión y el tamaño. Debajo va la guía desplegable de 4 pasos ([[#Guía de instalación]]).

## Movimiento (GSAP)
- GSAP **3.13.0**, la misma versión que la app (`apps/desktop/package.json`), copiada a `assets/vendor/` (gsap + ScrollTrigger). Versión exacta, nada de CDN.
- Reglas: duraciones de 0,5 a 0,8 s; `power2.out`; escalonado de 0,06 a 0,1 s. Cada elemento se anima **una sola vez**, al entrar en pantalla. No se secuestra el scroll ni se fijan secciones. Con `prefers-reduced-motion` todo aparece sin animación (`gsap.matchMedia`). Sin GSAP (por ejemplo si falla la carga), la página se ve completa.
- La imagen principal (LCP) solo hace un fundido, nunca se desplaza.

## Secciones
1. **Cabecera**: logo, Funciones · Cómo funciona · PLUS · Preguntas, ES/EN y Descargar. Al bajar se vuelve compacta y de vidrio.
2. **Portada**: título, bajada y botones (Descargar, Ver cómo funciona). Al lado, una captura grande de la app dentro del marco metálico de la app. Entrada: logo → título por líneas → captura que sube con un fundido.
3. **Franja de confianza**: chips de «Beta gratuita · Windows 10 y 11 · Se actualiza solo · Nunca pide contraseñas».
4. **Funciones**: filas alternadas, texto de un lado y captura del otro. Catálogo, ficha del juego, biblioteca y su administrador, juegos de Steam de todas las cuentas, modo niño, pantalla grande con mando. Cada captura aparece al entrar en pantalla.
5. **Cómo funciona**: 3 pasos unidos por una línea que se dibuja con el scroll (el mismo trazo de lápiz que las letras de la app).
6. **PLUS**: qué suma, con el aspecto dorado de la app (bordes y líneas doradas, marca «+ PLUS»).
7. **Descargar**: botón, versión, requisitos (Windows 10 1809+ u 11 de 64 bits, Steam instalado antes) y la guía de instalación.
8. **Preguntas**: el acordeón actual, con apertura y cierre suaves.
9. **Pie**: contacto, enlaces y © 2026.

## Capturas de la app
- Las saca Claude de la vista previa de la app (`?uiDemo=1`, 1600 × 1000, a escala 1), en español y en inglés, en `.webp`. Lista: catálogo, ficha, biblioteca, administrador de biblioteca, modo niño, pantalla grande, Inicio con PLUS.
- Cada captura lleva ancho y alto fijos y `loading="lazy"`, salvo la de la portada.

## Guía de instalación
- Hecha (2026-11-04): un desplegable «¿Windows muestra un aviso al instalar?» con 4 pasos. (1) El navegador duda → ⋯ → Conservar. (2) Windows protegió tu PC → Más información. (3) Ejecutar de todas formas. (4) Control de cuentas → Sí. Cada paso tiene un dibujo en HTML con el botón marcado en naranja.
- Las capturas reales de Seba van en `deploy/website/assets/guide/paso-1.png` … `paso-4.png`. Si la imagen existe, reemplaza al dibujo; los anillos naranjas se ubican sobre cada captura cuando lleguen.

## Etapas
1. Estructura y estilos de las secciones nuevas, con los textos en es/en.
2. Capturas de la app.
3. GSAP: entrada de la portada, apariciones con el scroll y la línea de los pasos.
4. Revisión: 375 px y escritorio, los dos idiomas, movimiento reducido, sin GSAP, Lighthouse (rendimiento y accesibilidad ≥ 90). Publicar.

## A decidir con Seba
- Qué funciones van primero y si se muestra el precio de PLUS.
- Contacto y redes del pie.
- Si la portada usa una captura fija o un video corto de la app.
