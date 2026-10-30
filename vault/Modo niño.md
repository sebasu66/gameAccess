---
tipo: diseño
actualizado: 2026-10-30
estado: rediseñado 2026-10-30 (misma cuenta y servicio vigilante), sin implementar
---
# Modo niño — control de acceso y tiempo para chicos

> Diseño acordado con Seba el 2026-10-19. **Todavía no se implementa**: primero va la prueba de concepto (tarea MN.2 en [[Tareas]]). Feature del plan de 4 USD (ver [[Proyecto]]).

## Objetivo
Que un chico de **6 a 12 años** solo pueda jugar a los juegos que el adulto le habilita, en los horarios y con el tiempo que el adulto define, **sin poder saltearlo** abriendo los ejecutables por fuera de Game Access ni instalando juegos nuevos (por ejemplo Roblox desde el navegador o siguiendo instrucciones de una IA). En la misma PC, otro usuario (adulto) usa Game Access normal, sin restricciones.

## Modelo nuevo (Seba, 2026-10-30): misma cuenta de Windows y un servicio vigilante

> **Reemplaza a la cuenta de Windows separada** (secciones "Idea central…" y "Nada se ejecuta salvo…", que quedan como historia). Todavía sin implementar: tareas MN.17 a MN.20 en [[Tareas]].

**Por qué cambia.** La cuenta separada rompía lo que más importa: Steam no recuerda el inicio de sesión del adulto en otra cuenta de Windows (lo cifra por usuario), la cuenta del niño necesitaba permisos en cada carpeta de juego y en la biblioteca, los juegos que piden administrador pedían hacerla administradora, y armarla requería pasos. La prioridad de Seba: **que los juegos anden, que el tiempo se cuente bien y que sea simple de configurar**. Un hueco de seguridad menor es aceptable: es para chicos de menos de 12. Es el enfoque de los programas de cibercafé.

### Piezas
1. **Servicio de Game Access** (servicio de Windows, corre como SYSTEM, arranca con Windows, lo instala el instalador). Difícil de detener: su lista de permisos niega Detener y Pausar a todos salvo SYSTEM, y Windows lo reinicia si se cae. Hace cuatro cosas: vigila los procesos, cuenta el tiempo, guarda el estado del modo restrictivo y habla con Game Access por una tubería local (named pipe); más adelante, también con el servidor para el celular (MN.9).
2. **Vigilante de procesos con lista blanca** (Seba, 2026-10-30). **Mientras el modo niño está encendido**, el servicio se entera de cada programa que arranca (ETW de procesos del núcleo; WMI `Win32_ProcessStartTrace` como alternativa) y **solo deja correr lo que está en la lista blanca; todo lo demás lo cierra enseguida**. Como SYSTEM, puede cerrar también lo que corre como administrador. Se decide por la ruta del .exe, sin importar quién lo abrió. No hace falta que Windows arranque bloqueado: lo que se abra, desde el escritorio, un acceso directo o un instalador, pasa por el vigilante. La lista blanca tiene dos partes:
   - **Juegos**: los de la biblioteca de Game Access (descargados o importados) **asignados al niño**, como hoy. Corren los procesos de su carpeta y lo que ese juego abra (anti-cheat, lanzadores propios). Esa regla de "lo que abre" vale solo para los juegos, no para Steam: si no, cualquier juego de Steam pasaría.
   - **Programas**: los que el adulto deja usar (navegador, Explorador, Office, CAD o 3D…). **No entran a la biblioteca**: solo a la lista blanca. Se arman como dice el punto 3.

   Además, siempre pasan Windows (`C:\Windows` y lo firmado por Microsoft), Game Access con su runtime, y Steam (`steam.exe`, `steamwebhelper.exe`), para que pueda iniciar sesión y lanzar juegos.

   Lo que no está en la lista se cierra, y Game Access se abre (o avisa, si ya estaba abierto) con **"Game Access está bloqueando este juego. Un adulto tiene que entrar a la biblioteca y agregarlo a los juegos permitidos."** Para un programa: "…agregarlo a los programas permitidos". Un juego que el niño instale por su cuenta queda afuera solo: **no hace falta reconocer qué es un juego**, salvo para elegir cuál de los dos mensajes mostrar.
