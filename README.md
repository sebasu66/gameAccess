# Game Access

Game Access es una aplicación Windows construida con **React + Vite + Tauri 2** y un backend central **FastAPI**. El objetivo actual de la beta es permitir que un usuario active Game Access durante un período limitado, consulte el catálogo, descargue juegos y use cuentas Steam proveedoras de forma transparente, manteniendo la autoridad de disponibilidad y leases en el servidor.

> **Estado de arquitectura: 2026-10-01.**
>
> `README.md` describe las reglas vigentes. `TODO.md` contiene solamente trabajo pendiente. `skill.md` conserva contexto técnico y decisiones más detalladas.

## Regla principal del producto

**DESCARGAR Y JUGAR SIEMPRE QUE SEA POSIBLE.**

Game Access no debe introducir restricciones preventivas que Steam no requiera. La disponibilidad real debe derivarse de evidencia concreta y del estado central de las leases, no de heurísticas históricas.

### Download

Si existe una cuenta registrada con acceso conocido al AppID, Game Access intenta la descarga.

- DOWNLOAD **no** se bloquea por una lease activa, por Steam Family ni por capacidad simulada.
- Steam/DepotDownloader es la autoridad final sobre si la operación concreta puede completarse.
- Un error de descarga no invalida automáticamente la cuenta.
- Solo un `InvalidPassword` explícito reportado por Steam marca la credencial como inutilizable.

### Play

Para jugar:

1. validar que la activación de Game Access siga vigente;
2. reutilizar la cuenta ya asignada a esa misma instalación si puede acceder al nuevo AppID;
3. si hace falta otra cuenta, seleccionar cualquier identidad Steam registrada con acceso conocido al AppID;
4. excluir identidades reservadas por una **lease activa de otra instalación**;
5. excluir solamente credenciales explícitamente marcadas `invalid_password`;
6. si no queda ninguna candidata, informar que no hay disponibilidad.

No se usa Steam Family, `ProviderAccount.status`, IP, fingerprint ni el viejo `user_id=1` como scheduler de Play.

## Identidad del cliente y activación

La identidad estable del cliente es `installation_id`.

En Windows se genera una vez y se conserva localmente bajo el área de datos de Game Access. La activación/key queda vinculada a esa instalación y el cliente la envía al backend mediante los headers de activación.

Reglas actuales:

- `installation_id` es la identidad de ownership de una lease;
- no se deriva identidad de IP, hostname ni fingerprint;
- una key/sesión no habilita otra instalación automáticamente;
- el backend valida activación en catálogo, descargas, leases y operaciones protegidas;
- el vencimiento de la activación es el límite duro de nuevas operaciones Game Access;
- **10 minutos antes del vencimiento** el cliente muestra un aviso;
- al vencer, se limpia la sesión local de Game Access y se vuelve al gate de activación;
- el vencimiento **no cierra Steam ni mata un juego que ya esté abierto**.

Mensaje esperado a T-10:

```text
Tu acceso expirará en 10 minutos. Puedes generar otra llave siguiendo el mismo procedimiento.
```

Al expirar:

```text
Terminó el tiempo de acceso. Ingresa una nueva llave para continuar.
```

## Modelo de leases

Las leases representan disponibilidad central de una **cuenta Steam proveedora**, no control del proceso local de Steam.

### Reutilización

Si un `installation_id` ya tiene una lease y la misma cuenta puede acceder al nuevo AppID, se reutilizan la misma cuenta y la misma lease.

Esto evita cambios de cuenta innecesarios.

### Cambio de cuenta

Si la cuenta actual no puede acceder al nuevo juego:

- primero se busca una alternativa válida;
- solo después de encontrarla se libera/reemplaza la lease anterior;
- nunca se libera preventivamente la cuenta actual dejando al jugador sin alternativa.

### Liberar una lease no significa cerrar Steam

Una liberación central:

- vuelve a ofrecer la cuenta al pool;
- no hace logout;
- no cambia la cuenta local;
- no cierra Steam;
- no mata el juego;
- no intenta revocar una sesión local que el usuario ya está usando.

Esta separación es deliberada.

## Presencia Steam e inactividad online

El backend es la autoridad de inactividad de leases.

Game Access usa la **Steam Web API** (`ISteamUser/GetPlayerSummaries/v2`) con el secreto de servidor:

```text
STEAM_WEB_API_KEY
```

La key se configura solamente en el entorno del backend, por ejemplo en Render. Nunca debe entrar en Git, frontend, instalador o logs.

El monitor consulta las cuentas con leases activas:

- si Steam devuelve evidencia de que la cuenta está jugando online, se conserva la lease y se limpia cualquier período de inactividad;
- si una respuesta válida indica que ya no está jugando online, comienza el período de gracia;
- después de **10 minutos continuos** sin actividad online válida, el backend libera la lease con `steam_inactive_timeout`;
- si la API falla, hay timeout, falta SteamID verificable o la respuesta es ambigua, el estado es **unknown**, no inactive;
- unknown **no avanza el contador** y nunca libera una cuenta por error.

Si `STEAM_WEB_API_KEY` no está configurada, el comportamiento seguro es preservar las leases en vez de inferir inactividad.

## Offline play

El juego offline es un comportamiento válido y buscado.

Después de que el backend libera una cuenta por inactividad online, el usuario puede continuar localmente si Steam y el juego lo permiten, por ejemplo usando Steam Offline Mode o desconectando Wi-Fi.

El cliente debe explicar la liberación sin presentar el juego como terminado.

Una lease liberada en el servidor y un juego que sigue corriendo localmente son estados compatibles.

## Cuentas proveedoras y credenciales

### Una identidad Steam = una cuenta de Game Access

El login Steam es la identidad canónica de una cuenta proveedora.

El roster y el backend tratan el login case-insensitive. No deben existir asientos operativos separados como:

```text
alice
alice#2
alice#3
```

Si aparecen duplicados históricos, el sync consolida mappings, leases y referencias hacia una sola identidad canónica.

### Actualizar una contraseña

Si se vuelve a cargar el mismo login con una contraseña nueva:

- se actualiza la credencial de esa cuenta;
- no se crea otra cuenta;
- la contraseña más reciente reemplaza a la anterior;
- una validación correcta reactiva una cuenta previamente marcada por contraseña inválida.

### Única invalidez dura: InvalidPassword

Los estados históricos `inactive`, `disabled`, `free` o `leased` pueden estar desactualizados y **no son autoridad de elegibilidad**.

Una cuenta queda fuera del pool únicamente cuando Steam devuelve explícitamente `InvalidPassword`.

Actualmente esa señal puede llegar desde:

- scan/onboarding SteamKit;
- login real para Play;
- worker de Download/DepotDownloader.

No invalidan una cuenta:

- Steam ocupado / `AlreadyLoggedInElsewhere`;
- Steam Guard;
- timeout;
- error de red;
- API caída;
- scan incompleto;
- respuesta desconocida;
- fallo genérico de descarga/login.

Una contraseña válida posterior para el mismo login repara la cuenta original.

## Steam Family

Steam Family dejó de formar parte del scheduler operativo.

La topología Family, miembros y copias pueden mantenerse como **metadata y diagnóstico histórico**, pero:

- no limitan Play;
- no limitan Download;
- no calculan disponibilidad operativa;
- no rankean cuentas;
- no reservan “seats” para el runtime.

La disponibilidad operativa es simplemente: **acceso conocido + credencial utilizable + identidad no ocupada por otra lease activa**.

Cualquier investigación futura de Steam Family debe permanecer separada de esta regla salvo una decisión explícita posterior.

## AFK local — pendiente, no implementado

Está prevista una segunda señal de inactividad desde el cliente, pero todavía **no forma parte del runtime actual**.

Diseño acordado:

- detectar aproximadamente 10 minutos sin input real del sistema;
- incluir teclado, mouse y controller/gamepad cuando corresponda;
- mostrar un popup nativo “¿Sigues ahí?”;
- esperar inicialmente 60 segundos, configurable a 30–60 s para pruebas;
- si el usuario responde o genera input, conservar la lease;
- si no responde, enviar `client_afk_timeout` al backend;
- el backend liberará solo la lease central;
- tampoco en este caso se cerrará Steam ni el juego.

La implementación debe evitar falsos positivos en fullscreen, Alt+Tab, bloqueo de Windows, Remote Desktop y sesiones jugadas solo con controller.

## Partidas guardadas — objetivo pendiente

La continuidad de saves debe pertenecer al **usuario de Game Access + juego**, no a la cuenta Steam proveedora que haya sido asignada en una sesión concreta.

La arquitectura futura debe:

- descubrir rutas reales por juego: Steam `userdata`, Documentos, AppData y rutas específicas;
- mantener un save canónico por usuario + AppID;
- preparar/restaurar ese progreso antes de lanzar el mismo juego con otra cuenta proveedora;
- capturar los archivos modificados al cerrar;
- conservar backups;
- resolver conflictos por timestamp/hash/slots sin sobrescribir silenciosamente una partida más nueva;
- mantener múltiples slots cuando el formato lo permita;
- excluir automatización en juegos ligados a SteamID/cifrado por cuenta;
- coordinarse cuidadosamente con Steam Cloud para evitar restauraciones o uploads incorrectos.

## Logging y diagnóstico

El cliente escribe un log narrativo pensado también para diagnóstico humano:

```text
%LOCALAPPDATA%\GameAccess\logs\gameaccess.log
```

Los errores técnicos importantes se reportan al backend mediante el canal de errores del cliente.

Nunca deben escribirse:

- contraseñas;
- bearer tokens;
- activation keys;
- session tokens;
- material criptográfico de transporte;
- credenciales Steam completas.

Toda denegación/liberación relevante del backend debe registrar una razón concreta y, cuando corresponda, `installation_id`, AppID/game, lease y cuenta.

## Arquitectura actual

```text
Cliente Windows
┌─────────────────────────────────────────────┐
│ Game Access / Tauri                         │
│ React + Vite                                │
│                                             │
│ - activación                                │
│ - catálogo                                  │
│ - descarga                                  │
│ - Play                                      │
│ - transporte cifrado de credenciales        │
│ - integración local con Steam               │
└───────────────────┬─────────────────────────┘
                    │ HTTPS
                    ▼
Backend central / FastAPI
┌─────────────────────────────────────────────┐
│ - activaciones + installation_id            │
│ - catálogo                                  │
│ - inventario de cuentas                     │
│ - leases                                    │
│ - presencia Steam                           │
│ - audit/access events                       │
│ - errores cliente                           │
└─────────────────────────────────────────────┘
                    │
                    ▼
Steam Web API / Steam services
```

### `apps/api`

Backend central FastAPI. Actualmente contiene:

- activación y sesiones por instalación;
- catálogo/metadata;
- cuentas proveedoras y ownership conocido;
- leases;
- monitor de presencia Steam;
- audit events;
- endpoints de transporte de credenciales;
- sincronización administrativa;
- prototipos históricos de créditos/Family que no gobiernan el flujo actual.

El backend de producción/desarrollo remoto debe ser independiente del cliente. El cliente no requiere que el usuario ejecute manualmente un FastAPI local.

### `apps/desktop`

Aplicación Windows de usuario:

- React/Vite;
- Tauri 2;
- catálogo;
- activation gate;
- Play/Download;
- polling de estado de lease;
- mensajes de expiración/inactividad;
- login Steam en contexto local;
- runtime Python embebido para las tareas que todavía lo necesitan.

La ventana principal está configurada como ventana redimensionable, no fullscreen.

### `apps/launcher`

