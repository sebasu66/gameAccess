# GameAccess desktop: diagnóstico y tareas de regresión

Fecha: 2026-09-05. Documento de implementación para otro modelo. En esta revisión no se modificó código de aplicación ni se reconstruyó/reinició la aplicación.

## Alcance y punto de partida

Corregir detalles, tamaños, ETA, carga lazy, detección de instalaciones, Play en tarjetas, inactividad y proporción de paneles. Conservar las funciones existentes. No cambiar autenticación, licencias, Steam Guard ni la ruta de lanzamiento que el usuario confirmó que funciona. Conservar los modos local y GameAccess. No introducir juegos ficticios ni iniciar descargas reales para ejecutar tests.

Estado observado:

- Rama `main`, HEAD `be5d82b2278986e66b4d782ee942fdf2292b1fdd`, coincidente con la referencia local `origin/main`. No se hizo fetch: esto no certifica el remoto actual.
- Versión declarada `0.1.0` en package.json, Cargo.toml y tauri.conf.json. No identifica una revisión de código.
- Proceso observado: `GameAccess-latest.exe`, PID 83188, ruta `C:\DEV\gameAccess\GameAccess-latest.exe`. Archivo de 576512 bytes, fecha observada 2026-09-04 18:47. El release en `apps/desktop/src-tauri/target/release/gameaccess-desktop.exe` mide 9466880 bytes, fecha observada 2026-09-04 19:34. Son artefactos distintos; no se demostró qué revisión sirve el proceso activo ni si el primero es un bootstrapper. No reemplazarlos a ciegas.
- Sin modificaciones tracked al iniciar esta revisión; existen ejecutables de prueba, logs, debug y bin/obj sin seguimiento. No borrarlos, agregarlos al commit ni revertir trabajo ajeno.
- Baseline ejecutada: `npm test` en `apps/desktop`: **12 archivos, 40 tests aprobados**. No se realizó reproducción visual, build ni prueba de descarga real en esta revisión. Las causas siguientes están verificadas en código, no mediante una sesión visual.

Commits recientes relevantes:

| Commit | Cambio y consecuencia |
| --- | --- |
| be5d82b | Documenta aislamiento de UI, pero exige más ancho para grilla: contradice el nuevo 50/50. |
| ddf8481 | Tests principalmente de cadenas de código; no prueban latencia ni lifecycle. |
| f97e5c4 | Habilita imports raw para esos tests. |
| 4c5f91c | Carga el CSS público del contrato de layout. |
| f7e4947 | Introduce el límite de ancho del detalle confirmado abajo. |
| 3811f94 | Ya mueve estimación/inicio de descarga a spawn_blocking. Preservar. |
| 2a4de98, d251a03 | Unificación del detalle. No deshacer ni eliminar contenido. |

Los nombres de commits no prueban la autoría de todas las demás regresiones. No hacer rollback global.

## 1. P0: restaurar detección de instalación y estado único

### Causas verificadas

- `apps/desktop/src/App.tsx:736`: el sondeo inicial usa `games.slice(0, 24)`. No recorre el resto del catálogo. Su efecto depende de `[games]`, por lo que también repite consultas por cambios de identidad del array.
- `apps/desktop/src/native.ts:395-403`: en modo GameAccess devuelve cualquier `provider_download_status` no nulo antes de consultar Steam. Un JSON antiguo de error/no instalado oculta un manifiesto Steam instalado.
- `apps/desktop/src/LibraryRoom.tsx:101`: `{ ...downloads, ...managedDownloads }` da prioridad absoluta al estado local administrado, sin comparar origen, revisión ni fecha.
- `LibraryRoom.tsx:393-403` guarda resultados de estimación en `managedDownloads`. Rust devuelve una estimación con `state: not-installed` e `installed: false`: información de tamaño puede convertirse en autoridad de instalación.
- La selección interna de LibraryRoom no es la selección del modal legacy de App. No confiar en el sondeo del modal para cubrir tarjetas seleccionadas en LibraryRoom.

### Tareas

- [ ] Separar los almacenes de instalación, transferencia y estimación. Una respuesta de tamaño no debe escribir `installed`, `state` ni pisar un evento de finalización.
- [ ] Implementar un reconciliador puro probado: evidencia local válida de instalación no se degrada por estimación, error remoto o JSON antiguo. Una transferencia activa se conserva como estado separado; instalado no equivale automáticamente a ejecutable mientras hay una actualización obligatoria.
- [ ] Consultar Steam aunque exista estado del proveedor; fallos de lectura/JSON del proveedor no deben impedir esa consulta. Para proveedor instalado, validar su destino/manifiesto antes de considerarlo instalado. No mantener un `installed: true` para siempre después de desinstalar: invalidar por evidencia local fresca.
- [ ] Sustituir el corte de 24 por descubrimiento completo en segundo plano, lotes de como máximo 4 AppIDs, deduplicados. Priorizar visibles y seleccionado; continuar con el resto sin bloquear la primera pintura. Idealmente leer una vez el inventario de bibliotecas/manifiestos y compartirlo, no recorrer directorios completos por tarjeta.
- [ ] Refrescar el inventario al finalizar instalación, desinstalación detectada y actualización explícita. La identidad nueva de un array con los mismos AppIDs no debe reiniciar el trabajo.
- [ ] Unificar polling/eventos en un servicio compartido. No superponer dos rondas si la anterior tarda más de 2500 ms; no reiniciar el polling por `[games]`. Aplicar resultados por AppID y generación, no por selección actual.

