# Game Access — sistema de diseño de la interfaz

Fuente de verdad visual. La pantalla de **detalle del juego** es la referencia: si una pantalla
contradice este documento, la pantalla se corrige. Los valores son los de `apps/desktop/src/gameaccess-theme.css`
y `filter-wizard.css`; cuando cambie un valor, cambia aquí primero.

## 0. Plantillas (un solo lugar por tipo)

Cada tipo de control tiene **una** plantilla: sus valores son variables en `:root` de `apps/desktop/src/gameaccess-theme.css` y la regla que los aplica, con la lista de todos los componentes que la usan, está en `apps/desktop/src/ga-design.css`. Para cambiar un tipo se cambian sus variables; un componente nuevo de ese tipo se agrega a la lista de su plantilla.

| Plantilla | Variables | Quién la usa |
|---|---|---|
| Botón principal (naranja plano) | `--ga-btn-bg`, `--ga-btn-bg-hover`, `--ga-btn-ink` | `GaButton primary`, acciones de la ficha, aplicar filtros, primario de `AppDialog` y del diálogo central, guardar opciones del juego, opción principal del menú lateral, teclado del mando, mantener descarga |
| Botón secundario (transparente con borde) | `--ga-btn2-bg`, `--ga-btn2-bg-hover`, `--ga-btn2-border`, `--ga-btn2-ink` | `GaButton` secundario, secundario de `AppDialog` y del diálogo central, cancelar descarga, botones de la ayuda, limpiar filtros |
| Botón de peligro | `--ga-btn-danger-bg`, `--ga-btn-danger-bg-hover`, `--ga-btn-danger-ink` | `GaButton danger`, confirmación destructiva de `AppDialog` |
| Letra de todos los botones con texto | `--ga-btn-font`, `--ga-btn-case`, `--ga-btn-track` | las tres plantillas de botón, congelar y volver |
| Fondo detrás de un diálogo | `--ga-backdrop`, `--ga-backdrop-blur` | `AppDialog`, ajustes/ayuda/registro/opciones/recuperación, cancelar descarga, filtros, PLUS, diálogo central, importador y diálogos de alerta |
| Panel de diálogo (vidrio esmerilado óxido y borde fino) | `--ga-dialog-bg`, `--ga-dialog-glass`, `--ga-dialog-ring`, `--ga-dialog-radius`, `--ga-dialog-shadow` | los mismos diálogos |
| Encuadre dentro del marco | `--ga-frame-*` (las publica el marco) | todos los overlays (`device-frame.css`) |
| Texto de los diálogos (regla general y roles) | `--ga-text-*`, `--ga-hint-*`, `--ga-label-*`, `--ga-status-font`, `--ga-space-*`, `--ga-row-gap` | todo párrafo dentro de un diálogo o panel (§4.25, `components/ga/content.css`) |

Siguen teniendo estilo propio a propósito: botones del marco (teclas con relieve, `device-frame.css`), cubos y botones planos de la pantalla, `ga-close`, la ficha del juego (la referencia, con su imagen) y el diálogo de ejecutar un juego (con la imagen del juego de fondo).

## 0b. Niveles de interfaz (Seba, 2026-10-30; plan en `docs/TAREA-pantallas-y-modos.md`)

Todo lo que se muestra es de uno de estos cinco niveles. Antes de crear algo nuevo se decide su nivel; si no encaja en ninguno, se pregunta.

