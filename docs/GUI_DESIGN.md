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
| **Pantalla / modo** | Cambia todo el contenido principal. Se elige desde el marco: Home, Juegos (Catálogo / Librería, alternados junto al buscador), Library Manager, Configuración, Niños en casa. | Ancho completo, sin fondo de superposición y sin `ga-close`. Se sale cambiando de modo. El Library Manager es un modo más (Seba, 2026-11-02): botón propio en la botonera del marco, siempre visible, sin pasar por la Librería ni volver con `ga-back`. |
| **Panel lateral** | Columna a la derecha que no bloquea. | Hay uno solo: **Procesos y descargas** (Descargas arriba como hoy; Tareas debajo, solo mientras alguna corre: nombre, progreso, cancelar, y clic lleva a la tarea en el Library Manager). §4.17. |
| **Diálogo** | Bloquea para confirmar, avisar, validar, pedir un dato corto o seguir un proceso crítico con progreso (Importar, actualización de la base de juegos). | Chico, `ga-close`, como mucho un botón principal (§4.6). **Uno solo a la vez:** ningún diálogo abre otro; si hace falta algo más, se cierra el primero o se resuelve como pantalla. Los procesos críticos no se minimizan. |
| **Gate** | Cubre toda la app hasta resolverse: actualización, activación. (La clave de padre ya no es un gate: es un diálogo antes de Control parental, 2026-10-31.) | Uno solo a la vez, por encima de todo. |
| **Aviso** | No bloquea y se cierra solo. | Un único sistema: `GaNotice` (§4.9). El fin de una tarea larga se avisa ahí, no con una línea que queda en el panel. |

**Home** (pantalla de inicio): saludo con el nombre del usuario, novedades (reemplazan la campanita), últimas versiones con sus cambios, estado de PLUS o del modo base explicado, y al final ayuda y contacto (Patreon, Mercado Pago). Lo que no tenga otro lugar va en Home.

**Plugins en pantalla** (Seba, 2026-11-05): van dentro de la pantalla, arriba a la derecha, no en el marco: son de terceros y puede haber varios. Una bandeja de una columna (`plugin-indicator-group`), un plugin por fila con su luz (verde conectado, roja sin respuesta, gris apagado); un clic lleva a su sección en Configuración › Plugins.

**Menús de un juego** (tarjeta y `…` de la ficha): solo Jugar o Instalar, Administrar y Ver detalles (tarjeta de propiedades `GameInfoCard`, con cerrar y copiar). Lo demás está en su fila del Library Manager. Mientras descarga, la ficha ofrece Administrar descarga, que lleva a esa fila.

**Marco** (abajo a la derecha): Home, Juegos, Configuración, Niños en casa, Procesos y descargas (con luz mientras haya algo activo), Big Picture (siempre visible y diferenciado) y PLUS (siempre: "Activar PLUS" o el estado de la suscripción). Library Manager y ayuda **no** van en el marco; «Actualizar juegos» vive en la pantalla Catálogo, junto a los filtros (`CatalogRefreshButton.tsx`).

## 0c. Capas de estilo (Seba, 2026-11-05)

El estilo va en tres capas de **variables CSS** (`--ga-*`). Tailwind queda acotado al Library Manager y lee las mismas variables (`text-ga-orange`, `bg-ga-panel`; `tailwind.config.cjs`).

| Capa | Archivo | Qué define | Qué no |
|---|---|---|---|
| **1. Plantilla base** | `src/templates/base.css` | escala de texto (T1 título de pantalla, T2 sección, T3 grupo, cuerpo), márgenes `--ga-space-*`, radios, alturas de control | colores, tipografías, vidrio |
| **2. Sabor de estilo** | `src/templates/flavor-terminal.css` (el actual: **terminal**, futurista y minimalista) | tipografías, colores, vidrio, bordes, luces | distribución de una pantalla |
| **3. Detalles de pantalla** | el CSS de cada pantalla | distribución y lo propio de esa pantalla, siempre leyendo variables de las capas 1 y 2 | valores de color, fuente o radio escritos a mano |

- **Un sabor nuevo** es un archivo igual al de terminal con `:root[data-ga-flavor="nombre"]`; se activa con `setStyleFlavor("nombre")` (`templates/flavor.ts`). No toca componentes.
- **Regla para lo nuevo:** si falta una variable para un rol, se agrega a la capa que corresponde y se usa. `npm run check:css` frena colores sueltos; `templates/flavor.test.ts` controla que la base no tenga colores ni tipografías y que las piezas nuevas lean variables definidas.
- **Ficha ancha del rediseño RN7:** `game-detail-wide.css` define solo su distribución. Los tamaños `--ga-detail-*` viven en `templates/base.css`; su vidrio, tinta, valoración y tipografía viven en el sabor. Se abre desde la ficha existente y reutiliza datos reales de Steam, medios y acciones. Las pestañas de fuentes y cooperativo aparecen únicamente cuando sus consultas aportan datos.
- **Política (Seba, 2026-11-05; reafirmada 2026-11-19):** **toda vista de la aplicación, sin excepción, usa los tres niveles**, desde el primer commit: lo general (`GaButton`, `GaAccordion`, `ga-group`, `ga-settings-group`, `ga-label`, `ga-hint`, `ga-status`, `ga-heading`, `ga-path-control`, `ga-style-toggle`), el sabor, y recién después la capa de pantalla, en su propio CSS y solo con distribución. Ningún color, fuente, radio, margen ni alto escrito a mano: si falta una variable se agrega a la base o al sabor; si falta una pieza, se agrega al nivel general, nunca a la pantalla. La pantalla nueva entra en `templates/flavor.test.ts`.
  - **Por qué:** es lo único que evita estilos de interfaz distintos entre pantallas, y bordes, rellenos, márgenes, distribución y alineamiento improvisados. Seba no tiene que pedirlo cada vez.
  - **Un campo** es siempre nombre arriba en `ga-label` y control abajo, los dos del mismo ancho (`ga-path-control`). Una etiqueta en negrita pegada sobre un input, anchos distintos en una misma columna o separaciones que cambian de sección a sección son errores, no detalles.
  - **Cuidado con el alcance:** una clase general definida solo dentro de `.ga-settings-panel` no existe fuera de ese contenedor, y la vista que la use queda sin estilo. Lo general va definido para toda la aplicación.
- **Migrado hoy:** escala de texto y márgenes (base); tarjeta de propiedades, bandeja de plugins, Configuración › Plugins y Configuración › IA (pantalla). **Falta:** los demás tokens de `gameaccess-theme.css` pasan al sabor, y el CSS anterior todavía escribe colores sueltos (contados en `scripts/dialog-css-baseline.json`): esos lugares no siguen un sabor hasta migrarlos.

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
| `--ga-shade` / `--ga-shade-soft` | `#000` / `#000000aa` | negro de una imagen que se funde hacia abajo y fondo de una pastilla o un círculo sobre una imagen |
| `--ga-violet` | `#b99ad8` | color del perfil de gustos (avisos de Actividad) |
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
- **Menú lateral de una tarjeta** (`GameSideMenu.tsx`, Seba 2026-11-02): sigue abierto mientras el puntero esté en la tarjeta o en los botones del menú, en una caja un 10 % de la altura de la tarjeta más alta arriba y abajo, sin margen hacia los lados (`menuHoldArea`). Si el puntero sale, se cierra a los 1,5 s. Solo toman el puntero sus botones, no el vidrio; un clic derecho en otra tarjeta, aunque el menú esté encima, cierra este y abre el de esa.

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
- Texto largo (`textarea`, p. ej. el formulario de contacto): el mismo campo, 132 px de alto mínimo, padding 10 × 12 px, crece solo hacia abajo. En una pantalla (Home) la etiqueta y el texto van a 16 px.

### 4.9 Aviso único `ga-notice` (componente `GaNotice`; reemplaza al toast y a los diálogos de resultado y confirmación simple)
- Uno solo a la vez, **abajo a la derecha** (16 px sobre el pie, 20 px del borde; si hay panel derecho abierto, a la izquierda del panel), 380 px de ancho. Si llega otro, el mismo aviso cambia su contenido: no se apilan.
- Fondo que se desvanece hacia arriba (`rgba(20,24,28,.97)` abajo → transparente arriba) sin apagar el contenido; línea de 2 px abajo con el color del tono: verde (`ok`), celeste (`frost`), rojo (`danger`/`error`), naranja (`info`).
- Padding 48/22/22 px, separación 16 px. Portada del juego (46 × 69 px) a la izquierda si hay juego; si no, ícono del tono en un círculo.
- **Temporizador:** si salió bien y no tiene botones propios, círculo de 30 px arriba a la derecha que se completa en **8 s** y cierra el aviso (Seba, 2026-10-31: 3 s no alcanzaba para leerlo) (se pausa con el mouse encima; tocarlo cierra). También lo lleva "Listo para jugar", que tiene solo el botón Jugar, y "Nuevas descargas" (juegos que pasaron a tener descarga), con Aceptar y Más: Más abre Novedades, donde la noticia queda en la campana hasta abrirla.
- **Error:** nunca se cierra solo; muestra sus botones (p. ej. "Ver registro" y "Reintentar").
- **Confirmación:** `Cancelar` + la acción (roja si destruye, celeste si congela). Esc cancela.
- **Pasos:** lista de pasos con estado (pendiente, en curso, hecho, falló) y barra fina abajo; se usa al jugar.
- Texto largo: el aviso crece hacia arriba, el ancho no cambia. `z-index` por encima de la ficha y de los paneles.
- Los diálogos que bloquean la app (actualización, base del catálogo, plugin) siguen en el diálogo central (`src/centralDialog`).

- **Actividad (Seba, 2026-11-01).** Todo aviso, al irse de la esquina, queda en el **historial** del panel Actividad (§4.17), como las notificaciones de Windows 11. Reglas:
  1. **Una pregunta no va al historial** hasta que se responde: queda en la esquina sin cerrarse sola. Al historial va lo que pasó después (p. ej. "Congelando Hades").
  2. **Una entrada por proceso** (descarga, congelado, mover...), que cambia de estado: iniciada → en curso → completada / falló, con la hora de inicio y la de fin. No se agrega una entrada nueva al terminar.
  3. **Lo que corre va aparte**: arriba en el panel, "En curso", con su progreso en vivo; debajo el historial, del más nuevo al más viejo.
  - Un proceso que empieza muestra su aviso en la esquina con la barra de progreso, sin temporizador, mientras no llegue otro aviso.
  - Cada entrada que tiene un juego lleva a su fila en el Library Manager, donde está su detalle.
  - El historial se guarda en la PC (hasta 30 días o 200 entradas) y se agrupa por día; el botón del marco cuenta las entradas sin ver.
  - Ya no hay indicador flotante de descargas ni consola flotante de congelado.

### 4.10 Insignia de estado
- Pastilla de 20 px, texto 11 px, color según estado: naranja (en curso), verde (listo), rojo (error), gris (sin estado).

