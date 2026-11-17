# TAREA — Pantallas, modos y diálogos

Pedido de Seba (2026-10-30). Reordena la navegación de la app: qué es una pantalla, qué es un panel y qué es un diálogo, y mueve cada cosa a su lugar. Es un cambio de navegación, no solo de estilo.

- **Inventario completo de lo que existe hoy:** proyecto "Game Access" en claude.ai, `claude/inventario-pantallas.md`.
- **Reglas de diseño que se aplican y se actualizan:** `docs/GUI_DESIGN.md` (secciones indicadas abajo).
- **Antecedente:** `docs/TAREA-interfaz-nueva.md` (T10: paneles del escritorio, `desk/desk.ts`).
- **Seguimiento:** pasar cada tarea de abajo a `vault/Tareas.md` y registrar cada commit en `vault/Log.md`.
- **Flujo de trabajo:** prototipo primero (sin logs, docs ni i18n) para que Seba lo pruebe; después la etapa de pulido (traducciones, tests, docs). Una rama (`dev`), commit y push por paso verificado.

---

## 1. Modelo

| Nivel | Qué es | Reglas |
|---|---|---|
| **Pantalla / modo** | Cambia todo el contenido principal. Se elige desde el marco. | Sin modal y sin la X roja. Se sale cambiando de modo, o con `ga-back` en subpasos. Ancho completo. |
| **Panel lateral** | Columna a la derecha, no bloquea. | Un solo panel: "Procesos y descargas". |
| **Diálogo** | Bloquea. Confirmar, avisar, validar, pedir un dato corto, o un proceso crítico con progreso. | Chico, un botón principal, `ga-close`. **Nunca se apilan:** uno a la vez. |
| **Gate** | Cubre toda la app hasta resolverse (clave de padre, actualización, activación). | Uno solo a la vez. |
| **Aviso** | No bloquea y se cierra solo (`GaNotice`). | Un único sistema de avisos. |

## 2. Decisiones de Seba

### Marco (abajo a la derecha)
- **Home** (nuevo): pantalla de inicio. Saludo ("Hola, usuario"), novedades (reemplazan la campanita), últimas versiones con sus cambios, estado del modo PLUS/base explicado, ayuda y contacto al final y todo lo que no tenga otro lugar.
- **Catálogo / Librería:** un solo modo "Juegos"; se alternan con los botones junto al buscador, como ahora. La palabra grande de la primera columna debe notarse más para distinguir cuál de los dos está activo.
- **Configuración** y **Niños en casa:** cada una su propia pantalla (hoy son diálogos de 720 px).
- **Procesos y descargas:** botón en el marco, con indicador luminoso mientras haya algo activo. Abre el panel lateral.
- **Big Picture:** botón siempre visible en el marco y diferenciado (margen o color distinto).
- **PLUS:** el botón del marco existe siempre. Sin PLUS muestra "Activar PLUS"; con PLUS muestra el estado de la suscripción (hasta cuándo está paga) y permite darse de baja.
- **Fuera del marco:** Refrescar juegos (va en Catálogo/Librería), campanita (va a Home), Library Manager (va dentro de Librería), ayuda (va a Home).
- Pantalla completa: puede seguir en el marco y también tener un botón grande en Librería.

### Library Manager
- Es hijo de Librería: un modo dentro de ella, con botón grande en pantalla. **No** va en el marco.
- Las tareas largas (mover, comprimir/congelar y otras) mantienen su detalle y su interfaz en el Library Manager.

### Panel lateral "Procesos y descargas"
- Un solo panel con dos secciones: **Descargas** (exactamente como hoy) y **Tareas** (abajo, en su propia sección).
- La sección de Tareas solo existe mientras hay tareas corriendo. Cada una muestra solo nombre y progreso y se puede cancelar. Al hacer clic lleva a esa tarea en el Library Manager.
- Cuando una tarea termina no queda ninguna línea en el panel. Se avisa con el **aviso único de abajo a la derecha** (`GaNotice`, §4.9), que es una confirmación: si tiene un solo botón OK, ese botón se pulsa solo a los X segundos. Si el proceso terminó con error, el aviso **no** se cierra solo. Esto ya funciona así hoy; no hay que cambiarlo.
- Entran aquí: la actualización del plugin (no bloquea) y las tareas largas del Library Manager.

