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
6. Textos: siempre `t("clave")` con claves en `src/locales/es.ts` y `en.ts`. Nunca texto fijo en JSX ni en `aria-label`/`title`.
7. Verifica con `npm run check:i18n`, `npx tsc --noEmit -p tsconfig.json` y `npx vitest run`.
8. Si cambiaste el aspecto de una pantalla, pásala por la lista de comprobación (§6 del documento) antes de dar el cambio por terminado.

## Errores frecuentes que hay que evitar

- Agregar una X suelta sin círculo para cerrar: no. Siempre `ga-close`.
- Botón de confirmación en gris o blanco: la acción principal es naranja.
- Botón solo-icono de otra altura que sus vecinos: 44 × 44 px.
- Panel sin borde degradado ni vidrio: usa `ga-panel`.
- Radios de 5 px o 50 % en botones: 8 px; el círculo es solo para `ga-close`.
- Títulos en Manrope: los títulos son Bebas Neue naranja.
