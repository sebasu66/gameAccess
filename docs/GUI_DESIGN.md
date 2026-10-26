# Game Access — sistema de diseño de la interfaz

Fuente de verdad visual. La pantalla de **detalle del juego** es la referencia: si una pantalla
contradice este documento, la pantalla se corrige. Los valores son los de `apps/desktop/src/gameaccess-theme.css`
y `filter-wizard.css`; cuando cambie un valor, cambia aquí primero.

## 1. Tokens

| Token | Valor | Uso |
|---|---|---|
| `--ga-orange` | `#cc8333` | acción principal, títulos de pantalla, selección |
| `--ga-orange-hover` | `#d69959` | hover de la acción principal |
| `--ga-bg` | `#111416` | fondo de la app |
| `--ga-panel` | `rgba(21,25,29,.94)` | paneles y diálogos (vidrio) |
| `--ga-white` | `#f4f4f2` | texto principal |
| `--ga-muted` | `#929ba2` | texto secundario, subtítulos, pistas |
| `--ga-line` | `#ffffff20` | separadores y bordes de elementos secundarios |
| `--ga-danger` | `#be4750` | cerrar (botón de cierre), acciones destructivas |
| `--ga-danger-hover` | `#d65c65` | hover del botón de cierre |
| `--ga-success` | `#a0d2b4` | estados completados |
| `--ga-frost` | `#a5cee9` | juegos congelados (copo de nieve y tamaño en la grilla; en el administrador de biblioteca, `frost` de Tailwind: tamaño en disco, real tachado, barra doble y ahorro) |

Naranja sobre fondo oscuro: el texto sobre naranja es `#140a02` (casi negro cálido), nunca blanco.

## 2. Tipografía

- **Títulos de pantalla y diálogo:** Bebas Neue, naranja, mayúsculas.
  - Pantalla completa: 56 px. Diálogo: 36–48 px. Nunca menos de 32 px.
- **Cuerpo, botones, etiquetas:** Manrope. Base 14 px, interlineado 1.5.
  - Botones: una sola letra para todos, `--ga-btn-font` (Bahnschrift semibold 17 px, en mayúsculas con `--ga-btn-track` .04em: la DIN angosta de Windows; Segoe UI si falta). Etiquetas de sección: 800, 11 px, mayúsculas, `letter-spacing: .14em`.
- **Eyebrow** (línea superior del encabezado, p. ej. "GAME ACCESS"): Manrope 800, 11 px, naranja, `letter-spacing: .18em`.
- **Subtítulo:** Manrope 400, 14 px, `--ga-muted`.

## 3. Espaciado y forma

- Escala de 4 px: 4, 8, 12, 16, 20, 24, 28, 32.
- Padding de diálogo y panel: 28 px. Padding de panel compacto (dentro de un diálogo): 16 px.
- Gap entre botones de una fila: 10 px. Entre secciones: 24 px.
- Radios: **botones y campos 8 px**, paneles y diálogos 12 px, chips 16 px (pastilla).
- Ningún radio de 50 % salvo el botón de cierre, que es circular. Radio de 5 px solo en los botones solo-icono de la fila de la ficha y en `ga-back`.

## 4. Componentes

Cada componente tiene una sola definición. Si una pantalla necesita una variante, se agrega aquí antes de usarla.

### 4.1 Botón de cierre `ga-close` (obligatorio en todo diálogo y panel)
- Círculo de **38 × 38 px**, arriba a la derecha con 18 px de margen.
- Fondo `--ga-danger`, borde 1 px `#e1898f`, icono X blanco de 18 px.
- Sombra de resplandor `0 0 14px #be475088`. Hover: fondo `--ga-danger-hover`, resplandor `0 0 20px #d65c65cc`.
- Prohibido: X sin fondo, X en cuadrado redondeado, X en otro color.