## 2. P0: detalles lazy, trabajo acotado y UI independiente

### Causas verificadas

- `App.tsx:710-728` precarga detalles de los primeros 8 juegos cada vez que cambia `[games]`. Esto contradice la carga estrictamente por juego solicitado.
- `LibraryRoom.tsx:369-390` tiene un solo valor `details`, lo borra al cambiar selección y llama `loadDetails` nuevamente. A → B → A repite trabajo. El flag `cancelled` evita pintar resultados antiguos, pero no cancela el trabajo.
- `apps/desktop/src/api.ts`, `loadDetails`: la ruta backend no tiene caché/in-flight compartida. La caché/dedupe de metadata Steam local no cubre ese caso.
- La estimación tiene debounce de 700 ms, pero `estimateAttemptedRef` marca intentos antes del resultado: un error queda sin reintento durante el montaje. No limita procesos ya iniciados al navegar entre juegos ni deduplica entre montajes.
- `provider_download_estimate_blocking` valida proveedor y lanza Python para manifiestos; el probe de estimación admite hasta 600 segundos. Un comando asíncrono sin control de concurrencia todavía puede saturar recursos.

**Importante:** los detalles ya usan Promises y los comandos de estimación/inicio ya usan `spawn_blocking`. No hay evidencia para decir que esas funciones actuales ejecutan directamente el trabajo pesado en el hilo de UI. `await` no es por sí mismo bloqueo; no reemplazar `.then` por otro estilo como supuesto arreglo.

### Tareas

- [ ] Eliminar el precargado incondicional de ocho detalles, no la función de detalles ni sus consumidores. Cargar solo el juego cuyo detalle se abre/selecciona. Conservar selección inicial si la pantalla ya muestra su detalle.
- [ ] Crear un servicio compartido fuera del lifecycle de App/LibraryRoom: claves de detalle `(catalogMode, backendIdentity, gameId)` y claves de tamaño que incluyan AppID, plataforma y revisión/depot cuando esté disponible. No confundir gameId backend con Steam AppID.
- [ ] Guardar valores resueltos e in-flight. Selección repetida, rerender, refresh equivalente del catálogo y remount/StrictMode deben reutilizar la misma consulta. Propuesta explícita: detalles TTL 10 minutos; tamaño TTL 30 minutos más invalidación al cambiar build/depot. Nunca reutilizar datos de otra fuente/cuenta si su contenido depende de esa identidad.
- [ ] Mostrar inmediatamente título/portada/acciones conocidas; placeholders por campo pendiente. No limpiar información válida al revalidar. Error de metadata no borra catálogo ni instalación ni bloquea Play.
- [ ] Mantener protección contra respuestas fuera de orden. Abortar fetch cuando no haya consumidores; para comandos nativos ya iniciados, deduplicar y limitar a **una estimación pesada simultánea**. Descartar trabajos en cola que ya no tengan consumidores. No matar procesos de descargas activas.
- [ ] Conservar 700 ms de estabilidad antes de estimar; no consultar los juegos intermedios de navegación rápida. Un fallo debe permitir reintento explícito, con error recuperable y sin bucle automático.
- [ ] Separar datos rápidos del cálculo costoso: metadata, inventario y tamaños actualizan sus campos independientemente. Cualquier recorrido de disco, cálculo intensivo o subprocess queda en worker/backend, nunca en render ni en un efecto síncrono costoso.

## 3. P1: tamaños correctos y ETA honesta

### Causas verificadas

- `apps/launcher/provider_download_probe.py:186-198` extrae literalmente **Total bytes on disk**. `total_bytes` en 331-344 deriva de esos totales o del tamaño de archivos del directorio.
- `apps/launcher/provider_download_manager.py:179-185` renombra ese valor a `bytes_total`; no demuestra bytes de transferencia comprimida.
- `apps/desktop/src-tauri/src/native_core.rs:277` lee `BytesToDownload` y no `SizeOnDisk`. Una instalación completa puede tener descarga pendiente cero y ocupar muchos GB.
- `LibraryRoomParts.tsx:408-412` muestra `download.bytes_total` como “Tamaño”; no distingue espacio instalado y descarga. Solo presenta ETA durante transferencia activa.
- `provider_download_manager.py:200-218` infiere bytes mediante porcentajes de depots y divide por tiempo desde inicio; no mide necesariamente tráfico. ETA usa `int(eta) if eta else None`, perdiendo el cero final. Pausas/reanudaciones y tiempos de preparación distorsionan ese promedio.
- `provider_download_estimate_blocking` reutiliza cualquier `bytes_total` persistido sin validar revisión/frescura.