| Nivel | Qué es | Reglas |
|---|---|---|
| **Pantalla / modo** | Cambia todo el contenido principal. Se elige desde el marco: Home, Juegos (Catálogo / Librería, alternados junto al buscador), Configuración, Niños en casa. | Ancho completo, sin fondo de superposición y sin `ga-close`. Se sale cambiando de modo; un subpaso (p. ej. Library Manager dentro de Librería) vuelve con `ga-back` (§4.11). |
| **Panel lateral** | Columna a la derecha que no bloquea. | Hay uno solo: **Procesos y descargas** (Descargas arriba como hoy; Tareas debajo, solo mientras alguna corre: nombre, progreso, cancelar, y clic lleva a la tarea en el Library Manager). §4.17. |
| **Diálogo** | Bloquea para confirmar, avisar, validar, pedir un dato corto o seguir un proceso crítico con progreso (Importar, actualización de la base de juegos). | Chico, `ga-close`, como mucho un botón principal (§4.6). **Uno solo a la vez:** ningún diálogo abre otro; si hace falta algo más, se cierra el primero o se resuelve como pantalla. Los procesos críticos no se minimizan. |
| **Gate** | Cubre toda la app hasta resolverse: actualización, activación. (La clave de padre ya no es un gate: es un diálogo antes de Control parental, 2026-10-31.) | Uno solo a la vez, por encima de todo. |
| **Aviso** | No bloquea y se cierra solo. | Un único sistema: `GaNotice` (§4.9). El fin de una tarea larga se avisa ahí, no con una línea que queda en el panel. |

**Home** (pantalla de inicio): saludo con el nombre del usuario, novedades (reemplazan la campanita), últimas versiones con sus cambios, estado de PLUS o del modo base explicado, y al final ayuda y contacto (Patreon, Mercado Pago). Lo que no tenga otro lugar va en Home.

**Marco** (abajo a la derecha): Home, Juegos, Configuración, Niños en casa, Procesos y descargas (con luz mientras haya algo activo), Big Picture (siempre visible y diferenciado) y PLUS (siempre: "Activar PLUS" o el estado de la suscripción). Refrescar juegos, Library Manager y ayuda **no** van en el marco.

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
| `--ga-danger-ink` | `#e1898f` | borde del cierre, etiqueta de una sección peligrosa |
| `--ga-ok` / `--ga-warn` / `--ga-error` | `--ga-success` / `--ga-orange` / `--ga-danger-hover` | colores de `ga-status` |
| `--ga-label-ink` | `#d79d5d` | etiquetas de sección (`ga-label`), eyebrow de los diálogos |
| `--ga-orange-ink` / `--ga-orange-tint` / `--ga-orange-line` | `#ffd0a0` / `#cc83331a` / `#d79e6066` | texto, fondo y borde de una nota cálida (p. ej. falta PLUS) |
| `--ga-surface` / `--ga-surface-2` | `#ffffff08` / `#ffffff12` | fondo de una caja o una barra dentro de un diálogo |
| `--ga-field-bg` | `#0d1114` | fondo de campos y selectores |
| `--ga-frost` | `#a5cee9` | juegos congelados (copo de nieve y tamaño en la grilla; en el administrador de biblioteca, `frost` de Tailwind: tamaño en disco, real tachado, barra doble y ahorro) |

Naranja sobre fondo oscuro: el texto sobre naranja es `#140a02` (casi negro cálido), nunca blanco.

## 2. Tipografía

- **Títulos de pantalla y diálogo:** Bebas Neue, naranja, mayúsculas.
  - Pantalla completa: 56 px. Diálogo: 36–48 px. Nunca menos de 32 px.
