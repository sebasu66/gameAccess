---
tipo: especificacion
actualizado: 2026-11-11
---
# Rediseño de navegación — especificación para implementar

> **Pedido y decisiones de Seba (2026-11-10 y 2026-11-11), trabajadas con Claude en un prototipo navegable.**
> Esta nota manda sobre lo que la contradiga en `docs/GUI_DESIGN.md` §0b y §4.33 y en `docs/TAREA-pantallas-y-modos.md` (modos, marco, Home). Las tareas están en [[Tareas]] (sección «Rediseño de navegación», RN1–RN14). Cada paso hecho va a [[Log]]; las dudas, a [[Mensajes]] (ver M010).

## 0. Antes de empezar

- **Referencia visual:** `examples/GA Arbol de Navegacion/index.html` (abrir en Chrome o Edge con doble clic; GSAP y las fuentes vienen de CDN, así que necesita internet). Todo lo que dice esta nota se puede ver ahí. **Es un prototipo, no código para copiar**: un solo HTML con datos de ejemplo. Se rehace en React con las plantillas de la app.
- **Reglas que no cambian** (`AGENTS.md`, `docs/GUI_DESIGN.md`):
  - Tres capas de estilo (§0c): `templates/base.css` (estructura), un sabor por estilo en `templates/flavor-*.css` (aspecto), y el CSS de cada pantalla solo con distribución. Nada de color, fuente, radio, margen ni alto escrito a mano. `npm run check:css` y `templates/flavor.test.ts` tienen que pasar.
  - Primero los componentes generales de `components/ga` (`GaButton`, `ga-group`, `ga-label`, `ga-hint`, `ga-status`, `ga-heading`…), después lo de cada pantalla.
  - Textos con `t("clave")`, en `es` y `en`. Nada fijo en el JSX.
  - Movimiento con GSAP desde `src/motion/gsap.ts`, por la cola `queueTransition` (`src/motion/transitions.ts`), solo `transform`, `opacity` y `clip-path`, y respetando «reducir movimiento». Skill: `.claude/skills/gameaccess-motion-ui`.
  - Shadow DOM: estilos con hojas construidas (`adoptedStyleSheets`), por la CSP. Probar siempre en la **app compilada**, no solo en Vite.
  - Un paso verificado = un commit con push a `dev`. Compilar no es aceptación: mirar la pantalla y medirla.
- **Términos internos fuera de la interfaz:** «nivel 1/2/3», «columna 1/2», «panel 3», «componente», «bloom», «chaflán» son palabras de esta nota. En pantalla se dice «barra de modos», «panel de secciones», «contenido», «resplandor», «esquinas» (ver §5.13).

## 1. Distribución de la pantalla

De izquierda a derecha, a todo el alto, con un margen alrededor y una barra de estado abajo a todo el ancho:

| Zona | Qué es | Ancho |
|---|---|---|
| **Barra de modos** (hoy `ModeRail`) | Arriba, la palabra del modo actual en vertical y en su color. Abajo, los otros tres modos como franjas diagonales con su ícono. | fijo (`--ga-mode-rail-w`, 120 px en el prototipo) |
| **Panel de secciones** | El título de la sección elegida, sus submodos y debajo las demás secciones del modo. Imagen de fondo propia de cada modo. | fijo (392 px) |
| **Contenido** | Lo que se muestra de la sección. **Es la única zona que crece** con la ventana. | el resto |
| **Actividad** (hoy «Procesos y descargas», `ga-side-panel`) | Arriba, el bloque de marca. Debajo, lo que está en curso y el historial. | fijo (264 px) |
| **Barra de estado** | Servidor, plugin, disco, descargas, catálogo al día, versión y novedades. | todo el ancho, 30 px |

**Pantallas anchas (Seba, 2026-11-11):** no hay proporción fija ni franjas vacías a los costados. La escala sale del lado corto de la ventana y el contenido se estira. En un monitor ultra ancho (por ejemplo 2560 × 1080 o 3440 × 1440), el contenido aprovecha el ancho: ver §4.3 (varias pestañas a la vez) y §5.8 (ficha).

**No duplicar información (Seba):** el modo se nombra una sola vez (la palabra de la barra de modos); la sección, una sola vez (su título en el panel de secciones, que se extiende sobre el contenido). El contenido no repite título ni migas de pan.

## 2. Árbol de navegación

Se elige de izquierda a derecha: modo → sección → submodo (si tiene) → contenido. Orden fijo de los modos: Catálogo, Librería, Game Access, Configuración.