### Tareas

- [ ] Definir campos independientes en tipos TS, DTO Rust y payload Python: `download_total_bytes`, `downloaded_bytes`, `installed_size_bytes`, `estimated_install_size_bytes`, `speed_bps`, `eta_seconds`; acompañar valores con fuente y condición estimada cuando corresponda. Mantener compatibilidad de payloads existentes sin cambiar silenciosamente su significado.
- [ ] “Total bytes on disk” alimenta tamaño estimado instalado, **no** tamaño transferido. Si no existe fuente de bytes de descarga, mostrar “No disponible”, no inventarlo ni usar cero.
- [ ] Leer `SizeOnDisk` de manifiesto como tamaño instalado reportado por Steam y etiquetar su origen. Si se necesita ocupación física real del sistema de archivos, calcularla por separado en worker bajo demanda: suma de tamaños lógicos y bloques asignados no son equivalentes. No recorrer todo el disco al abrir catálogo.
- [ ] Mostrar etiquetas claras: “Descarga”, “Instalado” o “Instalación estimada”, “Velocidad” y “Tiempo restante”. Normalizar bytes/unidades una sola vez; cero válido no debe tratarse como null.
- [ ] ETA de transferencia = bytes restantes de transferencia / velocidad observada de transferencia. Si solo hay porcentajes de progreso en disco, identificar el resultado como aproximado de progreso, no velocidad de red real. No mezclar unidades/fuentes para obtener ETA.
- [ ] Extraer cálculo puro con reloj inyectable y ventana de muestras de 15 segundos. Ignorar muestras sin delta temporal válido, reiniciar ventana al reanudar, clamp de restantes >= 0; mostrar desconocido durante preparación/pausa o sin velocidad válida, y 0 al completar. No contar bytes previos a una reanudación como recién transferidos.
- [ ] Antes de descargar, mostrar estimación solo si hay tamaño transferible y velocidad histórica medida compatible; de lo contrario “Se calcula al iniciar”. No efectuar descargas/pruebas de velocidad ocultas.

## 4. P1: idle desktop a siete minutos reales

Evidencia: `LibraryRoom.tsx:292-302` usa `30_000`; root reinicia por pointerdown/keydown, no por movimiento/rueda. El usuario puede estar leyendo o desplazándose y entrar demasiado pronto.

- [ ] Usar constante `DESKTOP_IDLE_TIMEOUT_MS = 7 * 60 * 1000` (dentro de los 5–10 minutos pedidos).
- [ ] Reiniciar por pointerdown, pointermove, wheel, touch y teclado del usuario; agrupar eventos de alta frecuencia sin cambiar el momento efectivo de última actividad. Video, polling y cambios automáticos de slides no son actividad.
- [ ] Una sola suscripción/timer con cleanup; salir inmediatamente del modo idle por interacción. Al volver de ventana oculta, empezar un período nuevo, evitando entrada inmediata inesperada.
- [ ] No cambiar timers propios de `surface-display` (18/45 segundos de presentación) ni comportamiento tablet: son una función distinta del idle desktop.

## 5. P1: Play verde en cada tarjeta instalada

Evidencia: `LibraryRoomParts.tsx`, `InstallStateBadge`, aún genera Play para instalado y disponible. No fue eliminado: su entrada de instalación está afectada por §1. Además es un span, no un botón de lanzamiento. La tarjeta en `CatalogPanel:445-465` ya es un button de selección.

- [ ] Restaurar el indicador verde al resolver instalación real. Mantener separados instalado y licencia/copia disponible: sin licencia mostrar instalado, con acción deshabilitada y razón; nunca inventar disponibilidad ni saltear autorización backend.
- [ ] Para satisfacer el botón Play pedido, añadir acción accesible que use el mismo handler de lanzamiento existente del detalle. No crear otra autenticación. Reestructurar tarjeta con acciones hermanas si hace falta: **no anidar button dentro de button**.
- [ ] Clic/Enter en Play lanza una sola vez; selección de tarjeta sigue abriendo detalle. Lanzamiento no debe vaciar catálogo ni refrescar todas las fichas.

## 6. P1: proporción desktop 50/50

Evidencia exacta: `apps/desktop/public/library-room-layout.css:5` impone `clamp(300px, 31vw, 450px)` con `!important`; desde 1280 px impone `minmax(360px, 440px)`. Es la causa directa del detalle estrecho. Cambiar solo CSS de src puede no surtir efecto.

