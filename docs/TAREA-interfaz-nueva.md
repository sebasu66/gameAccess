# TAREA — Interfaz nueva (estilo de la demo GSAP)

Pedido de Seba (2026-10-23). Este documento es la guía completa para pasar a la app real (`apps/desktop`) el diseño que se armó y aprobó en una demo HTML. Está escrito para que lo pueda seguir alguien que no participó de las conversaciones: leelo entero antes de tocar código.

- **Demo (la referencia visual y de comportamiento):** `docs/design/gameaccess-gsap-demo-2026-10-23/index.html`.
- **Skill que acompaña esta tarea:** `.claude/skills/gameaccess-motion-ui` (reglas cortas para cada cambio).
- **Sistema de diseño:** `docs/GUI_DESIGN.md` (la tarea T0 lo actualiza con lo nuevo; después manda ese documento).
- **Seguimiento:** cada tarea de abajo está también en `vault/Tareas.md`, sección "Interfaz nueva". Tildala ahí y registrá el commit en `vault/Log.md` al terminarla.

---

## 1. Cómo ver la demo

La demo es un solo archivo HTML que carga GSAP desde cdnjs y las portadas desde Steam (necesita internet).

1. Desde la raíz del repo, levantá un servidor estático:
   `apps/api/.venv/Scripts/python.exe -m http.server 8791 --bind 127.0.0.1 --directory docs/design/gameaccess-gsap-demo-2026-10-23`
   (también está como configuración `gsap-demo` en `.claude/launch.json`).
2. Abrí `http://localhost:8791/`. Si ves algo viejo, agregá `?v=` con cualquier número para saltear la caché.
3. Para ver los **paneles laterales** abrí la demo en un navegador de **1800 px o más** de ancho (maximizado en un monitor grande). En ventanas más chicas se ve el modo "una pantalla por vez".

Qué probar en la demo (y qué tiene que pasar en la app al final):

| Probar | Qué tiene que pasar |
|---|---|
| Cargar la página | La palabra gigante "CATALOGO" entra desde abajo, las portadas aparecen en cascada. |
| Pasar el mouse por una portada | Se levanta un poco, borde naranja, el fondo de la página toma los colores del juego. |
| Clic en una portada | La tarjeta crece hasta ser la ficha y empuja a las demás hacia afuera. |
| Cerrar la ficha (X roja o Esc) | La ficha se repliega al tamaño de la tarjeta y la portada reaparece como una grilla de cuadraditos que se llena del centro hacia afuera. |
| Botón de vista Biblioteca (abajo, junto a la búsqueda) | Giro 3D + deslizamiento; la palabra cambia a "LIBRERIA" deslizándose. |
| Librería | Grilla "bento": instalados en vertical, sin instalar en apaisado chico de a tres, congelados profundos a la derecha con velo azul. |
| Quedarse 2 s quieto sobre una tarjeta de la librería | Aparecen tres rayitas (hamburguesa) dibujándose en la esquina; clic → la tarjeta gira y atrás aparece el menú. |
| Pie: pasar el mouse por los botones | Son cubos de vidrio sin texto; al pasar el mouse se encienden y muestran su nombre. |
| Pie: Administrador / Descargas / Novedades | En ventana grande abren paneles al costado; en ventana chica, uno por vez a pantalla completa. |
| Jugar (desde la ficha, el dorso de la tarjeta o un panel) | Aviso abajo a la derecha con los pasos; si sale bien, círculo que se completa en 3 s y se cierra; Hades simula un error que no se cierra solo. |

En el código de la demo cada parte tiene un comentario en castellano que explica la idea. Los nombres de funciones que se citan abajo (`renderLibrary`, `openFlipMenu`, etc.) son de la demo: buscalos ahí para ver exactamente cómo está hecho.

---

## 2. La idea (por qué es así)

1. **Menos texto en pantalla.** En la pantalla principal los comandos son íconos; el nombre aparece solo al pasar el mouse o con el foco del teclado. Dentro de un diálogo o panel, los botones sí llevan texto.
2. **Un solo aviso para todo.** Hoy hay diálogos que aparecen encima (o incluso detrás) de la ficha: al jugar, al desinstalar, al congelar, al terminar una descarga. Se reemplazan por **un único aviso** abajo a la derecha, siempre el mismo componente, que nunca queda detrás de nada.
3. **El catálogo es para descubrir.** Sin búsqueda no muestra lo que ya está instalado (eso está en la librería). Arriba muestra lo último que salió en Steam.
4. **La librería muestra de un vistazo qué se puede jugar ya.** Lo instalado es grande (vertical), lo pendiente es chico (apaisado), lo archivado (congelado profundo) queda agrupado a un costado con un velo azul.
5. **Las pantallas secundarias acompañan, no tapan.** En monitores grandes, Descargas, Administrador de biblioteca y Novedades son paneles al costado (un cuarto de ancho). Cuando no tienen el foco se ponen en gris y giran levemente hacia el centro ("pantallas envolventes") para no hacer ruido. En ventanas chicas se abren de a uno a pantalla completa.
6. **Movimiento con intención.** Las animaciones explican qué pasó (algo se va, algo llega, algo se transforma). Nunca muestran una imagen agrandada o deformada, y se apagan si el sistema pide "reducir movimiento".
7. **Siempre los mismos componentes.** Un solo botón de cerrar, un solo botón principal, los mismos títulos, márgenes y fuentes en todas las pantallas.

