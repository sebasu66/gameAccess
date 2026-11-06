---
tipo: pruebas
actualizado: 2026-10-29
---
# Pruebas pendientes de Seba

> Lista de lo nuevo que hay que **revisar y probar**, con dónde está el código y cómo probarlo. Tildar cada punto cuando se haya probado (o anotar qué falló en [[Mensajes]]). Lo que se agrega al proyecto y queda sin probar se suma acá; las tareas siguen en [[Tareas]] y lo hecho en [[Log]]. Todo lo de abajo está en `dev`.

**Cómo se prueba cada cosa**
- 🌐 **En el navegador, ahora, sin instalar nada**: `npm --prefix apps/desktop run dev` y abrir `http://127.0.0.1:38148/?uiDemo=1`. Solo sirve para ver pantallas: no hay Windows, ni cuentas, ni claves guardadas.
- 🖥️ **Con la app instalada**: hace falta un instalador nuevo de `dev` (compilar y reinstalar en `C:\Program Files\gameAccess`; el Modo niño no anda desde otra carpeta).
- 👶 **Con la cuenta del niño**: iniciar sesión en Windows como el niño.
- Después de actualizar desde una versión anterior, la cuenta del niño ya creada tiene que **aplicar de nuevo una vez** (para que exista la carpeta compartida de estadísticas y órdenes).

---

## 1. Lo que se puede ver ya, en el navegador 🌐
- [ ] **El portón con clave.** (Atajo comprobado el 2026-10-29: cierra, se pone verde con la clave de ejemplo y abre.) Con `?uiDemo=1`, abrir la consola del navegador y escribir `gaGateDemo()`. El portón se cierra, la cerradura queda trabada y el candado encendido. Escribir `P1E1R1R1O26` (el ejemplo de perro el 11-11-26): se oye un tic por tecla, se ven tres círculos como mucho sin saber cuántos hay, y al completar se pone **verde**, la cerradura gira y el portón abre. Probar también: borrar y reescribir (sin límite), escribir de más, **"Entrar como jugador"** y **"Olvidé la clave"** (muestra un aviso, todavía no recupera nada). Código: `AdminKeyField.tsx`, `AdminGate.tsx`, `admin-gate.css`.
- [ ] **La pantalla del niño.** `?kidDemo=1` (y `&timeUp` para el fin de tiempo): juegos de ejemplo, tiempo que queda, aviso a los 5 minutos. Código: `KidScreen.tsx`.
- [ ] **El administrador de biblioteca.** `?libraryDemo=1`. Mirar la confirmación de desinstalar. Código: `library-manager/GameLibraryManager.tsx`.
- [ ] **Textos en los dos idiomas.** Cambiar a inglés en Configuración y revisar las pantallas nuevas (`locales/es.ts`, `locales/en.ts`; el test de paridad ya cuida las claves, no la redacción).
- [ ] **Estilo.** Revisar con ojo de diseño: botones del mismo alto en cada fila, el LCD alineado con el candado, la pantalla de niños a 1024 px de ancho (`docs/GUI_DESIGN.md`).

## 2. Modo niño: la pantalla única (botón del niño) 🖥️
Código: `KidModePanel.tsx`, `familyPrefs.ts`, `kidMode.ts`, `kid-mode.css`. Commits `fe740b8`, `a9c15bc`.
- [ ] **Primera pregunta.** Con el botón del niño por primera vez: "¿Hay niños en tu casa?". "No hay niños" deja Game Access como siempre; "Ahora hay niños" lo vuelve a abrir.
- [ ] **Tres pestañas** cuando hay niños: Modo niño, Filtro de contenido (ya no está en Configuración) y Clave de padre.
- [ ] **Sin PLUS**: la página que explica y vende la función se ve completa, "Empezar" aparece bloqueado y "Conocer PLUS" abre el diálogo de PLUS.
- [ ] **Asistente** (con PLUS): paso 1 cuenta de Windows (solo letras sin tilde, números, punto, guion), paso 2 tiempo y horarios con la propuesta (2 h; lunes a viernes 12–21; fin de semana 9–22). "Crear la cuenta y terminar" pide **un** permiso de Windows y crea la cuenta sin contraseña.
- [ ] **Panel** (cuenta creada): el asistente no vuelve; se ven la semana de juego, lo más jugado, los juegos, los ajustes y el aviso de la app del celular "muy pronto".
- [ ] **"Ya no hay niños en casa"** se niega mientras exista la cuenta o la clave y dice qué quitar primero.