| Modo | Secciones | Submodos (pestañas) |
|---|---|---|
| **Catálogo** — descubrir juegos | Explorar (buscador y filtros) · Búsqueda smart (IA, en tus palabras) · Sugerencias IA · Juegos nuevos · Perfil de gustos | Juegos nuevos: En el catálogo / Listos para descargar |
| **Librería** — jugar y administrar | Jugar (solo instalados) · Descargas · Manager (todos, instalados o no) | Jugar: Última partida / Por género (mazos, §5.9) / Favoritos / A–Z · Descargas: En curso / En cola / Completas · Manager: Juegos / Espacio / Congelar / Mover / Importar |
| **Game Access** — el proyecto (reemplaza a Home; no tiene juegos) | Novedades · Cómo se usa · Mi cuenta · Suscripción · Ayuda y contacto | Novedades: Última versión / Anuncios · Ayuda: Preguntas frecuentes / Escribinos |
| **Configuración** | General · Apariencia · Plugins · Control parental | General: Juegos y descargas / Steam / Inteligencia artificial / Opciones (idioma, inicio con Windows, avisos, actualización, registro) · Apariencia: General / Estilo / Detalles · Control parental: Juegos / Tiempo / Filtro |

Qué cambia respecto de hoy: Home pasa a ser el modo **Game Access**; el Library Manager pasa a **Librería › Manager**; Descargas entra a **Librería**; Niños en casa pasa a **Configuración › Control parental** (deja de ser un modo). «General» agrupa lo que no es apariencia, plugins ni control parental, para que nada quede sin lugar; su última pestaña se llama «Opciones» para no repetir «General» (Seba, 2026-11-11). Hay que actualizar `GUI_DESIGN.md` §0b y §4.33 con esto (RN14).

## 3. Colores de los modos

Son de la app, **no cambian con el estilo**. `rc` es el color de la franja y de la barra; `acc`, el de acento (textos, bordes, brillo) dentro de ese modo.

| Modo | rc | acc | Franja de la imagen |
|---|---|---|---|
| Catálogo | `#e8661c` | `#ff7a2e` | 2 (naranja) |
| Librería | `#dc9a17` | `#f2b33d` | 1 (ámbar) |
| Game Access | `#c4472d` | `#ff8466` | 3 (rojo) |
| Configuración | `#2f7fb8` | `#7cc4ff` | 4 (azul) |

Estados: correcto `#6fcfb0`, error `#ff5d4d`. El color del modo activo se publica como variable (`--ga-mode`, `--ga-mode-acc`) y el contenido lo usa con un resplandor suave de fondo (§4.3).

## 4. Piezas de la pantalla

### 4.1 Barra de modos
- **Arriba:** solo la palabra del modo actual, en vertical, ajustada al alto disponible. Nada más.
- **Abajo:** los otros tres modos como franjas diagonales del color sólido de cada uno, con un ícono blanco grande. **Posiciones fijas** (no se reordenan al cambiar), brillo al pasar el mouse. Insignia con número si hay novedades.
- **Íconos fijos** (Seba, 2026-11-11): catálogo (grilla de apps), librería (mando), Game Access (casa), configuración (engranaje). No cambian con el estilo, para que siempre se entienda qué es cada uno.
- **Lo que sí cambia con el estilo:** el relleno de los íconos (plano, cristal, neón, duotono) y un gráfico 2D en SVG sobre el color del modo (papel, franjas de peligro, circuito, líneas de velocidad, damero, puntos). **No imitar materiales con CSS** (metal, carbono): Seba lo descartó, no queda bien.
- Al cambiar de modo: las letras de la palabra entran escalonadas y las franjas entran desde la izquierda. La imagen del panel de secciones hace un barrido y cambia.

### 4.2 Panel de secciones
- **Fondo:** una imagen por modo (§6), con el motivo abajo y la parte de arriba más libre. Esquina inferior derecha cortada en diagonal y tres franjas diagonales que terminan en ese corte, como las de la barra de modos.
- **Título (la sección elegida):** sale de la lista y queda arriba, más grande, como una flecha que se extiende sobre el contenido (unos 190 px dentro del contenido, no más: deja lugar al buscador). Nombre grande, descripción corta debajo, y en la punta tres chevrones siempre encendidos. Fondo con el color del modo en degradé.
- **Submodos:** si la sección tiene pestañas, van debajo del título, dentro del panel (no en el contenido).
- **Botones de las otras secciones:**
  - Forma de flecha con la punta a 45°, borde fino blanco al 22 %, ícono descriptivo en un círculo de línea a la izquierda, nombre y descripción.
  - Escalonados: cada uno un poco más corto que el anterior (8 px).
  - Al pasar el mouse: el borde, el ícono y una barra a la izquierda toman el color del modo, y **tres chevrones salen de la punta hacia la derecha** (el botón se extiende; no come espacio del texto). Los demás botones se oscurecen.
  - Íconos de sección que no repiten los de los modos: Jugar = play, Descargas = flecha hacia abajo sobre una línea, Manager = tabla con renglones (no la grilla del catálogo).
  - Sin número ni rombo (Seba los descartó).