---

## 3. Reglas para todas las tareas (obligatorias)

- **Rama `dev`, un commit por tarea** (o por subtarea si es grande), cada uno probado. Antes de empezar: `git status` limpio y `git pull --ff-only`. Así cualquier tarea se puede revertir sola.
- **Leé antes:** `AGENTS.md`, `docs/EXECUTION_PROTOCOL.md`, `docs/GUI_DESIGN.md` y la skill `.claude/skills/gameaccess-gui-design`.
- **Traducciones:** ningún texto fijo en JSX ni en `aria-label`/`title`. Todo sale de `t("clave")` con la clave en `src/locales/es.ts` **y** `src/locales/en.ts`. Correr `npm run check:i18n` (no puede subir el número de pendientes).
- **La palabra gigante del costado va sin tilde:** `CATALOGO` / `LIBRERIA` en castellano, `CATALOG` / `LIBRARY` en inglés (claves nuevas, en mayúsculas sin acentos).
- **Pruebas en cada tarea:** `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `npm run check:i18n`. Si cambiás algo que tiene test, actualizá el test; si agregás lógica nueva (por ejemplo el armado de la grilla bento), agregale test.
- **Verlo funcionando:** `npm run dev` y abrir `http://127.0.0.1:38148/` (sin Tauri muchas pantallas quedan vacías; el administrador tiene modo demo con `?libraryDemo=1`). Probá en castellano e inglés y en ventanas de 1024, 1440 y 1920 px de ancho. Un build no es una prueba visual.
- **CSP de Tauri** (`src-tauri/tauri.conf.json`): no se pueden cargar scripts ni fuentes de internet. GSAP va por npm. Las fuentes nuevas van como archivos en `public/fonts/` con su licencia (`*-OFL.txt`) y `@font-face`, como Bebas Neue y Manrope. Las imágenes de Steam sí están permitidas.
- **Sin colores nuevos sueltos:** si hace falta uno, se agrega primero a la tabla de tokens de `docs/GUI_DESIGN.md` (lo hace T0).
- **Foco por teclado:** Tab recorre todos los botones visibles (ver `GUI_DESIGN.md` §4.13). Todo lo que aparece al pasar el mouse tiene que aparecer también con el foco del teclado (`:focus-visible` / `focusin`).
- **Movimiento reducido:** toda animación GSAP se registra dentro de `gsap.matchMedia()` o consulta la preferencia (ver T1). Con "reducir movimiento" los cambios ocurren al instante, sin errores.
- **No romper los otros modos:** la app tiene modo pantalla grande con mando (`BigScreenControls`, `LibraryInputController`) y superficies `tablet`/`display` (`auxiliarySurface` en `main.tsx`). Lo nuevo no puede romper la navegación con flechas ni el mando.
- **Registrar:** al cerrar cada tarea, tildarla en `vault/Tareas.md`, una línea en `vault/Log.md` con el commit, y leer `vault/Mensajes.md`.

---

## 4. Valores de diseño (tomados de la demo)

| Qué | Valor |
|---|---|
| Naranja principal | `#ff6a00` (token `--ga-orange`); texto sobre naranja `#140a02` |
| Botón principal | **naranja plano** `#ff6a00` (hover `#ff8230`), borde del mismo color, texto `#140a02`. **Sin degradado, sin volumen, sin resplandor ni brillos.** Seba va a pasar un ejemplo de "botón de vidrio" que siga pareciendo plano; hasta entonces, plano. |
| Verde "listo / instalado" | `#8fe3b0` (`--ga-success`) |
| Celeste "congelado" | `#8fd3ff` (`--ga-frost`) |
| Rojo peligro / cerrar | `#e5202e` (`--ga-danger`), botón de peligro `#c8321f` |
| Fondo / panel | `#111416` / `rgba(21,25,29,.94)` con `backdrop-filter: blur(16px)` y borde degradado (`GUI_DESIGN.md` §4.6) |
| Títulos | Bebas Neue, naranja |
| Texto | Manrope |
| Palabra gigante del costado | **Archivo Black** (OFL, Google Fonts; bajarla y empaquetarla), interior pixelado (ver T6) |
| Botón cubo del pie | 38–41 px, radio 8, vidrio: `linear-gradient(180deg,#ffffff16,#ffffff05)`, borde `#ffffff1c`, brillo `inset 0 1px 0 #ffffff24`; encendido: fondo naranja translúcido, borde `#ff8a38`, resplandor `0 0 18px #ff6a0055` |
| Marca "instalado" | círculo de 28 px arriba a la izquierda con ▶ verde (`.play-mark` en la demo); reemplaza la etiqueta "INSTALADO" / "LISTO" |
| Duraciones | entradas 0,5–0,7 s `expo.out`; cambios de lugar 0,6–0,75 s `expo.inOut`/`power3.inOut`; salidas 0,3 s `power2.in` |
| Ancho de ventana "grande" | `≥ 1800 px` (constante `WIDE_MIN` en la demo; dejarla en un solo lugar) |
| Paneles laterales | ancho `clamp(380px, 25vw, 560px)`; 22 % si hay paneles en los dos costados |
| Aviso único | 380 px de ancho, abajo a la derecha, 16 px sobre el pie |
| Temporizador del aviso | círculo de 30 px arriba a la derecha del aviso, se completa en **3 s** |