### 4.11 Botón volver `ga-back` (pantallas completas)
- Pantallas completas: no tienen botón cerrar. El gestor de biblioteca es un modo (§0b) y no lleva volver; se sale eligiendo otro modo.
- Flecha y texto ("Volver" / "Back"). Rojo con el mismo fondo, borde y resplandor que `ga-close`.
- **Alto 54 px** y radio **5 px**, igual que los pulgares de la ficha de juego.
- Escape lo activa, igual que el cerrar de un overlay.

### 4.12 Overlay y pantalla completa
- **Overlay** (panel flotante, con borde): tiene `ga-close` arriba a la derecha, vidrio esmerilado y borde degradado (§4.6). Escape lo cierra.
- **Pantalla completa** (gestor de descargas, gestor de biblioteca): no tiene cerrar sino `ga-back` (§4.11). Escape vuelve.
- **Pantalla / modo** (§0b: Home, Juegos, Library Manager, Configuración, Niños en casa): ocupa toda la zona principal sin fondo de superposición y no tiene cerrar ni volver; se sale eligiendo otro modo en el marco. Configuración y Niños en casa dejan de ser diálogos. Molde único `GaScreen` (`components/ga/Screen.tsx`, `appScreen.ts`, `.ga-screen` en `ga-design.css`):
  - Contenido **centrado** (hasta 1200 px). Un panel lateral abierto (Descargas) angosta la pantalla desde su lado y el contenido se corre junto a él, como el catálogo.
  - Llega **hasta abajo**: su fondo baja hasta la abertura del marco (entre las pestañas del pie, que quedan encima de sus esquinas); su contenido llena la altura, desplaza adentro y sus botones quedan justo por encima de las pestañas.
  - Mientras se ve, los juegos de atrás **no se dibujan** (`html.ga-screen-on`, `content-visibility: hidden`), pero conservan su estado para volver.
  - Al elegir otro modo, **el detalle del juego se cierra** enseguida (`SCREEN_CHANGE_EVENT`).
  - **Texto a escala de pantalla** (Seba, 2026-10-30): la misma regla general de §4.25, con tokens más grandes en `.ga-screen` (`ga-design.css`): título de la pantalla 72 px, título de un paso o sección (`ga-heading`) 48 px, párrafo 18 px (mínimo 16), pista y estado 16 px, etiqueta 14 px; espacios 12 / 24 / 40 px (`--ga-space-1/2/3`). Controles (selects, chips) de 44 px de alto con la letra de estado. Una pantalla no escribe tamaños propios. **Ningún texto de una pantalla queda por debajo de 16 px** (Seba, 2026-10-31: Control parental se veía chico y con poco contraste): las piezas que la pantalla toma de lugares compactos (pestañas, la grilla del Library Manager, las casillas y niveles del filtro de Configuración) suben al mínimo en `components/ga/content.css`; títulos de columna y pestañas, 14 px (`--ga-screen-caption`). El gris secundario dentro de una pantalla es más claro (`--ga-muted: #b6bec4`, contra `#929ba2` en diálogos).
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

- **Actividad (2026-11-01, reemplaza a "Descargas" y a "Procesos y descargas"):** el único panel lateral. Encabezado "Actividad"; **Historial** arriba y **En curso** debajo (descargas y tareas que corren: nombre, barra, cancelar; clic lleva a la fila del juego en el Library Manager). Lo más nuevo queda abajo: el panel abre al final y baja solo cuando llega algo. "Borrar historial" va junto al título del historial. El detalle de cada descarga (imagen con la velocidad, etapa, pasos, tamaños, Pausar/Reanudar, Subir/Bajar en la cola, seguir tras un corte, Cancelar, carpeta) está en la fila de su juego en el Library Manager, abierto mientras dura (`downloads/DownloadDetail.tsx`); una descarga sin carpeta todavía tiene su propia fila. "Añadir descarga manual" está al final del Library Manager.
- **Grupos por categoría, como Android (Seba, 2026-11-06, reemplaza la regla de unir por tipo y por hora):** una tarjeta por categoría sin importar el tiempo entre avisos (`activityGroups`, `activity.ts`): Nuevos juegos para descargar, Novedades del catálogo, Descargas, Tu biblioteca, Game Access, Tu perfil de gustos y Otros avisos. Cada aviso nuevo mueve toda su tarjeta al lugar más nuevo, abajo, y la marca con borde fuerte y un punto hasta abrirla. La tarjeta muestra ícono, cuándo, nombre, cantidad y lo último que pasó; si lo último falló, toma el color de error. Un clic la expande y cada entrada lleva a su sección: novedades y catálogo a Inicio, la actualización de la app a sus novedades en Inicio, descargas y biblioteca al Library Manager. Perfil de gustos y verificación de juegos **reemplazan** su aviso anterior. Una entrada sin categoría propia la deduce de su tipo, clave o juego (`activityCategory`), así el historial guardado también se agrupa.
- **Capas:** `activity/activity.css` es capa de pantalla, solo distribución; medidas `--ga-feed-*` en `templates/base.css`; colores `--ga-kind-*`, intensidades y fuentes `--ga-feed-*` en `templates/flavor-terminal.css`. Lo controla `templates/flavor.test.ts`.
- **Cada tipo con su estilo:** color propio (`--kind`: novedades naranja, perfil `--ga-violet`, verificación y descargas `--ga-ok` (con no corren, `--ga-warn`), congelado `--ga-frost`, error `--ga-danger`, el resto `--ga-muted`), tarjeta de radio 10 px con **degradado de ese color** de izquierda a derecha y borde del mismo color, **ícono de 40 px en la esquina** sobre un cuadro de su color (con portada del juego, el ícono va como insignia de 24 px en su esquina), título de 15 px en hasta dos líneas, texto de 14 px, 10 px entre tarjetas.

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
- **Motor: TanStack Table** (`@tanstack/react-table`, Seba 2026-11-17). La tabla ordena, filtra y cuenta con la librería; las filas se siguen dibujando con nuestras clases. Nada de filtros ni tramos hechos a mano.
- **Filtro por columna** (`ColumnFilter.tsx`, `column-filter.css`): clic derecho en el encabezado o su embudo (visible al pasar el cursor, naranja si la columna filtra). Panel de 300 px bajo el encabezado, con `ga-label`, **Quitar filtro** y **Listo**. Tres clases: *texto* (Nombre: una palabra), *lista* (Estado, Carpeta, Fuente: la palabra y los valores con casillas y cuántas filas tiene cada uno, contando ya los filtros de las otras columnas) y *rango* (Tamaño en GB, Partidas, Días sin jugar: Desde y Hasta, con el mínimo y el máximo de la lista como pista). Cada filtro activo es una pastilla al lado de los filtros rápidos que lo quita.
- **Pestañas del Manager**: Juegos, Cuentas, Espacio y Congelar. El gráfico del disco vive en **Espacio** (`ManagerSpace.tsx`), no sobre la grilla. Importar y mover a la librería no son pestañas: son asistentes (§4.37).
- **Variante juegos del niño** (`KidGamesGrid`, pantalla de niños): la misma tabla con cuatro columnas, portada, nombre, interruptor **Sí/No** (pastilla de 32 px, naranja si lo ve) y **límite propio** (General / Específico; el específico con − y + de a 30 minutos hasta el tiempo del día). Sin ancho mínimo: entra en el diálogo.
- Solo se desplazan las filas (con la barra redonda); título, resumen, botones (apilados a la derecha del resumen), filtros y encabezado de la tabla quedan fijos.

### 4.20b Fila abierta del administrador (`RowExpand`, Seba 2026-11-01; rehecha 2026-11-02; **retirada 2026-11-19**, ver §4.49: el registro y las propiedades viven ahora en el detalle de la izquierda)
- **Una sola fila por juego que se despliega.** Un clic en la fila (fuera de sus controles) la abre o la cierra; abierta, no muestra la miniatura: el nombre queda arriba, en la fila; fila y detalle tienen el mismo fondo. Se abre sola mientras dura una tarea del juego (descarga, instalación, congelado, movida).
- **Las acciones del juego solo están en su menú flotante.** La última columna tiene un solo botón **⋯** (32 px) que abre el menú encima de la fila; el clic derecho en la fila abre el mismo menú junto al puntero (`RowMenu`: panel de vidrio de 240 px con el nombre del juego como título y las acciones una debajo de la otra, cada una con su ícono y su nombre; se cierra con Escape, un clic afuera o al elegir). La fila abierta no repite esas acciones.
- **Un componente igual en toda fila abierta, en dos mitades** (`minmax(0,1fr) minmax(0,max-content)`, 24 px entre ellas: el registro toma lo que deja la imagen). El detalle va desde la columna del nombre hasta donde empieza la columna ⋯. Con el administrador angosto (menos de 640 px) el registro va arriba, con su propio alto (12 rem), y la imagen debajo.
- **Izquierda: el registro** del juego (`gameaccess-log.txt`: descarga, instalación, configuración, cada Jugar, cada congelado), con "Qué le falta" arriba si tiene problemas y la tarea que corre como último grupo. **Toma el alto de la mitad derecha** (mínimo 12 rem) y se desplaza por dentro: las dos mitades terminan en la misma línea.
- **Derecha: la imagen de la tarea.** La mitad derecha se llena con una grilla tenue de celdas de 24 px que se apaga hacia la derecha (como la del congelado) y todo se apoya en sus líneas: 24 px de margen, la imagen apaisada del juego de **15 × 7 celdas (360 × 168 px)**, sus cifras 2 celdas más, los controles 4 celdas de ancho a una celda de la imagen, y el historial alineado arriba y abajo con la imagen. Igual para descarga, congelado y movida (Seba, 2026-11-02: crecida con la fila quedaba demasiado grande; dentro de la grilla se ve equilibrada y alineada) con la animación de lo que pasa (gráfico de velocidad, prensa de hielo, cubos). Con una tarea:
  - la base de la imagen **se funde a negro** y se alarga 44 px; sobre esa franja, los datos **sin etiquetas** (la etiqueta queda como tooltip), separados por `·`: tamaño descargado / total, tiempo restante, velocidad; un dato que todavía no se conoce no se muestra;
  - el **porcentaje en un círculo** de 44 px arriba a la izquierda de la imagen, y al lado el nombre de la tarea en una pastilla ("Preparando", "Instalación", "Congelando");
  - **todos los controles de la tarea juntos** en una columna de 96 px a la derecha de la imagen: botones altos (ícono de 22 px sobre el nombre) que reparten el alto de la imagen. Descarga: Pausar o Reanudar, Reintentar tras una falla, Cancelar y Abrir carpeta. Instalación: Cancelar y Abrir carpeta. Congelado o movida: Cancelar.
  - Sin tarea, la imagen quieta, del mismo tamaño.