- **Cuerpo, botones, etiquetas:** Manrope. Base 14 px, interlineado 1.5.
  - Botones: una sola letra para todos, `--ga-btn-font` (Manrope, la fuente de la app, bold 16 px, tal como está escrito: sin mayúsculas forzadas ni espaciado extra). Etiquetas de sección: 800, 11 px, mayúsculas, `letter-spacing: .14em`.
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
- **Diálogo superpuesto** `ga-overlay-dialog` (importar juegos, plan de corrección y los que vengan): un solo molde, vidrio esmerilado marrón óxido oscuro (translúcido con desenfoque, un poco más cálido arriba a la izquierda) y el mismo borde fino con degradé de la ficha del juego.
- **Un solo diálogo a la vez** (§0b): nunca se apilan. Mientras quede alguno que abre otro, `modalStack.ts` oculta el de abajo (provisorio); la meta es que ningún diálogo abra otro.

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
- **Pantalla / modo** (§0b: Home, Juegos, Configuración, Niños en casa): ocupa toda la zona principal sin fondo de superposición y no tiene cerrar ni volver; se sale eligiendo otro modo en el marco. Configuración y Niños en casa dejan de ser diálogos. Molde único `GaScreen` (`components/ga/Screen.tsx`, `appScreen.ts`, `.ga-screen` en `ga-design.css`):
  - Contenido **centrado** (hasta 1200 px). Un panel lateral abierto (Descargas) angosta la pantalla desde su lado y el contenido se corre junto a él, como el catálogo.
  - Llega **hasta abajo**: su fondo baja hasta la abertura del marco (entre las pestañas del pie, que quedan encima de sus esquinas); su contenido llena la altura, desplaza adentro y sus botones quedan justo por encima de las pestañas.
  - Mientras se ve, los juegos de atrás **no se dibujan** (`html.ga-screen-on`, `content-visibility: hidden`), pero conservan su estado para volver.
  - Al elegir otro modo, **el detalle del juego se cierra** enseguida (`SCREEN_CHANGE_EVENT`).
  - **Texto a escala de pantalla** (Seba, 2026-10-30): la misma regla general de §4.25, con tokens más grandes en `.ga-screen` (`ga-design.css`): título de la pantalla 72 px, título de un paso o sección (`ga-heading`) 48 px, párrafo 18 px (mínimo 16), pista y estado 16 px, etiqueta 14 px; espacios 12 / 24 / 40 px (`--ga-space-1/2/3`). Controles (selects, chips) de 44 px de alto con la letra de estado. Una pantalla no escribe tamaños propios.
  - **Un diálogo siempre queda arriba de una pantalla:** los diálogos van con su propia capa (z-index alto) y no dentro de algo que la pantalla oculte; los de la barra superior (Configuración, Ayuda) quedan arriba porque la barra sube por encima de la pantalla mientras esta se ve.
  - **Transición GSAP** igual a la de la grilla y el Library Manager: lo que se va sube 16 px y se desvanece (0,2 s, `power2.in`); lo que llega sube desde 24 px (0,5 s, `expo.out`). Con "reducir movimiento" cambia sin animar.
- **Excepción:** los diálogos chicos que muestran la imagen del juego (p. ej. ejecutar un juego) conservan su fondo difuminado con la imagen. No se cambian.

### 4.13 Foco por teclado (Tab)
- **Entran en el ciclo de Tab:** todos los `button` visibles y habilitados (acción principal, cancelar, cerrar, volver, tres puntos, tienda, pulgares, botones de grilla y de cada fila).
- **Salen del ciclo de Tab** (`tabIndex={-1}`; siguen funcionando con el mouse): sliders (`input type="range"`), casillas (`input type="checkbox"`), controles de grilla que no son botones, barras de desplazamiento, imágenes, videos y bloques de texto desplazables.
- Si una pantalla necesita que otro control entre en el ciclo, se pide primero y se documenta aquí.
- **Botones del marco** (dock y pie izquierdo): fuera del ciclo de Tab. Las teclas **1 a 9** aprietan los del dock, de izquierda a derecha (cada uno lo anuncia con `aria-keyshortcuts`), siempre que el foco no esté en un campo de texto y no haya un diálogo abierto (Seba, 2026-10-30).
- **Campos de texto:** cuando aparece una pantalla, un paso o un diálogo con un campo, el primero que aparece recibe el foco (una sola vez; si ya estás escribiendo en otro campo de esa misma pantalla, no se mueve). **Enter** en un campo pasa al siguiente campo de la misma pantalla o diálogo y, después del último, al botón principal (`ga-btn-primary`), si está habilitado; un segundo Enter lo aprieta. Un componente que use Enter para otra cosa lo marca con `preventDefault` y la regla no actúa. El buscador del catálogo no está en ninguna pantalla ni diálogo y queda como está. Todo en `src/keyboardRules.ts`.

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

- **Nunca se cambia la proporción de una tarjeta de juego.** Portadas 2:3; los juegos para instalar de la librería muestran la imagen apaisada de Steam entera (460 × 215), una vez y media el ancho de una portada, sin recortar ni deformar. El borde de las tarjetas va por fuera de la imagen.