- [ ] En las reglas desktop de ese archivo usar `grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)`; quitar el override posterior de 440 px. Mantener gap y comportamiento responsive; asegurar min-width:0 y ausencia de overflow horizontal en ambos paneles.
- [ ] Actualizar comentario del archivo y regla 6 de `docs/UI_THREAD_CONTRACT.md` para exigir 50/50 del espacio disponible, descontando gap. No eliminar el detalle unificado ni rediseñar tablet/display.

## 7. Tests obligatorios antes de dar por terminado

Agregar primero tests que fallen con el código actual, conservarlos y hacerlos pasar con las correcciones. Los tests raw existentes solo verifican texto; `LibraryRoom.test.tsx` usa renderToStaticMarkup, que no ejecuta efectos. Ninguno certifica carga lazy, timers o detección real. Quitar la prohibición textual de `await loadDetails`: no tiene fundamento de aislamiento.

### Unitarios / contratos

- [ ] TS, reconciliador: proveedor viejo error/no instalado + Steam instalado => instalado; JSON proveedor corrupto => consultar Steam; estimación tardía no degrada instalado; desinstalación local fresca invalida instalación previa. Cubrir actualización activa sin confundirla con instalación ausente.
- [ ] TS, caché: dos consumidores => una llamada; A-B-A => reutiliza; misma lista en array nuevo => ninguna repetición; aislamiento por modo/backend; vencimiento/invalidation; fallo permite retry; respuesta A nunca se muestra como B.
- [ ] TS, estimaciones: 20 selecciones con intervalo <700 ms => solo la última; cambio después de iniciar => máximo una pesada simultánea; respuesta tardía no toca instalación; remount no duplica in-flight.
- [ ] Rust, fixtures en directorio temporal y raíz Steam inyectada: biblioteca secundaria en libraryfolders.vdf, manifiesto instalado con BytesToDownload=0 y SizeOnDisk>0, manifiesto parcial/corrupto/ausente. Probar tamaños sin tocar instalación real del usuario.
- [ ] Python, parser fixture “Total bytes on disk: 1000000” => tamaño de instalación, no descarga. ETA con reloj inyectado: 1000 bytes restantes a 100 B/s => 10 s; pausa, reanudación, cero velocidad, total desconocido, completado => 0, valores negativos/NaN rechazados.

### Integración con React montado

Usar Vitest con entorno DOM (agregar jsdom y herramientas de montaje si faltan), Promises controladas, mocks de backend/native y fake timers. No usar SSR para estos casos.

- [ ] Catálogo de 60 juegos: instalado en posición 40 obtiene indicador/Play sin abrir modal legacy; máximo 4 probes simultáneos. Refresh equivalente no reinicia inventario completo.
- [ ] Mantener metadata/estimación pendientes: selección, búsqueda, scroll y foco siguen funcionando; título y lista visibles. Resolver/rechazar petición no borra catálogo. Probar A lento/B rápido y vuelta a A.
- [ ] Simular montaje/desmontaje/StrictMode: no duplicar consultas ni timers, sin actualizaciones a consumidor desmontado.
- [ ] Ronda de estado que tarda 6 segundos: nunca hay otra ronda simultánea del mismo recurso. Finalización actualiza tarjeta, detalle y colección instalada sin reiniciar fichas.
- [ ] Idle: a 30 s y 6:59 no entra; a 7:00 entra; wheel/pointermove/keydown a 6:59 difieren entrada otros siete minutos; polling/video no lo difieren; actividad sale; unmount limpia timer. Verificar display/tablet por separado.
- [ ] Play con disponibilidad ejecuta una sola vez el handler autorizado; sin disponibilidad no lanza; pulsar tarjeta solo selecciona; sin botones anidados. Lista permanece tras lanzamiento simulado.

### Integración visual / Tauri

- [ ] Agregar E2E de navegador (por ejemplo Playwright con bridge controlado) a 1280x800 y 1920x1080: anchos detalle/grilla difieren <=2 px descontando gap; sin overflow; Play visible. A 760 px y en tablet/display conservar layout específico. Medir layout computado, no buscar cadenas CSS.
- [ ] E2E con respuestas retenidas durante 10 s: seleccionar/buscar antes de liberarlas y verificar cambio visual mientras siguen pendientes. Esto prueba independencia, no solamente que una Promise exista.
- [ ] Prueba de integración nativa con worker lento inyectado y sin Steam real: durante estimación pendiente responde un comando ligero y el frontend sigue navegable. El test de navegador con mocks no demuestra aislamiento Rust.
- [ ] Rebuild final del artefacto exacto, registrar ruta, versión y commit de origen; verificar visualmente ese artefacto y guardar captura. No afirmar que el proceso antiguo contiene HEAD. No cerrar juego, detener descargas ni reemplazar binarios activos sin coordinarlo.