## 3. Tiempo del niño 👶
Código: `src-tauri/src/kid_mode.rs`, `KidScreen.tsx`. Commits `ea27b5a`, `fe740b8`.
- [ ] **Máximo por juego** dentro del total: poner Roblox en 15 minutos y el total en 120. Jugar Roblox: a los 15 min se cierra **solo ese juego**, su tarjeta queda apagada ("Sin tiempo hoy") y se puede seguir con los otros. Lo jugado en Roblox cuenta también para el total.
- [ ] **Total del día**: al agotarse cierra el juego, avisa y a los 60 segundos cierra la sesión de Windows.
- [ ] **Aviso de 5 minutos** y que las flechas, Enter, clic y el mando mueven y juegan.
- [ ] **Estadísticas**: tras jugar, en la cuenta del adulto el panel muestra la barra del día y el detalle (pasar el mouse sobre el día). Archivos en `C:\ProgramData\GameAccess\uso\<sid>.json`.
- [ ] **Órdenes en vivo** desde el panel del adulto con el niño jugando: *Parar el juego ahora* (cierra en segundos), *Cerrar el día* / *Reabrir el día*, *+15 / +30 min*. Si el botón dice que hay que aplicar de nuevo, aplicar y repetir.

## 4. Deshacer y desinstalar 🖥️
Código: `kid-account.ps1`, `kid_mode.rs` (`kid_remove`), `windows/hooks.nsh`. Commit `fe740b8`. **Estas son las más delicadas: probarlas con una cuenta de prueba.**
- [ ] **"Quitar el modo niño"** (panel, abajo): confirma, Windows pide permiso, se borra la cuenta del niño y su perfil, la pantalla vuelve a la explicación. Hacerlo con el niño **sin** sesión abierta; con sesión abierta debería fallar con un mensaje, sin romper nada.
- [ ] **Desinstalar Game Access** con una cuenta de niño creada: la cuenta y `C:\ProgramData\GameAccess` desaparecen.
- [ ] **Actualizar** Game Access (instalador nuevo encima): la cuenta del niño **no** se toca.
- [ ] **Juego que sale de la biblioteca**: al desinstalar, desvincular, mover o borrar un juego que el niño tiene, la confirmación dice que también sale del modo niño (y si es el último, que el niño se queda sin juegos); después ofrece "Aplicar ahora". Lo mismo al quitar un acceso directo (Roblox). Código: `GameLibraryManager.tsx`, `kidMode.ts`.
  - Mientras no se aplique, el niño todavía ve ese juego y falla al abrirlo (pendiente en [[Tareas]], MN.13).

## 5. La clave de padre 🖥️
Código: `src-tauri/src/admin_key.rs`, `accessRole.ts`, `AdminKeySection.tsx`, `AdminKeyField.tsx`, `AdminGate.tsx`, `SplashScreen.tsx`. Commit `a9c15bc`.
- [ ] **Activarla**: pestaña "Clave de padre" (solo con PLUS y la cuenta del niño creada). Poner una palabra. Abrir el desplegable "solo para los ojos del padre" y revisar que la explicación sea clara.
- [ ] **La palabra oculta**: en la pestaña, "Tu palabra" muestra puntos. Mantener apretado "Mantené apretado para verla" (mouse, o Espacio/Enter con el teclado) la muestra; al soltar, al cambiar de ventana o al bloquear la pantalla se oculta. La clave del día no aparece en ningún lado. Con PLUS terminado el botón no aparece.
- [ ] **Cambiar o quitar la clave**: piden escribir la palabra actual o la clave de hoy (cualquiera de las dos, sin importar mayúsculas). La de ayer o una palabra equivocada dan "No coincide…".
- [ ] **Al abrir Game Access**: el portón queda cerrado con el LCD. La clave correcta abre como administrador; en minúsculas también. **Entrar como jugador** abre sin clave.
- [ ] **Jugador**: no puede abrir el botón del niño (el portón se cierra y pide la clave; con la clave se abre y entra); no ve los botones del niño por juego en la biblioteca.
- [ ] **Inactividad**: 5 minutos sin tocar la PC y el portón se cierra de nuevo pidiendo la clave.
- [ ] **Cambiar la palabra** y **Quitar la clave**.