### 4.16 Palabra lateral de la vista
- A la izquierda de la zona principal, la palabra de la vista actual en vertical (de abajo hacia arriba), la más larga al 110 % del alto de la ventana y las dos con el mismo tamaño de letra (igual de gruesas). **Sin tilde**: `CATALOGO` / `LIBRERIA` (`CATALOG` / `LIBRARY`).
- Archivo Black; silueta lisa al 28 % y encima el interior pixelado (cuadraditos de 6 px con ranura de 2 px), con el borde de la letra liso (Seba descartó el borde en escalera); empieza en el borde interior del marco; las letras se desvanecen hacia el centro con una máscara. Catálogo en naranja, librería en verde (`--ga-success`). Se oculta debajo de 900 px.

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
- **Variante juegos del niño** (`KidGamesGrid`, pantalla de niños): la misma tabla con cuatro columnas, portada, nombre, interruptor **Sí/No** (pastilla de 32 px, naranja si lo ve) y **límite propio** (General / Específico; el específico con − y + de a 30 minutos hasta el tiempo del día). Sin ancho mínimo: entra en el diálogo.
- Solo se desplazan las filas (con la barra redonda); título, resumen, botones (apilados a la derecha del resumen), filtros y encabezado de la tabla quedan fijos.

### 4.21 Descarga en la lista `digital-download-row` / `ga-dl-card`
- Cada descarga es una tarjeta: borde `#ffffff12`, radio 10 px (12 la que está en curso), fondo `#ffffff05`, 8 px entre tarjetas; con mouse o foco el fondo y el borde se aclaran.
- Con mouse o foco la tarjeta crece hacia abajo y se abre una fila de botones debajo de la imagen, alineada a la derecha, con la cruz para quitarla al final. Botones planos de 34 px, solo ícono (el nombre se despliega al pasar el mouse): fondo transparente, borde opaco `#59636a`, ícono naranja.
- Lista o con error: marca de 30 px semitransparente sobre la esquina superior izquierda de la imagen.

### 4.22 Buscador
- En reposo es una cápsula corta con el relleno semitransparente y el borde opaco, centrada en el panel central (no en la ventana; el botón de vista cuelga a su derecha y no la mueve); crece con el texto que se escribe (hasta el 64 % de la ventana) y se vuelve opaca con mouse, foco o texto.

