---
name: gameaccess-gui-design
description: Game Access desktop UI design system. Use whenever you create or change any screen, dialog, panel, button, close control, chip, toast or form in apps/desktop (React/CSS), or review a screen for visual consistency. Enforces the detail-screen reference style, one close button, equal-height button rows, orange primary actions and glass panels with gradient borders.
---

# Game Access — diseño de la interfaz

Antes de tocar estilos o componentes de la interfaz, lee `docs/GUI_DESIGN.md` en la raíz del repo.
Es la fuente de verdad (tokens, tipografía, componentes, reglas y lista de comprobación).
Si esta skill y ese documento se contradicen, manda el documento; avisa al usuario para corregir la skill.

## Cuándo aplicarla

- Crear o modificar una pantalla, diálogo, panel, menú o botón en `apps/desktop/src`.
- Revisar una pantalla pedida por el usuario contra el estilo de referencia (la ficha de juego).
- Agregar CSS nuevo: primero busca si el componente ya existe en `docs/GUI_DESIGN.md` §4.

## Procedimiento

1. Identifica el componente que necesitas en `docs/GUI_DESIGN.md` §4. Si existe, úsalo tal cual.
2. Si no existe, propón su definición en `docs/GUI_DESIGN.md` (tokens, tamaños, radios, estados) antes de escribir CSS.
3. Usa tokens (`--ga-orange`, `--ga-danger`, `--ga-muted`, etc.), nunca colores sueltos nuevos.
4. Un diálogo: un `ga-close` (círculo rojo 38 px), como mucho una acción principal naranja.
5. Botones de una misma fila: misma altura (44 px; 54 px solo en la ficha de juego).
5b. Texto de un diálogo (§4.25 del documento, `components/ga/content.css`): los párrafos ya salen bien sin CSS propio (Manrope, 14 px, nunca menos de 13, interlineado 1.5, sin márgenes, alineados al inicio). No escribas reglas para `p` ni títulos; usá `ga-stack` para el espacio, `ga-hint`, `ga-status is-ok|is-warn|is-error`, `ga-label`, `ga-heading`, `ga-group`, `ga-actions` y `ga-disclosure`. Lo distinto (color, peso, recuadro, `--ga-p-size` más grande) es una excepción con su clase. Colores solo con tokens. `npm run check:css` lo controla.
5c. Jerarquía y espacios (§4.26 del documento): en un diálogo grande, título 52 px, texto principal 18 px en tinta de lectura, cada ítem como tarjeta con título 20 px en negrita y en su color sobre texto de 16 px; márgenes 40/44/36 px, 32 px entre secciones, 16 px entre tarjetas; ancho de la columna central (hasta 1200 px), texto a 80 caracteres por línea, tarjetas lado a lado del mismo alto; encabezado y botones fijos en pantallas bajas. En una pantalla ningún texto baja de 16 px. Mirá el resultado en la vista previa y medilo antes de darlo por hecho.
5d. Las clases de Tailwind solo existen en `src/library-manager` y `src/components/ui`, y sus utilidades son `!important`: el ancho o el color de un diálogo van en su CSS, con clase propia y `!important` donde la base fija lo mismo.
6. Textos: siempre `t("clave")` con claves en `src/locales/es.ts` y `en.ts`. Nunca texto fijo en JSX ni en `aria-label`/`title`.
7. Verifica con `npm run check:i18n`, `npm run check:css`, `npx tsc --noEmit -p tsconfig.json` y `npx vitest run`.
8. Si cambiaste el aspecto de una pantalla, pásala por la lista de comprobación (§6 del documento) antes de dar el cambio por terminado.

## Foco, Escape y pantallas completas

- Overlay (panel flotante): `ga-close` arriba a la derecha, Escape lo cierra.
- Pantalla completa (gestor de descargas, gestor de biblioteca): `ga-back` arriba a la derecha, con flecha y texto; Escape lo activa.
- Tab recorre todos los `button`. Sliders, casillas, controles de grilla, barras de desplazamiento, imágenes y videos llevan `tabIndex={-1}`.
- Los diálogos chicos con la imagen del juego de fondo no se cambian.

## Errores frecuentes que hay que evitar

- Agregar una X suelta sin círculo para cerrar: no. Siempre `ga-close`.
- Botón de confirmación en gris o blanco: la acción principal es naranja.
- Botón solo-icono de otra altura que sus vecinos: 44 × 44 px fuera de la ficha; 48 × 54 px en la fila de la ficha.
- Panel sin borde degradado ni vidrio: usa `ga-panel`.
- Radios de 8 px en botones de acción. Excepciones con 5 px: los pulgares y tienda de la ficha, y `ga-back`. El círculo es solo para `ga-close`.
- Títulos en Manrope: los títulos son Bebas Neue naranja.

## Interfaz nueva

Para las tareas de `docs/TAREA-interfaz-nueva.md` (catálogo, librería bento, paneles, aviso único, pie con cubos, animaciones GSAP) usá también la skill `gameaccess-motion-ui`.