### 4.2 Botón principal `ga-btn-primary` (componente `GaButton variant="primary"`)
- Fondo `--ga-orange` **plano**, texto `#140a02`, borde 1 px `--ga-orange`. **Altura 44 px**, padding horizontal 18 px, radio 8 px.
- Sin degradado, sin volumen, sin resplandor ni brillos (Seba, 2026-10-23; un efecto de vidrio que siga pareciendo plano queda pendiente de un ejemplo suyo).
- Hover: `--ga-orange-hover`.
- **Todos los botones naranjas son el mismo componente**, los dibuje quien los dibuje (acción principal de un diálogo, Jugar/Descargar/Ver en Steam de la ficha, Jugar en descargas, Aplicar filtros, primario del diálogo central, opción principal del menú lateral): fondo `--ga-btn-bg`, texto `--ga-btn-ink`, letra `--ga-btn-font`, sin brillo; hover `--ga-btn-bg-hover` (`ga-design.css`).
- Una sola acción principal visible por diálogo. Confirmar, Activar, Guardar, Mostrar resultados: todos naranja.
- Peligro (desinstalar, borrar): fondo `#a64c41`, texto blanco. Nunca naranja.

### 4.3 Botón secundario `ga-btn-secondary`
- Fondo `#ffffff08`, borde 1 px `#ffffff25`, texto blanco. **Altura 44 px** (igual que el principal), radio 8 px.
- Hover: fondo `#ffffff14`.
- Botón solo con icono fuera de la ficha (p. ej. cerrar otros menús, acciones de listas): **44 × 44 px**, misma forma y borde que el secundario.
- Botón solo con icono dentro de la fila de la ficha (`…`, tienda, pulgares): **48 × 54 px**, mismo tamaño para los tres, con radio 5 px (`ga-design.css`).

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

### 4.9 Aviso único `ga-notice` (componente `GaNotice`; reemplaza al toast y a los diálogos de resultado y confirmación simple)
- Uno solo a la vez, **abajo a la derecha** (16 px sobre el pie, 20 px del borde; si hay panel derecho abierto, a la izquierda del panel), 380 px de ancho. Si llega otro, el mismo aviso cambia su contenido: no se apilan.
- Fondo que se desvanece hacia arriba (`rgba(20,24,28,.97)` abajo → transparente arriba) sin apagar el contenido; línea de 2 px abajo con el color del tono: verde (`ok`), celeste (`frost`), rojo (`danger`/`error`), naranja (`info`).
- Padding 48/22/22 px, separación 16 px. Portada del juego (46 × 69 px) a la izquierda si hay juego; si no, ícono del tono en un círculo.
- **Temporizador:** si salió bien y no tiene botones propios, círculo de 30 px arriba a la derecha que se completa en **3 s** y cierra el aviso (se pausa con el mouse encima; tocarlo cierra). También lo lleva "Listo para jugar", que tiene solo el botón Jugar, y "Nuevas descargas" (juegos que pasaron a tener descarga), con Aceptar y Más: Más abre Novedades, donde la noticia queda en la campana hasta abrirla.
- **Error:** nunca se cierra solo; muestra sus botones (p. ej. "Ver registro" y "Reintentar").
- **Confirmación:** `Cancelar` + la acción (roja si destruye, celeste si congela). Esc cancela.
- **Pasos:** lista de pasos con estado (pendiente, en curso, hecho, falló) y barra fina abajo; se usa al jugar.
- Texto largo: el aviso crece hacia arriba, el ancho no cambia. `z-index` por encima de la ficha y de los paneles.
- Los diálogos que bloquean la app (actualización, base del catálogo, plugin) siguen en el diálogo central (`src/centralDialog`).

### 4.10 Insignia de estado
- Pastilla de 20 px, texto 11 px, color según estado: naranja (en curso), verde (listo), rojo (error), gris (sin estado).