### 4.23 Consola de congelado `ga-freeze-console` (componente `FreezeConsole`)
- Congelar, congelado profundo y descongelar se **preguntan en el aviso** (§4.9, `confirmNotice`, celeste: Cancelar + la acción), no en un diálogo; el **resultado** también es un aviso: "Congelado completado" con el antes y después y un Aceptar que se aprieta solo a los 3 s (un error espera). Al irse el aviso, el trabajo se cierra y su fila se pliega. El trabajo se ve en esta consola, que **no bloquea** la app (sin fondo oscuro, sin foco atrapado), o en la fila del juego en el administrador.
- Panel flotante abajo a la izquierda, dentro del marco, sobre el pie; 520 px de ancho; vidrio y borde fino de la plantilla de diálogo.
- Encabezado: eyebrow celeste (Congelando / Congelado profundo / Descongelando), nombre del juego en Bebas naranja, `ga-close`: mientras trabaja la pliega en una **pastilla** (44 px, copo girando, juego y %); al terminar, la cierra.
- Dibujo SVG animado: archivos que entran a una prensa naranja y salen como bloque de hielo que se llena con el avance (caja con zunchos en el profundo; al descongelar corre al revés). Quieto al terminar y con "reducir movimiento".
- Cifra grande (Bebas 54 px), bytes hechos / total, velocidad y tiempo restante; pasos con puntos (hecho celeste, actual latiendo); barra de 6 px celeste; archivo en curso en monoespaciada; registro tipo terminal (monoespaciada 12 px, tiempo desde el inicio, último renglón con cursor).
- El avance lo escribe el launcher (`.cache/digital_frozen/<appid>.progress.json`) y la app lo lee con `freeze_progress` cada 400 ms.
- **Un congelado a la vez.** Otro pedido queda **en cola** (aviso "En cola: empieza cuando termine X"; estado "En cola" en su fila y en el tablero de actividad) y arranca solo. Mientras un juego se congela, descongela o espera, su fila solo ofrece **Cancelar** (X roja) e historial; Jugar en ese juego muestra un aviso con "Esperar" y "Cancelar y jugar". Cancelar avisa "Congelado cancelado · El juego quedó como estaba" (con temporizador) y los cubos vuelven a su lugar.
- **Jugar otro juego** pone el congelado **en pausa** hasta que ese juego termina (tablero: "En pausa: estás jugando").
- **Cerrar la app** con un congelado en curso pregunta en el aviso ("Seguir congelando" / "Cancelar y cerrar"); al reabrir tras un corte, un aviso por juego cuenta qué pasó y ofrece lo que corresponde (Seguir / Deshacer, Volver a congelar, Reintentar).
- **En el administrador de biblioteca** no hay terminal aparte: el congelado es parte del **historial del juego** (fila expandida, que se abre sola mientras dura). El historial es una ventana chica (máx. 680 px), fondo apenas más oscuro que la grilla (`#00000026`), borde fino. El congelado es un grupo al final: título celeste ("Congelando · 42 %"), el detalle del launcher sangrado bajo una línea celeste tenue, y el cierre. Sin horas por línea ni símbolos de adorno. Al terminar se vuelve a leer el historial (el launcher anota inicio, fin o falla).
- A la derecha del historial, la **barra de congelado** (`FreezeBar`): misma línea de arriba y altura que el historial (13rem), a 32 px, del tamaño de la imagen apaisada del juego (460:215), que está adentro tenue (opacidad .32) y desaturada a la mitad, siempre del mismo tamaño. Encima, la cuadrícula de 9 × 4 cubos de 40 px (el juego, vidrio esmerilado) cerrada a la izquierda; con el avance, cubo tras cubo se achica y se acomoda en un grupo de 5 filas a la izquierda, celeste; al 100 % ocupan más o menos la mitad (al descongelar, al revés). El % (Bebas 40 px) y el tamaño van sobre la imagen, abajo a la derecha. Detrás de la imagen, una grilla tenue (`#ffffff12`: una línea por fila de cubos y una cada dos columnas) completa la forma; con los bordes, sigue 180 px a la derecha y se desvanece. El resultado no va acá: va en el aviso.
- **Mover un juego vinculado a la biblioteca** es un trabajo de esta misma cola (modo `move`): el aviso de confirmación se cierra al confirmar, la fila dice "Moviendo a la biblioteca", el historial muestra cada paso con su duración y el resultado es un aviso (verde). En el lugar de la barra va su propio dibujo (`MoveArt`, `lm-move`): la fila se parte en **dos mitades iguales**, el historial a la izquierda y a la derecha una caja **del mismo tamaño que la ventana del historial** (misma línea de arriba, 13rem, 12 px adentro) dibujada como una **grilla de líneas guía tenues** (cada 26 px, blanco al 9 %, que se desvanecen en los bordes, como las guías del GAME ACCESS de la columna derecha); sobre ella, el dibujo a toda la altura que permita el ancho; a la izquierda la **carátula vertical** del juego en su marco (borde blanco tenue, radio 8 px), a la derecha una **carpeta dibujada** (trazo blanco tenue con relleno blanco semitransparente al 7 %, naranja al terminar, rojo si falla) con la **imagen apaisada** del juego (la de cabecera de Steam, 80 % del ancho de la carpeta) **centrada** delante del relleno; entre las dos, un espacio corto con **archivos** (contorno naranja) que viajan de izquierda a derecha. Con el avance, la carátula de la izquierda **se vacía de arriba hacia abajo** y la de la carpeta **se llena de abajo hacia arriba**; el porcentaje (Bebas Neue naranja) y **un solo valor, lo que falta copiar**, debajo de los archivos, entre la carátula y la carpeta. Cancelada vuelve a 0 %. Con movimiento reducido, sin archivos ni transiciones. Una mudanza cortada (la app o la PC se apagaron) deja la fila en "Mudanza sin terminar (N %)" con **Continuar la mudanza** y **Descartar la copia**.
- **Tablero de actividad** (`ActivityBoard`) junto al gráfico de disco: líneas y letras tenues sobre el fondo (opacidad .38, .7 con trabajo), un anillo por tarea (congelar, descongelar, revisar la biblioteca, aplicar cambios) con su % o un arco que gira; "En reposo" sin tareas. Solo informa.