---

## 5. Tareas

Orden recomendado: T0 → T1 → T2 → T3 (son la base) y después el resto. Cada tarea dice qué archivos toca, qué hacer, dónde mirar en la demo y cómo saber que está terminada.

### T0 · Actualizar `docs/GUI_DESIGN.md`
- **Qué:** confirmar en la tabla de tokens `--ga-frost` y `--ga-success`. Agregar componentes nuevos en §4: aclarar que el botón principal (§4.2) es naranja plano sin resplandor, botón cubo con etiqueta que se despliega, aviso único (§4.9 reemplaza el toast actual), temporizador circular, marca de instalado `play-mark`, palabra gigante del costado, panel lateral, dorso de tarjeta.
- **Fuente de los valores:** sección 4 de este documento y el CSS de la demo.
- **Hecho cuando:** el documento describe todos los componentes que usan las tareas siguientes; no hay código cambiado todavía.

### T1 · Instalar GSAP y preparar el módulo de movimiento
- **Archivos:** `apps/desktop/package.json`, nuevo `src/motion/gsap.ts`.
- **Qué hacer:**
  1. `npm install gsap @gsap/react` (versión 3.13 o superior; desde 3.13 todos los plugins son gratis).
  2. En `src/motion/gsap.ts`: importar y registrar `Flip`, `SplitText` y `ScrollTrigger`; exportar `gsap`, un hook `useReducedMotion()` y una función `motionOk()` que lea `matchMedia('(prefers-reduced-motion: reduce)')`.
  3. Regla para todos los componentes: usar `useGSAP(() => { ... }, { scope: ref, dependencies: [...] })` de `@gsap/react` (limpia sola y aguanta el doble montaje de StrictMode). Nunca `useEffect` con `gsap.to` sin limpiar.
- **Hecho cuando:** compila, Vitest pasa (en jsdom GSAP funciona; si algún test se queja de `matchMedia`, mockearlo en el setup de tests).

### T2 · Botones como componentes
- **Archivos:** nuevo `src/components/ga/Buttons.tsx` (o junto a `components/ui/button.tsx` si conviene), CSS en `src/ga-design.css`.
- **Qué hacer:** crear y exportar:
  - `GaButton` con `variant: "primary" | "secondary" | "danger" | "frost"`, alto 44 px (54 px en la fila de la ficha con `size="tall"`). `primary` = naranja plano (sección 4).
  - `GaIconButton` = botón cubo del pie: solo ícono; con `label` (traducido) que se despliega al pasar el mouse o con foco; soporta `pressed` (interruptor: fondo naranja suave y rayita encendida abajo) y `badge` (numerito naranja arriba a la derecha, oculto si es 0).
  - `GaClose` (círculo rojo 38 px, ya existe la clase `ga-close`: envolverla en componente) y `GaBack` (rojo, 54 px, flecha + "Volver").
- **Reemplazar** los botones principales existentes por `GaButton variant="primary"` en un primer paso solo donde ya usan `ga-btn-primary`; el resto se migra en cada tarea.
- **Demo:** CSS "Botón principal: naranja plano", `.foot-btn`, `.ga-close`, `.ga-back`.
- **Hecho cuando:** los componentes existen, tienen un test simple (renderiza, `aria-label` traducido, `pressed`/`badge`), y al menos el diálogo de premium y Configuración usan `GaButton`.