3. **Programas permitidos: se detectan los que ya están instalados.** Al encender el modo niño por primera vez, Game Access lee la lista de programas instalados de Windows: las claves `Uninstall` de la PC y del usuario (nombre, editor, carpeta, ícono) y las apps de la Tienda. **Todos empiezan permitidos**; el adulto revisa y destilda los que quiera bloquear. Así solo se muestra lo que esta PC tiene, no una lista gigante de programas posibles.
   - **Los juegos de esa lista no se permiten solos.** Steam registra sus juegos como "Steam App 12345"; también están los de GOG y Epic, los que coinciden con un nombre del catálogo, y los que están dentro de una biblioteca de Steam. Esos se muestran aparte, sin permitir: un juego se habilita asignándolo al niño desde la biblioteca.
   - **Lo bloqueado se puede permitir con un toque.** El servicio anota lo que cerró (ruta, nombre, cuántas veces, última vez) y la pantalla del adulto lo muestra con **"Permitir"**. Sirve para un programa que no aparece en la lista de Windows, como una utilidad de auriculares en `AppData` o algo portátil. El aviso al niño no se repite para lo que se cierra solo en segundo plano.
   - **Todo se maneja desde la sección de niños**: permitir un programa nuevo, sacar uno, y agregar o quitar juegos de la lista blanca.
4. **Encender y apagar el modo niño.** Lo enciende el adulto desde la sección de niños y queda encendido, también después de reiniciar, hasta que lo apague con la clave. Mientras está encendido, Game Access abre mostrando solo los juegos permitidos, con su tiempo; las pantallas de adulto no se ven.
   - Un botón **"Ingresar clave"** (el portón con la clave de padre) desbloquea todos los juegos y pantallas de Game Access.
   - Un interruptor **"Apagar el modo restrictivo hasta la próxima sesión"**: el servicio deja de cerrar programas y de contar tiempo hasta el próximo inicio de sesión de Windows.
   - **La clave de padre es una contraseña común** que elige el padre (Seba, 2026-10-30: la clave que mezclaba la palabra con la fecha obligaba a hacer una cuenta mental cada día). Más adelante: huella o confirmación desde el celular (MN.9), o **Windows Hello** del adulto, para no tener que crear una contraseña nueva.
5. **Tiempo.** Lo cuenta el servicio, por los procesos de los juegos permitidos, aunque Game Access esté cerrado. Al terminarse, el servicio cierra el juego y Game Access muestra que se acabó.
6. **Celular** (MN.9): el padre ve el tiempo y manda órdenes (más tiempo, cerrar el día, apagar el modo restrictivo) a través del servidor; el servicio las recibe.

**Qué se va:** la cuenta de Windows del niño, `kid-account.ps1`, las directivas de restricción, y `familia.json` como está hoy. La configuración pasa a `ProgramData\GameAccess`, escrita por el servicio. Para migrar: "Quitar el modo niño" borra la cuenta de Fran.

**Qué se gana:** Steam funciona tal cual (los "recordarme" y el cambio automático de cuenta del adulto), los juegos usan la misma biblioteca y los mismos permisos, los que piden administrador andan, y configurar es elegir juegos, horario y tiempo.

### Para decidir (Seba)
- **¿Bloquear además partes de Windows** (tecla Windows, Alt+Tab, Administrador de tareas, el Explorador), como un quiosco? Con la lista blanca no hace falta para los programas. Quedaría para que el niño no vea el escritorio.
- **Navegadores.** Arrancan permitidos, como cualquier programa instalado. Destildarlos cierra la vía de jugar en el navegador (Roblox web, juegos online); dejarlos permite la tarea escolar. Hoy el filtro de contenido va por separado.
- **La tienda de Steam y la tarjeta guardada.** El niño juega con las cuentas de Steam del adulto: desde la superposición (Shift+Tab) llega a la tienda, y una tarjeta guardada compra sin contraseña. Opciones: que en modo restrictivo el servicio cierre las ventanas de tienda de Steam, o desactivar la superposición.
- **Varios niños.** Con una sola cuenta de Windows, Game Access no sabe qué niño juega. ¿Se elige el perfil del niño al abrir, cada uno con su tiempo?
- **Detener el servicio.** Si la cuenta del adulto es administradora, Windows solo pide "Sí" (sin contraseña) para tareas de administrador. Con el escritorio libre, alguien que sepa podría cambiar los permisos del servicio y detenerlo. Para chicos de menos de 12 se acepta; un quiosco lo cerraría.
- **Lo que la lista blanca puede romper.** Un programa legítimo que no figura en la lista de Windows se cierra hasta que el adulto lo permite: utilidades de periféricos, portables, actualizadores que corren desde una carpeta temporal. Y un juego que Windows lista como programa común, si no se lo reconoce como juego, arrancaría permitido. ¿Alcanza con la revisión inicial y con "Permitir" sobre lo bloqueado?

