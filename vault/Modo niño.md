---
tipo: diseño
actualizado: 2026-10-31
estado: redefinido 2026-10-31 (cuenta de Windows del niño, nada en la cuenta del adulto); sin implementar
---
# Modo niño — control de acceso y tiempo para chicos

> Modelo acordado con Seba el **2026-10-31**. Reemplaza al de "misma cuenta y servicio vigilante" (30/10) y ordena el de "cuenta aparte" (29/10). Este archivo tiene solo lo vigente y lo pendiente; los modelos anteriores están en el historial de Git y en [[Log]]. Tareas: sección "Modo niño" de [[Tareas]]. Feature de PLUS (ver [[Proyecto]]).

## Objetivo
Que un chico de **6 a 12 años** juegue solo a lo que el adulto le habilita, en los horarios y con el tiempo que el adulto define, sin poder saltearlo. En la misma PC el adulto usa Game Access normal, sin restricciones. Prioridad de Seba: **que los juegos anden, que el tiempo se cuente bien, que sea simple de configurar y que nunca trabe la PC del padre**.

## Por qué este modelo (2026-10-31)
El modelo de misma cuenta obligaba a endurecer la cuenta del **padre**, y eso se volvió en su contra: la opción "Contraseña de Windows" (`ConsentPromptBehaviorAdmin` = 1) dejó a Seba sin poder aceptar tareas de administrador (con la cuenta sin contraseña Windows rechaza la contraseña vacía: `LimitBlankPasswordUse` = 1), apagar y quitar el modo niño no la devolvían, el servicio quedaba instalado y escribiendo al log aunque el modo niño se hubiera quitado, y la lista blanca cerraba programas legítimos. Que un juego ande mal es menos grave que trabar la PC del padre.

## Regla de base
**Todo lo que restringe vive dentro de la cuenta de Windows del niño.** En la cuenta del adulto y en Windows para toda la PC no se cambia nada: ni opciones de UAC, ni servicios, ni listas blancas, ni carpetas cerradas para todos. Quitar el modo niño es borrar esa cuenta y su carpeta de configuración: no queda nada más que deshacer.

## Piezas
1. **Cuenta del niño**: cuenta local **estándar** (sin administrador), **sin contraseña**, con **Game Access como escritorio** (`--kid-shell` de `kid_mode.rs`, valor `Shell` en su `HKCU\...\Winlogon`; probado en Windows 11 el 29/10). Sin escritorio, barra de tareas, menú Inicio, Explorador ni navegador; Administrador de tareas y Ejecutar deshabilitados en su registro; Ctrl+Alt+Supr deja solo "Cerrar sesión"; la escala de pantalla del adulto copiada. Cerrar Game Access cierra la sesión; si se cae, se relanza. Una cuenta estándar no puede cambiar nada de esto ni instalar programas (Windows le pide la contraseña de un adulto).
2. **Game Access del niño** (el de esa cuenta, siempre abierto porque es el escritorio): muestra la biblioteca en Big Picture (teclado, mouse o mando), **cuenta el tiempo y hace cumplir el horario**: fuera de horario o sin tiempo muestra la pantalla de bloqueo y cierra la sesión. Juega con el mismo `play` del launcher que el adulto (fix, idioma, pasos previos, cambio de cuenta de Steam).
3. **Game Access del padre**: la sección Control parental (asistente y panel) crea la cuenta y guarda la configuración. No pide administrador salvo al crear o quitar la cuenta (un solo "Sí" de Windows, que sigue como Windows lo trae).
4. **Servidor y celular** (MN.9): sumar tiempo, bloquear o desbloquear ahora y encender o apagar se hacen desde el celular del padre, a través del servidor.

**No hay servicio de Windows.** El horario no usa el horario de inicio de sesión de Windows (`net user /times`): cambiarlo pide administrador y el celular no podría desbloquear fuera de horario.