## 6. La biblioteca protegida con la clave 🖥️
Código: `catalog/DigitalProcessManager.ts` (`requireAdmin`), `App.tsx`, `PluginDownloadButton.tsx`. Commit `d62ee21`. Entrar como **jugador** y probar que cada una **pide la clave antes de confirmar** y que, sin clave, no hace nada ("Hace falta la clave de padre para esto"):
- [ ] Desinstalar, desvincular, borrar o mover un juego (uno y en lote).
- [ ] Importar juegos; adoptar/arreglar desde el plan.
- [ ] Congelar y descongelar.
- [ ] Cambiar las carpetas de juegos (Configuración › Juegos).
- [ ] Empezar una descarga (catálogo y plugin).
- [ ] Debe **seguir libre**: jugar, cancelar una descarga que ya empezó, los reintentos automáticos y el congelado automático.

## 7. Cuando se apaga PLUS 🖥️ (nuevo)
Código: `accessRole.ts` (`setPlusLapsed`, `setPlusGraceDays`), `kidMode.ts` (`reportPlus`, `reportPlusUnreachable`), `ActivationGate.tsx`, `kid_mode.rs` (`kid_plus_set`, `plus.json`), `KidScreen.tsx`, `KidModePanel.tsx` (aviso). Qué pasa: el modo niño queda **en pausa** (el niño no puede jugar), la clave de padre **deja de pedirse** (todo desbloqueado, como el modo base), el filtro de contenido sigue, y **no se borra nada**; al volver PLUS todo se reanuda solo. Solo se concluye que PLUS terminó si el servidor **contestó** que no hay PLUS (vencido, revocado o plan base); sin conexión no cambia nada.
- [ ] Con clave de padre y cuenta de niño ya configuradas, hacer que PLUS venza o revocar la llave. Al abrir Game Access: el portón **no** pide clave (o se abre solo si ya la estaba pidiendo), la pantalla de niños muestra "Tu PLUS no está activo".
- [ ] Entrar a la cuenta del niño: aparece "El modo niño está en pausa", no deja jugar y cierra la sesión al minuto.
- [ ] **Sin internet no se pausa de golpe** (gracia de 7 días, `PLUS_GRACE_DAYS` en `kidMode.ts`): con la PC sin conexión, el modo niño y la clave siguen funcionando y la pantalla de niños avisa "No se pudo verificar tu PLUS… N día(s) más". Pasados los 7 días desde la última vez que se confirmó PLUS, se pausa como si hubiera terminado. Una respuesta explícita del servidor de que **no hay PLUS** no tiene gracia: es inmediata. Para ver el aviso sin esperar días: cortar internet y reiniciar Game Access.
- [ ] Volver a activar PLUS: el niño puede jugar otra vez y la clave vuelve a pedirse, con la misma palabra.
- [ ] Atajo para ver la pausa sin tocar el servidor: escribir `{"active": false}` en `C:\ProgramData\GameAccess\uso\plus.json` (y `{"active": true}` para reanudar).
- Límite conocido: si el adulto nunca vuelve a abrir Game Access, la pausa no llega (la PC del niño solo se entera por ese archivo). Cuando las estadísticas y órdenes vivan en el servidor (MN.9) también podrá pausar desde allá.