## Idea central: Game Access como escritorio de la cuenta del niño (modo quiosco) — reemplazado 2026-10-30, ver arriba
1. El niño tiene **su propia cuenta local estándar de Windows** (sin permisos de administrador).
2. En esa cuenta, **Game Access reemplaza al escritorio de Windows** (shell personalizado): al iniciar sesión se abre Game Access y no hay escritorio, barra de tareas, menú Inicio, explorador de archivos ni navegador. Sin eso, el niño no puede buscar ejecutables ni descargar juegos.
3. **Salir de Game Access cierra la sesión de Windows.** Si Game Access se cuelga, se relanza o se cierra la sesión (si no, queda la pantalla en negro).
4. **Cuando se acaba el tiempo**, Game Access avisa ("te quedan 5 minutos, guardá la partida"), cierra el juego y cierra la sesión.

### Cómo se reemplaza el escritorio
- **Shell Launcher** (oficial de Microsoft) es solo para Windows Enterprise/Education: no sirve en una casa.
- **Windows Home/Pro**: valor `Shell` en `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon` de la cuenta del niño. Existe hace años; **hay que confirmarlo en Windows 11 actual, Home y Pro** (es la prueba de concepto).
- **Acceso asignado** (kiosk nativo): restricciones con apps de escritorio y varía por versión; no contar con él.

### Ayudas nativas de Windows que se suman
- **Horario de inicio de sesión**: `net user <cuenta> /times:...`. Fuera de horario el niño no puede ni entrar; lo hace cumplir Windows.
- **Administrador de tareas deshabilitado** en la cuenta del niño (política `DisableTaskMgr`), para cerrar la vía Ctrl+Alt+Supr → "Ejecutar nueva tarea".
- **La cuenta del adulto debe tener contraseña**; si no, el niño cambia de usuario desde la pantalla de inicio.

### Nada se ejecuta salvo lo que Game Access habilita (Seba, 2026-10-29) — reemplazado 2026-10-30
En la cuenta del niño Game Access corre **como el niño**: no puede tener más permisos que él, así que lo que Game Access pudiera habilitar solo, también lo podría el niño. Seba tiene juegos en varios discos (C:, E:, F:, G:), Steam con 3 bibliotecas, Epic, RetroBat y Roblox (que se instala en el `AppData` de cada cuenta): bloquear carpeta por carpeta deja abierta cualquiera que se olvide y obliga a cambiar permisos de millones de archivos. Por eso se le quitan los permisos **al usuario**, todo en su propio registro bajo `Policies` (una cuenta estándar no lo puede cambiar) y sin tocar archivos:
- **Cambio 2026-10-30 (Seba): sin SRP.** Lo importante es que los juegos anden y que el tiempo se cuente; el kiosco (Game Access como escritorio, sin Administrador de tareas ni Ejecutar, discos ocultos) alcanza para chicos de menos de 12. `kid-account.ps1` ya no pone directivas de restricción de software y las saca de una cuenta armada antes. El niño juega con la **misma biblioteca y el mismo `play`** que el adulto (fix, idioma, pasos previos, cambio de cuenta de Steam, administrador): `familia.json` guarda la ruta de la biblioteca (`library`) y la cuenta del niño puede escribir en ella y en las carpetas de sus juegos. Si un juego pide administrador, la cuenta del niño es administradora (Windows le pide confirmar, sin contraseña). Al acabarse el tiempo, un juego que no se deja cerrar hace cerrar la sesión. Lo de abajo sobre SRP queda como historia.
- **Directivas de restricción de software** (SRP, `HKCU\Software\Policies\Microsoft\Windows\Safer\CodeIdentifiers`): por defecto nada se ejecuta (`DefaultLevel` 0); se permiten `C:\Windows`, `Program Files` y `Program Files (x86)`, salvo las carpetas de juegos de los launchers que instalan ahí (`steamapps` de Steam, `Epic Games`, `GOG Galaxy\Games`) y los navegadores. Gana la regla más específica: habilitar un juego = una regla "sin restricción" para su carpeta, aunque esté dentro de una cerrada. Juegos nuevos, otros discos y Roblox quedan bloqueados solos.
- **Discos ocultos y cerrados** en el Explorador y en los cuadros "Abrir/Guardar" (`NoDrives`, `NoViewOnDrive`): cierra la vía de lanzar algo desde el diálogo de archivo de un juego. Ocultar solo no alcanza: Steam o Roblox abren lo que ya conocen sin pasar por el Explorador.
- **Servicio de Game Access como SYSTEM** (MN.6, obligatorio): recibe "jugar a X" por named pipe, comprueba cuenta, juego permitido, tiempo y horario, escribe la regla del juego en el registro de esa cuenta y la saca al acabarse el tiempo (y al arrancar la PC, las que hayan quedado). También lleva el tiempo.
- **A confirmar en MN.2**: que Windows 11 Home y Pro sigan respetando las SRP de usuario (Microsoft dejó de desarrollarlas en 2018, siguen incluidas), si una regla nueva vale para el próximo programa o recién en la sesión siguiente, y que Game Access arranque (corre desde `Program Files`; en `AppData` solo tiene DepotDownloader, para descargas).
- **Plan B** si las SRP no andan: el servicio vigila los procesos de la cuenta del niño (ETW) y cierra al instante los que no lanzó Game Access.
- Descartados: **AppLocker** (Microsoft solo garantiza que se aplique en Enterprise/Education; no existe en Home), **App Control / WDAC** (para toda la PC: bloquearía también al adulto), **denegar ejecutar carpeta por carpeta** (lo de arriba), **`DisallowRun`** solo (lo respeta solo el Explorador).
- No cubre programas de Windows (`cmd`, `regedit`): quedan permitidos; protege que no haya escritorio, Ejecutar ni Administrador de tareas para llegar a ellos.