## Orden de ejecución y entrega

1. Releer estado Git y este diagnóstico; ubicar símbolos si cambiaron líneas. Añadir tests rojos para §1/§2 antes de modificar lógica.
2. Separar estado/caché y corregir descubrimiento. Luego semántica de tamaños/ETA.
3. Corregir idle, Play y layout conservando el flujo de lanzamiento.
4. Ejecutar unitarios TS/Rust/Python, integración montada y E2E. `npm test` y `npm run build` desde apps/desktop; registrar comandos exactos adicionales según la configuración real del proyecto.
5. Rebuild y prueba visual/nativa final. Entregar archivos modificados, causas corregidas, tests que fallaban/pasan, evidencia visual y limitaciones pendientes. No llamar completado a lo que solo pasó tests de cadenas o fue revisado estáticamente.

No implementar cambios fuera de este alcance, no reset/checkout destructivo, no commit/push ni limpieza de ejecutables sin pedido. Si alguna prueba requiere backend, licencia o descarga real, reportarla como pendiente y solicitar coordinación; no usar credenciales reales en fixtures/logs.

## 8. P0: ampliación solicitada — teclado y recuperación del foco

Esta ampliación forma parte obligatoria de la entrega, no es trabajo opcional. La aplicación debe poder operarse sin clics. Enter entra; Escape vuelve un nivel. Conservar seleccionado, filtro y scroll al navegar entre zonas.

### Diagnóstico adicional verificado

- `LibraryRoom.tsx:303` enfoca root al montar. `returnToGrid` y `onSelectGame` también enfocan root, pero no hay recuperación por foco de ventana en este componente. Su `onKeyDown` está en la sección: si el foco DOM queda afuera, no recibe teclas.
- `LibraryRoom.tsx:479-494` decide solamente entre grid/actions. No implementa Ctrl+F, navegación de pestañas ni PageUp/PageDown. El retorno temprano cuando no hay seleccionado también impediría resolver atajos globales si se agregaran después de esa condición.
- `LibraryRoomParts.tsx`, `handleGridKey`: Escape se consume sin hacer nada; izquierda en primera columna entra en acciones. Esto contradice el contrato solicitado: las flechas navegan juegos, Enter entra al detalle.
- `App.tsx:314` tiene Ctrl+F en otra superficie legacy; no resuelve la biblioteca LibraryRoom. El input de búsqueda en LibraryRoom aparece en la rama tablet, con stopPropagation: hace falta una búsqueda desktop accesible por teclado, reutilizando `searchQuery` y el filtro existente.
- `CatalogTabs.tsx` solo tiene onClick. Hay tres pestañas definidas: Propios, GameAccess y Store. `main.tsx`, CatalogShell, contiene esas pestañas como hermanas de `<App key={mode}/>`; cambiar modo remonta App. El controlador de navegación debe vivir por encima de ese remount.

### Contrato exacto de interacción

| Contexto / tecla | Resultado requerido |
| --- | --- |
| Ventana recupera foco | Restaurar foco operativo sin clic; conservar juego y zona válidos. Si el foco se perdió/body/nodo desmontado, recuperar grilla seleccionada. Si hay modal, recuperar ese modal. |
| Grilla + flechas | Navegar juegos por filas/columnas actuales, sin saltar al detalle al llegar al borde izquierdo. Mantener selección visible. |
| Grilla + Enter | Entrar al detalle y enfocar su primera acción habilitada; no lanzar/descargar con esa misma pulsación. |
| Detalle + Escape | Volver a grilla, mismo juego y scroll. |
| Ctrl+F | Enfocar búsqueda de la aplicación y evitar buscador del navegador; funciona incluso con catálogo vacío/error. |
| Búsqueda + Escape | Devolver foco a grilla **conservando consulta y resultados filtrados**. |
| Grilla filtrada + Escape posterior | Limpiar consulta, recuperar overview completo y mantener juego si sigue disponible. Si no hay filtro, no cerrar aplicación. |
| Tab / Shift+Tab en biblioteca | Activar siguiente/anterior pestaña superior disponible, con vuelta circular. Incluir Store solo si está disponible; no eliminarla. Restaurar selección por pestaña o primera tarjeta válida y foco de grilla al cargar. |
| PageUp / PageDown | Desplazar verticalmente una página del contenedor de la zona activa (grilla o detalle), no el documento global ni el otro panel. No cambiar pestaña. |
| Modal abierto | Teclas pertenecen al modal: Enter confirma la acción enfocada; Escape cancela/cierra; Tab recorre sus controles y no cambia catálogo. |