### T3 · Aviso único (reemplaza toasts y diálogos de confirmación)
Es la tarea más importante para el uso diario.
- **Archivos:** `src/toasts.ts`, `src/Toaster.tsx`, `src/toaster.css`, `src/AppSessionOverlay.tsx` (diálogo al jugar), `src/App.tsx` (estado `session`, línea con `launchReady`), `src/DownloadCompleteDialog.tsx`, `src/FreezeDialog.tsx`, `src/DigitalGameContextMenu.tsx` (confirmación de quitar/desinstalar), `src/AppDialog.tsx`.
- **No tocar:** `src/centralDialog/` (diálogo central para tareas que bloquean la app: actualización, base del catálogo, plugin). Sigue como está.
- **Qué hacer:**
  1. Crear `src/notice/` con un store (como `toasts.ts`) y un componente `<GaNotice />` montado una sola vez en `main.tsx` (en lugar de `<Toaster />`). API:
     - `notify({ game?, title, text?, tone: "ok" | "info" | "frost" | "danger" | "error", actions?, timer? })`
     - `confirmNotice({ game?, title, text, confirmLabel, kind: "danger" | "frost" }) → Promise<boolean>`
     - `runSteps({ game, title, steps: string[] })` que devuelve un controlador para marcar cada paso `running / done / failed` y terminar con éxito o error.
     - Mantener `notify(message, {tone})` viejo funcionando como atajo (llama al nuevo) para no romper los ~todos los usos actuales.
  2. **Reglas del aviso:** uno solo a la vez; si llega otro, el mismo aviso cambia de contenido (no se apilan). Si salió bien y no tiene botones propios: **círculo temporizador arriba a la derecha que se completa en 3 s y lo cierra** (se pausa con el mouse encima; se puede tocar para cerrar antes). Un aviso `error` **nunca se cierra solo** y muestra sus botones. Las confirmaciones muestran `Cancelar` + la acción; Esc cancela. Texto largo: el aviso crece **hacia arriba**, el ancho no cambia.
  3. **Aspecto:** abajo a la derecha (si hay panel derecho abierto, a la izquierda de ese panel), 380 px, fondo que se desvanece hacia arriba (sin apagar el contenido), línea de color abajo según el tono, portada del juego a la izquierda si hay juego. Padding 48/22/22 px, separación 16 px. `z-index` por encima de la ficha y de los paneles.
  4. **Jugar:** reemplazar `AppSessionOverlay` por `runSteps`. Los pasos salen de las fases reales del lanzamiento (`reserving`, `preparing`, `launching`… y lo que hace el perfil de ejecución: aplicar fix, revisar idioma, buscar ejecutable). Éxito → "Listo: ya estás jugando" con temporizador. Error → título + detalle + botones "Ver registro" y "Reintentar", sin cierre automático.
  5. **Descarga terminada:** en lugar de `DownloadCompleteDialog`, aviso "Listo para jugar" con botón **Jugar** + temporizador (sin botón "Después").
  6. **Congelar / descongelar / desinstalar / quitar de la biblioteca:** confirmación con `confirmNotice` cuando es destructivo (desinstalar, quitar, congelado profundo); progreso dentro del aviso; resultado con temporizador. `FreezeDialog` sigue existiendo solo si hace falta mostrar un progreso largo; su resultado pasa al aviso.
- **Demo:** funciones `notify`, `confirmNotice`, `runWithNotice`, `playGame` y el CSS "Aviso único".
- **Hecho cuando:** jugar, terminar una descarga, congelar y desinstalar muestran el aviso nuevo; ningún diálogo de esos queda detrás de la ficha; tests actualizados (los de `DownloadCompleteDialog`, `FreezeDialog`, `AppDialog` que dependan del diálogo viejo).

### T4 · Pie de pantalla
- **Archivos:** `src/main.tsx` (barra `catalog-bottom-actions`, `ga-dock`, `ga-global-language`), `src/dock.css`, `src/LanguageSwitch.tsx`, `src/BigScreenControls.tsx` (usa el pie como destino), `src/BackendStatus.tsx`, `src/PremiumEntry.tsx`.
- **Qué hacer:** todos los botones del pie pasan a `GaIconButton` (cubos sin texto que se encienden y muestran el nombre al pasar el mouse). Novedades usa una **campana** (`Bell` de lucide) con numerito de anuncios sin leer (sale de `useAnnouncements`: contar los que todavía no se mostraron; al abrir Novedades se pone en 0). El idioma pasa a un solo botón con el ícono del mundo (`Globe2`) que al pasar el mouse muestra un selector Español / English (reutilizar `LanguageSwitch`). Lo que hoy muestra `BackendStatus` y `PremiumEntry` se mantiene, pero en el mismo estilo de cubo (estado como color o punto, texto solo al pasar el mouse).
- **Demo:** pie (`<footer class="footer">`), CSS "Pie: botones cubo de vidrio", `.lang-pop`.
- **Hecho cuando:** en la pantalla principal no queda texto fijo en el pie; Tab recorre los botones y muestra sus nombres; el modo pantalla grande sigue funcionando.

### T5 · Catálogo "para descubrir"
- **Archivos:** `src/LibraryRoom.tsx`, `src/LibraryRoomParts.tsx` (`CatalogPanel`, `InstallStateBadge`), `src/App.tsx` (`newGames`, `heroPool`), `src/CatalogFilterToolbar.tsx` / `src/CatalogTabs.tsx` (pastillas de filtro de arriba), estilos en `library-room.css` / `catalog-tabs.css`.
- **Qué hacer:**
  1. **Sin búsqueda, no mostrar los juegos instalados** en el catálogo. Con búsqueda, mostrar todos. Debajo del título de la grilla, un enlace "N instalados están en tu librería →" que cambia a la librería.
  2. **Sacar las pastillas de filtro de arriba** del catálogo: los filtros quedan en el editor de filtros (`LibraryFilterDialog` / asistente). No borrar la lógica de filtros.
  3. **Banner de arriba:** muestra lo último agregado / salido en Steam (usar `newGames`), con la línea "Nuevo en Steam · hace N días". Rota cada 7 s con barritas de progreso; el título entra letra por letra (`SplitText`).
  4. **Marca de instalado:** reemplazar la etiqueta "INSTALADO" por el círculo con ▶ verde arriba a la izquierda (`play-mark`). Va también en la librería.
  5. **Animación de la grilla al filtrar o cuando un juego se instala:** usar `Flip`. **Importante:** las tarjetas que se van primero se achican dentro de su lugar (`scale .5`, `opacity 0`, 0,3 s) y recién después la grilla se reacomoda con `Flip`. Nunca dejar que `Flip` anime una tarjeta que sale (ahí aparecía la portada agrandada fuera de su lugar). No usar `scale: true` en `Flip` para tarjetas con imagen.
  6. Al pasar el mouse por una portada: se levanta 8 px con leve inclinación 3D que sigue al mouse y el fondo de la página toma los colores del juego, con fundido entre juegos. **Cómo hacer el fondo (importante, si no parpadea):** dos `<canvas>` de 64×36 px estirados a pantalla completa con `filter: blur(18px)`; la imagen se carga y se decodifica (`img.decode()`) antes de dibujarla en el lienzo que está apagado, y solo se anima la `opacity` (nunca `scale` ni un `blur` grande sobre una imagen de pantalla completa). El banner también espera `decode()` antes de cambiar de imagen y nunca reemplaza la capa que se está viendo.