Script de la prueba de concepto: `tools/windows/kid-account.ps1` (crea la cuenta y su perfil, escritorio, Administrador de tareas y Ejecutar deshabilitados, discos ocultos, SRP y horario; `-Allow`/`-Disallow` habilitan o cierran la carpeta de un juego; `-Remove` borra la cuenta y su perfil).

### App del celular del padre (idea, Seba 2026-10-29)
Una mini app en el celular del adulto para **ver y administrar** al niño: cuánto jugó y a qué, cuánto le queda, sumar o quitar tiempo, habilitar o bloquear un juego, cambiar el horario. Habla con el servicio de la PC (directo en la red local o a través de la API de Game Access); la PC aplica los cambios y el servicio los hace cumplir. Sin diseñar todavía.

## Cómo se presenta y se usa (Seba, 2026-10-29)
El botón del niño abre una mini aplicación con varias páginas:
1. **Explicación que vende la función** (tono de marketing, para quien todavía no paga PLUS): qué resuelve, cuatro beneficios y "se configura en dos pasos". El botón Empezar está bloqueado sin PLUS y al lado hay "Conocer PLUS".
2. **Asistente**: (a) cuenta nueva de Windows para el niño, con el aviso de que solo puede usar Game Access (sin otros programas, sin internet, sin nada dañino) y el nombre; (b) tiempo por día y horarios, ya llenos: 2 h, lunes a viernes 12–21, fin de semana 9–22.
3. **Panel** (el asistente no vuelve a mostrarse): juegos habilitados con su máximo propio, cuánto jugó por día en la semana, órdenes en vivo (parar ahora, cerrar el día, sumar minutos) y ajustes. Más adelante, el enlace para bajar la app del celular.

**Máximo por juego** (2026-10-29): cada juego puede tener un máximo diario menor, **dentro** del total; el tiempo de un juego también cuenta para el total. Sirve para dar más tiempo a un programa de dibujo o a juegos educativos y menos a los que no aportan (Roblox: 1 h de 3 h).

## Deshacer y desinstalar (Seba, 2026-10-29)
- **Desde la app**: "Quitar el modo niño" deshace lo que se hizo: borra la cuenta de Windows y su perfil, saca al niño de `familia.json` y borra su tiempo y órdenes; queda como antes de empezar.
- **Al desinstalar Game Access**: se borran las cuentas de niño y `%ProgramData%\GameAccess`; una cuenta con Game Access de escritorio y sin Game Access sería una pantalla negra. En una actualización no se toca.
- **Al quitar un juego de la biblioteca**: la confirmación avisa que sale también del modo niño (y si el niño se queda sin juegos); el cambio llega a Windows al aplicar.