### 4.24 Apertura `gs-gate` (componente `SplashScreen`)
- Reemplaza a los videos del logo. Una **tapa de metal** hecha como el marco (gunmetal, acero cepillado en overlay, brillo diagonal), en dos hojas, cierra la pantalla dentro del marco. Cada hoja tiene su **marco** (línea grabada a 18 px) y, donde se une con la otra, un **canto biselado** de 30 px con una ranura. El dibujo de la tapa: dos **paneles rebajados** por hoja con esquinas cortadas y rayado tenue, **ranuras de ventilación** del lado de afuera, líneas grabadas que se desvanecen, tornillos en las esquinas del marco y franjas de advertencia cortas sobre la junta.
- Sobre la junta, un **cerrojo redondo fijo a la hoja derecha** (54 vmin, máx. 470 px), como lo tendría una tapa real: borde moleteado, placa de metal oscuro, "GAME ACCESS" y el **emblema del fabricante grabados** en bajo relieve (corte oscuro con borde de luz abajo a la derecha): una G (anillo abierto arriba a la derecha) y una A que cierra el círculo y se ilumina en naranja al destrabarse (su pierna izquierda es el anillo de la G, la derecha es una recta del vértice al extremo de la G y su travesaño es la barra de la G).
- Junto al cerrojo, en la hoja izquierda, un **candado retroiluminado** (34 px, luz blanca desde adentro, como un logo iluminado en metal) dice que la tapa está cerrada.
- Secuencia: el cerrojo se dibuja (1,1 s) y espera **cerrado**, en silencio, mientras se resuelve el acceso. Después funciona como **un solo mecanismo** (Seba, 2026-10-30): el sonido (`public/brand/splash.mp3`) y el giro de un cuarto de vuelta empiezan juntos (0,95 s, hasta dejar el emblema derecho; el arco del candado salta, su luz se apaga y la A se ilumina en naranja) y, al terminar el giro, las dos hojas se abren como un **portón** (1,3 s) con el cerrojo yéndose entero con la hoja derecha; la app aparece debajo (1,1 s). El sonido nunca suena suelto. La apertura no pide la clave de padre (2026-10-31): la pide solo Control parental, en un diálogo con el mismo campo LCD (`ParentKeyDialog`).
- Con "reducir movimiento" (o la animación del estilo pixel apagada) el cerrojo se ve abierto y el portón se va sin animar.
- Detrás de la tapa hay un fondo liso (`.ga-opening-background`, `#08090b`), sin imágenes de juegos: la apertura no pide nada a Steam.

### 4.25 Texto de los diálogos (plantilla única, `components/ga/content.css`)
Seba, 2026-10-29: los párrafos de todos los diálogos tienen el mismo estilo por defecto; un estilo distinto es una excepción. No se arregla diálogo por diálogo.

**1. Regla general (siempre se cumple).** Todo `<p>` dentro de un diálogo o panel (`ga-overlay-dialog`, `ga-dialog`, `ga-settings-panel`, `download-complete-dialog`, `ga-filter-dialog`, `ga-premium-dialog`, `central-dialog-card`, `ga-panel`) lleva, aunque la pantalla diga otra cosa (`!important`):
- Fuente: Manrope (`--ga-text-family`).
- Tamaño: 14 px (`--ga-text-size`), **nunca menos de 13 px** (`--ga-text-min`). Un diálogo solo puede agrandarlo con `--ga-p-size`.
- Interlineado 1.5 (`--ga-text-leading`).
- Sin márgenes: el espacio entre bloques lo da el `gap` del contenedor (`ga-stack`).
- Alineado al inicio; un diálogo solo puede centrarlo con `--ga-p-align: center` (estados vacíos, §5.5).
- La letra chica (`<small>`) tampoco baja de 13 px.

**2. Aspecto por defecto (sin peso, cualquier clase lo cambia).** Color `--ga-text-ink` (blanco) y peso 400; el subtítulo del encabezado en `--ga-muted`. El color, el peso o un recuadro de una línea concreta son del diálogo: van en su CSS.