- **Demo:** `visible`, `applyFilter`, `reflowCatalog`, `showSpot`, `setAmbient`, bloque "Tilt 3D".
- **Hecho cuando:** sin búsqueda no aparecen instalados; con búsqueda sí; instalar un juego desde el catálogo lo saca con la animación limpia.

### T6 · Palabra gigante del costado y cambio Catálogo ⇄ Librería
- **Archivos:** `src/LibraryRoom.tsx` (vista `libraryView`), CSS nuevo `src/view-rail.css`, fuente `public/fonts/ArchivoBlack-Regular.ttf` + `archivoblack-OFL.txt`.
- **Qué hacer:**
  1. A la izquierda de la zona principal, la palabra de la vista actual en vertical (se lee de abajo hacia arriba), tan grande que ocupa el **110 % del alto** de la ventana (un poco cortada arriba y abajo). Texto sin tilde (sección 3).
  2. Aspecto: Archivo Black; silueta lisa y tenue (capa `solid` con opacidad .28) y encima el **interior pixelado** (capa `pix` con máscara de cuadraditos de 6 px y 2 px de ranura). Las letras mismas se desvanecen hacia el centro de la pantalla con una máscara (no un velo encima). Catálogo en naranja, librería en verde (`--ga-success`).
  3. El tamaño se calcula al cargar y al cambiar el tamaño de la ventana (función `sizeRail` de la demo) y deja libre a la izquierda el ancho que ocupa.
  4. **Cambio de vista:** la vista que se va gira y se desliza hacia un costado mientras la nueva entra del otro (rotación Y ±38°, 1 s, `expo.inOut`); la palabra vieja sale deslizándose hacia arriba y entra la nueva desde abajo.
  5. Se oculta en ventanas de menos de 900 px.
- **Demo:** `.rail`, `.rail-word`, `sizeRail`, `switchView`.
- **Hecho cuando:** la palabra se ve en ambas vistas, en ambos idiomas, y cambiar de vista anima sin saltos; con "reducir movimiento" el cambio es instantáneo.

### T7 · Librería en grilla "bento"
- **Archivos:** `src/LibraryRoom.tsx` (vista librería), `src/LibrarySectionShelf.tsx` / `src/librarySections.ts` si la librería se arma ahí, nuevo `src/libraryBento.ts` (lógica pura, con test), CSS `library-room.css`.
- **Qué hacer:**
  1. **Formatos:** juego instalado y jugable → portada vertical (600×900). Juego en la librería sin instalar → imagen apaisada chica (`header.jpg`, como en descargas), un poco apagada. **Una vertical ocupa lo mismo que tres apaisadas apiladas.**
  2. **Armado prolijo por bandas** (función pura en `libraryBento.ts`, igual a `libOrder` + `layoutBento` de la demo):
     - La grilla tiene `C` columnas (las que entren, mínimo 180 px) y filas de alto `(anchoColumna × 1,5 − 2 × gap) / 3`.
     - Se trabaja en **bandas de 3 filas**. Cada celda de una banda lleva una vertical (ocupa las 3 filas) o una pila de hasta 3 apaisadas.
     - Las verticales se reparten parejo entre las pilas (reparto proporcional, tipo Bresenham), la **pila incompleta va al final**.
     - Los **congelados profundos** van como apaisadas en la **columna de la derecha**, banda por banda.
     - Se ubica cada tarjeta con `grid-column` / `grid-row` explícitos (no `grid-auto-flow: dense`).
     - Test: con 7 instalados y 11 pendientes en 6 columnas tienen que quedar dos bandas, la primera completa.
  3. **Quitar de la librería:** la tarjeta se achica dentro de su lugar hasta desaparecer y después las demás se reacomodan con `Flip` (mismo orden que en T5).
  4. **Descarga terminada:** la tarjeta pasa de apaisada a vertical con `Flip`.
  5. **Congelado:** comprimido pero jugable → tarjeta vertical normal con un copito celeste chico en una esquina. Congelado profundo (no jugable) → apaisada en la columna derecha con un **velo celeste esmerilado que sube desde abajo** (animación de `clip-path` de abajo hacia arriba la primera vez) y la palabra "CONGELADO"; el nombre del juego se sigue leyendo.
  6. **Pastillas** "Solo instalados" y "Solo favoritos" abajo, sobre la búsqueda (no arriba), solo en la vista librería; excluyentes; un segundo clic las apaga.
  7. Encabezado: "N listos para jugar · N sin instalar · N congelados".