## Servidor (Seba, 2026-10-29) — MN.9 y US.1
Las estadísticas y las órdenes en vivo tienen que poder consultarse desde la app del celular, así que viven en el servidor (`apps/api`) y también en la PC.
- **Quién manda**: la PC hace cumplir las reglas aunque no haya internet. El servidor es el buzón y el historial.
- **Sin puertos abiertos en la casa**: la PC consulta al servidor (cada pocos segundos mientras el niño juega, más espaciado si no) y sube su historial; el celular habla solo con el servidor.
- **Estadísticas**: la PC sube los segundos por día y por juego (mismo formato que `uso\<sid>.json`); el servidor guarda el historial y lo sirve al celular y a Game Access.
- **Órdenes**: cola por niño con las mismas acciones del canal local (`extend`, `lock`, `unlock`, `stop`, más cambiar horario y límites). La PC las toma, las aplica y confirma; el canal local queda para la pantalla de Game Access y sin internet. Las dos fuentes se combinan por fecha de la orden.
- **Emparejar el celular con la PC**: código corto que muestra Game Access en el panel del niño; el celular lo canjea y queda ligado a la cuenta del usuario (US.1). Cada orden lleva usuario, PC y niño, y el servidor comprueba que el usuario sea el dueño.
- **Tabla de usuarios (US.1)**: `user` con correo, nombre, idioma y fecha de alta; sus llaves de acceso (`AccessKey` pasa a tener `user_id`), la membresía PLUS (vigencia) y **pagado / no pagado** con fecha y nota, que Seba cambia a mano en el panel de administración (sin pasarela de pago por ahora). El acceso a PLUS sale de la vigencia y de esa marca.

## Cuando PLUS se apaga (Seba, 2026-10-29) — MN.15
El modo niño y la clave de padre son parte de PLUS. Si el usuario los tenía configurados y PLUS deja de estar activo:
- **Modo niño**: queda **en pausa**, no se borra. La cuenta del niño sigue existiendo pero Game Access no lo deja jugar ("El modo niño está en pausa") y cierra la sesión al minuto. La PC del niño se entera por `C:\ProgramData\GameAccess\uso\plus.json`, que escribe el Game Access del adulto tras cada verificación (sin permiso de administrador); si el archivo falta o no se entiende, el modo niño sigue (una PC que nunca reportó, o una versión vieja, no se rompe). Si el adulto nunca vuelve a abrir Game Access la pausa no llega: eso lo resuelven las órdenes desde el servidor (MN.9).
- **Clave de padre**: **sin efecto**. No se pide, todos son administradores, el portón no se cierra. La palabra queda guardada, dormida.
- **Lo demás**: la biblioteca y las descargas se desbloquean (dependían de la clave); el filtro de contenido sigue (es gratuito).
- **Volver**: al volver PLUS todo se reanuda solo, con la misma palabra y la misma cuenta.
- **Sin internet**: el cliente no puede verificar PLUS. Hay una **gracia de 7 días** desde la última confirmación (`PLUS_GRACE_DAYS`, en `kidMode.ts`) en la que todo sigue funcionando, con un aviso de cuántos días quedan; después se trata como PLUS terminado. Una respuesta explícita del servidor de que no hay PLUS no tiene gracia (si el cobro tiene días de tolerancia, los da el servidor, no el cliente).

## Usuarios y PLUS (Seba, 2026-10-29) — US.1, US.2
- **Qué se guarda de cada usuario**: nombre, correo, contraseña (como hash) y su **llave de PLUS**. La llave activa el modo PLUS en el cliente y no vence mientras se reciba el pago mensual (hoy `AccessKey` vence y está ligada a una instalación; pasa a ligarse al usuario).
- **Pagado / no pagado**: una marca con fecha que Seba pone a mano en el panel de administración. La app no cobra todavía.
- **Cobro (más adelante)**: suscripciones de Mercado Pago y sus avisos (webhooks): pago recibido extiende la llave, pago rechazado dispara un aviso al usuario con unos días de anticipación y, si sigue sin pagar, revoca la llave. El cliente ya reacciona a una llave revocada (sección anterior).
- **Para probar**: servidor local con usuarios de ejemplo en cada estado (pagado, por vencer, sin pagar, sin llave), `apps/api/restart_local_api.ps1` y un script que los siembre; sirve también para la recuperación de clave olvidada y las órdenes desde el celular.
- **Cómo quedó (Claude, 2026-10-29)**: tabla **`account`** (no `user`: es palabra reservada en Postgres y ya la ocupa la tabla vieja de créditos) con nombre, correo único, idioma, fecha de alta, contraseña opcional (hash scrypt con sal, nunca en claro ni devuelta), `paid`, `plus_until`, `paid_at` y `paid_note`. `AccessKey.account_id` liga cada llave PLUS a su usuario. **La membresía manda sobre las llaves**: al marcar "Pagado hasta X" sus llaves PLUS vencen en X; al marcar "No pagado" vencen en ese momento (el cliente oye `expired` y pausa el modo niño y la clave, MN.15); al volver a pagar la misma PC sigue con la misma sesión, sin llave nueva. Así la ruta de activación no cambió. Una llave de usuario no se renueva sola (409): se renueva en el usuario. Panel: sección "Usuarios" en `/admin` (crear, Pagado hasta…, No pagado, Crear llave PLUS, Vincular llave…), rutas `/admin/users` (no `/admin/accounts`: ese prefijo es de las cuentas de proveedores retiradas). Estados: Pagado, Por vencer (7 días o menos), Sin pagar, Sin llave.
- **Servidor de prueba**: `apps/api/run_demo_users_api.ps1 [-Reset]` usa un SQLite aparte (`users-demo.db`, ignorado por Git; el script de semillas se niega a correr contra otra base) y siembra los cuatro estados con contraseña `prueba-1234`; imprime sus llaves y queda en el puerto **38147**, el que la app de escritorio siempre prueba primero (`DEFAULT_LOCAL_API` en `settings.ts`): en otro puerto la app no lo ve y se va al servidor real. Panel: `http://127.0.0.1:38147`. `restart_local_api.ps1` no sirve para esto: apunta a la base compartida de clientes.
- **Preguntas abiertas para Seba**: cuántos días de tolerancia tras un cobro rechazado; si una llave vencida debe poder reactivarse sola al pagar; si el usuario puede tener más de una PC con la misma llave.

