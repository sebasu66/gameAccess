# Game Access — sistema de diseño de la interfaz

Fuente de verdad visual. La pantalla de **detalle del juego** es la referencia: si una pantalla
contradice este documento, la pantalla se corrige. Los valores son los de `apps/desktop/src/gameaccess-theme.css`
y `filter-wizard.css`; cuando cambie un valor, cambia aquí primero.

## 1. Tokens

| Token | Valor | Uso |
|---|---|---|
| `--ga-orange` | `#ff6a00` | acción principal, títulos de pantalla, selección |
| `--ga-orange-hover` | `#ff8230` | hover de la acción principal |
| `--ga-bg` | `#111416` | fondo de la app |
| `--ga-panel` | `rgba(21,25,29,.94)` | paneles y diálogos (vidrio) |
| `--ga-white` | `#f4f4f2` | texto principal |
| `--ga-muted` | `#929ba2` | texto secundario, subtítulos, pistas |
| `--ga-line` | `#ffffff20` | separadores y bordes de elementos secundarios |
| `--ga-danger` | `#e5202e` | cerrar (botón de cierre), acciones destructivas |
| `--ga-danger-hover` | `#ff3342` | hover del botón de cierre |
| `--ga-success` | `#8fe3b0` | estados completados |

Naranja sobre fondo oscuro: el texto sobre naranja es `#140a02` (casi negro cálido), nunca blanco.

## 2. Tipografía

- **Títulos de pantalla y diálogo:** Bebas Neue, naranja, mayúsculas.
  - Pantalla completa: 56 px. Diálogo: 36–48 px. Nunca menos de 32 px.
- **Cuerpo, botones, etiquetas:** Manrope. Base 14 px, interlineado 1.5.
  - Botones: 700, 14 px. Etiquetas de sección: 800, 11 px, mayúsculas, `letter-spacing: .14em`.
- **Eyebrow** (línea superior del encabezado, p. ej. "GAME ACCESS"): Manrope 800, 11 px, naranja, `letter-spacing: .18em`.
- **Subtítulo:** Manrope 400, 14 px, `--ga-muted`.

## 3. Espaciado y forma

- Escala de 4 px: 4, 8, 12, 16, 20, 24, 28, 32.
- Padding de diálogo y panel: 28 px. Padding de panel compacto (dentro de un diálogo): 16 px.
- Gap entre botones de una fila: 10 px. Entre secciones: 24 px.
- Radios: **botones y campos 8 px**, paneles y diálogos 12 px, chips 16 px (pastilla).
- Ningún radio de 5 px ni de 50 % salvo el botón de cierre, que es circular.

## 4. Componentes

Cada componente tiene una sola definición. Si una pantalla necesita una variante, se agrega aquí antes de usarla.

### 4.1 Botón de cierre `ga-close` (obligatorio en todo diálogo y panel)
- Círculo de **38 × 38 px**, arriba a la derecha con 18 px de margen.
- Fondo `--ga-danger`, borde 1 px `#ff6b75`, icono X blanco de 18 px.
- Sombra de resplandor `0 0 14px #e5202e88`. Hover: fondo `--ga-danger-hover`, resplandor `0 0 20px #ff3342cc`.
- Prohibido: X sin fondo, X en cuadrado redondeado, X en otro color.

### 4.2 Botón principal `ga-btn-primary`
- Fondo `--ga-orange`, texto `#140a02`, borde 1 px `--ga-orange`. **Altura 44 px**, padding horizontal 18 px, radio 8 px.
- Hover: `--ga-orange-hover`, desplazamiento `translateY(-1px)`.
- Una sola acción principal visible por diálogo. Confirmar, Activar, Guardar, Mostrar resultados: todos naranja.
- Peligro (desinstalar, borrar): fondo `#c8321f`, texto blanco. Nunca naranja.

### 4.3 Botón secundario `ga-btn-secondary`
- Fondo `#ffffff08`, borde 1 px `#ffffff25`, texto blanco. **Altura 44 px** (igual que el principal), radio 8 px.
- Hover: fondo `#ffffff14`.
- Botón solo con icono (`…`, favoritos, pulgares, tienda): **44 × 44 px**, misma forma y borde que el secundario. Mismo alto que el texto de la fila: nunca más bajo ni más alto.