- **Datos:** el estado de congelado sale de la biblioteca (`entry.frozen === "deep"` / con valor) como en `DigitalGameContextMenu.tsx`.
- **Demo:** `libOrder`, `layoutBento`, `renderLibrary`/`buildLibrary`, `bentoCard`, CSS "Librería: grilla bento" y `.b-ice`.
- **Hecho cuando:** la grilla queda en bandas completas (salvo la última), los congelados profundos a la derecha, y quitar/descargar anima limpio.

### T8 · Menú en el dorso de la tarjeta (librería)
- **Archivos:** componente de tarjeta de la librería (T7), `src/DigitalGameContextMenu.tsx` (de acá salen las acciones y sus condiciones), CSS.
- **Qué hacer:**
  1. Al quedarse **2 s quieto** sobre una tarjeta aparece en la esquina inferior derecha un botón con **tres rayitas que se dibujan** (SVG con `stroke-dashoffset`) y queda latiendo suave. Si el mouse se va antes, no aparece; si se va después, se desdibuja. Con el foco del teclado aparece enseguida.
  2. Clic → la tarjeta **gira** (rotación Y 90°) y atrás aparece el dorso del mismo tamaño (si el menú no entra, el dorso crece lo necesario): la misma portada **dibujada en líneas** (filtro SVG `#sketch`: escala de grises + detección de bordes `feConvolveMatrix` + `mix-blend-mode: screen`), encima una capa de **vidrio** que se desvanece hacia la derecha, y encima el menú.
  3. El menú tiene **solo**: Jugar (o Instalar si no está instalado; destacado en naranja), Cambiar nombre y **Administrar** (abre el administrador de biblioteca con ese juego resaltado, T11). Sin título. Las opciones avanzadas (congelar, desinstalar, quitar) quedan en el administrador.
  4. Se cierra al alejarse de la tarjeta (con 280 ms de margen), con Esc o al desplazar la página; la tarjeta vuelve a girar a su estado original.
  5. Sacar el botón "−" que aparece al pasar el mouse (quitar está en el administrador).
- **Demo:** `bentoCard` (hamburguesa), `openFlipMenu`, `closeFlipMenu`, `menuItems`, `<filter id="sketch">`, CSS "Dorso de la tarjeta".
- **Hecho cuando:** el menú aparece solo tras 2 s, gira, muestra las tres opciones con la portada en líneas y se cierra al salir.

### T9 · Abrir y cerrar la ficha del juego
- **Archivos:** `src/LibraryDetailPanel.tsx` (`DesktopFeature`), `src/LibraryRoom.tsx` (`detailOpen`, `closeGameDetail`), `src/GameCoverBackdrop.tsx`, CSS de la ficha.
- **Qué hacer:**
  1. **Abrir:** el panel aparece en su lugar final pero recortado con `clip-path: inset(...)` al rectángulo de la tarjeta, y el recorte se abre hasta el panel completo (0,85 s `expo.inOut`). Una copia de la portada ("ghost") viaja desde la tarjeta hasta la **franja de arriba** de la ficha (nunca más grande que esa franja) mientras se desvanece hacia abajo con una máscara; la imagen ancha real de la ficha aparece encima. Las partes de la ficha (título letra por letra, datos, galería, botones) entran escalonadas por encima. Las demás tarjetas visibles se alejan del centro de la que se abrió (empujadas hacia afuera, `scale .82`, opacidad .35).
  2. **Cerrar:** las partes se repliegan (escalonado inverso), la franja se apaga, el recorte vuelve al tamaño de la tarjeta, las demás tarjetas vuelven a su lugar. Recién ahí la portada de la tarjeta **reaparece como una grilla de cuadraditos** (lado ≈ 1/16 de la tarjeta, mínimo 8 px) que se llena del centro hacia afuera con algo de azar, en **1,2 s** (canvas; ver `pixelReveal`).
  3. Mantener el botón de cierre único `ga-close`, Esc y el foco que vuelve a la tarjeta.
- **Demo:** `openDetail`, `closeDetail`, `pushOthers`, `srcRect`, `clipFor`, `pixelReveal`, CSS `.ghost`.
- **Hecho cuando:** en ningún momento se ve la portada agrandada o deformada; abrir y cerrar funcionan desde catálogo, librería y banner.