### Diálogos que siguen siendo diálogos
- **Editor de filtros:** es función de la grilla (que vive en Catálogo y Librería). Ya está bien como diálogo modal.
- **Importar:** diálogo modal **bloqueante y sin minimizar**: pregunta dónde buscar, trabaja con progreso y se cierra al terminar. Bloquea todo lo demás.
- **Actualización de la base de datos de juegos:** bloqueante, se espera a que termine.

### Atomicidad y cierre de la app (a verificar)
- Todos los procesos deben ser atómicos y retomables por sí mismos.
- Importar tiene dos partes: (1) armar la lista de juegos y pedir confirmación: no es crítico, si se cierra la app se pierde la lista y no pasa nada; (2) crear los registros en la librería: gradual, juego por juego. Si se reintenta no debe duplicar lo que ya existe. Una carpeta a medias se detecta como fuera de estándar y se intenta arreglar.
- **Pendiente de Seba:** verificar si la importación tiene restauración.

### Pantallas angostas
- Se mantiene el tamaño mínimo de diseño actual: 1200 x 800 (`tauri.conf.json`, abre en 1440 x 900). No se adapta toda la interfaz; el usuario puede agrandar la ventana. Único ajuste posible: por debajo de cierto ancho el panel derecho tapa parte de la grilla en lugar de achicarla.

## 3. Lista de cambios

Cada ítem lleva la sección de `docs/GUI_DESIGN.md` que debe cumplir o actualizar.

| # | Cambio | Archivos principales (hoy) | GUI_DESIGN |
|---|---|---|---|
| 0 | Escribir las reglas: niveles, un solo modal a la vez, contenido de Home | `docs/GUI_DESIGN.md` | §0, §4.6, §4.12, §5 |
| 1 | **Un solo modal a la vez.** Provisorio ya hecho: `modalStack.ts` oculta el de abajo. Definitivo: ningún diálogo abre otro | `modalStack.ts`, `ga-design.css` | §4.6, §4.7 |
| 2 | **Niños en casa como pantalla** (con el stepper) | `KidModePanel.tsx`, `KidWizard.tsx`, `KidControlPanel.tsx`, `kid-mode.css` | §4.11, §4.12, §4.25 |
| 3 | **Configuración como pantalla** | `AppSettings.tsx` | §4.11, §4.12, §4.25 |
| 4 | **Home** (inicio, novedades, versiones, ayuda, contacto) | `AppHelp.tsx`, `announcements`, campanita en `main.tsx` | §4.12, §4.16 |
| 5 | **PLUS** siempre visible en el marco; oferta/estado como sección o pantalla, no diálogo | `PremiumEntry.tsx` | §4.14 |
| 6 | **Panel "Procesos y descargas"**: sección de Tareas, clic lleva a la tarea | `DownloadCatalogPanel.tsx`, `desk/desk.ts`, `desk/DeskPanel.tsx` | §4.17, §4.21 |
| 7 | **Library Manager como modo de Librería** (botón grande, fuera del marco) | `library-manager/GameLibraryManager.tsx`, `DownloadCatalogPanel.tsx` | §4.12, §4.20 |
| 8 | Refrescar juegos al Catálogo/Librería | `main.tsx`, `catalog-refresh.css` | §4.14 |
| 9 | Big Picture diferenciado en el marco | `BigScreenControls.tsx` | §4.14 |
| 10 | Palabra de la sección más notoria | CSS de la palabra lateral | §4.16 |
| 11 | **Ayuda contextual:** un botón de ayuda en cada pantalla principal o modo que enciende y apaga una capa sobre la interfaz explicando cada zona y botón (textos en §7) | una por pantalla; componente común | nueva sección |
| 12 | Aviso de tarea terminada con cierre automático | `GaNotice` | §4.9 |
| 13 | Verificar restauración de la importación y atomicidad de los procesos | `library-manager/ImportWizard.tsx` y procesos del launcher | — |

## 4. Cambios pendientes de la apertura (indicados por Seba)

### 4.1 La clave de padre en la apertura solo si el modo padre está activo
- **Pedido:** al iniciar la app, mostrar el campo de contraseña solo si el modo padre está encendido y configurado (es decir, si ya se corrió el asistente del modo niño y se guardó la clave del padre). Si no, la app abre sin clave, como antes, con la animación del globo que gira, el candado que se apaga y el portón que se abre.
- **Lo que dice el código hoy:** `SplashScreen.tsx` (~líneas 180–188) ya hace `if (!state.enabled) { setKeyGate("done") }` con `loadAdminKey()` (comando `admin_key_state`, `admin_key.rs`). Es decir, la lógica ya está pensada así; si hoy pide la clave sin haber corrido el asistente, lo más probable es que `admin_key_state` esté devolviendo `enabled: true` por una clave guardada en esa PC. **Hay que reproducirlo**: ver el estado real de `admin_key_state` en esa máquina antes de cambiar nada.
- **Criterio de aceptación:** sin clave guardada, la apertura nunca muestra el campo ni el cerrojo "sellado"; con clave, lo muestra como hoy. Un test con el comando real, sin simularlo.
- **GUI_DESIGN:** §4.24.

