---
tipo: diseño
actualizado: 2026-10-29
estado: diseñado, sin implementar
---
# Modo niño — control de acceso y tiempo para chicos

> Diseño acordado con Seba el 2026-10-19. **Todavía no se implementa**: primero va la prueba de concepto (tarea MN.2 en [[Tareas]]). Feature del plan de 4 USD (ver [[Proyecto]]).

## Objetivo
Que un chico de **6 a 12 años** solo pueda jugar a los juegos que el adulto le habilita, en los horarios y con el tiempo que el adulto define, **sin poder saltearlo** abriendo los ejecutables por fuera de Game Access ni instalando juegos nuevos (por ejemplo Roblox desde el navegador o siguiendo instrucciones de una IA). En la misma PC, otro usuario (adulto) usa Game Access normal, sin restricciones.

## Idea central: Game Access como escritorio de la cuenta del niño (modo quiosco)
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

### Nada se ejecuta salvo lo que Game Access habilita (Seba, 2026-10-29)
En la cuenta del niño Game Access corre **como el niño**: no puede tener más permisos que él, así que lo que Game Access pudiera habilitar solo, también lo podría el niño. Seba tiene juegos en varios discos (C:, E:, F:, G:), Steam con 3 bibliotecas, Epic, RetroBat y Roblox (que se instala en el `AppData` de cada cuenta): bloquear carpeta por carpeta deja abierta cualquiera que se olvide y obliga a cambiar permisos de millones de archivos. Por eso se le quitan los permisos **al usuario**, todo en su propio registro bajo `Policies` (una cuenta estándar no lo puede cambiar) y sin tocar archivos:
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