- [ ] Implementar controlador de foco/atajos de biblioteca en CatalogShell o servicio equivalente, con zonas explícitas `grid`, `detail`, `search`, `modal` y estado por modo. Mantener handlers desacoplados de la posición física de DOM y del montaje de App.
- [ ] Suscribirse a focus de ventana y visibilitychange; en Tauri cubrir foco nativo si WebView no emite el evento esperado. Ejecutar restauración tras DOM listo, sin repetir foco en cada render ni robarlo de inputs/modales válidos. Limpiar listeners.
- [ ] Respetar edición de texto, composición IME, controles multimedia y configuración de sesiones: flechas/Enter de un input no deben navegar/ejecutar juegos. Manejar Ctrl+F y Escape explícitamente; no interceptar atajos del sistema. Aplicar Tab de catálogo al contexto biblioteca, no indiscriminadamente a otros diálogos/superficies.
- [ ] Una pulsación ejecuta una sola transición. Evitar duplicados entre handler global, bubbling, click nativo de Enter y listeners legacy. Ignorar auto-repeat para lanzar, cancelar y cambiar pestaña; permitir repetición de navegación.
- [ ] Usar IDs estables de juego y acción; foco visible. Restaurar scroll por pestaña. No convertir un refocus en recarga de detalles/inventario. No usar bucle que fuerce focus continuamente.

## 9. P0: finalización de descarga, persistencia y acción exclusiva

### Diagnóstico adicional verificado

- `DownloadCompleteDialog.tsx` **ya existe**, con “Jugar ahora” y “Ahora no”. `LibraryRoom.tsx:263-268` lo abre al observar instalado entre descargas rastreadas. Conservarlo, no crear otro flujo de lanzamiento.
- `completedGame` es un solo valor: finalizaciones concurrentes pueden sobrescribirse. El diálogo no implementa foco inicial, retorno de foco ni manejo de Escape/aislamiento de teclado.
- `DownloadCompleteDialog` solo usa `copies_available > 0` para canPlay, mientras otras acciones admiten `local_primary_account_label`. Unificar la política compartida de disponibilidad, conservando autorización real, para no bloquear local de forma inconsistente.
- El manager Python sí persiste JSON por AppID con reemplazo temporal (`write_status`, `.gameaccess/downloads/status/app-{app_id}.json`). No es correcto decir que todo estado es volátil. Lo volátil es el estado React/seguimiento y su rehidratación está afectada por el corte de 24 y precedencia de §1.
- `LibraryRoomParts.tsx`, `buildActions`, devuelve **siempre dos acciones** Play/Download. Mientras descarga, Download muestra porcentaje y queda deshabilitado. `activateAction` en LibraryRoom asume índices fijos 0=Play y 1=Download: hay que corregirlo al pasar a acción exclusiva.

### Tareas

- [ ] Persistir instalación confirmada antes de abrir el diálogo; “Ahora no”, Escape, cerrar modal o fallo al lanzar no deben revertir instalado ni borrar archivos. “Jugar ahora” llama una sola vez al handler autorizado existente.
- [ ] Crear cola de finalizaciones por `(AppID, downloadJobId)` con reconocimiento persistido: una notificación por trabajo, sin duplicar por polling/remount. Si termina con UI cerrada, rehidratar resultado y ofrecer el diálogo pendiente una vez. No abrir diálogos para todos los juegos instalados descubiertos sin una descarga nueva asociada.
- [ ] Guardar estado durable en servicio/runtime, no únicamente en localStorage o React. Al reabrir navegador/app, cargar inventario persistido, luego reconciliar en segundo plano con archivos/manifiestos. Nunca presentar error de conexión como “no instalado”; indicar verificación pendiente manteniendo última evidencia conocida. Antes de lanzar, validar destino/permiso actual.
- [ ] Mantener instalación por máquina/AppID independientemente del modo de catálogo; licencia/disponibilidad y selección siguen siendo específicas del contexto. No persistir credenciales. Una desinstalación real sí invalida preparado/instalado.
- [ ] Derivar **una sola acción primaria**: no instalado => “Descargar”; descargando/preparando => “Cancelar descarga”; cancelando => “Cancelando…” deshabilitada; instalación confirmada => “Jugar”. Si no hay licencia, Jugar deshabilitado con razón, no ofrecer Descargar otra vez. En estado desconocido mostrar verificación, no inferir ausencia.
- [ ] Reemplazar dispatch basado en índices por `action.kind`; incluir cancelación. Mantener referencias/foco válidos al cambiar acción. Actualizar detalle, tarjeta y diálogo con el mismo selector/política; no dejar botones legacy contradictorios en superficies alcanzables.

## 10. P0: cancelación real con confirmación

En el flujo de proveedor revisado (`native.ts`, `provider_download.rs`, `provider_download_manager.py`) no se encontró ruta de cancelación. No basta con cambiar la etiqueta o eliminar el estado de UI: debe detener el trabajo real.