### 4.11 Botón volver `ga-back` (pantallas completas)
- Pantallas completas (gestor de descargas, gestor de biblioteca): no tienen botón cerrar; tienen **botón volver** arriba a la derecha, en el lugar del cerrar.
- Flecha y texto ("Volver" / "Back"). Rojo con el mismo fondo, borde y resplandor que `ga-close`.
- **Alto 54 px** y radio **5 px**, igual que los pulgares de la ficha de juego.
- Escape lo activa, igual que el cerrar de un overlay.

### 4.12 Overlay y pantalla completa
- **Overlay** (panel flotante, con borde): tiene `ga-close` arriba a la derecha, vidrio esmerilado y borde degradado (§4.6). Escape lo cierra.
- **Pantalla completa** (gestor de descargas, gestor de biblioteca): no tiene cerrar sino `ga-back` (§4.11). Escape vuelve.
- **Excepción:** los diálogos chicos que muestran la imagen del juego (p. ej. ejecutar un juego) conservan su fondo difuminado con la imagen. No se cambian.

### 4.13 Foco por teclado (Tab)
- **Entran en el ciclo de Tab:** todos los `button` visibles y habilitados (acción principal, cancelar, cerrar, volver, tres puntos, tienda, pulgares, botones de grilla y de cada fila).
- **Salen del ciclo de Tab** (`tabIndex={-1}`; siguen funcionando con el mouse): sliders (`input type="range"`), casillas (`input type="checkbox"`), controles de grilla que no son botones, barras de desplazamiento, imágenes, videos y bloques de texto desplazables.
- Si una pantalla necesita que otro control entre en el ciclo, se pide primero y se documenta aquí.

### 4.14 Botón cubo `GaIconButton` (pie y comandos de la pantalla principal)
- Solo ícono (19 px), 41 × 38 px, radio 8. Vidrio: fondo `linear-gradient(180deg,#ffffff16,#ffffff05)`, borde `#ffffff1c`, brillo `inset 0 1px 0 #ffffff24`.
- Al pasar el mouse o con foco **se enciende** (fondo naranja translúcido, borde `#d79e60`, resplandor `0 0 18px #cc833355`) y **despliega su nombre** al lado del ícono. Sin mouse ni foco no muestra texto.
- `pressed` (interruptor encendido): fondo naranja suave y una rayita naranja abajo. `badge`: numerito naranja arriba a la derecha, oculto en 0.
- En la pantalla principal los comandos son cubos; dentro de diálogos y paneles los botones llevan texto (§4.2, §4.3).

- Cubo interruptor (`aria-pressed`), como `ga-personal-order` junto al orden del catálogo: mismo tamaño y estilo que sus vecinos; encendido es naranja lleno con el texto visible; sin poder usarse va atenuado (`aria-disabled`, no `disabled`, para que el tooltip explique qué falta). Cuando pasa a estar disponible, una sola vez: pulso de escala con brillo naranja y un sonido corto, después de cerrar cualquier ficha abierta.

- **Marco y pantalla:** los botones montados en el marco (los del pie) son teclas de metal con relieve y bisel (luz arriba a la izquierda, sombra abajo a la derecha, un canto oscuro debajo) que se hunden al apretarlos o mientras están encendidos. Los botones de la pantalla (barra de filtros y orden, buscador, botón de vista) son planos: sin degradé, bisel, brillo ni sombra (`device-frame.css`).
- **Botón de vista** (catálogo / biblioteca): uno solo, redondo, con el ícono de la vista actual; el nombre se despliega con el mouse o el foco. Plano: catálogo en el naranja de los botones principales, biblioteca en su verde; al cambiar, el color nuevo barre el botón de izquierda a derecha en 1 s.
- **Buscador y botón de vista** comparten alto (`--ga-dock-h`: 42 px en ventanas chicas hasta 62 px) y se achican con la ventana (el buscador hasta 300 px de ancho).