## 7b. Usuarios y PLUS en el servidor (US.1) 🖥️ (nuevo)
Código: `apps/api/app/accounts.py`, `account_admin_routes.py`, `admin/index.html` (sección Usuarios), `scripts/seed_demo_users.py`, `run_demo_users_api.ps1`.
- [ ] **Levantar el servidor de prueba**: `apps/api/run_demo_users_api.ps1 -Reset`. Imprime cuatro usuarios (Pagado, Por vencer, Sin pagar, Sin llave) y sus llaves. Abrir `http://127.0.0.1:8010/admin`: la sección Usuarios los muestra con su estado en color.
- [ ] **El cliente contra ese servidor**: con el servidor de prueba en el puerto **38147** (el que la app siempre prueba primero y muestra como "Local"; otro puerto no lo ve), usar un instalador compilado con `GAMEACCESS_ALLOW_LOCAL_ACTIVATION=1` (como el 0.1.4 de prueba) y activar la llave de "Pagado": PLUS activo. Con el modo niño y la clave puestos, en el panel marcar **No pagado**: a la siguiente verificación la app avisa que PLUS terminó, la clave deja de pedirse y la cuenta del niño queda en pausa. Marcar **Pagado hasta…**: todo vuelve solo, sin llave nueva.
- [ ] **La llave de "Sin pagar"** no se puede activar ("This activation key has expired").
- Comprobado por HTTP el 2026-10-29 (sin la app): Pagado ve PLUS hasta su fecha; No pagado da `401 expired`; al volver a pagar la misma sesión vuelve a PLUS.

## 7c. Mover un juego vinculado a la biblioteca 🖥️ (nuevo)
Código: `apps/launcher/game_library_manager/mover.py`, `manager._linked_move`, `apps/desktop/src/freezeJobs.ts` (modo `move`).
- [ ] **De otro disco**: en el Administrador de biblioteca, un juego vinculado desde otra unidad → "Mover a la carpeta de juegos" → confirmar. El aviso se cierra enseguida; la fila dice "Moviendo a la biblioteca", el historial muestra los pasos y la barra se va encendiendo en naranja con los GB copiados. Al terminar, el aviso dice cuánto y en cuánto tiempo, y el juego queda como uno más de la biblioteca.
- [ ] **Cancelar** a mitad de camino (la X de la fila): se borra la copia a medias y el juego sigue vinculado donde estaba.
- [ ] **Mismo disco**: es instantáneo (solo cambia de carpeta).
- [ ] **El dibujo**: mientras copia, a la derecha del historial se ve la carátula vertical vaciándose de arriba hacia abajo, archivos que viajan y la carpeta llenándose desde abajo con la misma carátula más chica.
- [ ] **Cortarla de verdad** (cerrar Game Access, o apagar la PC, a mitad de una copia entre discos): al abrir, el aviso dice que se cortó al N % y ofrece **Continuar** o **Descartar la copia**; la fila dice "Mudanza sin terminar (N %)" con los mismos dos botones y el juego se puede jugar desde su carpeta. **Continuar** sigue desde lo copiado (el historial dice "Retomada: X GB ya estaban copiados"); **Descartar** borra la copia a medias.
- [ ] **Cancelar a propósito** (la X) sí borra la copia a medias.
- [ ] **En cola**: con un congelado en marcha, la mudanza espera su turno y arranca sola.

## 8. Cosas que no se pudieron comprobar y conviene mirar con atención
- [ ] **DPAPI real**: la palabra de la clave se guarda cifrada en el perfil del adulto (`%LOCALAPPDATA%\GameAccess\parental\admin-key.dpapi`). Los tests pasan en Windows, falta verlo en la app instalada. Otro adulto en la misma PC no tendría esa clave.
- [ ] **El portón de arranque con clave dentro de Tauri**: la lógica está probada con tests y en el navegador, falta verlo en la app (sonido incluido: se genera con la placa de sonido, sin archivo).
- [ ] **Verde y apertura con la clave real** (en el navegador se prueba con la clave de ejemplo).
- [ ] **`kid-account.ps1` elevado**: la sintaxis está validada, no se ejecutó (crear, quitar, `-RemoveAll`).
- [ ] **Escape de la cuenta del niño**: sigue pendiente la prueba MN.2 (Alt+F4, Ctrl+Alt+Supr, Steam, Roblox, diálogos de archivo).
