# Game Access — TODO central

> **Cola autoritativa de trabajo pendiente**
>
> Última revisión: **2026-10-06**
>
> Este archivo contiene solamente trabajo pendiente que sigue siendo compatible con la arquitectura actual. Las tareas completadas, reemplazadas o descartadas se eliminan de aquí; Git conserva su historial.
>
> Las reglas vigentes de acceso, leases, offline play, credenciales y elegibilidad de cuentas están documentadas en `README.md` y `skill.md`. Si una tarea contradice esas reglas, prevalecen esos documentos.

## P0 — Probar la arquitectura actual de acceso y leases

- [ ] **Generar un instalador nuevo desde `dev`** con los cambios actuales de activación, leases por `installation_id`, presencia Steam server-side, mensajes de expiración y política simplificada de cuentas.
- [ ] Verificar que el backend de Render esté desplegando el commit actual de `dev` y que la variable `STEAM_WEB_API_KEY` tenga un valor válido. No registrar ni copiar el secreto a Git, logs o cliente.
- [ ] Hacer una prueba end-to-end con una key suficientemente larga: activar Game Access, pedir un juego, recibir una cuenta, iniciar Steam y lanzar el juego.
- [ ] Confirmar en logs del backend que la lease queda asociada al `installation_id` correcto y que la presencia Steam detecta actividad online mientras el juego está activo.
- [ ] Probar liberación por inactividad online: poner Steam en Offline Mode o quitar conectividad de Steam, mantener el juego abierto y confirmar que después de **10 minutos continuos sin evidencia online válida** el backend libera la cuenta con razón `steam_inactive_timeout`.
- [ ] Confirmar que la liberación server-side **no cierra Steam, no mata el juego, no cambia de cuenta y no interrumpe el juego local/offline**.
- [ ] Confirmar que el cliente muestra el aviso de lease liberada y explica que se puede seguir jugando con Steam Offline Mode o sin conexión. Si el cliente estaba sin red, mostrarlo cuando vuelva a poder consultar el backend.
- [ ] Probar reutilización: el mismo `installation_id` pide otro juego accesible por la misma cuenta y reutiliza la lease/cuenta sin nuevo login innecesario.
- [ ] Probar exclusividad: otro `installation_id` no puede usar esa identidad Steam mientras exista una lease activa; después de liberarse sí puede recibirla.
- [ ] Probar expiración de acceso: aviso a **T-10 minutos**, expiración efectiva, limpieza de la sesión de Game Access y vuelta al gate de activación sin cerrar el juego/Steam ya abiertos.
- [ ] Revisar logs de una prueba completa y confirmar que toda denegación/liberación relevante contiene acción, instalación, juego/lease/cuenta cuando corresponda y una razón concreta, sin secretos.

## P0 — Validar la política simplificada de cuentas

- [ ] Probar con una cuenta cuyo `ProviderAccount.status` histórico figure `disabled` o `inactive`, pero cuya credencial no esté marcada `invalid_password`; debe seguir siendo candidata si tiene acceso conocido al AppID.
- [ ] Provocar de forma controlada un **`InvalidPassword` real de Steam** y verificar que esa identidad sale del pool inmediatamente, tanto si ocurre en Play como durante Download/scan.
- [ ] Volver a cargar el **mismo login Steam** con la contraseña nueva válida y confirmar que se actualiza/reactiva la cuenta original en vez de crear otra.
- [ ] Verificar en una base que contenga duplicados históricos `login` / `login#2` que el sync consolida mappings, leases y referencias hacia una sola identidad canónica.
- [ ] Confirmar que errores transitorios —Steam ocupado, Steam Guard, timeout, red, API, scan incompleto— nunca convierten la cuenta en `invalid_password`.
- [ ] Confirmar que Steam Family permanece solamente como metadata/diagnóstico y no modifica Play, Download ni los contadores operativos de disponibilidad.

## P0 — Release e instalación limpia