### 4.4 Acción de la ficha de juego `ga-glass-action`
- Exclusivo de la ficha de juego (la fila de Descargar / Jugar / Librería). **Altura 54 px**, radio 8 px, icono de 27 px.
- No se usa en diálogos ni en listas.

### 4.5 Chip de filtro `ga-chip`
- Pastilla de **32 px** de alto, radio 16 px, texto Manrope 700 12 px.
- Seleccionado: fondo naranja, texto oscuro. No seleccionado: borde `--ga-line`.
- Contador dentro del chip, separado por 6 px.

### 4.6 Panel y diálogo `ga-panel`
- Fondo `--ga-panel`, `backdrop-filter: blur(16px)`, radio 12 px, padding 28 px.
- **Borde degradado claro:** borde de 1 px con gradiente de `#ffffff55` (arriba izquierda) a `#ffffff08` (abajo derecha), aplicado con máscara (`mask-composite: exclude`), como `gameaccess-theme.css:472`.
- Sombra `0 24px 60px #0008`.
- Encabezado estándar: eyebrow + título Bebas + subtítulo muted, botón `ga-close` arriba a la derecha, separador `--ga-line` debajo.

### 4.7 Fondo de superposición `ga-backdrop`
- `#05080ccc` con `backdrop-filter: blur(10px)`. Cierra al pulsar fuera o con Esc (salvo procesos en curso).

### 4.8 Campo de texto `ga-field`
- Fondo `#0d1114`, borde 1 px `#ffffff20`, radio 8 px, **altura 44 px**. Foco: borde naranja y contorno `2 px` naranja con 3 px de offset.
- Etiqueta arriba, Manrope 500 13 px, `--ga-white`.

### 4.9 Notificación `ga-toast`
- Fondo `rgba(24,28,31,.94)`, borde 1 px `--ga-line`, borde izquierdo 3 px naranja (o verde, rojo, según tono), radio 8 px, sombra `0 12px 40px #0007`.

### 4.10 Insignia de estado
- Pastilla de 20 px, texto 11 px, color según estado: naranja (en curso), verde (listo), rojo (error), gris (sin estado).

## 5. Reglas de uso

1. Un diálogo tiene exactamente un botón de cierre `ga-close` y, como mucho, una acción principal naranja.
2. Los botones de una misma fila comparten altura (44 px fuera de la ficha; 54 px dentro).
3. Los textos salen de `t("clave")`. Nada en español o inglés fijo en el JSX.
4. Los íconos de acción llevan `aria-label` traducido; los botones solo-icono llevan `title`.
5. Los estados vacíos usan texto muted centrado, sin ilustraciones.
6. El tamaño grande (`.ga-big-screen`) aumenta la altura mínima de botones a 44 px; no reduce tipografía.
7. No introducir nuevos colores: si falta uno, se agrega a la tabla de tokens.

## 6. Lista de comprobación para revisar una pantalla

- [ ] Hay un solo botón de cierre, circular, rojo, 38 px.
- [ ] Los botones de la misma fila tienen el mismo alto.
- [ ] La acción principal es naranja; la de peligro, roja; el resto, secundario.
- [ ] Los paneles tienen borde degradado y vidrio esmerilado.
- [ ] Los títulos son Bebas naranja; el texto es Manrope.
- [ ] Ningún texto está en un solo idioma fijo (revisar en `es` y en `en`).
- [ ] Probado en `es`, `en` y en ventana de 1024 px de ancho.

## 7. Estado de aplicación

Aplicado el 2026-10-19 (`apps/desktop/src/ga-design.css` y clases en los componentes):
- `ga-close` en diálogos y paneles: ayuda, configuración, registro del juego, premium, filtros, descarga completada, biblioteca, ficha de tienda, panel de fuentes.
- `ga-btn-primary` en la acción "Activar" de premium.
- `ga-panel` en el panel de fuentes (vidrio y borde degradado).

Sin cambios a propósito: **la ficha de juego** (referencia). Su botón de cierre y su fila de acciones se quedan como están.

Pendiente de verificar en la app (no se pudo ver renderizado):
- Alto de los botones "…", tienda y pulgares frente a la acción principal; la regla de este documento es 44 px fuera de la ficha.
- Panel de descarga de la biblioteca: falta confirmar si usa `ga-panel`.