## Dónde vive cada cosa
| Dónde | Qué guarda | Quién escribe |
|---|---|---|
| `Program Files\gameAccess` | El programa | Solo administrador |
| `ProgramData\GameAccess\ninos\config.json` | Encendido o apagado, horario por día, tiempo por día y por juego, la biblioteca publicada (todos los juegos con lo necesario para lanzarlos y cuáles están permitidos) | **Solo la cuenta del padre** (y SYSTEM y administradores); el niño solo lee. Los permisos se ponen al crear la cuenta, con el "Sí" de Windows, así el padre cambia la configuración después sin volver a pedir permiso |
| `ProgramData\GameAccess\uso\` | Tiempo jugado por día y por juego, `plus.json` | La cuenta del niño escribe su tiempo; el padre lee |
| `%LOCALAPPDATA%` de cada cuenta | Lo de siempre (biblioteca del adulto, preferencias, sesiones de Steam de esa cuenta de Windows) | Cada cuenta el suyo |

La biblioteca del adulto está en su perfil, que otra cuenta de Windows no puede leer: por eso el Game Access del padre **publica** la biblioteca en `config.json`. Las carpetas de juegos fuera de los perfiles (`C:\juegos_GameAccess`, otros discos) dejan escribir a los usuarios de la PC por defecto: confirmarlo en la prueba (MN.24).

## Estados (una sola bandera)
**Modo niño configurado** = existe la cuenta del niño. Todo lo de esta página depende de eso: sin cuenta, Game Access funciona como antes del control parental (sin portón con clave, sin círculo, sin nada en Windows).

| | Encendido | Apagado | No configurado / quitado |
|---|---|---|---|
| Cuenta del niño | Solo los juegos permitidos, con horario y tiempo | **Toda la biblioteca, sin límite de tiempo ni horario** (sigue siendo solo Game Access) | No existe |
| Game Access del padre | Se entra sin clave; Control parental pide la clave | Igual | Como antes: Control parental muestra la explicación y el asistente |
| Servicio de Windows | No hay | No hay | No hay |
| Restricciones en la cuenta del adulto | Ninguna | Ninguna | Ninguna |
| Instalar o desinstalar programas | El niño no puede (cuenta estándar, sin escritorio) | Igual | — |
| Círculo de estado | Verde | Gris | No se muestra |

Con el modo configurado y **sin PLUS activo**, el círculo es **rojo** (ver "Cuando PLUS se apaga").

**Círculo de estado**: en la esquina, al lado del estado del servidor y del plugin. Verde = restricción encendida; gris = apagada; rojo = deshabilitada por no tener PLUS.

## Game Access del padre
- Se entra **sin clave**: no hay portón con clave, modo jugador ni vuelta automática a jugador. El portón queda como animación de entrada, sin campo.
- **Control parental**, cuando el modo está configurado, pide la **clave de padre** en un **diálogo modal** que usa el campo que hoy está en el portón (círculos, tic por tecla, verifica al escribir, verde al acertar).
- **Toda la configuración de niños vive en esa pantalla**: se quita del Administrador de biblioteca la asignación de juegos al niño.
- Arriba de todo, el **interruptor grande** Encendido / Apagado.
- **La clave de padre** es una contraseña común que elige el padre (4 a 40 caracteres, sin distinguir mayúsculas), guardada con DPAPI en el perfil del adulto (`admin_key.rs`). Protege también el filtro de contenido. Más adelante: Windows Hello o confirmación desde el celular.

## Asistente
Pasos: clave de padre, filtro de contenido, la cuenta del niño (cómo funciona y su nombre), sus juegos, horario y tiempo. Un solo niño por ahora; con este modelo varios niños son una cuenta cada uno.

**Aviso de proteger la cuenta del adulto**: si la cuenta de Windows del padre no tiene contraseña ni Windows Hello, el niño puede elegirla en la pantalla de inicio y entrar sin restricciones. El asistente **lo aconseja, no lo exige** ni lo cambia por su cuenta.

**Diálogo final** (modal, al crear la cuenta; las aclaraciones aparecen según el caso):

> **¡La cuenta de tu hijo está lista!**
> Para usarla, cerrá sesión o cambiá de usuario en Windows: vas a ver la cuenta nueva de {nombre}. Entra sin contraseña y ve solo Game Access: no puede cambiar nada, solo jugar, y el contador de tiempo lo bloquea fuera de los horarios que definiste.
>
> **Aclaraciones**
> - *Si tu cuenta de Windows no tiene contraseña ni Windows Hello:* **Protegé tu cuenta.** Sin contraseña, tu hijo puede entrar a tu cuenta desde la pantalla de inicio. ▸ *¿Cómo se hace?* (sección que se despliega: Configuración → Cuentas → Opciones de inicio de sesión → Contraseña, y después PIN de Windows Hello o huella).
> - *Si sus juegos permitidos incluyen juegos de Steam:* la primera vez que abra un juego de Steam, Steam va a pedir iniciar sesión en la cuenta nueva. Hacelo vos y marcá **"Recordarme en este equipo"**. Pasa una vez por cada cuenta de Steam.

## Steam
- Game Access maneja **varias cuentas de Steam y cambia solo a la dueña de cada juego**; tiene que funcionar igual en la cuenta del niño. **No se usa la Familia de Steam.**
- El cambio (`steam_account_manager/switch.py`) pone `AutoLoginUser` en el registro de la cuenta de Windows, cierra Steam y lo abre de nuevo. La lista de cuentas "recordadas" (`loginusers.vdf`) está en la carpeta de Steam y la comparten todas las cuentas de Windows, pero lo que permite entrar sin contraseña se guarda **por cuenta de Windows**. Por eso, en la cuenta del niño, cada cuenta de Steam pide iniciar sesión **una vez** (lo explica el diálogo final). Game Access tiene que reconocer ese caso y no tomarlo como un error.
- En la cuenta del niño, Steam se abre con **`-silent`** (y probar `-nofriendsui`), también al cambiar de cuenta: sin barra de tareas ni bandeja, el niño no tiene de dónde abrir la ventana de Steam. No se cambia el manejador `steam://` de Windows (vale para toda la PC).
- **La tienda**: el niño juega con las cuentas de Steam del adulto, y desde la superposición del juego (Shift+Tab) llega a la tienda y a una tarjeta guardada. Apagar la superposición en Steam se la apaga también al adulto. No se resuelve con código: el asistente aconseja que Steam pida confirmación para comprar.