- [ ] **Actualizar la animación del logo/splash** para usar la versión nueva del logo de Game Access. Reemplazar los assets/frames anteriores sin reintroducir logos viejos y verificar la animación real en el build Tauri/instalador.
- [ ] Construir el instalador exacto desde el commit probado y registrar commit, hash del artefacto y build stamp visible.
- [ ] Instalar en una máquina/VM Windows limpia y verificar que Game Access no depende de Node, Rust, Python ni archivos del checkout de desarrollo.
- [ ] Confirmar conexión al backend remoto, activación, catálogo, imágenes, descarga, Play, mensajes de error y actualización de estado después de reiniciar la aplicación.
- [ ] Verificar detección de **todas** las bibliotecas Steam configuradas en el equipo, no solamente la principal.
- [ ] Confirmar que la aplicación permanece en modo ventana normal y que no cubre ni reemplaza la barra de tareas.
- [ ] Revisar todos los textos visibles del flujo principal y eliminar strings técnicos/ingleses accidentales cuando exista un mensaje de usuario en castellano.

## P0 — Catálogo y datos de proveedores

- [ ] Ejecutar un refresh completo del inventario de cuentas proveedoras con el scanner actual y comparar conteos contra el catálogo vigente.
- [ ] Mantener ownership válido por proveedor aunque otra cuenta falle el scan. Un fallo parcial debe conservar la última evidencia buena de las demás cuentas y registrar diagnóstico/retry.
- [ ] Mantener fuera del catálogo final DLC, tools, software, soundtracks y otros tipos no-juego; AppIDs todavía sin clasificar quedan pendientes de metadata y no deben destruir ownership conocido.
- [ ] Completar metadata pendiente del catálogo sin bloquear la navegación ni convertir fallos/rate limits de Steam en pérdida de licencias.
- [ ] Revalidar el caché local del catálogo en Tauri: primer arranque, segundo arranque, reutilización de snapshot, overlay liviano de disponibilidad, búsqueda/filtros locales y fallback cuando la caché no existe.
- [ ] Definir y validar el empaquetado de artwork estático del catálogo para que una instalación nueva no tenga que poblar miles de imágenes una por una desde Internet.
- [ ] Mantener trailers/videos fuera del instalador y obtenerlos on-demand.
- [ ] Añadir un smoke test de release que detecte catálogo corrupto, assets faltantes y referencias a tipos no-juego antes de publicar.

## P0 — Linkvertise / obtención de acceso

- [ ] Grabar/incorporar el video real del recorrido de obtención de acceso.
- [ ] Conectar el flujo oficial de Linkvertise al backend y validar una prueba real de finalización antes de emitir acceso.
- [ ] Evitar claves/sesiones en URLs; asociar de forma segura navegador ↔ intento de activación de la instalación.
- [ ] Permitir que Tauri detecte la autorización emitida por el servidor y complete la activación automáticamente, manteniendo la clave manual como fallback.
- [ ] Añadir al estado de acceso vencido una acción clara para generar otra key siguiendo el mismo procedimiento una vez que el flujo definitivo esté conectado.

## P1 — Detección local de AFK y liberación voluntaria de capacidad

> **Pendiente para más adelante. No implementar en el ciclo actual.**
>
> Objetivo: si el usuario realmente dejó la PC, liberar la cuenta central aunque el juego siga figurando online, sin tocar la sesión local.

- [ ] Detectar inactividad **a nivel del sistema operativo**, no solamente eventos del WebView. Considerar teclado, mouse y, si el juego se usa con él, **gamepad/controlador** para evitar falsos AFK.
- [ ] Umbral inicial: **10 minutos sin input del usuario**.
- [ ] Al alcanzar el umbral, mostrar un popup nativo visible sobre la experiencia de juego: **“¿Sigues ahí?”** con countdown. Usar inicialmente **60 segundos** de gracia; dejar el valor configurable para poder probar 30–60 s.
- [ ] Cualquier input válido o una respuesta afirmativa durante la gracia cancela el AFK y mantiene la lease.
- [ ] Si no hay respuesta al finalizar la gracia, el cliente informa al backend con una razón explícita, por ejemplo `client_afk_timeout`.
- [ ] El backend libera **solamente la lease/capacidad central**. No enviar logout, no cerrar Steam, no matar el juego y no forzar cambio de cuenta.
- [ ] Mostrar/loguear una explicación clara: la cuenta se liberó por ausencia de actividad local, pero el juego local puede continuar mientras Steam/juego lo permitan.
- [ ] Hacer la operación idempotente y segura ante pérdida de red: si el cliente no puede avisar, no fingir que la lease fue liberada; reintentar/reportar estado cuando vuelva la conexión.
- [ ] Probar fullscreen, juego en segundo plano, Alt+Tab, bloqueo de Windows, Remote Desktop y uso solo con controller antes de activar esta política en producción.
- [ ] Registrar telemetría mínima para medir falsos positivos: detección AFK, popup mostrado, respuesta, timeout y liberación, sin registrar teclas ni contenido de input.

