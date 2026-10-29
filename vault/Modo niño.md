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

### Juegos bloqueados hasta que Game Access los habilita (Seba, 2026-10-29)
En la cuenta del niño Game Access corre **como el niño**: no puede tener más permisos que él, así que lo que Game Access pudiera habilitar solo, también lo podría el niño. Por eso:
- Las cuentas de niños están en el grupo local **`GameAccess-Kids`**, que tiene **denegado ejecutar** (permiso NTFS `ExecuteFile`, heredado) en las carpetas de juegos. Bloquea los `.exe` y también las DLL (cargarlas pide permiso de ejecución). Anda en Home y Pro.
- Un **servicio de Game Access como SYSTEM** (MN.6, ahora obligatorio) recibe el pedido "jugar a X" por named pipe, comprueba qué cuenta lo pide, si el juego está permitido, si queda tiempo y si está en horario, y agrega un permiso **explícito de ejecutar** en la carpeta de ese juego solo para esa cuenta (el permiso de la carpeta del juego queda más cerca que la denegación heredada de la raíz, y gana). Al acabarse el tiempo cierra el juego y saca el permiso; al arrancar la PC saca los que hayan quedado.
- El tiempo también lo lleva el servicio: el niño no puede tocar ni el contador ni el permiso.
- Descartados para esto: **AppLocker** (Microsoft solo garantiza que se aplique en Enterprise/Education; no existe en Home), **App Control / WDAC** (es para toda la PC: bloquearía también al adulto), **`DisallowRun`** (solo la respeta el Explorador).
- No cubre programas de Windows (`cmd`, etc.): no conviene cambiar sus permisos; ahí protege que no haya escritorio ni Explorador.
- Steam abre sus juegos él mismo: su carpeta de juegos necesita el mismo bloqueo y habilitación. Probarlo en MN.2.

Script de la prueba de concepto: `tools/windows/kid-account.ps1` (crea la cuenta, el grupo, el escritorio, el Administrador de tareas bloqueado, el horario y el bloqueo de las carpetas; `-Remove` lo deshace).

### App del celular del padre (idea, Seba 2026-10-29)
Una mini app en el celular del adulto para **ver y administrar** al niño: cuánto jugó y a qué, cuánto le queda, sumar o quitar tiempo, habilitar o bloquear un juego, cambiar el horario. Habla con el servicio de la PC (directo en la red local o a través de la API de Game Access); la PC aplica los cambios y el servicio los hace cumplir. Sin diseñar todavía.

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