## Juegos que piden administrador
Una cuenta estándar no puede aceptar el permiso de Windows. Muchos juegos lo piden sin necesitarlo: el niño los lanza con la compatibilidad `RunAsInvoker` (`__COMPAT_LAYER`), que los abre sin pedir permiso. Los que de verdad lo necesitan (instalar un anti-cheat la primera vez) los abre el padre una vez desde su cuenta.

## Tiempo y horario
- Lo cuenta el Game Access del niño mientras corre algún proceso de la carpeta del juego, por día y por juego, en `uso\`.
- **Máximo por juego**: cada juego puede tener un máximo diario menor, dentro del total; su tiempo cuenta también para el total.
- Aviso a los 5 minutos ("guardá la partida"); al terminarse cierra el juego (primero le pide que se cierre, unos segundos después lo fuerza: `process_control::terminate`) y la sesión.
- **Fuera de horario**: el niño puede iniciar sesión, pero ve "Fuera de horario" y la sesión se cierra sola.
- **Congelado**: al aplicar se descongelan los juegos del niño, y el congelado automático no los vuelve a congelar (la cuenta del niño no puede descongelar).
- Lo que se instala por usuario de Windows (Roblox, la sesión de Epic) se instala o se inicia una vez dentro de la cuenta del niño.

## Celular y servidor (MN.9)
- **La PC hace cumplir; el servidor es buzón e historial.** Sin puertos abiertos en la casa: la PC consulta al servidor.
- **Quién habla con el servidor: el Game Access de la cuenta del niño**, que está abierto toda la sesión. Sube la configuración vigente, el estado de ahora (bloqueando, apagado, desbloqueado hasta tal hora) y un resumen del día; consulta cada 30 s mientras el niño tiene la sesión abierta. Una orden que llega con la sesión cerrada se aplica al entrar.
- **Órdenes**: sumar tiempo, desbloquear ahora, desbloquear por N minutos (vence solo por hora, aunque se corte internet), bloquear ahora, encender o apagar. Más adelante: horario, tiempo y juegos.
- **Emparejar**: código corto que muestra Control parental; el celular lo canjea y queda ligado a la cuenta del usuario (US.1).
- Hasta que exista el celular, sumar tiempo en el momento no tiene botón: se cambia el tiempo por día en el panel.
- Mensajes compactos: PR.1.

## Cuando PLUS se apaga (MN.15)
- **Modo niño en pausa**, no se borra: la cuenta del niño no deja jugar ("El modo niño está en pausa") y cierra la sesión al minuto. Círculo rojo. La PC del niño se entera por `uso\plus.json`, que escribe el Game Access del adulto tras cada verificación; si falta o no se entiende, el modo niño sigue.
- **Clave de padre sin efecto**: Control parental se abre sin pedirla. La clave queda guardada.
- El filtro de contenido sigue (es gratuito). Al volver PLUS todo se reanuda solo.
- **Sin internet**: gracia de 7 días desde la última confirmación (`PLUS_GRACE_DAYS`, `kidMode.ts`), con aviso de los días que quedan. Una respuesta explícita de "no hay PLUS" no tiene gracia.

## Usuarios y PLUS (US.1, hecho; US.2 pendiente)
Tabla `account` en `apps/api` (nombre, correo único, idioma, contraseña opcional como hash scrypt, `paid`, `plus_until`, `paid_at`, `paid_note`); `AccessKey.account_id` liga cada llave PLUS a su usuario y la membresía manda sobre las llaves. Panel "Usuarios" en `/admin`. Servidor de prueba: `apps/api/run_demo_users_api.ps1 [-Reset]` en el puerto 38147 con los cuatro estados (Pagado, Por vencer, Sin pagar, Sin llave). Cobro con Mercado Pago (US.2) sin hacer. Preguntas abiertas para Seba: días de tolerancia tras un cobro rechazado; si una llave vencida se reactiva sola al pagar; si una llave sirve para más de una PC.

## Quitar, desinstalar y limpiar
- **"Quitar el modo niño"** (Control parental): borra la cuenta del niño y su perfil, `ninos\` y su tiempo. Queda como antes de empezar.
- **Desinstalar Game Access**: lo mismo, salvo en una actualización (una cuenta con Game Access como escritorio y sin Game Access sería una pantalla negra).
- **Quitar un juego de la biblioteca** avisa si sale también del modo niño (y si el niño se queda sin juegos).
- **El instalador limpia lo que dejaron versiones anteriores** aunque el modo niño no esté configurado: el servicio `GameAccessRestrictor`, la carpeta `ProgramData\GameAccess\restriccion`, `ConsentPromptBehaviorAdmin` = 1 cuando lo puso Game Access (lo devuelve a 5) y un `familia.json` sin cuenta de niño. No instala ningún servicio.

## Se va del modelo del 30/10
El restrictor y su tubería (`restrictor.rs`, `restrictor_pipe.rs`, el servicio en `hooks.nsh`), la opción "Contraseña de Windows" (`uac_password.rs`), la lista blanca y los programas permitidos (`KidPrograms`, programas comunes, `allowFromBlock`, el cartel de bloqueo), el modo padre/jugador con vuelta automática y el campo de clave del portón. Se queda: el asistente, la grilla de juegos, la pestaña Tiempo, el Big Picture del niño, la clave de padre, PLUS vencido y `kid-account.ps1` (revisado).

## Vías de escape conocidas (aceptadas para menos de 12)
- La tienda de Steam desde la superposición (ver Steam).
- Diálogos "Abrir archivo" dentro de un juego: poco probable a esta edad.
- Juegos con navegador adentro (Roblox): si están permitidos, quedan sujetos al tiempo.
- La cuenta del adulto sin contraseña (ver Asistente).
- Modo seguro o acceso físico: fuera del alcance de una herramienta familiar.