## Una sola pantalla para los niños (Seba, 2026-10-29; rediseño MN.16)
Todo lo de niños se configura en **un solo lugar: el botón del niño**. Lo abre cualquiera; **cambiar algo pide ser administrador** (la clave de padre): como jugador se ve todo deshabilitado con "Ingresar la clave".
- **Modo niños apagado** (no hay cuenta de niño): primero, siempre, tenga o no PLUS, la **página que explica**: "¿Tenés niños en casa?", el texto de que controla el tiempo de juego sin peleas, y las tres funciones (filtro de contenido adulto en el catálogo; bloqueo de las funciones de padres; una cuenta de Windows solo para el niño, como una consola, sin Windows, con tiempo por día y horarios). **Empezar pide PLUS** (sin PLUS: "Activá PLUS para empezar" y "Conocer PLUS").
- **Asistente** (`KidWizard.tsx`): cada "Siguiente" agrega el paso debajo con GSAP y baja hasta él; los pasos hechos quedan, atenuados; "Cancelar" vuelve a la explicación.
  1. **Restringir las funciones de padres**: elegir la palabra de la **clave de padre** (la única clave: también protege el filtro).
  2. **Filtro de contenido adulto**.
  3. **La cuenta del niño**: cómo funciona y su nombre.
  4. **Sus juegos**: la grilla de juegos; "Crear la cuenta y terminar" crea la cuenta (Windows pide permiso) y el modo niños queda **encendido** (hay cuenta).
- **Modo niños encendido** (`KidControlPanel.tsx`): un panel con cuatro pestañas, **Juegos**, **Tiempo** (tiempo por día, horarios, la semana y las órdenes en vivo), **Filtro de contenido** y **Soporte y configuración** (clave de padre, ayuda y contacto, celular próximamente, quitar el modo niño). Abajo, "Aplicar" para los cambios de juegos y tiempo.
- **Grilla de juegos** (`KidGamesGrid.tsx`): la tabla del administrador de biblioteca con cuatro columnas: imagen, nombre, **Sí/No** y **límite propio**: *General* (juega libre dentro del tiempo del día) o *Específico* (de a 30 minutos, hasta el tiempo del día). Lista los juegos instalados y los accesos directos.
- **Una sola clave** (MN.14 punto 2): el filtro ya no tiene contraseña propia ni la pide al arrancar (se quitó `ParentalSetupDialog`); una contraseña vieja del filtro todavía lo desbloquea. Se quitó la pregunta "¿hay niños en casa?" con sus respuestas sí/no (`familyPrefs.ts`).

## Cómo es la clave de padre (Seba, 2026-10-29) — hecho en MN.10