- [ ] Al pulsar “Cancelar descarga”, abrir confirmación “¿Cancelar la descarga de [juego]?” con “Seguir descargando” y “Cancelar descarga”. Escape equivale a seguir; foco inicial en seguir; conservar progreso mientras se pregunta.
- [ ] Implementar comando asíncrono de cancelación por AppID + jobId, idempotente. Registrar propiedad e identidad del proceso/trabajo al iniciarlo. Cancelar preparación/validación pendiente y downloader hijo de **ese** trabajo; no terminar todos los Python, Steam ni otras descargas. Preferir señal cooperativa; timeout y terminación solo del árbol propio verificado si fuera necesario.
- [ ] Añadir estados explícitos cancelling/cancelled, confirmación del worker y persistencia atómica. No declarar cancelado hasta detener transferencia. Si falla, mostrar error recuperable sin fingir éxito.
- [ ] Resolver carrera completar/cancelar con transición terminal serializada: si instalación ya terminó y fue validada, conservar installed y responder “ya completada”; nunca degradar ni borrar una instalación completa por cancelación tardía. Eventos antiguos no resucitan un job cancelado.
- [ ] Conservar archivos parciales por defecto para eventual reanudación; no prometer reanudación si downloader no la soporta. Volver a ofrecer Descargar al cancelar; una descarga parcial no es lista para jugar. No borrar carpetas instaladas ni liberar licencias de otras sesiones. Liberar solo recursos/reservas efectivamente pertenecientes al trabajo cancelado usando mecanismos existentes.
- [ ] Cubrir el modo local sin atribuirle control inexistente: verificar el mecanismo admitido para detener una descarga administrada por Steam. Si no hay control programático soportado, documentar bloqueo y ofrecer abrir gestión de Steam; no simular cancelación ni matar Steam. Reportar esta parte como pendiente hasta comprobar una cancelación real.

## 11. Pruebas adicionales obligatorias de esta ampliación

- [ ] Integración montada: seleccionar juego 15, blur/focus con activeElement=body, ArrowRight sin clic => juego siguiente; Enter => detalle sin lanzamiento; Escape => mismo juego en grid. Con modal abierto, refocus conserva modal. Sin duplicados bajo StrictMode.
- [ ] Ctrl+F escribe filtro; Escape mantiene consulta y permite flechas; segundo Escape limpia filtro. Repetir con cero resultados y catálogo vacío. Flechas al editar texto no mueven selección.
- [ ] Tab/Shift+Tab cambian pestaña una vez por pulsación, respetan disponibilidad, conservan selección/filtro/scroll por modo y no disparan recargas pesadas. En diálogo recorren botones, no catálogo.
- [ ] PageDown/PageUp verifican scrollTop del panel activo con contenido largo: otro panel y window.scrollY no cambian. Comprobar foco visible y selección visible por flechas.
- [ ] Matriz de acciones: no instalado solo Descargar; activo solo Cancelar; cancelando solo Cancelando; instalado solo Jugar. Enter ejecuta la acción por kind después de cada transición, no por índice antiguo.
- [ ] Finalización abre diálogo una vez; aceptar/no/Escape preservan instalado. Dos finalizaciones => cola sin pérdidas. Error de launch no revierte instalación. Disponibilidad local y GameAccess se evalúa consistentemente.
- [ ] Test de persistencia con **contexto de navegador nuevo**, no solo remount: completar con servicio/fixture durable, cerrar contexto y abrir otro => Play, incluso en juego 40. Probar finalización con UI cerrada y ausencia de repetición tras reconocer diálogo. Reiniciar servicio contra almacenamiento temporal y verificar rehidratación.
- [ ] Cancelar confirmación con Escape => worker continúa; confirmar => solo job objetivo termina, sin diálogo de completado, vuelve Descargar, persiste cancelado. Repetir cancelación es inocuo. Fallo de cancelación visible; instalación completada durante confirmación queda instalada. Eventos tardíos no cambian terminal.
- [ ] Integración worker con procesos de prueba inocuos y temporales: dos jobs concurrentes, cancelar uno durante preparación y otro caso durante transferencia; el no seleccionado sigue. No usar Steam real para unit tests.
- [ ] Smoke en artefacto Tauri exacto: Alt+Tab fuera/dentro y navegar toda la secuencia con teclado, sin clics; comprobar modal de finalización y refocus tras regresar del juego. Las simulaciones DOM no prueban foco nativo real.

Integrar §8–§11 en el orden de entrega: resolver estado durable/acciones y controlador de teclado junto con §1–§2, y completar tests antes de rebuild final. Esta ampliación no autoriza al modelo que redacta el diagnóstico a implementar las correcciones.

## 12. Script raíz de build/run y sello visible de compilación