- **Las imágenes de la tarea se arreglan solas** (`GameWideArt`, `SteamCover`; la movida: portada y carpeta): un juego reciente no tiene rutas de Steam sin código, así que nunca se arma la URL a mano.
- **Descarga e instalación son tareas separadas:** al terminar la descarga, la imagen deja el gráfico de velocidad y muestra el progreso de la instalación.

### 4.21 Descarga en la lista `digital-download-row` / `ga-dl-card`
- Cada descarga es una tarjeta: borde `#ffffff12`, radio 10 px (12 la que está en curso), fondo `#ffffff05`, 8 px entre tarjetas; con mouse o foco el fondo y el borde se aclaran.
- Con mouse o foco la tarjeta crece hacia abajo y se abre una fila de botones debajo de la imagen, alineada a la derecha, con la cruz para quitarla al final. Botones planos de 34 px, solo ícono (el nombre se despliega al pasar el mouse): fondo transparente, borde opaco `#59636a`, ícono naranja.
- Lista o con error: marca de 30 px semitransparente sobre la esquina superior izquierda de la imagen.

### 4.22 Buscador
- En reposo es una cápsula corta con el relleno semitransparente y el borde opaco, centrada en el panel central (no en la ventana; el botón de vista cuelga a su derecha y no la mueve); crece con el texto que se escribe (hasta el 64 % de la ventana) y se vuelve opaca con mouse, foco o texto.

### 4.23 Consola de congelado `ga-freeze-console` (componente `FreezeConsole`)
- **2026-11-01 (Seba): ya no hay consola flotante ni pastilla.** Un congelado, descongelado o movimiento en curso es una tarea: se lista en la sección Tareas del panel Procesos y descargas (§0b, `ProcessTasks.tsx`) y su detalle (dibujo, cifras, pasos, registro) se ve en la fila del juego en el administrador, adonde lleva el clic. Lo de abajo sigue valiendo para ese detalle.
- Congelar, congelado profundo y descongelar se **preguntan en el aviso** (§4.9, `confirmNotice`, celeste: Cancelar + la acción), no en un diálogo; el **resultado** también es un aviso: "Congelado completado" con el antes y después y un Aceptar que se aprieta solo a los 8 s (un error espera). Al irse el aviso, el trabajo se cierra y su fila se pliega. El trabajo se ve en esta consola, que **no bloquea** la app (sin fondo oscuro, sin foco atrapado), o en la fila del juego en el administrador.
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
- **Cómo se alinean los botones, una vez para toda la aplicación** (Seba, 2026-11-19; antes era distinto en cada pantalla): (1) por defecto conservan su ancho y van al **principio** de la línea —ese es el lugar de un botón que dispara algo: verificar que corre, abrir la carpeta, reparar, renombrar—; (2) en una **columna angosta** (un contenedor de 420 px o menos, como el detalle del Manager) cada uno toma **todo el ancho**, uno por línea; (3) un botón **de peligro** toma todo el ancho siempre, para no apretarlo de refilón al apuntar al de al lado; (4) `ga-actions-end` es solo para la acción que cierra un formulario (Guardar, Listo). La pantalla no decide esto: si un caso no entra, la regla se cambia en `content.css`.
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

**Acordeones: uno abierto a la vez, en toda la app** (Seba, 2026-11-02). Abrir un `details` cierra los otros abiertos del mismo contenedor (`singleAccordion.ts`, se activa una vez en `main.tsx`; ningún componente tiene que hacer nada). Un grupo que necesite varios abiertos lleva `data-accordion="multi"` en el contenedor, y es una excepción.
- Una ayuda que se muestra siempre no lleva además un botón para mostrarla.
- Un bloque de ayuda o explicación usa `ga-stack` (16 px entre párrafos y secciones) con 20 × 24 px de margen interior: nunca párrafos pegados al borde ni a la sección siguiente.

- Una pantalla no escribe reglas para `p` ni para títulos (`h1`–`h6`): ni margen, ni fuente, ni tamaño, ni alineación. Lo que necesite distinto va con su clase y es una excepción (color, peso, recuadro, o `--ga-p-size` / `--ga-p-align`).
- Colores: solo tokens de `:root`. Un color suelto en un `.css` que no sea del tema no pasa el control.
- **Control:** `npm run check:css` (y `npm test`, con `src/dialogCss.test.ts`) falla si un `.css` agrega reglas de párrafo o colores sueltos. La deuda vieja está contada por archivo en `apps/desktop/scripts/dialog-css-baseline.json`: puede bajar (`node scripts/check-dialog-css.mjs --update` al limpiar), nunca subir.
- Sin componentes React para esto: `<p className="ga-hint">` es tan corto como un `<GaHint>`.

### 4.27 Diálogo de inicio de juego `ga-launch` (componente `LaunchDialog`, Seba 2026-11-01)
- Se abre **apenas se pide jugar** (`launchGame` → `beginLaunch`) y es el único modal mientras el juego arranca. **Los primeros 10 s bloquea todo**: sin `ga-close`, Esc no lo cierra y ningún otro juego se lanza (`launchLocked()`); una barra naranja muestra el tiempo.
- Cabecera: dibujo SVG animado (mando dentro de un anillo que gira, botones que parpadean; rojo con una X si falla, verde con un tilde que se dibuja al abrir) + eyebrow, título Bebas y texto. Debajo, el **registro en vivo** (monoespaciada 12 px, tiempo desde el inicio, cursor): lo escribe el lanzador (`launch_trace.py`) en `.cache/digital_launch/<appid>-progress.json` y la app lo lee cada 400 ms con `launch_progress`.
- **Modo error** (el lanzador falló, o pasaron 10 s sin que abra; si abre más tarde se cierra solo): aparece **Qué se revisó** (largo de la ruta, símbolos raros, Steam en ejecución aunque esté en segundo plano, archivos borrados por el antivirus —ejecutable marcado que falta o amenazas de Defender—, idioma cambiado por Game Access, juego congelado); lo que falla va destacado en naranja. Botones, una sola fila de 44 px: **Intentar arreglarlo solo** (naranja; acción `auto-fix`: abre Steam en segundo plano si el juego lo usa y no corre, descongela, vuelve a aplicar el respaldo del fix, deja el idioma sin tocar y vuelve a lanzar) y **Cancelar**. Si el segundo intento falla: **Abrir la ubicación del ejecutable** y **Cancelar**.
- Si abre, dice "Listo" y se cierra solo a los 1,4 s. Una instalación rota (faltan archivos) sigue yendo al diálogo de recuperación.
- **Variante del niño** (`KidScreen`, `kid`; Seba 2026-11-02): bloquea **todo el tiempo** que el juego tarda en abrir (sin límite de 10 s: espera a que corra un proceso del juego, `kid_game_open`; Rust se rinde a los 90 s), con una franja naranja que corre en vez de la barra de tiempo. Sin registro, sin "Qué se revisó" ni arreglo automático. Si falla: el error y un solo botón naranja **Volver a mis juegos**, más el `ga-close`. El mando y las flechas no mueven nada detrás mientras está abierto.

### 4.28 Diálogo del antivirus `ga-av` (componente `AntivirusDialog`, Seba 2026-11-02)
- Diálogo grande con las medidas de §4.26 (las mismas que `KidReadyDialog`; `antivirus-dialog.css`): eyebrow "Descarga directa", título Bebas 52 px, texto principal 18 px y dos tarjetas lado a lado del mismo alto: **Por qué hace falta** (`--ga-warn`) y **Solo para la descarga directa** (`--ga-ok`). Debajo, `ga-label` **Carpetas** con cada ruta en monoespaciada sobre `--ga-surface`.
- Botones, una fila de 44 px a la derecha: **Agregar la excepción** (naranja; un solo permiso de Windows), **Hacerlo a mano** y **No, gracias**. A mano (otro antivirus, Defender de una organización, permiso negado o error): los pasos en `ga-label` + lista, y **Abrir Seguridad de Windows** (naranja, solo Defender) o **Copiar las carpetas**, más **Ya lo hice** y **No, gracias**.
- Espera a que el diálogo central (bienvenida, novedades, tareas largas) se cierre: nunca se apila. Vista previa: `?uiDemo=1&antivirus=missing|other|managed`.

### 4.29 Asistente «Conectar IA» `ga-ai` (componente `AiConnectWizard`, Seba 2026-11-04)
- Diálogo grande con las medidas de §4.26 (`ai-connect.css`, las mismas de `ga-av`): eyebrow «Conectar IA · paso N de 3», título Bebas 52 px y debajo una barra de tres partes que marca el paso. Un solo `ga-close`.
- Paso 1: texto de 18 px y dos tarjetas lado a lado: **Qué hace** (`--ga-ok`) y **Qué se manda a Ollama** (`--ga-warn`); botones **Ahora no** y **Conectar** (naranja).
- Paso 2: la página de claves de Ollama se abre en el navegador del jugador (ahí están sus cuentas de Google y GitHub; Google no deja entrar en una ventana embebida) y, siempre encima y contra el borde derecho, la ventana chica de los pasos (`src/aiSteps`, 340 × 980 px como mucho y con scroll en pantallas bajas, una columna): cuatro pasos numerados con títulos de una línea, una captura real de cada pantalla de Ollama con lo que hay que tocar marcado en naranja (`step-N.png`; en la captura de la clave, la clave va tapada) y un campo grande para la clave. Al pegar una clave válida se guarda y la ventana se cierra sola; si no es válida, `ga-status is-error` y queda abierta. El diálogo muestra «Esperando tu clave…» con ruedita; botones **Atrás** a la izquierda y **Abrir/Mostrar los pasos** (naranja).
- Paso 3: ícono grande (ruedita, ✓ o ✗) y tres comprobaciones; **Listo**, o **Probar otra clave** / **Reintentar**.
- Configuración › IA: tarjeta «Ollama en la nube» con el estado y **Conectar** (naranja) o **Probar** y **Desconectar**. Vista previa: `?uiDemo=1`, Configuración › IA (la guía se simula).

### 4.30 Tapa de apertura y aspecto PLUS (Seba 2026-11-04)
- La palabra de la tapa (`GateWord`, `splash-screen.css`) es tan tenue como la de la columna derecha (`brand-wall.css`): línea de 1 px que no escala (`vector-effect: non-scaling-stroke`), opacidad .26, relleno .03, sombra naranja .12. Es grande (franja de `--gs-lock` × .4, del marco de la hoja hasta el candado o la cerradura) y se dibuja letra por letra antes de que gire la cerradura (`DRAW_MS` 1500). Seba: «apenas legibles, un poco más grandes».
- Con PLUS (`html.ga-plus`, `plusLook.ts`; recuerda el último estado para que la tapa ya salga dorada): marco, labio de la pantalla, líneas grabadas y nombre de la pestaña en dorado (`--ga-plus-*` en `gameaccess-theme.css`); en la tapa, marco de cada hoja y líneas en dorado y la marca **+ PLUS** arriba a la derecha (`gs-plus-mark`). Solo cambian colores, nada se mueve ni cambia de tamaño.