> **Reemplazado 2026-10-30 (Seba):** la clave ya no mezcla la palabra con la fecha (obligaba a una cuenta mental cada día). Es una contraseña común que elige el padre, de 4 a 40 caracteres, sin distinguir mayúsculas. Más adelante: celular o Windows Hello. Lo de abajo queda como historia.
- **Regla**: el padre elige una palabra; la clave de cada día es esa palabra con los dígitos de la fecha (dd mm aa, seis dígitos con ceros): después de cada letra va un dígito en orden y tras la última letra van los que sobren. `perro` el 11-11-26 es `P1E1R1R1O26`. Cambia todos los días, así que verla escribir no sirve. No distingue mayúsculas. Largo = letras + 6.
- **Dónde se explica**: solo en la pestaña "Clave de padre", en una sección que se despliega ("solo para los ojos del padre"). Se activa cuando hay PLUS y el modo niño en marcha; antes no hace falta clave.
- **Dónde vive**: la palabra se guarda con DPAPI en el perfil de Windows del adulto (`admin_key.rs`, igual que el filtro). El portón manda lo escrito y Rust contesta sí o no. **La clave del día nunca va a la interfaz.**
- **Ver la palabra (Seba, 2026-10-29)**: como el saldo de una billetera. En la pestaña "Clave de padre" la palabra se ve con puntos y aparece solo mientras se mantiene apretado el botón del ojo (`admin_key_word`); al soltar, al cambiar de ventana o al bloquear la pantalla se oculta. Con PLUS terminado (todos son administrador) el botón no aparece. Cambiar o quitar la clave pide escribir la palabra actual o la clave de hoy: el padre no técnico suele recordar la palabra. Más adelante el celular del padre (MN.7) va a mostrar la clave del día y un botón "Abrir Game Access en la PC", para que no haga falta calcularla.
- **El portón**: al abrir Game Access con clave activa, el portón queda cerrado con un campo tipo LCD junto al candado: círculos (se ven tres como mucho, corriendo a la izquierda, sin revelar cuántos), un tic por tecla, sin botón de confirmar; solo consulta cuando lo escrito tiene el largo de la clave de hoy, sin límite de intentos; al acertar se pone verde, la cerradura gira y el portón abre como administrador. Debajo, **"Entrar como jugador"** (sin clave, con menos privilegios) y "Olvidé la clave" (necesita US.1).
- **Jugador**: no puede abrir la pantalla de niños (ni ver los botones del niño por juego en la biblioteca). Si toca algo protegido, el portón vuelve a cerrarse pidiendo la clave con el mismo campo; con la clave se abre y sigue. Tras 5 minutos sin tocar la PC, el administrador vuelve a ser jugador y el portón se cierra de nuevo.

## Contraseña de administrador (Seba, 2026-10-29) — MN.10
Si el Modo niño está activo, hay un niño en la casa que puede llegar a Game Access abierto en la cuenta del adulto, o abrirlo él. Entonces:
- Modo niño y el filtro de contenido para niños quedan en una sección **bajo contraseña**.
- Game Access pasa a pedir permiso de administrador para modificar la biblioteca, descargar y cambiar el perfil del niño.
- No se pide todo el tiempo: al abrir Game Access, o cuando la PC lleva un rato sin actividad, Game Access se cierra de nuevo con la animación del portón (§4.24 de `docs/GUI_DESIGN.md`), que gana un campo de clave: **con clave entra como administrador, sin clave como jugador** (menos privilegios).
- Hay que decidir dónde vive la clave (hash en `familia.json`, que ya prevé un PIN del adulto, o en la cuenta del usuario del servidor) y qué puede hacer el modo jugador.

## Instalación y datos para varios usuarios
Desde 2026-10-19 (MN.1) Game Access se instala **para toda la PC** en `Program Files\gameAccess`; el estado del launcher va a `%LOCALAPPDATA%\gameAccess\launcher` y las carpetas de juegos y descargas elegidas en el instalador a `HKLM\Software\gameAccess`. Lo que sigue describe el resto del diseño.

Cambio previsto:
- **Instalación para toda la PC** (`"installMode": "perMachine"`, en `Program Files`): el niño no puede modificar ni reemplazar el ejecutable que hace de escritorio. Instalar y actualizar piden administrador; las actualizaciones las hace el adulto.

| Dónde | Qué guarda | Quién escribe |
|---|---|---|
| `Program Files\GameAccess` | El programa | Solo administrador |
| `ProgramData\GameAccess\familia.json` | Qué cuentas de Windows (SID) son de niños, juegos permitidos por niño, horarios, límites diarios, hash del PIN del adulto | Solo administrador; los demás solo leen |
| `%LOCALAPPDATA%` de cada usuario | Biblioteca, preferencias, caché (como hoy) | Cada usuario el suyo |

## Cómo decide el modo
Al arrancar, Game Access lee el **SID** de la cuenta que inició sesión y lo busca en `familia.json`:
- **Cuenta de niño → modo niño**: solo los juegos permitidos y el tiempo que queda; sin configuración, tienda, descargas ni importador; "Salir" = cerrar sesión.
- **Cualquier otra → modo adulto**: Game Access normal + sección **Control parental**.