### T10 · Paneles laterales y modo "una pantalla por vez"
- **Archivos:** `src/main.tsx` / `src/App.tsx` (dónde se abren hoy Descargas y Administrador), nuevo `src/desk/DeskLayout.tsx` (o similar), `src/DigitalDownloadsScreen.tsx`, `src/library-manager/GameLibraryManager.tsx`, Novedades (`useAnnouncements` / `centralDialog/announcements.ts`).
- **Qué hacer:**
  1. **Ventana grande (≥ 1800 px):** los botones del pie Administrador, Descargas y Novedades son **interruptores**. Administrador abre un panel a la **izquierda**; Descargas a la **derecha**; Novedades a la derecha, **debajo** de Descargas (62 % / 38 % del alto si están los dos). Ancho de panel en sección 4. La zona principal (catálogo/librería) se queda con el resto; sus tarjetas se reacomodan con `Flip` al abrir/cerrar paneles; la palabra gigante y la búsqueda se corren con el borde del panel.
  2. Los paneles laterales tienen **fondo opaco sin `backdrop-filter`** (desenfocar lo que tienen detrás obligaba a recalcularlo con cada cambio del fondo y parpadeaba). El color es el mismo gris del centro junto al catálogo y se oscurece hacia el borde exterior: izquierdo `linear-gradient(90deg,#0c0f11 0%,#14181b 45%,#1b2024 100%)`, derecho el mismo con `270deg`. En modo pantalla completa, fondo `#111416`.
  - **El pie va siempre por encima de los paneles** (`z-index` mayor), también cuando giran en perspectiva: sus botones tienen que verse y poder tocarse.
  3. **Panel sin foco:** gris (`filter: grayscale(1) brightness(.8)`) y girado 9° hacia el centro (izquierdo `rotateY(9deg)` con origen en su borde derecho; derecho `-9deg` con origen en su borde izquierdo; perspectiva 1300 px). Con el mouse o el foco del teclado encima se endereza y toma color (0,7 s).
  4. **Ventana chica:** el botón abre la pantalla completa (una sola a la vez), con la misma transición 3D de T6, y botón **Volver** (`GaBack`) arriba a la derecha; Esc vuelve.
  5. Al cruzar el límite de ancho, convertir de un modo al otro sin perder lo abierto.
  6. Encabezado de cada panel: eyebrow + título Bebas + subtítulo, `GaClose` en modo panel y `GaBack` en modo pantalla.
- **Demo:** `applyDesk`, `openPage`, `closePage`, `togglePanel`, `setPanelFocus`, CSS "Escritorio: paneles secundarios".
- **Hecho cuando:** en 1920 px se pueden tener los tres paneles a la vez; en 1440 px se abre uno por vez a pantalla completa.

### T11 · Administrador de biblioteca (rediseño compacto)
- **Archivos:** `src/library-manager/GameLibraryManager.tsx`, `Charts.tsx`, `SizeCell.tsx`, `library-manager.css`, `copy.ts`.
- **Qué hacer:** mantener todas sus funciones y datos actuales (importar, escanear, corregir, estados, tamaños, congelado) con este aspecto:
  1. Arriba, **dona animada del disco** (como el CodePen de referencia `codepen.io/creativeocean/pen/KKypdeM`): **solo tres partes**: Juegos (todo lo que ocupa la librería salvo congelados), Congelados y Libre (anillo tenue). No mostrar "fuera de estándar" en el gráfico. Las partes se dibujan escalonadas; las más grandes son más gruesas; centro "N GB ocupados de M". Al pasar el mouse por una parte o su fila de la leyenda, esa parte se engrosa, las demás se apagan y el centro muestra su valor. Leyenda a la derecha con barritas del color de cada parte.
  2. Debajo: Instalados · Ahorrado al congelar (**sin** "Fuera de estándar": ya está en la pastilla de filtro, no repetirlo). Botones en una fila, **de tamaño normal** (no estirados a todo el ancho): "Corregir todo (N)" (principal), "Importar juegos", Escanear (ícono). Pastillas de filtro: Todos, Fuera de estándar, Descargas sin terminar, Congelados.
  3. Filas compactas: miniatura apaisada, nombre, línea de estado (solo si agrega algo), tamaño e indicador de estado. **Sin texto repetido:**
     - Listo para jugar → sin línea ni insignia "Listo": un **ícono de play** verde a la derecha (botón que juega).
     - Fuera de estándar → un **ícono de advertencia**; el nombre "Fuera de estándar" aparece como etiqueta al pasar el mouse o con el foco (a la izquierda del ícono, para que la fila no la recorte). La línea que explica el motivo ("Carpeta con formato anterior.") se mantiene.
     - Congelado → tamaño congelado en celeste (`--ga-frost`) y, al lado, el tamaño sin congelar en naranja semitransparente (`#ff6a00` al 55 %). Sin tachado y sin "Ahorra X GB".
     - Los demás estados (descargando, en cola, sin instalar, congelado / congelado profundo) mantienen su insignia. **Al pasar el mouse** (o foco) aparecen las acciones: Corregir, Jugar, Instalar, Congelar, Congelado profundo, Descongelar, Abrir carpeta, Desinstalar, Quitar de biblioteca (según estado). Las destructivas confirman con el aviso único (T3).
  4. **Colores sobrios:** cifras en blanco, barras grises; naranja solo en el botón principal; celeste suave para congelado. (Igual se pone en gris cuando el panel no tiene foco.)
  5. "Administrar" desde el dorso de una tarjeta (T8) abre este panel con la fila de ese juego resaltada y desplazada a la vista.
- **Demo:** `renderManager`, `drawDisk`, `mgrInfo`, `mgrActs`, CSS "Administrador" y "Dona del disco".
- **Hecho cuando:** todas las acciones de antes siguen disponibles; los tests de `library-manager` pasan (actualizarlos si cambia el marcado).