### 4.31 «Tu perfil» en Configuración › IA `ga-profile` (componente `AiProfileEditor`, Seba 2026-11-05)
- Debajo de la tarjeta de Ollama: título T2 (`--ga-t2-font`, como un plugin) y grupos `ga-group ga-settings-group` con su `ga-label`; CSS de pantalla en `ai-settings.css`. Sin botón de guardar: cada cambio se guarda solo y va con cada pedido a la IA.
- Juegos: campo de búsqueda, Todos / Me gustan / No me gustan y orden, a 44 px; grilla de carátulas 2:3 con pulgar arriba a la izquierda (`--ga-ok` o `--ga-danger`) y quitar arriba a la derecha, visible al pasar el mouse o con foco. Los que no gustan van desaturados.
- Géneros: filas con el nombre y los dos pulgares (`GaIconButton`, 44 px). Cómo jugar: botones `ga-settings-choice` de `--ga-control-h`; al elegir Multijugador o Los dos aparecen los tipos de multijugador. Lo que buscás y lo que evitás: dos `textarea` lado a lado, 500 caracteres.

### 4.32 Búsqueda con IA en el catálogo (Seba 2026-11-05)
- Botón «Búsqueda con IA» junto a «Personalizado». Solo PLUS: para el resto queda deshabilitado y, al pasar el mouse o con foco, muestra un globo con el texto y el enlace **Conseguir PLUS**, que abre el mismo diálogo que el botón PLUS del marco (`OPEN_PREMIUM_EVENT`).
- Encendido: sin filtros, sin orden y sin destacado. Arriba, la sección «La IA te responde» con su mensaje (o **Conectar IA**, que lleva a Configuración › IA, si no hay clave). Debajo solo los juegos de la IA, en su orden.
- Cada resultado ocupa dos celdas: la tarjeta y, pegado a ella, el motivo sobre una sombra sutil en semicírculo centrada en la carátula, como la del menú contextual (`ga-ai-result-why`): sin línea ni bordes rectos. Al abrir el menú contextual de ese juego, el motivo se oculta hasta que el menú se cierra. Vista previa: `?uiDemo=1&uiDemoPlus`, con `gameaccess:ai-search` en `true`.

### 4.33 Barra de modo `ga-mode-rail` (componente `ModeRail`, Seba 2026-11-06)

Primera columna de los cinco modos básicos (Home, Juegos, Library Manager, Control parental, Ajustes): fina, a todo el alto de la ventana dentro del marco, con un margen. No está en Big Picture ni en la pantalla del chico. Es una sola barra, que cambia su contenido al cambiar de modo, con una animación por cambio. Medidas en `templates/base.css` (`--ga-mode-rail-w`, `--ga-rail-inset`, `--ga-rail-gutter`); disposición en `mode-rail.css`.

Sus estilos internos van en hojas construidas (`adoptedStyleSheets`): la política de seguridad de la app bloquea los `<style>` creados en ejecución, y eso solo se ve en la app compilada, no en la vista previa de Vite. Lo mismo vale para cualquier componente nuevo con Shadow DOM: probalo en la ventana real.

### 4.26 Jerarquía y espacios de un diálogo grande (Seba, 2026-10-31)
Criterios generales, no solo del modo niño. Se aplican a todo diálogo grande y a las pantallas: confirmaciones formales,
resúmenes, explicaciones con varias partes. Referencia: el diálogo final del asistente del modo niño (`KidReadyDialog.tsx`,
`kid-mode.css`).

**Escala de tipos: cada nivel se distingue del siguiente a simple vista.**
| Nivel | Valor |
|---|---|
| Título del diálogo | Bebas Neue 52 px naranja (en un diálogo grande; 34 px es el de un diálogo chico) |
| Texto principal (lo primero que se lee) | 18 px, tinta de lectura `--ga-text-ink`, nunca gris |
| Etiqueta de sección ("Aclaraciones") | `ga-label`, mayúsculas |
| Título de cada ítem o tarjeta | Manrope 700, 20 px, en el color de su tono (`--ga-warn`, `--ga-ok`…) |
| Texto de cada ítem | 16 px, tinta de lectura |
- Un título de color nunca tiene el mismo tamaño que el texto que encabeza: un título de ítem va al menos 4 px más grande y en negrita.
- El gris (`--ga-muted`) es solo para lo secundario: subtítulos y pistas. El texto que hay que leer va en `--ga-text-ink`.

**Espacios fijos, nunca "lo que salga".**
- Margen interior: 40 px arriba, 44 px a los costados, 36 px abajo.
- Encabezado estándar con línea `--ga-line` debajo y 24 px hasta el texto.
- 32 px antes de cada sección y antes de la fila de botones; 16 px entre tarjetas; 10 px entre el título de una tarjeta y su texto.
- Dentro de una tarjeta: 22 × 24 px de margen interior, ícono de 44 px en un círculo de su color y 20 px hasta el texto.

**Ítems como tarjetas.** Cada aclaración, aviso o paso con título propio va en una tarjeta (`--ga-surface`, borde `--ga-line`, radio 12 px), con ícono, título y texto. No se apilan párrafos de colores sueltos.

**Ancho.** Los diálogos no son angostos: casi todos los monitores de PC son anchos y el diálogo crece a lo ancho cuando el contenido lo pide (comandos, rutas, ayudas en varias partes), en vez de crecer hacia abajo. Un diálogo de opciones con ayuda (Ejecución de un juego) va hasta 960 px (Seba, 2026-11-02). Un diálogo grande es tan ancho como la columna central del contenido: hasta 1200 px dentro del marco, con los márgenes de `.ga-screen` (`min(1200px, 100vw − marco − 2 × clamp(24px, 4vw, 64px))`).
- Con ese ancho, el texto corrido se corta a unos **80 caracteres** por línea (`max-width: 80ch`): nunca renglones de punta a punta.
- Las tarjetas van **lado a lado** cuando entran (columnas de 380 px como mínimo) y **todas del mismo alto** (el de la más alta, también cuando una se despliega).

**Alto.** En una pantalla baja el encabezado y la fila de botones quedan fijos y solo el medio se desplaza: el botón principal nunca queda fuera de vista.

**Trampa de Tailwind.** La base de los diálogos (`components/ui`) usa Tailwind con todas las utilidades en `!important`, y Tailwind solo genera las clases que encuentra en `src/library-manager` y `src/components/ui`. Una clase de Tailwind escrita en otro archivo (`w-[…]`) no existe. Ancho, margen interior, color o tipo de un diálogo se fijan en su CSS con una clase propia y `!important` en la propiedad que la base también fija.

**Pantallas.** Dentro de `.ga-screen` ningún texto baja de 16 px; títulos de columna y pestañas 14 px (§4.12).

### 4.34 Humo único `smokeStage` (Seba, 2026-11-06; prototipo)
Los diálogos grandes del centro no son cajas: vidrio esmerilado sobre toda la ventana que se desvanece hacia las esquinas, más oscuro en el centro como humo, con el contenido directo encima. Hay **un solo humo** para toda la app (`components/ga/smokeStage.ts`, `smoke.css`).
- **Un diálogo llama a otro:** el humo queda quieto y el contenido nuevo empuja al viejo. Se mueven juntos, con el mismo tiempo y la misma curva (`--ga-smoke-time`, `--ga-smoke-ease`): el nuevo sube desde abajo apareciendo y el viejo sube desapareciendo. La distancia se mide en cada cambio (la mitad de cada uno más un hueco), así nunca se pisan. Si el viejo seguía abierto, al cerrarse el nuevo vuelve con el mismo empujón hacia abajo.
- Cada familia (`AppDialog`, `LaunchDialog`, Radix, diálogo central, PLUS, filtros, paneles de configuración) sigue con su código: `smokeStage` observa la página, y `SMOKE_SURFACES` dice qué cuenta como diálogo grande. Un diálogo nuevo solo tiene que usar una de esas clases o `GaSmoke`.
- No entran los chicos con la imagen del juego de fondo, la tarjeta de propiedades ni las pantallas completas.
- La máscara es un degradado radial (`--ga-smoke-mask`) en vez de un PNG: mismo resultado, sin archivo, y cada sabor la puede cambiar. Vidrio y oscuro: `--ga-smoke-glass`, `--ga-smoke-bg`. Recorrido mínimo: `--ga-smoke-travel`.
- `GaSmoke`: Esc o un clic en el humo cierra; el foco va a lo marcado con `data-autofocus` y vuelve a donde estaba.
- Primer uso propio: la pregunta antes de jugar en Big Picture (`BigPlayConfirm.tsx`), con la imagen grande, la descripción corta (`short_description`) y Jugar. Los primeros 350 ms no cuentan, así el mismo toque que la abrió no lanza el juego.

### 4.35 Columnas de Escena en una ventana angosta (Seba, 2026-11-16)

- **Las columnas laterales nunca se achican:** su contenido se deformaría. Tienen su tamaño de diseño, que depende del alto de la ventana.
- **El centro tiene un mínimo** (`--ga-nav-content-min`, `templates/base.css`). Cuando la ventana no da para todo, se retira primero la columna de actividad, entera (nunca a medias), y después la columna izquierda se pliega en un **cajón** (`navigation/sideDrawer.ts`).
- **El cajón:** plegado deja solo su pestaña (un tirador del color del modo con una flecha) en el borde izquierdo, y el contenido ocupa su lugar. Desplegado con la pestaña en una ventana donde no entra, se abre **encima del contenido** y se cierra al elegir una sección, con Escape o con un clic afuera. En una ventana donde entra, la pestaña lo pliega y despliega a mano y empuja el contenido; esa elección se recuerda.
- **Ventana más angosta que el mínimo:** el contenido conserva su ancho y se corta en el borde derecho, sin barra de desplazamiento horizontal.
- Estado en la página: `data-ga-nav-drawer` (`docked`, `closed`, `open`). El deslizamiento pasa por la cola de transiciones.

### 4.36 Apariencia de Escena (Seba, 2026-11-16)