El modo no es un interruptor que el niño pueda tocar: lo define la cuenta.

## Control parental (modo adulto)

> **Decidido con Seba (2026-10-29):** Game Access se instala desde la cuenta del padre y ese Game Access es la consola desde donde se administra todo: crear la cuenta del hijo, asignarle juegos, tiempo y horarios. Lo que pide administrador no lo hace la app del padre relanzándose elevada cada vez, sino el **servicio SYSTEM** que instala el instalador (que ya corre como administrador): la app del padre le manda las órdenes por named pipe y el servicio solo acepta órdenes de administración de cuentas del grupo Administradores (o del SID del padre registrado) y con el PIN; a la cuenta del niño solo le acepta "jugar a X". La app del celular (MN.7) pasa por el mismo servicio. El servicio hace en Rust lo mismo que `tools/windows/kid-account.ps1`. Lo de abajo (relanzar elevado) queda como plan B si el servicio no estuviera.
El adulto crea o elige la cuenta del niño, elige sus juegos y define horarios y límites. Para aplicarlo, Game Access se relanza **elevado** (p. ej. `gameaccess-desktop.exe --aplicar-control-parental`; Windows pide confirmación una vez) y:
- crea la cuenta local estándar del niño,
- pone Game Access como su escritorio,
- deshabilita el Administrador de tareas en esa cuenta,
- configura el horario de inicio de sesión,
- escribe `familia.json`.

## Juegos accesibles desde la cuenta del niño
- **Steam** se instala para toda la PC: sus juegos se comparten. Activar la **Vista familiar de Steam** con PIN (la sesión de Steam es la misma para todas las cuentas de Windows: el niño usaría la cuenta del adulto, con tienda y navegador interno). Revisar lo mismo en Epic y otros launchers.
- Los juegos instalados dentro de `C:\Users\<adulto>\...` no son accesibles desde otra cuenta: lo que instale o descargue Game Access debe ir a una carpeta compartida (p. ej. `C:\Juegos` o `ProgramData`).

## Conteo del tiempo
- **Versión 1**: el Game Access del niño guarda cuánto jugó en su `%LOCALAPPDATA%`. Sin escritorio ni explorador, un chico de 6 a 12 no tiene cómo borrarlo; además el horario de inicio de sesión lo hace cumplir Windows.
- **Con el bloqueo de ejecutables (2026-10-29) pasa a ser obligatorio**: un servicio chico como SYSTEM que lleva el tiempo y al que Game Access consulta (named pipe); el niño no puede tocarlo. Si en las pruebas aparecen escapes reales, ese mismo servicio puede vigilar procesos (eventos de proceso por ETW con `Microsoft.Diagnostics.Tracing.TraceEvent` o equivalente en Rust, reglas por firma digital del ejecutable con `WinVerifyTrust`, p. ej. "Roblox Corporation") y dejar correr solo lo que lanzó Game Access.

## Vías de escape conocidas
- Launchers (Steam, Epic): tienda, navegador interno, otros juegos → Vista familiar.
- Diálogos "Abrir archivo" dentro de juegos (clic derecho → ejecutar): poco probable a esta edad; respaldo con el servicio que vigila procesos.
- Juegos con navegador adentro (Roblox, algunos MMO): si están permitidos, quedan sujetos al tiempo como cualquier juego.
- Modo seguro o acceso físico a otra cuenta: fuera del alcance de una herramienta familiar.
- Juegos en el navegador: no aplican (no hay navegador en la cuenta del niño).

## Alternativas evaluadas (descartadas o secundarias)
- **Renombrar o esconder los ejecutables de los juegos**: descartado. Los launchers los "reparan" y vuelven a descargar, algunos anti-cheat lo detectan, un corte deja juegos rotos o liberados, y no cubre juegos nuevos.
- **Servicio que vigila todos los procesos en una cuenta normal** (sin quiosco): más código y hay que reconocer qué es un juego (biblioteca, carpetas de launchers, firma digital, base de juegos). Queda como refuerzo opcional.
- **Microsoft Family Safety**: hace límites por app y detecta juegos nuevos, pero exige cuentas Microsoft, no limita sitios web por tiempo y no tiene API pública (Game Access no puede leer ni mostrar el tiempo). Se puede recomendar como alternativa para familias que ya lo usan.
- **Open source**: no hay un proyecto para Windows que sirva de base (CSClock y Parents Time Control limitan el tiempo total de la PC; ActivityWatch solo mide). Se reutilizan librerías, no productos.