### 4.15 Marca de instalado `play-mark`
- Círculo de 28 px arriba a la izquierda de la portada con ▶ verde (`--ga-success`) sobre vidrio oscuro. Reemplaza la etiqueta "INSTALADO"/"LISTO" en el catálogo. En la librería no se muestra: ahí estar listo para jugar es lo normal.
- En reposo las portadas de las grillas (catálogo y librería) se ven apagadas (`saturate(.55) brightness(.9)`); la tarjeta bajo el puntero o seleccionada se ve con todo su color.
- Las grillas muestran al menos 6 portadas por fila (mientras cada una tenga 110 px o más); la separación entre portadas sigue a la ventana (24–40 px) y hay aire entre la grilla y las palabras grandes de los costados.
- Congelado jugable: copito celeste de 26 px arriba a la derecha. Congelado profundo: velo celeste esmerilado sobre la tarjeta apaisada.

### 4.16 Palabra lateral de la vista
- A la izquierda de la zona principal, la palabra de la vista actual en vertical (de abajo hacia arriba), la más larga al 110 % del alto de la ventana y las dos con el mismo tamaño de letra (igual de gruesas). **Sin tilde**: `CATALOGO` / `LIBRERIA` (`CATALOG` / `LIBRARY`).
- Archivo Black; dibujada como píxeles de pantalla vistos de cerca: grilla de 5 px donde cada celda se prende entera o no (bordes en escalera), con la silueta al 28 % y encima un cuadradito de 4 px por celda; las letras se desvanecen hacia el centro con una máscara. Catálogo en naranja, librería en verde (`--ga-success`). Se oculta debajo de 900 px.

### 4.17 Panel lateral `ga-side-panel`
- En ventanas de 1800 px o más: Administrador a la izquierda, Descargas a la derecha y Novedades debajo de Descargas. Ancho `clamp(380px, 25vw, 560px)` (22 % si hay paneles en los dos costados).
- Fondo opaco **sin** `backdrop-filter`: el gris del centro junto al catálogo, oscureciéndose hacia el borde exterior (`linear-gradient(90deg,#0c0f11 0%,#14181b 45%,#1b2024 100%)`, espejado a la derecha).
- Sin foco: gris (`grayscale(1) brightness(.8)`); con mouse o foco toma color. Sin perspectiva: el panel queda plano.
- Descargas se abre siempre como panel lateral (nunca pantalla completa), en cualquier ancho de ventana.
- Encabezado §4.6 con `ga-close`; en ventanas chicas el panel es la pantalla completa con `ga-back` (§4.11). El pie queda siempre por encima de los paneles.

### 4.18 Separador plegable `ga-bento-divider` (grupos de la librería)
- Acordeón: el separador entero es un botón (`aria-expanded`) con flecha a la izquierda (gira 90° al abrir), nombre del grupo en mayúsculas 11 px, cantidad entre paréntesis y la línea que se desvanece a la derecha. Al pasar el mouse o con foco, nombre y flecha en blanco; foco con anillo naranja.
- Por defecto solo **Instalados** está abierto; **Congelados** e **Instalables** empiezan cerrados. Lo que el jugador abre o cierra se recuerda en ese equipo.
- Abrir o cerrar no anima las tarjetas con Flip (sin medir todas las tarjetas): aparecen o se van al instante.