- Los Estilos 2–4 y la pestaña «Detalles» quedan ocultos (el código y sus hojas siguen, sin montarse): el marco usa siempre el Estilo 1 debajo de Escena.
- Se cambia solo esto, para que el estilo no se rompa: el **degradé de cada modo** (una paleta para los cuatro, uno de los degradés elegidos o dos colores propios; el tono oscuro se deriva solo), la **figura de cada modo** (imagen propia, escala y posición) y la **letra de la palabra grande**.
- El texto del menú pasa solo a negro o blanco, el que más contraste tenga con el degradé (`inkFor`, `navigation/sceneLook.ts`).
- Figura propia: PNG o WebP con fondo transparente y la proporción de la original (1024 × 1536); se rechaza con el motivo si no cumple. Se guarda en IndexedDB.
- **Soltar la imagen encima** (Seba, 2026-11-19): se arrastra un archivo desde la computadora y se suelta **sobre el personaje de la escena** o **sobre la miniatura** de Configuración › Apariencia, y esa imagen pasa a ser la figura del modo. Mientras se arrastra, el borde de la columna (o de la miniatura) se marca punteado (`[data-dropping]`, `--ga-scene-drop-*`). Pasa los mismos controles que el selector de archivos, y lo que falla se dice en un aviso.
- **Se acomoda sola** al soltarla (`fitFigure`, `navigation/sceneLook.ts`): se mide el dibujo dentro de la imagen —lo que no es transparente— y se calculan escala y posición para que la **esquina superior derecha del dibujo** quede en la esquina del arte y su alto sea siempre el mismo (`FIGURE_FIT`: arriba `0`, derecha `0`, alto `1,25` del alto del arte), así cualquier imagen llega siempre al mismo punto, por más aire transparente que traiga alrededor. Los valores que salen son los mismos que usan las barras, recortados a sus límites.
- Después el jugador **la acomoda a mano** con las barras de escala y posición, como siempre; el botón «Acomodar sola» vuelve a correr ese cálculo sobre la imagen que ya está puesta.
- Hasta **3 variaciones** guardadas (degradé y figura de cada modo, y la letra) y el botón «Volver al setting por defecto».
- Clic derecho en la escena: sobre el menú, colores; sobre la figura o la palabra, la figura (`SceneLookMenu`). Los mismos controles en Configuración › Apariencia (`SceneLookControls`).
- La escala y la posición cambian el tamaño y el lugar de la figura, nunca su `transform`: GSAP lo anima en cada cambio de modo.
- Variables: tamaños en la base (`--ga-scene-look-*`, `--ga-scene-figure-*`), aspecto en el sabor (`--ga-scene-<modo>-start/end/ink`, `--ga-scene-word-family`, `--ga-scene-look-*`); `scene-look.css` solo distribuye.
- MCP: `appearance_get`, `appearance_set_colors`, `appearance_set_figure`, `appearance_variations`.


### 4.37 Asistente de pantalla completa `GaWizard` (Seba, 2026-11-17)
- Para procesos de una sola vez (importar juegos, mover juegos a la librería): no tienen pestaña, se abren desde su botón como asistente sobre toda la ventana. `components/ga/Wizard.tsx`, `wizard.css`, medidas `--ga-wizard-*` en `templates/base.css` y colores en el sabor.
- Familia overlay (`ga-overlay-root` + `ga-overlay-dialog`): el humo o el fondo atenuado los pone ese molde. Ocupa la columna central hasta 1200 px y todo el alto de la ventana, con margen `clamp(16px, 3vw, 40px)`.
- Encabezado: eyebrow «Proceso · paso N de M» naranja, título Bebas 52 px naranja y un solo `ga-close`. Debajo, los pasos con nombre: una barra de 4 px por paso (naranja hasta el actual), número en círculo (✓ en los hechos) y nombre de 15 px.
- Cuerpo con scroll y texto principal de 18 px en tinta de lectura; botones fijos abajo: **Atrás** a la izquierda, la acción del paso (naranja) a la derecha.
- Mientras un paso no se puede dejar a medias (buscar, mover), el cerrar queda deshabilitado y Escape no hace nada. El último paso dice qué salió bien y qué no (`ga-wizard-results`).

### 4.38 Disco `DiskCard` y Manager › Espacio en varios discos (Seba, 2026-11-17)
- `library-manager/DiskCard.tsx` (de `examples/game-access-hdd`): el disco dibujado en tres capas (`hdd/hdd-body|platter|head.webp`) y los datos en un SVG de 1100 × 500 a su derecha: letra, nombre, para qué se usa, % ocupado, ocupado, libre, barra, capacidad y actividad. Ancho mínimo `--ga-hdd-min-w` (520 px); posiciones del arte y colores en `--ga-hdd-*` (`templates/base.css` y el sabor), distribución en `hdd.css`.
- Alineación: el arte de la carcasa está recortado a su borde visible (`--ga-hdd-aspect`), así la tarjeta ocupa todo el ancho de su columna y queda alineada con la fila de etiquetas y la lista de juegos de abajo (mismos bordes, sin márgenes propios).
- Color por nivel: azul hasta 75 %, amarillo hasta 90 %, rojo después (`is-normal|warning|critical`). Leyendo o escribiendo, el plato gira y el cabezal oscila (GSAP); con movimiento reducido queda quieto. Es `role="img"` con todo el dato en `aria-label`.
- Espacio: una tarjeta por disco fijo en una grilla `lm-disks`. Debajo, las etiquetas (`lm-disk-tag`: juegos, «Acá van los nuevos» naranja en el disco en uso con más espacio, archivos temporales) y el interruptor «Usar para juegos» (`GaSwitch`, §4.39). El del disco de la carpeta de juegos queda encendido y bloqueado, con la razón en su tooltip. Un disco sin usar va atenuado (`is-off`).
- Cada disco en uso lista sus juegos (`lm-disk-games`, alto fijo con scroll) con tamaño en mono, cada fila llena en naranja tenue en proporción a su tamaño frente al juego más grande de ese disco (`--lm-share`, colores `--ga-hdd-row-fill*`), y un botón por cada otro disco en uso («→ D:»); el mismo movimiento está en el menú de la fila de la grilla («Mover al disco D:»). Se confirma con el aviso único y corre como trabajo con barra en Actividad; mientras corre, el disco de origen dice «Leyendo» y el de destino «Escribiendo».
- Qué es cada disco (Seba, 2026-11-18): la fila de etiquetas dice la letra y el tipo (NVMe, SSD, Disco mecánico), con el modelo en el tooltip, y «Por USB» cuando está conectado por ahí. **No se muestra ninguna velocidad**: el tipo se lo pregunta a Windows (`disk_profile.kinds`), sin escribir ni leer nada en el disco. Mientras todavía no se sabe, la etiqueta dice «Viendo qué es…».

### 4.38b Barra superior de Manager › Juegos (Seba, 2026-11-17)
- Sobre la tabla, una grilla de una columna con los mismos bordes que la tabla: las acciones como celdas iguales (4 en una fila; 2 × 2 si la columna mide menos de 860 px; una debajo de otra bajo 640 px), con «Corregir todo» naranja primero; debajo, las pastillas de filtro y el botón de volver a escanear al final de esa fila.
- El tablero de actividad (`lm-activity`) solo aparece mientras algo corre, a la derecha de las acciones; en reposo no ocupa lugar (el panel Actividad ya está al costado).

### 4.39 Interruptor `GaSwitch` (Seba, 2026-11-17)
- Para prender o apagar algo que cambia en el acto (un disco para juegos). `components/ga/Switch.tsx`, `switch.css`; medidas `--ga-switch-*` en `templates/base.css`, colores y fuente en el sabor.
- Pista de 46 × 26 px con un círculo de 18 px que se desliza; encendido es naranja con brillo suave y el círculo oscuro. El nombre va al lado, en mayúsculas, gris apagado y claro encendido. Todo el conjunto es un solo botón `role="switch"` con `aria-checked` (Espacio o Enter lo cambian).
- `locked`: se ve pero no se cambia, con `aria-disabled` (no `disabled`) para que el tooltip diga por qué. `busy` mientras se aplica el cambio. Con movimiento reducido no se anima.

### 4.40 Fuente de Biblioteca › Manager (Seba, 2026-11-17)
- Las pestañas de Manager (Juegos, Cuentas, Espacio) y sus asistentes leen como una herramienta del sistema: texto en Bahnschrift (la DIN de Windows; si falta, Segoe UI) y cifras, rutas y tamaños en mono (Cascadia Mono, Consolas). Los títulos siguen en la fuente de títulos.
- Se hace con dos tokens del sabor, `--ga-manager-family` y `--ga-mono-family`, que reemplazan `--ga-text-family` dentro de `.ga-manager-view`, `.lm-root` y `.ga-manager-scope` (la clase que llevan los asistentes, que se abren fuera de la pantalla). Los tokens compuestos de fuente (`--ga-label-font`, `--ga-hdd-*-font`…) se resuelven donde se declaran: los que usa Manager se declaran de nuevo en ese bloque; uno nuevo que use Manager también va ahí.

### 4.41 Arte de los planes: insignia y tarjeta en tres partes `GaSliceCard` (Seba, 2026-11-17)
- Arte en `src/assets/plans/` (webp, recortado de la lámina de Seba): `plan-badge-base|plus` y, por plan, `plan-card-*-head|body|foot`. El nombre del plan está en la imagen; el texto para lectores de pantalla va en el botón o en un título oculto.
- Insignia del plan (`ga-scene-plan`, arriba en la columna de Escena): la imagen de BASE (rosa) o PLUS (dorada), alta `--ga-scene-plan-h` (48 px, con el brillo incluido). Reemplaza la insignia de metal. En inglés el plan gratis se llama BASIC: la insignia es `plan-badge-basic` y los textos dicen BASIC. La tarjeta grande usa en inglés su propio encabezado `plan-card-basic-head` (el cuerpo y el pie son los de BASE).
- `components/ga/SliceCard.tsx` + `slice-card.css`: encabezado y pie que guardan su proporción (ancho 100 %, alto de la imagen) y un cuerpo cuya imagen se estira al alto del contenido; relleno `--ga-slice-body-pad`; lo del pie (`footer`) va centrado en su placa (`--ga-slice-foot-inset`). Sirve para cualquier tarjeta de arte en tres partes.
- Suscripción › Mi plan: las dos tarjetas lado a lado, del mismo ancho y alto (`ga-plan-cards`, una debajo de otra bajo 340 px por tarjeta). En cada una, una línea de entrada en el color del plan (`--ga-plan-*-accent`) y tres ventajas con ✓; en el pie, «Tu plan» en el plan que se usa, y «Activar PLUS» (naranja) en la de PLUS si no se tiene.