**3. Roles y piezas (una clase cada uno, para no reescribirlas en cada pantalla):**
| Clase | Qué es | Valores |
|---|---|---|
| `ga-stack` (`-sm`, `-lg`) | columna de bloques | `gap` 16 px (8 / 24); los hijos sin márgenes; un botón suelto no se estira |
| `ga-hint` | texto secundario, pista | 13 px, `--ga-muted` |
| `ga-status` + `is-ok` / `is-warn` / `is-error` | estado o resultado de una línea (con ícono) | Manrope 700 13 px, `--ga-ok` / `--ga-warn` / `--ga-error` |
| `ga-label` | etiqueta de sección (`legend`, `span`) | 800 11 px, mayúsculas, `.14em`, `--ga-label-ink` (no es un párrafo: no lleva el mínimo) |
| `ga-heading` | título de un paso o sección dentro del diálogo | Bebas Neue 34 px naranja |
| `ga-group` (`ga-group-danger`) | etiqueta + controles (`fieldset`) | sin borde ni padding, `gap` 8 px; la etiqueta en rojo suave si es peligrosa |
| `ga-actions` (`ga-actions-end`) | fila de botones | `gap` 10 px, misma altura, se parte si no entra |
| `ga-disclosure` | `details`/`summary` plegable | flecha naranja propia (nunca el triángulo del navegador), cuerpo = un `ga-stack` |

- Una pantalla no escribe reglas para `p` ni para títulos (`h1`–`h6`): ni margen, ni fuente, ni tamaño, ni alineación. Lo que necesite distinto va con su clase y es una excepción (color, peso, recuadro, o `--ga-p-size` / `--ga-p-align`).
- Colores: solo tokens de `:root`. Un color suelto en un `.css` que no sea del tema no pasa el control.
- **Control:** `npm run check:css` (y `npm test`, con `src/dialogCss.test.ts`) falla si un `.css` agrega reglas de párrafo o colores sueltos. La deuda vieja está contada por archivo en `apps/desktop/scripts/dialog-css-baseline.json`: puede bajar (`node scripts/check-dialog-css.mjs --update` al limpiar), nunca subir.
- Sin componentes React para esto: `<p className="ga-hint">` es tan corto como un `<GaHint>`.

## 5. Reglas de uso

1. Un diálogo tiene exactamente un botón de cierre `ga-close` (overlay) o un botón `ga-back` (pantalla completa), y como mucho una acción principal naranja. Escape lo activa en ambos casos.
2. Los botones de una misma fila comparten altura (44 px fuera de la ficha; 54 px dentro de la ficha, incluidos los solo-icono).
3. Los textos salen de `t("clave")`. Nada en español o inglés fijo en el JSX.
4. Los íconos de acción llevan `aria-label` traducido; los botones solo-icono llevan `title`.
5. Los estados vacíos usan texto muted centrado, sin ilustraciones.
5b. No mostrar el mismo dato dos veces (un estado en una etiqueta y en una línea, una cifra arriba y en una pastilla). El estado normal (listo para jugar) no lleva indicador.
5c. Movimiento: GSAP desde `src/motion/gsap.ts`; respetar "reducir movimiento"; animar `transform` y `opacity`; reglas detalladas en `.claude/skills/gameaccess-motion-ui`. **Las transiciones van por una sola cola** (`queueTransition` de `src/motion/transitions.ts`): cada una es un timeline con su propio tiempo y corren una después de la otra, nunca encimadas. Ya pasan por ella: cambio de modo, grilla ↔ Library Manager, abrir y cerrar paneles laterales y la palabra lateral.
6. El tamaño grande (`.ga-big-screen`) aumenta la altura mínima de botones a 44 px; no reduce tipografía.
7. No introducir nuevos colores: si falta uno, se agrega a la tabla de tokens.
7b. El texto de un diálogo sigue la regla general (§4.25); una pantalla no define márgenes, fuente ni tamaño de sus párrafos.
8. Tab recorre todos los botones y ningún otro control (§4.13).
9. Cada cosa nueva tiene su nivel (§0b): una pantalla no es un diálogo grande, y un diálogo nunca abre otro diálogo.