- **Espacio:** el mismo aire (12 px) entre el título, los submodos y el primer botón, y entre botón y botón. Sin submodos, no se suma margen.
- **Textos que no entran:** se achican solos hasta un mínimo; nunca se salen ni se cortan sin necesidad (vale para todo estilo y toda fuente, también después de que cargan las fuentes).
- **Cambio de sección (una sola secuencia, en este orden):**
  1. Los submodos de la sección activa se pliegan hacia arriba, de abajo a arriba, sobre su título.
  2. Se van los chevrones del título, después su descripción y su nombre, y la flecha se cierra hacia la izquierda. **Es la entrada al revés, con la misma duración.** Al mismo tiempo, el botón elegido se desliza hacia la izquierda, como metiéndose bajo la barra de modos.
  3. Intercambio: la sección anterior vuelve a salir desde la izquierda **en el lugar que dejó la elegida**; la elegida aparece arriba, ya grande, extendiéndose de izquierda a derecha; después entran el nombre, la descripción y los chevrones.
  4. Se despliegan los submodos de la nueva sección, uno por uno.
  - El orden de la lista queda como quedó tras el intercambio.
  - Ojo al animar la forma de la flecha: si la forma viene del CSS con `calc()`, GSAP no la interpola y salta. Fijarla en píxeles (los mismos números en abierto y cerrado) antes de animar. Ninguna transición CSS sobre lo que anima GSAP.

### 4.3 Contenido
- **Cabecera:** a la derecha de la flecha del título queda un hueco. Ahí va **el buscador** si la sección busca (Explorar, Juegos nuevos, Jugar, Manager, Ayuda y toda Configuración; filtra en vivo lo que hay en pantalla; Ctrl+F), o si no **un resumen** de dos o tres datos (por ejemplo Descargas: en curso, en cola, velocidad). Arriba a la derecha, una imagen recortada en paralelogramo: la del modo o, en Descargas, la del juego que baja.
- **Fondo:** el color del modo como un resplandor suave (`--ga-mode-glow`), solo en el contenido.
- **Varias pestañas a la vez:** si el ancho del contenido alcanza, las pestañas de una sección se muestran juntas, cada una en su columna con su título. **Las pestañas aparecen solo si hace falta**: si entran todas, no se muestran; si entran algunas, quedan marcadas las visibles y al elegir otra la ventana se corre. Se recalcula al cambiar el tamaño. Ancho mínimo por columna: Manager 660, Apariencia 620, Control parental 560, General 560, Ayuda 520. No aplica a Jugar, Juegos nuevos ni Novedades (sus pestañas son formas de ver lo mismo).
- **Margen antes de una fila de botones: 24 px como mínimo** (regla global de Seba). Relleno de tarjetas 20–22 px.

### 4.4 Actividad y bloque de marca
- **Bloque de marca** arriba a la derecha: logo, «GAME ACCESS» y la insignia del plan. BASE sobria; **PLUS con borde dorado y un brillo sutil animado** que recorre el borde y el texto.
- **Actividad:** «En curso» (descargas, congelados con su barra) e historial (agrupado: «Descargas (3)», «Catálogo (2)»…). Un clic lleva a su lugar.

### 4.5 Barra de estado
Servidor (luz verde, o roja sin conexión) · plugin (gris si no hay) · disco libre · descargas (cantidad, velocidad y un medidor de barritas en el color del modo) · «Catálogo al día · hora» · versión · campanita con las novedades sin leer. Cada parte lleva a su lugar. Sin datos de hardware ni migas de pan.

### 4.6 Placas y avisos
- **Placa de humo** (ya existe `smokeStage` / `GaSmoke`, §4.34): solo para lo importante o lo que bloquea (antes de jugar, confirmar cancelar, activar PLUS, la ficha del juego). **No se apilan**: la nueva empuja a la anterior hacia arriba.
- **Avisos menores:** `GaNotice`, chico, abajo a la derecha, se cierra solo.