### 4.42 Botón de pad `GaPadButton` (Seba, 2026-11-17)
- Un cuadrado redondeado dibujado en SVG, como la tecla de un pad: `components/ga/PadButton.tsx` + `pad-button.css`. Medidas y mezclas `--ga-pad-*` en `templates/base.css`; color por defecto (verde salvia) y vidrio oscuro en el sabor.
- `color`: cualquier color o token (`var(--ga-orange)`); todos los tonos encendidos salen de ese color mezclado con la luz o el vidrio del sabor, así un solo color pinta el pad entero.
- Común: vidrio oscuro mate (casi plano), con un borde sutil que apenas brilla arriba y abajo (`--ga-pad-rim-light|dim`). Encendido (`lit`): cuerpo mate, el color sube suave desde abajo al centro, con un brillo alrededor. Los dos llevan el mismo marco fino de brillo irregular (más luz arriba y abajo, levemente en diagonal): blanco en el común, de su color y más fino (`--ga-pad-edge-lit-w`) en el encendido.
- Hover: el pad sube 1 px y se aclara; el común toma su color en el borde, el encendido brilla más. Movimiento reducido: sin subir ni transición.
- Cuadrado con solo ícono (`icon`) o ancho con texto (`children`): el SVG no tiene viewBox y sus formas se miden en CSS, así las esquinas no se deforman; todo (radio, marco, brillo, ícono, texto) escala con `--ga-pad-size` (54 px en la ficha, 112 px en un tablero).
- Ícono y texto en blanco puro; el texto en Inter (`--ga-ui-family`, `public/fonts/inter`, OFL: la fuente libre más parecida a la San Francisco de Apple, que no se puede distribuir fuera de Apple), peso 650.
- `ink`, cómo va el ícono sobre la tecla: `shadow` (sombra), `engraved` (grabado: luz abajo, sombra arriba), `printed` (impreso con fusión `hard-light`, blanco fuerte pero integrado; el valor por defecto) `printed-engraved`, `debossed` (bajo relieve: hundido en la tecla, un tono más oscuro que su superficie, con luz en su borde de abajo; `--ga-pad-deboss-*`) u `outlined` (blanco con un borde negro mínimo de 1 px, `--ga-pad-outline*`). `halo`: una sombra suave y difuminada detrás del ícono y el texto (no letra por letra; `--ga-pad-halo*`). `GaPadArt` es solo la tecla, para un botón que arma su propio contenido.
- Colores en el sabor: naranja óxido `--ga-pad-rust` y rojo ladrillo `--ga-pad-brick`.
- **En la ficha de juego** (Seba, 2026-11-17): Jugar, Descargas, Ver en Steam, Me gusta y No me gusta son pads de 60 px (`--ga-detail-wide-action-h`) en rojo ladrillo (`--ga-detail-pad-color`), con borde negro (`outlined`) y `halo`. La acción principal va encendida; Steam y los pulgares van comunes y el pulgar elegido se enciende. La selección con el mando usa el mismo contorno que el foco.
- El texto lleva suavizado (`-webkit-font-smoothing: antialiased`, `text-rendering: optimizeLegibility`); en Windows Chromium usa el suavizado del sistema, así que se nota sobre todo en macOS.
- `toggle`: funciona como tecla de prender y apagar (`aria-pressed` = encendido). Sin texto adentro, `label` es su nombre para lectores de pantalla y su tooltip; con `children`, el contenido va centrado encima.

### 4.43 La ficha de juego como expediente (Seba, 2026-11-17)
- Del diseño de Seba (referencia: la ficha de Control), sin pestañas: `LibraryDetailPanel.tsx` (`WideDetail`) con las piezas de `DetailSheet.tsx`; disposición en `detail-sheet.css`, medidas `--ga-sheet-*` en `templates/base.css`, colores y letras en el sabor (el color del modo, Anton para títulos y cifras, mono para etiquetas).
- Zona principal, en una grilla:
  - **barra**: arriba de todo, a la altura de los botones y de la columna derecha, dónde está (Librería o Catálogo / género / nombre) y sus herramientas (en tu biblioteca de Steam, actualizar, opciones, cerrar);
  - **arte** en todo el ancho (barra y héroe, desde el borde del marco): la imagen ancha de Steam (`library_hero`, pensada para recortarse alrededor de su centro, donde va el protagonista) centrada. Pasa **por detrás del título y de la información** (Seba, 2026-11-19) y se funde cerca del borde derecho (`--ga-sheet-art-solid-x`) y con los medios abajo; debajo de las palabras, la sombra (`.ga-sheet-shade`, `--ga-sheet-shade-right`) las mantiene legibles sobre cualquier imagen;
  - **información** a la derecha: quién lo hizo y el **logo** de Steam como título. Steam lo da en un lienzo de 640x360 con márgenes transparentes: la app los recorta una vez por logo y le da a cada logo más o menos la misma área (`--ga-sheet-logo-ref-aspect`); sin logo, el nombre en Anton ámbar, hasta dos líneas. Debajo, la pastilla «En tu biblioteca» (solo si está en la biblioteca, que incluye todas las cuentas de Steam vinculadas) y los modos de juego que da Steam (un jugador, cooperativo, multijugador). Luego «Expediente / N.º» con los géneros y el año, el texto corto, el **puntaje** y las teclas. El puntaje (`SheetScore`) es el de los jugadores de Steam (positivas y cantidad de reseñas): la cifra, una barra de diez segmentos y su nombre chico, verde, amarillo o rojo según las franjas de Steam (70 y 40); Metacritic solo si no hay reseñas de Steam (75 y 50). Si hay nota de Metacritic va al lado como enlace a su crítica. La última partida, en una línea chica;
  - **teclas**: la principal es Jugar si está instalado o Instalar si una cuenta de Steam vinculada lo tiene; si no, no hay tecla principal (es la versión núcleo, sin descargas directas). Al lado, la tienda de Steam y los pulgares. Las descargas directas solo están en la columna derecha;
  - **tira de medios**, con una línea ámbar fina justo encima: el tráiler (o la imagen elegida) en 16:9 a la izquierda, pegado a las capturas, que se reparten el resto: cuatro, o seis en una pantalla muy ancha (21:9 o más) para que no se estiren, cada una con un borde fino y sutil (la que se ve, en ámbar). Sin etiquetas encima. Un clic en una captura, o en la imagen que se ve, la abre a pantalla completa, igual que el tráiler. En una pantalla baja la tira y los paneles ceden alto (hasta `--ga-sheet-media-min` y `--ga-sheet-panels-min`) antes que la información, que nunca se corta;
  - **tres paneles** con ícono, título y rayas: Descripción (el texto largo de Steam, sin sus imágenes; el texto corto va solo arriba). Una V en su título la agranda: los paneles suben hasta la mitad de la pantalla, empujan los medios hacia arriba y tapan el arte (que conserva su tamaño), con las imágenes del texto a la vista; la V hacia abajo la vuelve a achicar, Requisitos como lista (o las etiquetas con un tilde si no hay) y Detalles (plataforma, estado con el tamaño, control, logros, idiomas y la valoración de Steam si el recuadro muestra Metacritic).
- **Columna de extras** a la derecha, solo con lo opcional que funciona: «Preguntarle a la IA» (con PLUS y la IA conectada: los enlaces «Más como este» y «¿Se parece este juego a otros que jugué?», y debajo sus respuestas; la razón si la IA lo sugirió), las fuentes de descarga (solo con el plugin y el juego sin instalar), compactas: el título se corta en varias líneas, la descarga es un cubo con solo el ícono y al pasar el cursor se ve toda la información y el cooperativo. Si no hay nada, la columna no está y la zona principal usa todo el ancho (`--ga-sheet-info-w-solo`).
- Las preguntas a la IA no se muestran sin PLUS o sin la IA conectada.
- La columna es secundaria: títulos más chicos (`--ga-sheet-side-title-font`) y portadas chicas (`--ga-sheet-pick-cover`), para no competir con el juego. Los juegos encontrados se listan uno debajo del otro con su razón; un clic abre su ficha.
- La **información** ocupa un tercio del ancho y llega hasta el borde derecho (`--ga-sheet-info-w`, `--ga-sheet-info-w-solo`: un tercio, con o sin columna de extras), así el arte se ve entero a su izquierda (Seba, 2026-11-19).
- La **franja de título** de los tres paneles es baja (`--ga-sheet-head-pad`, título de 22 px, ícono de 20 px, la V de 24 px): el panel es para leer, no para su título.
- Ningún dato se repite: el desarrollador va sobre el logo, el año junto a los géneros y la valoración de Steam solo en el puntaje.
- Capas sutiles (`DetailEditorial.tsx`): la cuadrícula sobre el arte y esquinas de mira en el marco.
- El logo no sigue al puntero (solo el arte tiene paralaje). En una pantalla baja (menos de 960 px) la información se aprieta un poco (`--ga-sheet-info-gap`, `--ga-sheet-logo-h`).
- Angosta (menos de 1100 px): una sola columna que se desplaza entera.
- El resalte de la ficha es el ámbar de la app (`--ga-sheet-ink`, de `--ga-orange`): la ubicación, los títulos de los paneles, las cifras, los tildes y los bordes. Los paneles llevan un tinte ámbar sutil de arriba hacia abajo y una franja más clara bajo el título.

### 4.44 Actividad y navegación orgánicas (Seba, 2026-11-18)
- Actividad usa fondo negro plano, borde y esquina superior orgánicos con el degradado del modo. El ícono queda en un círculo unido al borde; los avisos grises se conectan a la franja derecha mediante pequeñas formas SVG redondeadas. Los grupos conservan sus acciones y filtros.
- El menú izquierdo mantiene la abertura hacia el contenido y la gota del botón activo. Sus bordes hacen un eco curvo sobre los botones inactivos y una base gris los acompaña por debajo.
- GSAP anima las conexiones y el borde; las animaciones de Game Access no dependen de la preferencia de movimiento reducido de Windows, por decisión de Seba. La opción propia de animación de inicio sigue disponible.
- Vista previa con avisos de ejemplo: pendiente de aceptación visual de Seba en la app.