## P1 — Continuidad y unificación de partidas guardadas

> Objetivo: que el progreso pertenezca al **usuario de Game Access + juego**, no a la cuenta Steam proveedora que haya tocado usar en una sesión concreta.

- [ ] Medir cobertura/fiabilidad de rutas de guardado por juego usando `game_data_path` y/o PCGamingWiki, incluyendo Steam `userdata`, Documentos, AppData y rutas específicas del juego.
- [ ] Crear un perfil canónico de saves por **usuario de Game Access + AppID/juego**. Cambiar de cuenta Steam proveedora no debe crear un progreso separado cuando el juego permita portar los saves.
- [ ] Antes de lanzar un juego con otra cuenta Steam, localizar el save canónico de Game Access y preparar/copiar/restaurar el progreso en la ruta que esa sesión vaya a usar.
- [ ] Al cerrar el juego, detectar qué archivos cambiaron y fusionar/capturar el progreso de vuelta al save canónico del mismo usuario+juego.
- [ ] Definir una estrategia segura de **merge/conflictos**: no sobrescribir silenciosamente una partida más nueva; comparar timestamps/hash/slots y conservar backups antes de reemplazar.
- [ ] Cuando el formato del juego permita múltiples slots independientes, preservar todos los slots; cuando no sea fusionable de forma segura, elegir una versión explícitamente o mantener ambas copias para recuperación.
- [ ] Para juegos compatibles, respaldar/restaurar saves sin escribir mientras el juego o Steam los utiliza.
- [ ] Registrar compatibilidad por juego y excluir automatización cuando el save dependa de SteamID interno, cifrado por cuenta u otra condición no portable.
- [ ] Verificar interacción con Steam Cloud: evitar carreras donde Cloud restaure una versión vieja o vuelva a subir una versión equivocada al cambiar de cuenta proveedora.
- [ ] Diseñar una UI mínima de recuperación/historial para conflictos o restauración manual, sin exponer al usuario la complejidad de las cuentas proveedoras salvo que sea necesario.

## P1 — Implementar el diseño Digital aprobado (2026-10-06)

> Revisión local 2026-10-07: corregida la composición de grilla, buscador y footer; ficha con estructura independiente de las reglas antiguas, hero panorámico, dos columnas y acciones ancladas. Fuentes empaquetadas y tema centralizado. Build y 206 tests verificados; overview comprobado en cliente Tauri y ficha/Enter/Escape en componentes reales con datos de prueba. Pendiente aceptación visual y validación completa de ficha/descargas con datos reales.

> Diseño de referencia aprobado; implementación pendiente. Alcance principal: presentación y navegación del cliente. Conservar descargas, ejecución, instalación, favoritos, cuenta, ajustes y demás servicios existentes.
>
> Mockup aprobado: `docs/design/gameaccess-ui-2026-10-06/gameaccess-mockup.html`. Referencias finales en esa carpeta: `detail-wide-hero.jpg` y `overview-footer-type.jpg`. Los datos de muestra del HTML no deben convertirse en datos de producción.

### Preparación y estilos mantenibles