## 5. Pantallas

### 5.8 Ficha del juego (placa de humo a pantalla ancha)
Fuente de datos: la ficha actual (`LibraryDetailPanel.tsx`: `SteamFacts`, `RatingBar`, `ExtendedDetails`, `DetailPlayModes`, `DesktopDetailMedia`, `AiReasonPanel`, `CooptimusDetails`, fuentes del plugin). Se rehace la presentación, no los datos.
- **Se abre como placa**, con el mismo método que las otras: humo detrás; si se toca Jugar, la placa «Abriendo…» la empuja.
- **Bordes que se funden:** sin rectángulo ni línea. Un humo oscuro en el centro que se desvanece hacia los bordes, más una máscara de degradé (unos 120 px a los lados, 90 px arriba y abajo).
- **Encabezado:**
  - El arte grande del juego detrás (`library_hero`).
  - Nombre muy grande en una línea (se achica si no entra), géneros, lanzamiento, tamaño y plataformas.
  - Chips de modos de juego con ícono.
  - Arriba a la derecha: actualizar datos de Steam y «Cerrar · Esc».
- **Parallax:** con el mouse, la imagen va al revés del puntero, y el título y la fila de datos van con él a distinta profundidad.
- **Entrada por partes:** la placa sube, la imagen se acerca, el título sube, entran datos y modos, las acciones, las pestañas y la columna derecha, y al final se llena la valoración.
- **Izquierda, pestañas en vertical** (forma de flecha, como los botones de sección). Solo se muestran las que tienen datos:
  - Resumen (abre primero, sin esperar nada).
  - Descripción.
  - Más información (los 12 datos, en dos columnas).
  - Requisitos.
  - Fuentes de descarga: solo con plugin y si no está instalado; la mejor resaltada.
  - Cooperativo (Co-Optimus): solo si tiene.
- **Cada pestaña carga por su cuenta**: muestra un círculo girando mientras espera, bloques de relleno si se abre antes de tiempo, y desaparece si su fuente responde que no hay datos. No hacer esperar a toda la ficha.
- **Derecha, una columna** pegada abajo, del alto de su contenido:
  1. **Valoración siempre visible**, sobre vidrio semitransparente (no tapa la imagen):
     - Un anillo que se llena hasta el porcentaje mientras el número cuenta desde 0, en verde, ámbar o rojo.
     - La calificación de Steam («Mayormente positivas» para 70 %).
     - Barras de positivas contra negativas, los últimos 30 días, un histograma de 12 meses, recomendaciones y Metacritic.
     - Carga por su cuenta.
  2. **Tráiler y capturas** con miniaturas, pausa, sonido, volumen y maximizar (Flip; Esc lo devuelve).
  3. **Botones abajo a la derecha**: Jugar, Descargar o Instalar con Steam, la tienda de Steam y 👍 / 👎.
- El ancho de la columna derecha crece con la pantalla (600–760 px) y se ajusta para no tapar los botones de arriba.

### 5.9 Librería › Jugar › Por género (mazos)
- Grilla de celdas, **un mazo por género**: cuatro cartas apiladas en abanico chico con el primer juego adelante, y «+N» si hay más.
- **Hover:** el mazo se abre un poco y se ven los cuatro juegos, con un resplandor debajo en el color del modo.
- **Clic:** el mazo pasa a ocupar toda la fila y sus cartas se reparten a lo ancho, una tras otra, con el nombre debajo. Los demás mazos se deslizan a su lugar nuevo, más abajo (Flip). Abrir otro cierra el anterior.
- En el mazo abierto, cada carta se levanta al pasar el mouse; clic abre la ficha. Se cierra con «✕ Cerrar» o Esc. Teclado: Tab llega al mazo, Enter lo abre.
- Decisión pendiente: el hueco que queda al lado del mazo de la izquierda de una fila (ver [[Mensajes]] M010).

### 5.10 Librería › Descargas (asistente de cinco etapas)
- La descarga no es solo bajar: son cinco etapas, cada una con sus pasos, sus datos, sus acciones y su registro. Base en `downloadStepModel.ts` (route, probe, server, download, extract, install).
  - **Preparar** — encontrar de dónde y cómo bajarlo: buscar la ruta más rápida, medir el torrent, preparar en el servidor.
  - **Descargar** — reservar espacio, transferir, verificar. Datos: velocidad, falta, pico. Acciones: Pausar, Cancelar.
  - **Instalar** — verificar espacio, descomprimir, mover a la carpeta del juego.
  - **Configurar** — aplicar el fix, instalar librerías que faltan, elegir el ejecutable, excluir del antivirus.
  - **Listo** — marcar la carpeta como lista, agregar a la Librería.