### 4.45 El rack de los discos de Manager › Espacio (Seba, 2026-11-18)
- Los discos no flotan uno debajo del otro: cada uno va en una **bahía**, que es **el dibujo de Seba** (`library-manager/hdd/rack-bay.webp`, 1257 × 542) **usado tal cual**, no una recreación: la bandeja con sus dos franjas grabadas y sus molduras, la muesca del extremo abierto de la izquierda y, a la derecha, la columna que cierra la pieza con su ventana arriba y el cable verde bajando por ella.
- La pieza **no tiene nada encima**, así que las bahías se apilan pegadas (`--ga-rack-gap: 0`) y forman un solo rack, con el cable de cada una en línea con el de la siguiente.
- La bahía conserva **las proporciones del dibujo** (`--ga-rack-aspect`), así que nada se deforma nunca. Todo lo que Game Access pone encima se ubica con **las fracciones medidas sobre el dibujo** (`--ga-rack-*` en `templates/base.css`): el disco en el área libre (81,9 % × 71,8 %, con la forma justa para que lo llene), el LED en la ventana (84,8 % → 92,8 % de ancho, 7,4 % → 38,2 % de alto), los dos interruptores en la franja grabada grande (12,5 %, ancho 68,7 %, alto 11,8 % desde el 75,5 %), cuántos juegos tiene el disco en la plaquita de abajo (12,8 %, ancho 19,7 %, alto 5,2 % desde el 92,8 %) y el cable en el 94,8 % del ancho, con su derivación al disco a la altura del 48,2 %.
- **Lo que va en las franjas grabadas se mide contra la pieza, no contra la pantalla** (Seba, 2026-11-19): la bahía es contenedor de tamaño (`container: lm-bay / size`) y los interruptores, sus letras, las luces y el relleno de las franjas salen de `cqh` de la bahía (`--ga-rack-band-control-h`, `--ga-rack-switch-*`, `--ga-rack-band-pad-x`). En la primera franja los dos interruptores se reparten su largo (`space-between`), así ninguno —ni sus tres luces— se sale del grabado, a cualquier tamaño del rack. En esa franja los interruptores no miden los 44 px de una fila de botones (§5.2): son parte del grabado y toman su alto.
- **Lo recomendado no se escribe**: al lado de cada interruptor van **tres luces** del alto de las letras (`lm-bay-score`), una encendida cuando el disco no es el indicado para eso y las tres cuando sí lo es, con el motivo en su tooltip.
- **El LED** de la ventana es **liso y saturado**, como el de un componente de verdad: su propia paleta (`--ga-led-1…6`, la versión encendida de los colores de disco `--ga-drive-1…6`, por la misma letra) más su halo, sin degradados ni blancos. Reemplaza la línea de color al borde de la tarjeta.
- **Arriba de Espacio no hay tarjetas de explicación** (Seba, 2026-11-18): el texto de entrada ya dice cómo elige Game Access el disco de cada juego nuevo y dónde se cambia la reserva, y debajo van solo dos botones —«Reescanear discos…» y «Liberar un disco…»— con el orden de los discos a la derecha de esa fila. Ese bloque va **sobre la tabla de juegos**, en la columna izquierda, así el rack arranca arriba de todo y se ven tres discos sin desplazar.
- **Espacio se acomoda al ancho** (Seba, 2026-11-18): con 1440 px o más de contenido van **tres columnas** —la columna de palabras, la tabla de juegos y el rack—, todas arrancando arriba de todo. Con menos ancho queda como estaba: las palabras arriba, la tabla y, debajo, el rack, con desplazamiento vertical.
- **La columna de palabras** (`lm-space-aside`) es un recuadro tipo panel de revista con tres partes: el título «Cómo funciona» con el texto justificado, «Política actual» como una tabla chica de dos líneas (instalar y descargas, con los discos en el orden en que se prueban) y, al pie, los dos botones. Es tan alta como la pantalla (`100cqh`: `.lm-space` es contenedor de tamaño), queda fija mientras la tabla se desplaza y reparte el espacio libre entre sus tres partes.
- **La tabla de juegos** solo necesita el ancho de los nombres: la celda del disco dice únicamente la letra (`--ga-space-drive-w`, el texto largo vive en las opciones) y el nombre va en cuerpo grande (`--ga-space-name-font`) con filas más aireadas. Un juego que no se puede mover muestra la letra sin desplegable, con el motivo en su tooltip (congelado, descarga sin terminar o no hay otro disco habilitado).
- **Liberar un disco es un asistente de pantalla completa** (`FreeDiskWizard.tsx`, §4.37): elegir (con lo que se va a mover dicho antes de tocar nada), mover y listo. Mientras mueve, el asistente queda bloqueado: no se puede hacer otra cosa con la biblioteca.
- **Siempre tres estantes como mínimo**: con uno o dos discos el rack sigue con bahías vacías (la misma pieza atenuada) y el rack se desvanece hacia abajo (máscara de alto `--ga-rack-fade`), para que no termine en un hueco.
- **En el disco** no se repite la letra (ya está en su cuerpo) y **el tipo va en la esquina superior derecha de su panel**: `NVMe`, `SSD`, `HDD`, con `USB` al lado cuando cuelga de un puerto USB. Es la palabra de Windows, igual en los dos idiomas; el nombre largo, el modelo y el aviso de USB van en su tooltip.
- **El cable**: está dibujado siempre (es parte de la pieza). Mientras un juego se mueve de un disco a otro, por el tramo entre los dos viajan puntos de luz verdes (`--ga-rack-flow`, trazo discontinuo animado con GSAP) **en el sentido en que van los datos**.
- La capa de pantalla (`rack.css`) es solo distribución: lo controla `templates/flavor.test.ts`.

### 4.46 Hoja centrada `GaSheet` y la autocompresión de juegos (Seba, 2026-11-18)
- `components/ga/Sheet.tsx` (`sheet.css`): el mismo overlay del asistente (§4.37) —la ventana se oscurece detrás y el humo la toma igual, sin marco propio— pero con el contenido **centrado** (sus clases y variables son `ga-midsheet-*`, para no chocar con la ficha de juego §4.43, que usa `ga-sheet-*`) en vez de ocupar el alto. Crece hacia los costados y hacia arriba con su contenido y nunca pasa la ventana. Un `ga-close` y Escape. Es para lo que se dice una vez y se contesta una vez.
- **Autocompresión de juegos** (`library-manager/AutoCompressSheet.tsx`), desde el botón «Autocompresión…» de la columna de palabras de Espacio: explica que es la compresión de Windows aplicada **a cada juego y no al disco**, que el juego comprimido se juega igual sin descomprimir nada, y deja elegir a los cuántos días sin abrirlo se comprime —30, 60 o 90— o apagarlo. El triple de ese plazo es el congelado profundo. Se guarda en las preferencias del launcher (`auto_freeze`, `auto_freeze_days`).
- **En la tabla de juegos de Espacio**: una columna «Última partida» en corto —«67 d», «hoy», y una raya cuando nunca se jugó, con la frase entera en el tooltip (Seba, 2026-11-19)— y, al final de cada fila, una **columna angosta de un solo ícono** (Seba, 2026-11-19), sin palabras: el cajón de archivo comprime y el cajón con la flecha descomprime (es congelar y descongelar, con la misma pregunta en el aviso y el mismo trabajo que el menú del Administrador), cada uno con su nombre en el tooltip y en el lector de pantalla. El juego ya comprimido lleva su ícono en el color de congelado; el que está en congelado profundo muestra el copo de nieve como estado, sin botón, porque se descongela solo al jugarlo.

### 4.47 El ruedo del menú sobre los botones de modo (Seba, 2026-11-19)
- El borde de abajo del menú de Escena (`.ga-scene-liquid-body`, `navigation/SceneNavigation.tsx`) está calcado del dibujo de Seba. Medidas en radios del botón del dock (`r`), desde el centro del botón:
  - **el ruedo es recto de punta a punta**, `1,20 r` arriba del centro de los botones (en el dibujo, `0,43` de la separación entre botones): pasa por encima de todos y los deja enteros abajo, así el dock se lee como una franja propia. Sin onda ni montañas.
  - **cada botón lo abolla**, y la abolladura es siempre **una circunferencia centrada en el botón**, para que tenga su misma redondez:
    - el **encendido** tira del ruedo **hacia abajo**: collar de `1,18 r`, más chico que la altura del ruedo, así el color pasa de largo el botón y cierra abajo. Es la gota que lo marca, y lo que deja la mancha negra redonda entre él y sus vecinos.
    - los **apagados** lo empujan **hacia arriba**: muesca de `1,45 r`, un poco más grande que la altura del ruedo, así el color apenas se despega del botón —`0,25 r` de profundidad, suave y ancha, como si el botón hubiera abollado el panel—. Nunca un hueco grande: la muesca gigante (la gota espejada) se probó y no va.
  - **Ni la gota ni la muesca tienen esquinas**: el ruedo recto y la circunferencia del botón se juntan como se juntan dos gotas de líquido, con un **cuello** —una circunferencia tangente al ruedo por un lado y a la del botón por afuera— calculado, no dibujado a mano. Mide `0,27 r` y se achica solo si el botón de al lado está demasiado cerca (hasta el 90 % de la mitad del hueco), con un mínimo de `0,1 r`. Cada tramo sale del anterior por la misma tangente.
  - Lo que ya se probó y no va: la onda que pasaba por todos los botones (cresta `1,34 r`, valle `0,90 r`), que se lee como montañas; la muesca hecha como espejo exacto de la gota, que abre un hueco enorme en el panel; collar pegado al botón (`1,06 r`), que lo deja sin marca porque la imagen del botón encendido tiene aro propio (en el dibujo no se nota: ahí el botón es del color del goo y los dos son una sola mancha); un cuello hecho con dos curvas sueltas, que deja **púas** y **esquinas**; y levantar el ruedo al lado del encendido, que engorda la mancha negra pero aplana todo lo demás.
- Las dos abolladuras son **seis curvas** cada una (ruedo, cuello, dos de la circunferencia del botón, cuello, ruedo), así que la silueta tiene siempre 28: por eso GSAP transforma una en la otra al cambiar de modo y la transición sigue siendo orgánica.

### 4.48 Candado de PLUS `ga-plus-lock` (Seba, 2026-11-19)
- **Lo que es de PLUS se marca con un candado y nada más** (Seba): no hay carteles ni campos atenuados. `components/ga/PlusLock.tsx` + `plus-lock.css`; medidas `--ga-plus-lock-*` en `templates/base.css` (las mismas del candado de la navegación) y el **dorado del plan** en el sabor.
- Es **una marca, no un botón**, así vive dentro de otro control sin anidar botones. El cursor encima abre un globo que dice que eso es parte de PLUS (el texto puede ser propio de cada caso; si no, «Disponible en PLUS»). El globo se abre hacia la izquierda del candado, para no salirse de una columna angosta, y también aparece cuando el control que lo lleva toma el foco con el teclado.
- **Un clic en el control que lo lleva va a la suscripción**, igual que el menú principal de navegación: `openPlusScreen()` (el mismo `OPEN_PREMIUM_EVENT` del botón PLUS del marco). El control bloqueado **no abre su contenido**.
- Ya lo saben hacer las dos plantillas generales: una pestaña (`GaTab` con `locked`) y una sección del acordeón (`GaAccordionItem` con `locked`) muestran el candado en lugar de su marca y llevan a la suscripción. Ejemplo: **Personalización** en el detalle del Manager y en el diálogo de opciones del juego.