### 4.19 Ventana deslizante de tarjetas (catálogo y librería)
- Solo se montan las tarjetas visibles más una fila arriba y una abajo; al desplazarse, las que salen se desmontan y las que entran aparecen. La altura total de la grilla no cambia (barra estable). La tarjeta seleccionada queda montada.
- Sin animación de entrada por ahora. Un efecto de aparición solo se agrega a partir de una implementación de referencia (p. ej. la demo oficial de GSAP `ScrollTrigger.batch`) y probado en la app con datos reales.
- En el catálogo, una selección que hace el propio desplazamiento (`scrollClamping`) nunca mueve el scroll.
- Nunca medir todas las tarjetas en cada render (`Flip.getState` solo cuando cambia el conjunto de tarjetas) ni animar con Flip al aparecer la vista.
### 4.20 Tabla de datos `lm-grid` (administrador de biblioteca)
- Una fila por juego: casilla, portada apaisada de 76 px, nombre (con una línea de detalle solo si suma), estado como insignia (§4.10), carpeta en monoespaciada muted, tamaño (`SizeCell`), fuente (DD, Steam o Carpeta, pastilla neutra), cuenta o proveedor, partidas, última partida y las acciones de la fila.
- Encabezados Manrope 800 11 px en mayúsculas, muted; cada columna de datos es un `button` que ordena: el primer clic ordena (palabras de la A, números y fechas del mayor), el segundo invierte. La columna activa va en blanco con flecha naranja; las demás con una flecha doble tenue. `aria-sort` en el `th`.
- Filas sin dato (sin carpeta, sin partidas) quedan al final en los dos sentidos.
- Contenedor con borde `#ffffff14` y radio 12 px; con la ventana angosta la tabla se desplaza de costado y la columna de acciones queda fija a la derecha.
- Sin buscador propio: la filtra el buscador del catálogo y la librería.
- Solo se desplazan las filas (con la barra redonda); título, resumen, botones (apilados a la derecha del resumen), filtros y encabezado de la tabla quedan fijos.

### 4.21 Descarga en la lista `digital-download-row` / `ga-dl-card`
- Cada descarga es una tarjeta: borde `#ffffff12`, radio 10 px (12 la que está en curso), fondo `#ffffff05`, 8 px entre tarjetas; con mouse o foco el fondo y el borde se aclaran.
- Sus botones (cuadrados de 34 px, solo ícono, el nombre se despliega al pasar el mouse) flotan en una cápsula de vidrio abajo a la derecha (sobre la imagen en la que está en curso) y aparecen solo con mouse o foco, sin mover nada. La cruz para quitarla también.

### 4.22 Buscador
- En reposo es una cápsula corta y semitransparente, centrada; crece con el texto que se escribe (hasta el 64 % de la ventana) y se vuelve opaca con mouse, foco o texto.

## 5. Reglas de uso

1. Un diálogo tiene exactamente un botón de cierre `ga-close` (overlay) o un botón `ga-back` (pantalla completa), y como mucho una acción principal naranja. Escape lo activa en ambos casos.
2. Los botones de una misma fila comparten altura (44 px fuera de la ficha; 54 px dentro de la ficha, incluidos los solo-icono).
3. Los textos salen de `t("clave")`. Nada en español o inglés fijo en el JSX.
4. Los íconos de acción llevan `aria-label` traducido; los botones solo-icono llevan `title`.
5. Los estados vacíos usan texto muted centrado, sin ilustraciones.
5b. No mostrar el mismo dato dos veces (un estado en una etiqueta y en una línea, una cifra arriba y en una pastilla). El estado normal (listo para jugar) no lleva indicador.
5c. Movimiento: GSAP desde `src/motion/gsap.ts`; respetar "reducir movimiento"; animar `transform` y `opacity`; reglas detalladas en `.claude/skills/gameaccess-motion-ui`.
6. El tamaño grande (`.ga-big-screen`) aumenta la altura mínima de botones a 44 px; no reduce tipografía.
7. No introducir nuevos colores: si falta uno, se agrega a la tabla de tokens.
8. Tab recorre todos los botones y ningún otro control (§4.13).

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
- `ga-btn-secondary` definido en `ga-design.css` (2026-10-21) y usado en Configuración > Control parental ("Cambiar contraseña").

Sin cambios a propósito: **la ficha de juego** (referencia). Su botón de cierre y su fila de acciones se quedan como están.

Pendiente de verificar en la app (no se pudo ver renderizado):
- Botones solo-icono de la fila de la ficha ("…", tienda, pulgares): ya en 48 × 54 px por regla de `ga-design.css`; falta confirmar en la app.
- Panel de descarga de la biblioteca: falta confirmar si usa `ga-panel`.
