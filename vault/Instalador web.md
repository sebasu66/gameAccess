---
tipo: diseño
actualizado: 2026-11-04
---
# Instalación con un clic desde la web

Pedido de Seba (2026-11-04): instalar Game Access desde un botón de gameaccess.site, guiado y sin la pantalla azul de SmartScreen, sin pagar un certificado y sin abrir el núcleo. Cuando haya plata se firma la app y este mismo flujo sigue sirviendo.

## Cómo funciona
1. La página (`deploy/website`, sección Descargar, botón **Instalar con un clic**, `assets/install.js`) pide una sesión a la API (`POST /install/sessions`) y copia el comando con su código: `powershell -nop -c "irm <api>/i/<código>|iex"`.
2. El jugador hace **Win + R → Ctrl + V → Enter**. PowerShell (firmado por Microsoft) baja el script `apps/api/app/web_install.ps1` (abierto, en este repo) con el código y los datos de la versión ya puestos (`GET /i/<código>`).
3. El script avisa cada paso a la API (`POST /install/sessions/<código>/events`) y la página los muestra en vivo (`GET /install/sessions/<código>`, cada segundo).
4. Pasos: conectado → Windows 10 1809+/11 de 64 bits → Smart App Control apagado o en evaluación → WebView2 de Microsoft (lo instala con su instalador firmado si de verdad falta) → Steam (requisito: si falta, avisa y para; no se instala solo, decisión de Seba) → baja el instalador → verifica el SHA-256 → instala en silencio (`/S`, Windows pide permiso) → abre Game Access.
5. Lo que baja PowerShell no lleva la marca de "descargado de internet": no aparece SmartScreen.

## Reglas de seguridad
- El script solo ejecuta el instalador que nombra el servidor y solo si su SHA-256 coincide: el de la última release de GitHub con el `digest` que publica GitHub. Sin digest no se ofrece nada.
- Los valores que el servidor mete en el script van entre comillas simples de PowerShell con la comilla duplicada (test).
- La sesión dura 30 min, vive en memoria, guarda solo pasos y motivos cortos (`uac_declined`, `sac_on`…), sin id de instalación ni usuario. 30 sesiones por hora por IP.
- La página solo acepta `?api=` cuando ella misma se sirve desde localhost y el destino también es localhost: nadie puede armar un enlace a gameaccess.site que copie un comando hacia otro servidor.

## Probar
- Local: `launch.json` → `web-install-api` (`tools/web-install/serve-local.ps1`: API en 0.0.0.0:8796 con SQLite propio y el último instalador local en `/setup/`) y `landing`; abrir `http://localhost:8790/?api=http://127.0.0.1:8796#descargar`.
- Windows Sandbox: `tools/web-install/sandbox.wsb` abre el Sandbox con Win + R esperando; el comando apunta a la IP de vEthernet (Default Switch).
- Real: hace falta la API en Render (deploy manual de `dev`) y la página publicada.

## Resultados (2026-11-04)
- Sandbox limpio, comando pegado al iniciar: todos los pasos OK, Steam instalado por el script (versión anterior), 0.1.9 bajada, verificada, instalada y abierta. La app abrió con "Could not find the WebView2 Runtime": en el Sandbox el registro dice WebView2 156.0.4314.50 y en disco está la .58 (el registro sale de la imagen del Sandbox y los archivos de Windows del host). El instalador de WebView2 de Microsoft termina con -2147219198 y no lo arregla. El paso WebView2 ahora lo detecta y avisa en vez de decir "Listo".
- En el Sandbox no aparecen los permisos de administrador: falta verlos en una PC real.

## Pendiente
- Probar en el Windows 10 de Seba desde la web (API en Render + página publicada).
- Instalación por usuario (sin permiso de administrador): hoy el instalador es `perMachine` y escribe en HKLM; el permiso muestra "Editor desconocido".
- Dirección corta para el comando (por ejemplo `i.gameaccess.site` apuntando a Render).