- [ ] Actualizar el contrato de detalle desktop/UX durante la implementación; el nuevo diseño reemplaza las disposiciones anteriores que entren en conflicto, manteniendo los comportamientos funcionales vigentes.
- [ ] Trazar la integración en `LibraryRoom.tsx`, `DownloadCatalogPanel.tsx`, la ficha actual y las superficies existentes de toolbar/actions. Reutilizar controladores, caché de metadata, estado de instalación/descarga y servicios Digital; evitar otra implementación paralela de esas funciones.
- [ ] **Centralizar todo el estilo de este diseño en un único archivo `apps/desktop/src/gameaccess-theme.css`, importado una sola vez.** Consolidar allí las reglas que afecten grilla, buscador, footer, ficha, menú y botones; retirar los overrides visuales reemplazados. Los componentes no deben duplicar colores, fuentes, espaciado ni animaciones mediante estilos inline.
- [ ] Comentar el archivo CSS con un índice y secciones de tokens, tipografía, grilla, buscador/navegación, footer, overlay, medios, acciones/menú, animaciones, estados y adaptación a ventanas. Explicar usos, capas/z-index, límites de tamaño y motivos de reglas no obvias; definir colores, pesos, medidas y duraciones como variables CSS. Reservar valores calculados desde JS para geometría/estado mediante variables CSS, sin trasladar allí el tema visual.
- [ ] Aplicar la paleta aprobada: grafito/vidrio oscuro, blanco legible y acento naranja intenso `#ff6a00`; acciones naranjas con texto/símbolos negros. Usar Manrope en la interfaz y Bebas Neue en títulos de ficha, con fuentes empaquetadas y fallback. Mantener el footer fino con Manrope en mayúsculas, blanco, peso 700, espaciado de letras y mayor separación entre controles.
- [ ] Usar iconos rellenos y con mayor ocupación dentro de sus contenedores: referencia de escritorio de 30 px para lupa/Catálogo/Biblioteca y 22 px para footer, adaptados en ventanas estrechas. Mantener etiquetas accesibles y foco visible; el círculo del tráiler conserva unos 65 px, ampliando el **triángulo** (SVG de referencia 48 px), sin agrandar todo el botón.

### Overview, navegación y búsqueda

- [ ] Convertir la pantalla principal en una grilla de juegos a todo el espacio útil; mostrar la ficha únicamente después de clic o Enter. Conservar navegación por flechas, foco y posición de scroll.
- [ ] Dejar Digital como modo inicial activo y ocultar/deshabilitar por ahora los accesos Propios/GameAccess. Mantener sus capacidades subyacentes para una reactivación futura, sin mezclar servicios Steam/proveedores con Digital.
- [ ] Sustituir las pestañas Catálogo/Instalados/Favoritos por dos botones circulares externos al buscador: **Catálogo** y **Biblioteca** (instalados más favoritos). Revelar sus nombres al hover y al foco del teclado; mostrar claramente el seleccionado.
- [ ] Situar el buscador redondeado, flotante sobre la base de la grilla, junto a esos dos botones. Llevar géneros, modo de juego, orden, descargas, actualizar, ajustes y cuenta al footer inferior, sin solapamientos. Preservar búsqueda por teclado y acceso a todos los controles en ventanas pequeñas.
- [ ] Mantener búsqueda enriquecida por título, géneros, etiquetas y demás campos ya disponibles en la base canónica; diferenciar géneros de funciones Steam. No introducir datos de ejemplo ni asumir metadata ausente.
- [ ] Implementar selección múltiple **inclusiva (OR)** para Un jugador, Co-op Local, Co-op LAN, Co-op Online, Multiplayer Local, Multiplayer LAN, Multiplayer Online y MMO. Combinar ese conjunto con búsqueda/géneros; sin modos marcados, no restringir por modalidad. Usar evidencia real de la base/Steam y conservar como desconocidos los casos sin clasificación suficiente.
- [ ] Mostrar favoritos en ambas vistas, incluso si no están instalados, conservando su icono. Filtrar primero y ordenar siempre los favoritos coincidentes antes del resto, respetando el orden elegido dentro de cada grupo; no insertar favoritos ajenos a la búsqueda.
- [ ] Mantener portadas sin esquinas redondeadas, borde fino de selección y reflejo de vidrio sutil. Ajustar su tamaño a cantidad de resultados, espacio real de ventana y escalado: referencia proporcional de 0,70× a 1,50×, con límites iniciales de 120–360 px CSS y ajuste por altura/columnas. Probar 50, 15 y 5 resultados sin añadir todavía información adicional a las tarjetas.
- [ ] Mostrar hasta unos 50 juegos por bloque/vista mediante el mecanismo de paginación o virtualización apropiado, conservando acceso al resto del catálogo. Aplicar favoritos/orden sobre todos los resultados antes de paginar; no limitar la búsqueda a los primeros 50 registros.