- **Pasos arriba** como botones de flecha: hecho en verde, el actual en el color del modo, **falló en rojo** con ✕, pendiente en gris. Aire suficiente entre el nombre y el estado. Se puede mirar cualquier etapa.
- **Registro:** chico y discreto, como una terminal del sistema.
  - Borde blanco sutil, letra de 11 px.
  - Hora compacta (`12:09:50`) y nivel en tres letras con color: `INF` azul, `OK` verde, `WRN` ámbar, `ERR` rojo.
  - Lo más nuevo arriba, con un cursor que titila, y las líneas viejas apagándose.
  - **Muestra el log real de acciones**, con los niveles que defina el launcher.
- Si una etapa falla: la etapa en rojo, el paso que falló, el error en el registro y las acciones Reintentar / Cambiar de fuente / Cancelar.

### 5.11 Librería › Manager
Juegos (tabla actual `lm-grid`), Espacio, Congelar, Mover, Importar. En pantalla ancha, varias a la vez (§4.3).

### 5.12 Game Access › Suscripción
- **Dos tarjetas de acceso flotando** (vaivén suave, sombra que se achica, se inclinan en 3D siguiendo el mouse).
  - **BASE:** acero mate, «GRATIS», chip plateado.
  - **PLUS:** más grande y claramente más elaborada: marco de oro con brillo que lo recorre, un destello que cruza cada pocos segundos, holograma iridiscente, chip de oro, «ACCESO TOTAL». Etiqueta «TU PLAN» en la del plan actual.
- **Debajo de cada tarjeta, el texto del plan:** nivel y nombre, una línea de para quién es, la lista de funciones, y un pie con el estado y los botones. En BASE, también «No incluye».
- **BASE incluye:**
  - Catálogo con búsqueda enriquecida.
  - Gestor automático de varias cuentas de Steam.
  - Administrador de descargas inteligente (descarga, instala y configura solo).
  - Una descarga a la vez con código de descarga.
  - Estilo configurable.
  - Librería y catálogo simples de manejar.
  - Importador de apps de terceros (Roblox, Minecraft…), todo en un lugar, categorizado, filtrado y administrado.
- **PLUS** dice «Todo lo de BASE, más:»
  - Control parental con límite de tiempo por día.
  - Búsqueda asistida por IA.
  - Sugerencias según perfil, juegos e historial.
  - Aceleración de torrents integrada: hasta 4 en paralelo y 30 descargas aceleradas por mes.
  - Gestor inteligente de la librería.
  - Congelado automático de juegos en desuso.
  - Conector MCP para tu propia IA: ve tu librería e historial, descarga por voz, etc.
- **Sin precios en la app:** solo el enlace a `https://gameaccess.site/plus`.

### 5.13 Configuración › Apariencia (editor de estilos)
Es el editor de las tres capas, con nombres que entiende el usuario:

| Pestaña | Capa | Controles |
|---|---|---|
| **General** | base | unidad de espacio, aire antes de una fila de botones, relleno de tarjetas, tamaño del texto, tamaño del título de sección |
| **Estilo** | sabor | Estilo 1–4; colores de estado (los de los modos se muestran pero son fijos); imagen del panel de secciones; letras de títulos, texto, barra de modos; títulos en mayúsculas o no; esquinas cortadas, redondeo, punta de los botones de sección, esquinas de los paneles; relleno de botones (sólido o contorno); gráfico de la barra de modos; relleno de los íconos; brillo, grano, líneas de barrido; color de las imágenes de fondo; tinte del contenido; duración de las transiciones |
| **Detalles** | pantalla/componentes | barra de modos (ancho, alto e inclinación de las franjas), panel de secciones (corte, opacidad, tinte y desenfoque de la imagen), resplandor del contenido, botón (alto y forma, con vista previa), pasos del asistente, registro (tamaño y borde), entrada del título |