## 6. Lista de comprobación para revisar una pantalla

- [ ] Su nivel es el correcto (§0b): una pantalla no tiene `ga-close`; un diálogo no abre otro.
- [ ] Hay un solo botón de cierre, circular, rojo, 38 px.
- [ ] Los botones de la misma fila tienen el mismo alto.
- [ ] La acción principal es naranja; la de peligro, roja; el resto, secundario.
- [ ] Los paneles tienen borde degradado y vidrio esmerilado.
- [ ] Los títulos son Bebas naranja; el texto es Manrope.
- [ ] Ningún texto está en un solo idioma fijo (revisar en `es` y en `en`).
- [ ] Los párrafos no tienen reglas propias de margen, fuente ni tamaño; pistas con `ga-hint`, estados con `ga-status`, bloques en `ga-stack` (§4.25). `npm run check:css` pasa.
- [ ] Probado en `es`, `en` y en ventana de 1024 px de ancho.

## 7. Estado de aplicación

Aplicado el 2026-10-19 (`apps/desktop/src/ga-design.css` y clases en los componentes):
- `ga-close` en diálogos y paneles: ayuda, configuración, registro del juego, premium, filtros, descarga completada, biblioteca, ficha de tienda, panel de fuentes.
- `ga-btn-primary` en la acción "Activar" de premium.
- `ga-panel` en el panel de fuentes (vidrio y borde degradado).
- `ga-btn-secondary` definido en `ga-design.css` (2026-10-21) y usado en Configuración > Control parental ("Cambiar contraseña").

Texto de los diálogos (§4.25), 2026-10-29:
- La regla general ya alcanza a todos los diálogos de la lista de §4.25 (fuente, mínimo de 13 px, interlineado, sin márgenes, alineación). Se quitó la regla amplia `.ga-settings-panel p` (gris de 12 px).
- Migrado entero (sin CSS propio de texto, solo disposición): diálogo **Niños en casa** (`KidModePanel`, `ParentalControlSection`, `AdminKeySection`; `kid-mode.css`). La pantalla del chico quedó aparte en `kid-screen.css`.
- **Falta migrar** (siguen con clases propias de texto, `p` con márgenes en su CSS o el triángulo del navegador; con la regla general ya se ven parejos, pero sus reglas viejas cuentan en la línea de base):
  - Configuración (`AppSettings`, `DigitalStorageSettings`, `SteamSettings`, `LanguageSwitch`): `.ga-storage-settings p`, `ga-style-hint`, Tailwind `text-sm text-muted-foreground`, el plegable "Biblioteca" con el triángulo del navegador.
  - Ayuda (`AppHelp`): `ga-help-missing`.
  - Registro del juego (`DigitalGameLog`), opciones del juego (`DigitalGameOptions`, `AutomationForm`) y recuperación (`GameRecoveryDialog`): `ga-settings-error` → `ga-status is-error`.
  - Diálogo de la app (`AppDialog`, `ParentalSetupDialog`), cancelar descarga (`CancelDownloadDialog`), diálogo central (`central-dialog-hint`, `central-dialog-failure`), PLUS (`ga-premium-note`), filtros (`LibraryFilterDialog`, `ga-filter-accordion` con el triángulo del navegador), plugin (`PluginDownloadButton`).
  - Importar juegos y plan de corrección (`ImportWizard`, `PlanDialog`): Tailwind `m-0 text-sm text-muted-foreground` → `ga-hint`.
  - Fuera de la lista de moldes (la regla general todavía no los alcanza): pase de acceso (`ga-access-pass-panel`), Steam sin instalar (`session-card`), aviso único (`ga-notice`), paneles laterales (descargas, novedades).

Sin cambios a propósito: **la ficha de juego** (referencia). Su botón de cierre y su fila de acciones se quedan como están.

Pendiente de verificar en la app (no se pudo ver renderizado):
- Botones solo-icono de la fila de la ficha ("…", tienda, pulgares): ya en 48 × 54 px por regla de `ga-design.css`; falta confirmar en la app.
- Panel de descarga de la biblioteca: falta confirmar si usa `ga-panel`.