### 4.49 Manager › Juegos como lista con detalle (Seba, 2026-11-19)
- **Dos columnas** (`lm-split`, `library-manager/list-detail.css`): el detalle del juego a la izquierda, ancho `--ga-lm-detail-w` (un cuarto del espacio, entre 320 y 440 px), y la lista a la derecha con el ancho que sobra; la pantalla ya no está limitada a 1100 px. Bajo 900 px de contenido, el detalle pasa arriba de la lista. El detalle queda fijo (`sticky`) mientras la lista se desplaza.
- **La tapa se muestra entera sola** (Seba, 2026-11-19): como está recortada, hace un **paneo lento** de arriba abajo y vuelve (`--ga-lm-cover-pan-time`, 22 s, `object-position` animada). Con el cursor encima el paneo se detiene, la imagen se acerca apenas (`--ga-lm-cover-lift`) y una **luz inclinada la cruza una vez** (`--ga-lm-cover-sheen`). Todo por código, sin recortes ni imágenes extra; con la pestaña oculta el navegador no anima nada. Un velo abajo (`--ga-lm-cover-veil`) separa la tapa del nombre.
- **El detalle** (`GameDetail.tsx`): la portada **a todo el ancho del detalle**, pegada a sus bordes y recortada hasta `--ga-lm-cover-max-h` (como un héroe, no como una estampilla), el nombre debajo, qué le falta si tiene problemas, y después sus propiedades como **secciones que se abren de a una** (§4.50): **Idioma** y **Ejecución** (BASE), **Personalización** (PLUS, con el candado §4.48) y el **registro** del juego. Son los mismos campos del diálogo de opciones (`DigitalGameOptions` con `layout="panel"`), no una copia.
- **No repite nada de la grilla** (Seba, 2026-11-19): ni estado, ni tamaño, ni partidas, ni días sin jugar, ni carpeta. La grilla es para mirar y comparar; el detalle es para **editar las propiedades del juego, ver su imagen y leer su historial**. Por eso tampoco están ya en el menú de la fila «Opciones» ni «Ficha del juego»: se editan acá, a la vista, en vez de abrir un overlay.
- **El Manager es una pestaña de Librería**, al mismo nivel que Cuentas y Espacio (`DownloadCatalogPanel`): se dibuja `embedded`, sin cabecera ni botón de volver propios. La vista previa `?libraryDemo=1` también lo dibuja así.
- Muestra **la última fila elegida**. Con varias filas marcadas, una línea arriba dice cuántas y abajo sigue la última, así siempre se lee un juego. Esa fila va marcada en la lista (`is-picked`: fondo cálido y un filo naranja a la izquierda).
- **Reemplaza la fila que se desplegaba** (§4.20b): el registro vive en el detalle y la grilla es solo una lista. Tampoco muestra la portada de cada juego: la imagen está en el detalle.
- **El criterio entre la grilla y el detalle** (Seba, 2026-11-19): lo que es **de un solo juego** —jugar, reanudar, corregirlo, verificar que corre, abrir su carpeta, cambiarle el nombre, desinstalarlo, moverlo a la carpeta de juegos, quitarlo de la biblioteca— se maneja **desde el detalle**, donde ese juego ya está abierto; lo que es **de grupos de juegos** —importar, corregir todo, verificar los instalados, y lo que se hace con las filas marcadas— se queda en la grilla, en su barra y en la franja de selección. Por eso la fila ya **no tiene menú ⋯ ni menú contextual**: sus acciones son botones bajo el nombre del juego en el detalle (`lm-detail-acts`), a la vista en vez de dentro de un overlay.
- **Lo que no se puede deshacer va al final** (Seba, 2026-11-19): desinstalar, borrar del disco y quitar de la biblioteca son los últimos botones del detalle, separados por una línea (`lm-detail-risky`); arriba cortaban la vista al medio. Siguen estando además en la grilla, en la franja de las filas marcadas, porque también se hacen a varios juegos a la vez. Un juego de la biblioteca sin carpeta también se elige y muestra ahí su portada, su nombre y sus dos acciones.
- **Una descarga en camino no está acá** (Seba, 2026-11-19): un juego se **descarga e instala** en el gestor de descargas y recién entonces pasa a ser parte de la librería y tiene fila acá. Una carpeta que todavía se está bajando, descomprimiendo o preparando no se lista, salvo que el jugador ya haya puesto ese juego en su librería: ahí sí se muestra —un juego nunca está en dos lugares contando dos historias distintas— y un clic en su estado lleva al gestor de descargas, que es donde se sigue ese trabajo. Acá no se muestra ningún detalle de la descarga.
- **Qué hace y qué no esta grilla**: ver los juegos, de qué cuenta o colección son, y elegir uno para trabajarlo en el detalle. **No** comprime, no descomprime y no mueve juegos de unidad: eso es Manager › Espacio, donde están los discos.
- **Filas alternadas** (Seba, 2026-11-19): una de cada dos lleva un gris apenas más claro (`--ga-row-alt`), para seguir la línea con la vista; cede ante la fila que el cursor toca, la marcada y la que el detalle muestra. La fila del detalle lleva el filo naranja **solo en su primera celda**: puesto en todas se leía como rayitas verticales entre columnas.
- **Las dos columnas miden lo mismo y se desplazan por dentro** (`--ga-lm-pane-h`): la grilla no estira la página hacia abajo, y su barra es la perilla redonda (§4.51).
- **Grupos plegables**: cada bloque (la biblioteca de Game Access y la de cada cuenta de Steam) tiene una flecha antes del nombre que lo pliega; lo plegado se recuerda en esta PC (`gameaccess:lm-folded:v1`).

### 4.50 Secciones que se abren de a una `GaAccordion` (Seba, 2026-11-19)
- `components/ga/Accordion.tsx` + `accordion.css`; medidas `--ga-accordion-*` en `templates/base.css`, colores y letras en el sabor.
- **Siempre hay exactamente una abierta**, la primera al abrirse: un clic en una cerrada la abre y cierra la que estaba; un clic en la abierta la deja abierta. Así la columna nunca queda vacía ni se convierte en un muro de campos.
- Cada encabezado es un `button` con `aria-expanded` y `aria-controls`, y su cuerpo una región con su nombre. Ícono a la izquierda, nombre, y a la derecha la V que gira.
- **Lee como los paneles de la ficha de juego** (§4.43): la misma letra de título, el mismo ámbar y el mismo tamaño de ícono (`--ga-accordion-head-font`, `--ga-accordion-head-ink-open` e `--ga-accordion-icon` salen de los tokens de la ficha), para que las dos vistas de detalle sean una sola familia.
- Es para una columna de propiedades que se leen de a un grupo (el detalle del Manager, §4.49), no para lo que hay que comparar lado a lado.

### 4.51 Barras de desplazamiento (Seba, 2026-11-19)
- **Toda la aplicación, no cada pantalla.** `components/ga/scrollbars.css` se carga una sola vez desde `main.tsx`, con el resto de la plantilla general: cualquier zona que se desplace tiene la barra de la app sin montar nada —línea finita y perilla redonda que toma el ámbar bajo el cursor— (`::-webkit-scrollbar*` y `scrollbar-color`). Antes solo se veía bien donde alguien montaba el componente, y lo demás salía con la barra gris del navegador.
- **La perilla redonda grande** (`CircularScrollbar.tsx` + `circle-scrollbar.css`) sigue siendo la de las superficies grandes de lectura (catálogo, Manager, paneles del escritorio): línea fina con un círculo con aro que crece al pasar el cursor, al arrastrarlo o mientras el contenido se desplaza. Su CSS ahora se carga también con la plantilla general, además de con el componente, así sus clases existen siempre; sus medidas son `--ga-circle-*` (base) y sus colores, del sabor.
- Donde la perilla está montada, su elemento tapa la barra nativa; donde no, se ve la general. Nada queda con la barra del navegador.

### 4.52 Los discos en la barra de estado (Seba, 2026-11-19)
- No un disco: **todos los que el jugador activó para juegos**. Cada uno es su **letra, su nombre** y lo que le queda libre («C: Sistema 3 %»; `navDiskNamedFree`, o solo la letra si Windows no le da nombre), **el que peor está primero**, y el resto se lee entero en el tooltip. Un nombre largo se corta con puntos suspensivos (`--ga-nav-status-disk-max`) para que la barra no se corra. Un clic abre Manager › Espacio.
- **Lo que importa es cuando se está quedando sin lugar**, y por eso está en la barra. La cifra va **siempre en la tinta de la barra**, como todo lo demás: el único color es un **triangulito de aviso** al lado del disco que lo necesita, ámbar bajo el 25 % libre y rojo bajo el 10 % (o si el launcher lo marcó `too_full`). Son las mismas franjas que las tarjetas de disco de Manager › Espacio (§4.38). Nada de cifras de colores: el pie con muchos colores queda feo (Seba).
- **El pie respira**: las piezas se separan con `--ga-nav-status-gap` (16 px, antes usaba la separación más apretada de la app) y hay un separador también entre «En línea» y los plugins. El tooltip del disco dice su letra, su nombre y lo que le queda libre.
- `statusBarData.ts` (`disksInUse`, `diskLevel`) y `StatusBar.tsx`; colores con los tokens de aviso y peligro. Mientras no se conocen los discos, se sigue mostrando el de la carpeta de juegos, como antes.

## 5. Reglas de uso

1. Un diálogo tiene exactamente un botón de cierre `ga-close` (overlay) o un botón `ga-back` (pantalla completa), y como mucho una acción principal naranja. Escape lo activa en ambos casos.
2. Los botones de una misma fila comparten altura (44 px fuera de la ficha; 54 px dentro de la ficha, incluidos los solo-icono).
3. Los textos salen de `t("clave")`. Nada en español o inglés fijo en el JSX.
4. Los íconos de acción llevan `aria-label` traducido; los botones solo-icono llevan `title`.
5. Los estados vacíos usan texto muted centrado, sin ilustraciones.
5b. No mostrar el mismo dato dos veces (un estado en una etiqueta y en una línea, una cifra arriba y en una pastilla). El estado normal (listo para jugar) no lleva indicador.
5c. Movimiento: GSAP desde `src/motion/gsap.ts`; ignorar la preferencia de movimiento reducido de Windows (decisión de Seba, 2026-11-18); animar `transform` y `opacity`; reglas detalladas en `.claude/skills/gameaccess-motion-ui`. **Las transiciones van por una sola cola** (`queueTransition` de `src/motion/transitions.ts`): cada una es un timeline con su propio tiempo y corren una después de la otra, nunca encimadas. Ya pasan por ella: cambio de modo, grilla ↔ Library Manager, abrir y cerrar paneles laterales y la palabra lateral.
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
- [ ] La jerarquía se ve a simple vista (§4.26): título del diálogo, texto principal, títulos de ítem más grandes y en negrita que su texto; lo que hay que leer no está en gris.
- [ ] Los espacios son los fijos de §4.26 (márgenes, entre secciones, entre tarjetas); nada pegado al borde ni al título.
- [ ] Un diálogo grande tiene el ancho de la columna central, renglones de 80 caracteres como máximo, tarjetas lado a lado del mismo alto, y el botón principal a la vista en una pantalla de 720 px de alto.
- [ ] En una pantalla ningún texto baja de 16 px (títulos de columna y pestañas, 14 px).
- [ ] Mirado de verdad (captura o vista previa) y medido, no solo compilado.
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

### Actualización de la ficha de juego (2026-11-18)

El diseño de §4.43 se actualiza con pestañas Detalles / Co-Optimus y Requisitos / Relacionados, según los datos disponibles. App ID se muestra en Detalles. La descripción contiene solo el texto largo. El botón Consultar IA abre el panel lateral con las preguntas existentes. Cuando no hay descargas ni está abierto ese panel, el arte y la información comparten el ancho. El fondo oscuro se funde por los cuatro bordes. El paralaje del arte responde al mouse e ignora la preferencia de movimiento reducido del sistema.