### T12 · Descargas (rediseño)
- **Archivos:** `src/DigitalDownloadsScreen.tsx`, `src/DownloadTelemetry.tsx`, `src/digital-downloads.css`, `src/download-manager.css`.
- **Qué hacer:** mismas funciones (pausar, reanudar, cancelar, reordenar cola, reintentar, jugar, descarga manual) con este aspecto: descarga en curso como tarjeta con la imagen ancha arriba (método Torrent / Directa PLUS como pastilla), **gráfico de velocidad** (línea + área naranja), barras Descarga e Instalación, cifras Descargado / Velocidad / Restante, botones Pausar y Cancelar. Cola en filas compactas con número de posición y subir/bajar/cancelar. "Esta sesión" con lo terminado y botón Jugar. "Añadir descarga manual" plegado al final. Colores sobrios como en T11.
- **Demo:** `renderDownloads`, `updateDownloads`, CSS "Descargas".
- **Hecho cuando:** los tests de `DigitalDownloadsScreen` pasan y el panel funciona en modo lateral y en pantalla completa.

### T13 · Novedades como panel
- **Archivos:** `src/centralDialog/useAnnouncements.ts`, `announcements.ts`, nuevo componente de panel.
- **Qué hacer:** hoy las novedades se muestran en el diálogo central. Pasan a un panel (T10): tarjeta de la última versión (fecha, título, texto), "Nuevos en el catálogo" (juegos recientes con botón Ver que abre la ficha) y un consejo de uso. Contador de no leídos en la campana del pie (T4); al abrir el panel se marcan leídos. La bienvenida de la primera vez puede seguir en el diálogo central.
- **Demo:** `renderNews`, `markNewsRead`.
- **Hecho cuando:** la campana muestra el número correcto y el panel lista las novedades en castellano e inglés.

### T14 · Resto de las pantallas con el mismo estilo
- **Archivos:** `src/AppSettings.tsx`, `src/AppHelp.tsx`, `src/library-manager/ImportWizard.tsx`, `src/RenameGameDialog.tsx`, `src/ParentalSetupDialog.tsx`, `src/LibraryFilterDialog.tsx`, `src/DigitalStorageSettings.tsx`, `src/GameRecoveryDialog.tsx`, `src/SteamInstallFallbackDialog.tsx`, `src/PremiumEntry.tsx`/`AccessPass.tsx` y cualquier otro diálogo.
- **Qué hacer:** no hace falta rediseñarlas una por una. Aplicar la misma filosofía: panel de vidrio con borde degradado, encabezado estándar (eyebrow + título Bebas naranja + subtítulo), `GaClose` único, `GaButton` para todas las acciones (una sola principal naranja), mismos márgenes (28 px panel, 24 px entre secciones, 10 px entre botones), mismas fuentes. Pasarlas por la lista de comprobación de `GUI_DESIGN.md` §6.
- **Hecho cuando:** ninguna pantalla usa un botón o cierre propio; todas pasan la lista de comprobación en `es` y `en`.

### T15 · Revisión final
- Reducir movimiento (Windows: Configuración → Accesibilidad → Efectos visuales → Efectos de animación desactivados): todo funciona sin animaciones.
- Anchos 1024, 1440, 1920 y uno ultra ancho (≥ 2560): paneles, palabra gigante, grilla bento.
- Modo pantalla grande con mando: navegación con flechas, abrir ficha, volver.
- Teclado: Tab recorre los botones; lo que aparece al pasar el mouse aparece con el foco.
- Rendimiento: con 50+ tarjetas visibles, desplazar y filtrar sin tirones (no animar `filter: blur` en muchas tarjetas a la vez; preferir `transform` y `opacity`).
- `npx tsc --noEmit`, `npx vitest run`, `npm run check:i18n`, y prueba en la app instalada (`npm run tauri dev` o un build).

---

## 6. Errores que ya se cometieron en la demo (no repetirlos)

- `Flip` animando una tarjeta que **sale** → se ve la portada agrandada fuera de su contenedor. Primero achicar las que salen, después `Flip` solo con las que quedan.
- Agrandar la portada de la tarjeta hasta el tamaño de la ficha → imagen gigante y torpe. La portada solo viaja hasta la franja de arriba y se desvanece.
- Animaciones que no arrancan: si un test o una vista oculta deja GSAP sin cuadros, no "adelantar" timelines pausadas a mano.
- Botón naranja con degradado (en bandas parecía Windows 95; con reflejo y resplandor parecía con volumen). Es **naranja plano**, sin resplandor.
- Mostrar el mismo dato dos veces ("Fuera de estándar" en las cifras y en la pastilla) o un botón estirado a todo el ancho sin motivo.
- Botón "OK/Después" que se llena: se reemplazó por el círculo temporizador arriba a la derecha.
- Palabras en mayúscula con tilde en la palabra gigante: van sin tilde.
- Con los dos paneles abiertos, el centro parpadeaba en cada cambio del banner: el fondo de colores era una imagen de pantalla completa con `blur(70px)` que además se escalaba, y los paneles tenían `backdrop-filter` encima. Se arregló con lienzos chiquitos (solo `opacity`), imágenes decodificadas antes de mostrarse y paneles con fondo sólido (ver T5 y T10).
- Mostrar más texto del necesario en la pantalla principal (etiquetas "INSTALADO", textos fijos en el pie).
