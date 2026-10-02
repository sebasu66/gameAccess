# Game Access — TODO central

> **Cola autoritativa de trabajo pendiente**
>
> Última revisión: **2026-10-01**
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

## P1 — Continuidad de partidas

- [ ] Medir cobertura/fiabilidad de rutas de guardado por juego usando `game_data_path` y/o PCGamingWiki.
- [ ] Crear perfil local de progreso por usuario de Game Access y juego.
- [ ] Para juegos compatibles, respaldar/restaurar saves de forma segura sin escribir mientras el juego/Steam los utiliza.
- [ ] Registrar compatibilidad y excluir automatización cuando el save dependa de SteamID interno u otra condición no portable.
- [ ] Verificar interacción con Steam Cloud antes de habilitar restauración automática.

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

- [ ] Publicar landing y descarga Windows en URL estable.
- [ ] Definir estrategia de actualización del cliente y versión mínima soportada por backend.
- [ ] Firmar instalador/ejecutable cuando se prepare distribución pública.
- [ ] Añadir backups, recuperación, rate limiting y controles de abuso antes de una beta abierta.
- [ ] Realizar revisión legal/plataforma antes del lanzamiento comercial público.

## P3 — Demanda y negocio

- [ ] Registrar telemetría útil: búsquedas, vistas, intento de Play, asignación exitosa, falta de cuenta, sesiones completadas y tiempos de espera.
- [ ] Construir métricas de demanda/concurrencia por juego antes de automatizar compras de inventario.
- [ ] Mantener investigación de proveedores/ofertas separada del launcher y someter cualquier automatización a los términos vigentes de las plataformas.

## Reglas para mantener este TODO

- No volver a agregar Steam Family como scheduler/capacity gate salvo una decisión explícita posterior.
- No volver a agregar `user_id=1`, IP o fingerprint como identidad de lease: usar `installation_id`.
- No tratar errores ambiguos como `InvalidPassword`.
- No convertir timeout de lease en logout/cierre local.
- No volver a agregar fichas/créditos al flujo activo de la beta salvo nueva decisión explícita.
- Cuando una tarea se completa, **eliminarla de este archivo** después de registrar la evidencia en commit/docs. Git es el historial.