Corrección posterior del usuario: este script y el sello visible sí deben implementarse en esta entrega, con commit y push junto al documento. Las correcciones de §1–§11 siguen siendo tareas para el otro modelo. Se añadieron `build-and-run.ps1`, `BuildStamp.tsx`, definición de timestamp en Vite y documentación README. Las casillas siguientes conservan la especificación y deben contrastarse con la evidencia de verificación; no implican que todos los escenarios de prueba estén cubiertos.

Hallazgo durante implementación: `GameAccess-latest.build.json` identificaba el EXE raíz antiguo como copia de `gameaccess-runtime.exe`; `src/bin/gameaccess-runtime.rs` inicia solamente local_bridge. El script copia explícitamente `gameaccess-desktop.exe`, aunque la CLI Tauri anuncie el runtime como último binario construido. El primer ensayo encontró un fallo de File.Replace con backup null en Windows PowerShell; se corrigió usando backup temporal explícito. La suite frontend ampliada pasa 41 tests. No se da por cubierta la matriz completa de fallos ni la validación visual nativa por estos tests.

- [ ] Crear `build-and-run.ps1` en la raíz del repositorio. Resolver rutas desde `$PSScriptRoot`, no desde el directorio de invocación; funcionar desde otra carpeta y con rutas que contengan espacios. Propagar errores con código de salida no cero y mensajes de fase claros.
- [ ] Cerrar la aplicación Tauri de este proyecto antes de compilar. Identificar procesos por ruta absoluta verificada del ejecutable raíz y del release de este repositorio, no por coincidencia genérica de nombre. Pedir cierre normal, esperar con timeout y terminar solamente esos procesos si no cierran. No cerrar juegos, Steam, backend ni workers de descarga. Si un bootstrapper lanza otro proceso, verificar su ruta/identidad antes de incluirlo.
- [ ] Ejecutar el build de producción Tauri usando la configuración y scripts reales de `apps/desktop`; inspeccionar sus hooks para no omitir ni duplicar innecesariamente el build frontend. Verificar cada exit code. No distribuir un ejecutable antiguo cuando falle compilación.
- [ ] Usar siempre el mismo destino raíz `GameAccess-latest.exe`, sobrescribiéndolo tras build exitoso. No crear nombres numerados o fechados ni aumentar la versión comercial solo para distinguir builds. Verificar que el origen sea el ejecutable principal de release, no uno de tests o de `deps`.
- [ ] Copiar primero a un temporal hermano, verificar integridad y reemplazar el destino solo con artefacto válido. Conservar el ejecutable anterior si el build falla; reportar explícitamente fallo de reemplazo por bloqueo/permisos. Limpiar únicamente temporales creados por este script. Registrar ruta origen/destino y hash final.
- [ ] Tras reemplazo exitoso, abrir exactamente `GameAccess-latest.exe` desde la raíz. No ejecutar el anterior si hubo error. El script solicitado es build-and-run, no solo empaquetado; no requiere crear instalador NSIS salvo dependencia real del proyecto.
- [ ] Generar un único sello UTC de build en formato ISO 8601 para la compilación y embeberlo en la aplicación. Mostrarlo de forma visible y legible en la ventana principal, por ejemplo `Build: 2026-09-05T18:30:00Z`; puede acompañarse de hora local y hash corto de commit. No usar fecha de apertura, fecha del navegador ni mtime del archivo como sustituto.
- [ ] Incluir metadata en dependencias de rebuild de frontend/Rust según dónde se consuma: una compilación consecutiva debe actualizar el sello aunque no cambie código. Mantener sello consistente entre ambas capas si ambas lo muestran. No editar manualmente archivos fuente/versionados en cada build; usar mecanismo generado/ignorado y definir fallback explícito para modo desarrollo.
- [ ] No agregar EXEs, secretos, logs, target, bin/obj ni metadata efímera a Git. Documentar en README cómo ejecutar el script y dónde verificar el sello en pantalla.

### Validación y entrega del implementador

- [ ] Testear helpers con comandos/procesos simulados: app ausente; app presente; proceso ajeno de nombre parecido no termina; build fallido no reemplaza ni ejecuta destino; destino bloqueado devuelve error; rutas con espacios; invocación desde otro cwd; copia/hash correctos; launch apunta al destino raíz.
- [ ] Ejecutar dos builds consecutivos y comprobar nombre constante, reemplazo del archivo y sello nuevo embebido. Abrir el ejecutable raíz y verificar visualmente que el sello mostrado coincide con el de ese build, incluso después de cerrar/reabrir.
- [ ] Verificar un fallo de build controlado sin perder el último ejecutable válido. No provocar descargas reales ni terminar juegos para la prueba.
- [ ] Entregar commit y push del script, integración del sello, tests y documentación correspondiente después de verificar; informar hash, rama, destino remoto y estado final de Git. No incluir cambios ajenos ni usar force-push.