Harness/herramientas anteriores y runtime Python de apoyo para experimentos Steam, scans, ownership y downloads.

No es la interfaz de usuario final.

## Backend remoto y configuración del cliente

El frontend empaquetado lee:

```text
apps/desktop/public/gameaccess.settings.json
```

La configuración actual usa un resolver estable:

```json
{
  "api_url": "",
  "api_url_resolver": "https://raw.githubusercontent.com/sebasu66/gameAccess/refs/heads/dev/apps/desktop/public/backend-pointer.json",
  "catalog_manifest_url": "https://api.github.com/repos/sebasu66/gameAccess/contents/deploy/catalog-cache/catalog-manifest.json?ref=dev"
}
```

Esto permite cambiar el backend remoto mediante `backend-pointer.json` sin recompilar el cliente.

Un build con `build-and-run.ps1 -Server` puede fijarse explícitamente a la API local para desarrollo.

## Build del cliente

### EXE rápido de desarrollo

Desde la raíz:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-and-run.ps1
```

El script:

- valida/importa el backend FastAPI;
- prepara dependencias cuando hacen falta;
- genera un timestamp UTC de build;
- compila Tauri en release;
- reemplaza `GameAccess-latest.exe` de forma atómica;
- calcula SHA256;
- no cierra Steam, juegos ni workers de descarga.

Con servidor local:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-and-run.ps1 -Server
```

Solo build/validación:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-and-run.ps1 -NoRun
```

### Instalador NSIS

Desde `apps/desktop`:

```powershell
$env:VITE_BUILD_TIMESTAMP = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
npm run tauri -- build
```

Tauri genera el instalador en:

```text
apps/desktop/src-tauri/target/release/bundle/nsis/gameAccess_0.1.0_x64-setup.exe
```

El bundle incluye:

- frontend compilado;
- binario Tauri;
- runtime Python embebido;
- runtime/launcher;
- catálogo empaquetado configurado como recurso;
- bootstrapper de WebView2 cuando sea necesario.

No deben committearse instaladores, EXEs de release, secrets ni artefactos de `target`.

## Instalador de prueba actual

Build generado el **2026-10-01** para validar los últimos cambios de leases/presencia/credenciales:

```text
C:\DEV\Game Access Dev\GameAccess-v0.1.0-Installer-2026-10-01.exe
```

SHA256:

```text
33027A3616D90639A025E79942C87F966A6A7E3674FC9D90D6D7201F873011E5
```

Build stamp embebido:

```text
2026-10-02T01:57:02.780Z
```

El cambio de fecha entre nombre local y timestamp UTC es normal: la build se generó el 1 de octubre por la noche en Argentina y ya era 2 de octubre UTC.

## Validación reciente

Snapshot de pruebas previo a este README:

- backend completo: **57 passed**;
- launcher completo: **64 passed**;
- Rust login/presencia de resultado: **3 passed**;
- tests dirigidos desktop de lease/activación/credencial: **8 passed**;
- `cargo check`: OK;
- TypeScript: OK;
- Vite production build: OK;
- Tauri release + NSIS: OK.

Los warnings actuales de backend son deprecaciones de FastAPI/Starlette y no fallos funcionales.

## Seguridad y transporte de credenciales

Las credenciales de cuentas proveedoras permanecen en infraestructura controlada por Game Access y no se distribuye un CSV de cuentas al cliente.

Para Play/Download:

- el cliente solicita la credencial correspondiente a la operación autorizada;
- el backend verifica activación, lease/identidad cuando aplica y acceso al AppID;
- la credencial se entrega mediante el transporte cifrado implementado;
- Tauri la utiliza localmente para el login Steam;
- Game Access no la persiste como roster local del cliente;
- el backend nunca debe entregar credenciales de una lease perteneciente a otro `installation_id`.

Las contraseñas no deben aparecer en logs, UI diagnóstica ni reportes de error.

## Catálogo

Reglas actuales:

- incluir juegos reales conocidos por las cuentas proveedoras;
- excluir DLC/tools/software/soundtracks y otros tipos no-juego cuando están clasificados;
- no destruir ownership válido por un fallo transitorio de otro scan;
- metadata pendiente puede resolverse incrementalmente;
- el catálogo empaquetado/cacheado es una optimización de UX, no una fuente de nuevas licencias;
- todas las bibliotecas Steam configuradas en el PC deben ser consideradas para instalación/detección local.

## Plataforma Steam

Game Access debe usar Steam y sus interfaces como autoridad final. No se debe diseñar alrededor de modificar `steam_api64.dll`, fabricar ownership ni eludir DRM.

Tampoco se debe automatizar el cambio arbitrario de store country. La región de una cuenta debe seguir los mecanismos soportados por Steam y la situación real del titular.

## Funcionalidades pendientes principales

La cola autoritativa está en `TODO.md`. Entre los pendientes actuales destacan:

- prueba end-to-end del nuevo flujo de lease/presencia con el instalador recién generado;
- nueva animación del logo/splash;
- web pública de Game Access con descarga del instalador;
- continuidad/unificación de partidas guardadas por usuario + juego;
- detección AFK local con confirmación antes de liberar capacidad;
- validación de instalación limpia;
- consolidación final de catálogo/artwork;
- flujo Linkvertise;
- publicación/update strategy del cliente.

## Archivos clave

```text
README.md                              reglas y arquitectura vigente
TODO.md                                trabajo pendiente
skill.md                               conocimiento técnico acumulado
render.yaml                            declaración de entorno/deploy backend
apps/api/app/main.py                   API central
apps/api/app/family_capacity.py        metadata Family + selector simple actual
apps/api/app/steam_presence.py         consulta de presencia Steam
apps/api/app/pool_routes.py            sync de roster/inventario
apps/desktop/src/api.ts                API del cliente
apps/desktop/src/leaseLifecycle.ts     observación de lease server-side
apps/desktop/src/native.ts             operaciones nativas/download
apps/desktop/src/ActivationGate.tsx    activación y expiración
apps/desktop/src-tauri/src/steam_session.rs
                                       login/session Steam local