### 4.2 Quitar la imagen vieja de la apertura
- **Pedido:** queda un resto de la animación anterior: una imagen con muchos juegos en una grilla. Ya no pertenece a la app y debe quitarse.
- **Dónde está:** `GameCoverBackdrop.tsx` (grilla `activation-showcase`, 120 portadas de juegos, 20 títulos repetidos) se dibuja desde `ActivationGate.tsx:221`, dentro de `.ga-opening-background`; sus estilos están en `splash-screen.css` (líneas ~109–113).
- **Qué hacer:** quitar el uso en `ActivationGate.tsx`, borrar `GameCoverBackdrop.tsx` y las reglas `.activation-showcase*` si nada más las usa, y revisar que el fondo de la apertura quede sin imágenes de juegos. Revisar también `openingSettled.test.tsx`.
- **Criterio de aceptación:** al abrir la app no se ve ninguna grilla de portadas, no se piden imágenes a Steam durante la apertura, y los tests de apertura pasan.
- **GUI_DESIGN:** §4.24 (aclarar que la tapa cubre un fondo liso).

## 5. Orden sugerido

1. Reglas en `docs/GUI_DESIGN.md` y tareas en `vault/Tareas.md` (cambio 0).
2. Las dos correcciones de la apertura (4.1 y 4.2): son chicas y visibles.
3. Niños en casa como pantalla (2).
4. Configuración como pantalla (3).
5. Panel "Procesos y descargas" (6) y Library Manager dentro de Librería (7).
6. Home (4), PLUS (5), refresco, Big Picture, palabra de sección y ayuda contextual (8–12).
7. Verificación de atomicidad (13).

Cada paso: prototipo, prueba de Seba, y después pulido con tests y documentación.

## 6. Preguntas que siguen abiertas

1. ¿"Pantalla completa" queda solo en el marco, o también con botón grande en Librería?
2. La capa de ayuda: ¿qué la cierra (el mismo botón, Escape, clic fuera)? ¿Se muestra con gamepad/Big Picture?
3. Textos de ayuda: pasar a `es.ts` y `en.ts` en la etapa de pulido (hoy son borrador en español).

*Resueltas:* la ayuda contextual es una capa que se enciende y apaga por pantalla (no tooltips); el aviso de tarea terminada es el aviso único existente, con autoclic del OK y sin autocierre si hay error.

## 7. Contenido de la ayuda contextual (borrador de Seba, a pulir)

La capa de ayuda no hace falta en pantallas que se explican solas; sí en las que ejecutan tareas técnicas. Cada botón que hace algo técnico (Importar, Importar de Steam, Arreglar todo, etc.) explica **qué hace**.

- **Catálogo:** "Acá encontrás juegos nuevos y lanzamientos. Podés filtrar, ordenar y buscar con sus botones. Para ver un juego, tocalo: se abre el detalle, y a la derecha tenés más opciones. Debajo de cada juego están sus acciones."
- **Librería:** "Acá están todos tus juegos instalados por Game Access. También podés importar juegos: desde tu cuenta de Steam, o aplicaciones y juegos externos o independientes (Roblox, Minecraft, programas de dibujo y otras actividades que quieras centralizar acá)."
- **Library Manager:** "Acá ves en detalle todos tus juegos y los administrás: congelarlos, copiarlos, arreglarlos, quitarlos de la librería, instalarlos o desinstalarlos."
- **Niños en casa:** no necesita ayuda; la pantalla se explica sola.
- **Home:** "Acá encontrás tu información de usuario, las novedades de la app, los juegos nuevos y lo que agregan los plugins. También el contacto, si necesitás hablar con nosotros, y los links a Patreon y a la suscripción por Mercado Pago."
- **Configuración:** "Acá controlás los detalles: el estilo gráfico, el comportamiento de la librería, la lista de juegos, la instalación de juegos y otras opciones."
- **Panel de procesos y descargas:** "Acá ves las descargas pendientes y en progreso, y las tareas largas que corren en segundo plano, resumidas."