- **Estilos sin nombre propio** (Seba): «Estilo 1», «Estilo 2», «Estilo 3», «Estilo 4». Como el usuario los puede editar, un nombre fijo no tiene sentido.
- **Imagen propia por estilo:** botón «Elegir imagen…». La explicación al lado del botón:
  - Imagen apaisada de **1672 × 941 px (16:9)**.
  - Se corta en **4 franjas verticales iguales** de unos 418 × 941 px, de izquierda a derecha: **Librería, Catálogo, Game Access, Configuración**.
  - El motivo va en la mitad de abajo; el tercio de arriba lo tapa el título.
  - Si trae líneas de separación entre franjas, se recortan unos píxeles de cada borde.
  - De la misma imagen salen el arte y las capturas de ejemplo.
  - Se avisa si no es 16:9.
  - El usuario la administra; la app no la valida más que eso.
- «Volver a los valores de fábrica» por pestaña; guardar, exportar e importar tema (archivo `.gatheme`).

### 5.14 Atajos con Ctrl
- **Mantener Ctrl** (más de ~280 ms, para no molestar en Ctrl+C / Ctrl+V): aparece una tecla sobre cada control visible y, en los que no tienen texto (íconos), su nombre al lado. Soltar Ctrl o hacer clic lo esconde.
- **Ctrl + tecla** hace lo mismo que el clic. Teclas fijas:
  - **1–4:** los modos.
  - **F:** el buscador. K sigue abriendo el buscador.
  - **5–0:** las secciones.
- El resto lleva letras, en este orden: submodos, contenido, Actividad y barra de estado. Con una placa abierta, solo sus botones.
- No usar W, T, N ni Q en el navegador. En la app de escritorio sí se pueden, si Tauri las deja tomar.
- En un campo de texto, Ctrl+A/C/V/X/Z/Y siguen siendo del texto.

## 6. Estilos 1–4 y assets

- **Fuentes condensadas**, del ancho de Bebas, para que el contenido quepa: Bebas Neue (1), Teko (2), Saira Condensed (3), Barlow Condensed en cursiva (4). Texto: Manrope.
- **Empaquetar las fuentes en la app** (la CSP y el uso sin internet no permiten Google Fonts por CDN).

| | Estilo 1 | Estilo 2 | Estilo 3 | Estilo 4 |
|---|---|---|---|---|
| Imagen | cómic | shooter competitivo | consola abstracta | carreras y mecánica |
| Títulos y barra | Bebas Neue, mayúsc. | Teko, mayúsc. | Saira Condensed, normal | Barlow Condensed cursiva, mayúsc. |
| Gráfico de la barra | papel (grano) | franjas de peligro + marco | circuito | líneas de velocidad + banda a cuadros |
| Relleno de íconos | plano | duotono | cristal | neón |
| Botones | corte, sólidos | corte, sólidos | rectos redondeados (14 px), contorno | flecha, sólidos |
| Punta / esquinas | 44 / 26 px | 30 / 16 px | 0 / 0 | 50 / 30 px |
| Brillo · barrido · grano | .5 · sí · .28 | .3 · no · 0 | .7 · no · 0 | .6 · no · 0 |
| Transiciones | 0,6 s | 0,35 s | 0,55 s | 0,3 s |

**Assets** (en `examples/GA Arbol de Navegacion/assets/`; moverlos a `apps/desktop/public/styles/estilo-N/` con estos nombres):
- `panel-0..3.jpg`: las cuatro franjas del panel de secciones, en el orden Librería, Catálogo, Game Access, Configuración. El estilo 1 está en la raíz de `assets/`; los demás, en `tactico/`, `consola/` y `carreras/`.
- `hero-wide.jpg` y `shot-0..3.jpg`: arte y capturas **de ejemplo** de la ficha. En la app real son las del juego.
- `logo.png`: copia de `apps/desktop/public/brand/app-icon.png`.
- `carreras/brushed.jpg`: **no usar**; era la textura de metal descartada.
- Originales de Seba sin recortar: los mandó por chat. Pedírselos si hacen falta en mayor resolución.

## 7. Lo que es de ejemplo en el prototipo (no copiar)

- **Datos de juegos:** valoraciones, reseñas, tamaños, requisitos, histograma mensual, últimos 30 días y fuentes de descarga son inventados. Los datos de ocho juegos (desarrollador, editor, fecha) se cargaron de memoria, sin verificar.
- **Simulaciones:** las demoras de carga de cada pestaña y el tráiler (es una barra sobre la captura).
- **Portadas:** se generan por código.
- **Avisos:** «Guardar / exportar tema» solo muestran un aviso.

## 8. Orden de trabajo

Ver [[Tareas]] RN1–RN14. Cada paso deja la app funcionando, con commit y push a `dev`, mirado en la app compilada y con captura en el [[Log]].