apps/launcher/provider_account_onboard.py
                                       alta/repair de cuentas proveedoras
```

## Principios de mantenimiento

- inspeccionar código real antes de modificar arquitectura;
- no resetear/limpiar cambios locales del usuario;
- Git es el historial: no conservar implementaciones runtime contradictorias solo “por si acaso”;
- no introducir nuevas restricciones a Play/Download sin evidencia concreta;
- unknown nunca debe convertirse silenciosamente en inactive;
- `InvalidPassword` requiere evidencia explícita;
- una identidad Steam no puede multiplicarse por duplicados de base/CSV;
- liberar una lease central nunca implica cerrar la sesión local;
- cambios que afecten al jugador deben tener mensaje claro + razón técnica auditable;
- mantener `TODO.md` limpio: tareas terminadas u obsoletas se eliminan después de registrar evidencia.

## Desktop detail layout contract (2026-09-08)

The normal desktop library detail has three named regions. **First row** is the essential summary (title, real Steam short description, existing Play/Download state action, and like/dislike). **Second row** is a compact factual Steam summary plus separately labelled GameAccess availability and active-download measurements when they actually exist. First and Second rows remain visible together inside the supported desktop viewport. **Third row** and later About/requirements/gallery content form the scrollable extended-detail region.

Selected-game Steam details load lazily and asynchronously, including for the game already displayed at desktop startup, and use the existing AppID/game detail cache. Rapid selection changes must never paint stale details under a newer game. Desktop background media follows a deterministic trailer -> screenshots -> repeat sequence, starts muted, falls back safely on media errors, and does not change its contract merely because the window is maximized. Tablet and presentation/display surfaces keep their separate behavior.

See `docs/DESKTOP_DETAIL_LAYOUT_CONTRACT.md` for the acceptance contract and viewport matrix.