### Ficha de juego y menú de opciones

- [ ] Abrir la ficha como overlay de vidrio oscuro semitransparente. Escape o X vuelve al overview restaurando foco/scroll; gestionar focus trap y cierre de submenús antes de cerrar la ficha. Cargar detalles de forma diferida desde la caché y evitar respuestas obsoletas al cambiar rápidamente de juego.
- [ ] Mostrar **Library Hero ultrapanorámico de Steam a todo el ancho superior**, como imagen de cabecera, sin usar la portada ampliada de fondo ni la cápsula Header con título incrustado. Colocar el título debajo, en la columna izquierda; definir recorte adaptable y fallback si falta artwork.
- [ ] Dejar información a la izquierda y tráiler/capturas a la derecha. Mostrar título, tamaño real en GB cuando exista, año, géneros y modalidades; alojar descripción completa, idiomas, etiquetas, datos adicionales, reseñas y valoración de usuarios en un panel vertical desplazable con texto blanco, mayor peso y tamaño legible.
- [ ] Mostrar valoraciones reales (etiqueta positiva/mixta/negativa, porcentaje y cantidad cuando existan) sin forzar reseñas positivas; usar el estado explícito de datos no disponibles. Conservar las acciones de feedback existentes.
- [ ] Mantener las descargas con una presentación similar al cliente actual: un toast compacto con estado/progreso y, al pulsarlo o activarlo con Enter, abrir un overlay grande con la cola y los controles existentes de pausa, reanudación y cancelación. Reutilizar el gestor Digital actual; cerrar con Escape/X, devolver foco al toast y mantener la descarga activa al cerrar el overlay.
- [ ] Mantener Descargar/Cancelar/Pausar/Reanudar/Jugar según el estado real, con acción principal accesible y visible dentro del viewport. Reutilizar la cola Digital, errores, progreso, reconciliación y ejecución actuales; el cambio visual no altera estos flujos.
- [ ] Preservar reproducción de vídeo/capturas, inicio silenciado, controles, fallback y pausado/limpieza al cerrar la ficha o lanzar un juego. Evitar autoplay de múltiples vídeos durante la navegación.
- [ ] **Añadir un botón “…” en la ficha**, con nombre accesible “Más opciones”, menú anclado y navegación por teclado. Incluir **Abrir carpeta del juego** y **Desinstalar**, habilitados según el estado real de instalación/descarga; cerrar con Escape/clic exterior y devolver el foco al botón.
- [ ] Reutilizar las operaciones existentes: Digital mediante `DigitalCatalog.openInstallFolder/uninstall` y sus servicios; las acciones Steam conservan su ruta propia en `GameStorageContextMenu`/`gameStorage`. Pedir confirmación antes de desinstalar y refrescar estado tras completarlo; mostrar errores reales sin perder la instalación o la descarga.
- [ ] Inventariar e incorporar al menú otras opciones útiles ya soportadas según juego/estado (favoritos, acciones de descarga y acceso a Steam cuando corresponda). No mostrar acciones ficticias ni introducir nuevas operaciones de almacenamiento dentro del cambio cosmético.
- [ ] Aplicar iluminación de borde, reflejo breve y animación sutil de iconos al hover/foco de acciones, con una única definición en el CSS central y soporte de `prefers-reduced-motion`. Lottie/Lordicon queda como alternativa por evaluar, no una dependencia obligatoria del diseño aprobado.

### Validación e integración

- [ ] Probar favoritos y orden global con búsquedas y ambas vistas; combinaciones OR de modalidades, resultados vacíos y metadata incompleta. Validar con datos reales, no con las banderas ilustrativas del mockup.
- [ ] Verificar tamaños de tarjetas y legibilidad con resoluciones, zoom/escalado DPI y ventanas reducidas, incluyendo títulos largos, 50/15/5 resultados, footer, submenú y acciones; sin controles cortados ni scroll horizontal accidental.
- [ ] Verificar clic/Enter, flechas, Tab, Escape/X, apertura/cierre de “…” y restauración de foco/scroll; comprobar permisos/estado de las acciones de carpeta/desinstalación y ausencia de regresiones en descarga/Play.
- [ ] Implementar por ramas/PR en GitHub, sincronizar los commits publicados a `C:/DEV/Game Access Dev`, ejecutar los checks/build y pruebas de Tauri correspondientes y registrar el commit exacto verificado. Realizar revisión visual final con el usuario sobre la aplicación real; eliminar de este TODO solo las tareas efectivamente completadas.

## P1 — UX pendiente del cliente

- [ ] Terminar auditoría de navegación por teclado/foco: retorno desde juego, Enter/Escape, búsqueda, modales y recuperación del foco sin clics.
- [ ] Unificar acción primaria de juego: Descargar / Cancelar / Jugar según estado real, sin botones contradictorios.
- [ ] Verificar cancelación real de descargas administradas por Game Access sin matar Steam ni otros jobs.
- [ ] Persistir/reconciliar correctamente estado de descarga e instalación después de cerrar/reabrir la app.
- [ ] Mantener el diálogo de descarga terminada con **Jugar ahora / Ahora no**, sin perder instalaciones ni duplicar notificaciones.

## P2 — Backend y operación

- [ ] Migrar el estado central desde SQLite a PostgreSQL/Supabase cuando la beta requiera persistencia/concurrencia superiores.
- [ ] Mantener el backend independiente del checkout/cliente y con URL estable.
- [ ] Completar panel/admin para cuentas proveedoras, catálogo, clientes, activaciones, leases, disponibilidad y logs de decisiones.
- [ ] Añadir observabilidad de presencia Steam: número de leases activas, checks OK/unknown/error, idle grace y liberaciones.
- [ ] Implementar waitlist/reserva corta por juego si la demanda real demuestra que aporta valor.
- [ ] Probar dos o más clientes Windows reales contra el mismo backend y cubrir carreras de asignación.

## P2 — Publicación

- [ ] **Crear la página web pública de Game Access**: landing clara, explicación del servicio, requisitos, preguntas frecuentes básicas y CTA principal de descarga.
- [ ] Publicar desde esa web el **instalador Windows vigente** mediante una URL estable; mostrar versión/build y evitar que una página vieja apunte a un instalador obsoleto.
- [ ] Incluir en la web el flujo para obtener/renovar acceso cuando Linkvertise esté listo, además de ayuda básica de instalación y primer inicio.
- [ ] Definir hosting/dominio definitivo de la web y separar contenido público de cualquier panel/admin o secreto del backend.
- [ ] Definir estrategia de actualización del cliente y versión mínima soportada por backend.
- [ ] Firmar instalador/ejecutable cuando se prepare distribución pública.
- [ ] Añadir backups, recuperación, rate limiting y controles de abuso antes de una beta abierta.
- [ ] Realizar revisión legal/plataforma antes del lanzamiento comercial público.

## P3 — Demanda y negocio

- [ ] Registrar telemetría útil: búsquedas, vistas, intento de Play, asignación exitosa, falta de cuenta, sesiones completadas y tiempos de espera.
- [ ] Construir métricas de demanda/concurrencia por juego antes de automatizar compras de inventario.
- [ ] Mantener investigación de proveedores/ofertas separada del launcher y someter cualquier automatización a los términos vigentes de las plataformas.

## Reglas para mantener este TODO

- [ ] Validar con mando físico en el cliente Tauri el modo Pantalla grande: cruceta/stick, A/B, teclado de búsqueda, filtros, LB/RB, LT/RT, desconexión y regreso desde un juego. Implementación y pruebas del controlador simulado documentadas en `docs/BIG_SCREEN_CONTROLS.md`.

- No volver a agregar Steam Family como scheduler/capacity gate salvo una decisión explícita posterior.
- No volver a agregar `user_id=1`, IP o fingerprint como identidad de lease: usar `installation_id`.
- No tratar errores ambiguos como `InvalidPassword`.
- No convertir timeout de lease en logout/cierre local.
- No volver a agregar fichas/créditos al flujo activo de la beta salvo nueva decisión explícita.
- Cuando una tarea se completa, **eliminarla de este archivo** después de registrar la evidencia en commit/docs. Git es el historial.
