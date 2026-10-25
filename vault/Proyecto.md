---
tipo: proyecto
actualizado: 2026-10-25
---
# Game Access — definición del proyecto

*Lema: "Juga mas y mejor".*

> Este documento manda sobre `README.md`, `skill.md` y `docs/` si se contradicen. Estados según lo conversado con Seba hasta 2026-10-16; los marcados con † debe confirmarlos Seba.

## En una frase
Game Access es una aplicación de escritorio para Windows que reúne en un solo lugar el catálogo de juegos de PC, su descarga, instalación y ejecución, y que acelera las descargas mediante un servicio opcional de pago.

## Qué hace el usuario con la app
1. **Explora el catálogo** (unos 41.700 juegos): búsqueda por título, géneros, etiquetas y modo de juego, orden y filtro +18. Por defecto oculta juegos con rating bajo (menos de 6/10) y antiguos (más de ~1 año); ambos filtros se pueden quitar.
2. **Abre la ficha** de un juego: descripción, tráiler, capturas, valoraciones.
3. **Descarga**: la app consigue las fuentes del juego mediante un plugin y lo baja por torrent con un cliente embebido, o, con la versión Plus, por un link directo acelerado.
4. **Instala** en la carpeta `<appid>-<nombre>-<estado>` y **juega** con el botón Play, que ejecuta según el perfil de ejecución del juego.
5. **Administra su biblioteca**: juegos instalados y favoritos; abrir carpeta, desinstalar.

## Dos versiones
*(En el código y en `README.md` se llaman BASE = Free y PLUS = Plus.)*

| | **Free** (sin llave, descarga libre) | **Plus** (con llave) |
|---|---|---|
| Descarga | Torrent con cliente embebido, a velocidad natural. Elige la fuente con más seeds | La app envía el link al servidor; el servidor lo procesa (caché Viking Files / Torbox) y devuelve un link directo acelerado |
| Servidor | Solo actualiza el catálogo | Procesa links |
| Cómo se obtiene la llave | — | Patreon (desde 2 USD/mes) y cobro local en pesos |

Planes (borrador, a confirmar †): 2 USD/mes = 10 descargas rápidas; 4 USD/mes = lo anterior + multiusuario con control de tiempo para niños, congelado de juegos, hasta 4 descargas paralelas, 30 al mes. Si el torrent baja lento, la app avisa ("¿descarga lenta?") y ofrece la aceleración.

## Componentes
- **Cliente de escritorio** — `apps/desktop`: Tauri (Rust) + React/TypeScript. Guarda el catálogo en una base SQLite local y la sincroniza con el servidor por snapshot y diferencias.
- **Launcher** — `apps/launcher` (Python): descarga, descompresión, instalación y ejecución de los juegos.
- **Servidor** — `apps/api` (Python, desplegado en Render, base en Supabase): catálogo central, contenido premium y procesamiento de links (Plus).
- **Plugin de fuentes** — repo aparte, de otra cuenta (ver memoria local de Claude, no se nombra acá): open source, gratis y **opcional**. Aporta las fuentes de descarga de cada juego. Sin plugin, el usuario igual puede cargar links y perfiles de ejecución a mano.

## Catálogo
Cada juego se identifica por su **AppID**, el número de la tienda de Steam; se usa solo como identificador y para traer metadata (título, géneros, reseñas, imágenes). La base inicial salió de un dump offline; el servidor la mantiene al día y cada cliente guarda un subconjunto que sincroniza de forma aditiva.

## Features objetivo y estado
| Feature | Estado |
|---|---|
| Catálogo con búsqueda enriquecida y filtros (género, modo de juego, orden, +18) | En desarrollo (tareas A y B) |
| Biblioteca: instalados y favoritos | Existe † |
| Ficha de juego con tráiler, capturas y valoraciones | Existe; falta aceptación visual |
| Descargas: cola con pausa/reanudación y descargas paralelas † | En desarrollo † |
| Fuentes por plugin, ordenadas por seeds y multijugador online | Plugin publicado (v1.0.0), sin probar de punta a punta |
| Fuentes guardadas en la base y filtro "con fuente" por SQL | En desarrollo (tarea B) |
| Instalación con estados visibles y recuperación (`error.txt`, reintento) | En desarrollo (tarea C) |
| Perfil de ejecución editable (descomprimir fix en cada ejecución, ejecutables a probar, correr como admin) | En desarrollo (tarea C) |
| Versión Plus: aceleración por servidor (Viking Files / Torbox) | En desarrollo † |
| Modo Pantalla grande con mando | Hecho con mando simulado; falta validar con mando físico |
| Importador de juegos propios | Hecho (escáner de discos y vínculos) |
| Juegos de Steam de las cuentas que Steam recuerda en la PC del usuario: se importan solos en cada instalación (instalados y los que tiene sin instalar, estos últimos pedidos al servidor de Game Access, que tiene la clave de la API de Steam; el usuario nunca carga una clave), cada uno con su cuenta dueña; Jugar cambia Steam a esa cuenta; Instalar lo hace Steam. Requisito: Steam instalado antes que Game Access | En desarrollo (Seba, 2026-10-25; ver [[Tareas]]) |
| Registro de tiempo de juego | Planeado |
| Aviso "¿descarga lenta?" | Planeado |
| Detalle enriquecido (videos de gameplay, notas de prensa) | Planeado |
| Congelado de juegos (manual y automático) | Planeado |
| Multiusuario con control de acceso y límite de tiempo para niños (modo niño: Game Access como escritorio de la cuenta de Windows del niño) | Diseñado, sin implementar (plan de 4 USD; ver [[Modo niño]]) |
| Autoactualización segura con reversión | Planeado (obligatoria antes del primer build público) |
| Instalador profesional y traducción es/en completa | Planeado |
| Página web pública (qué es, cómo funciona, FAQ, descarga) | Planeado |

## Lo que Game Access NO es
- No incluye ni mantiene listas de descargas ni fomenta la piratería: es un gestor y acelerador de descargas genérico. Las fuentes llegan por plugins externos, que el usuario instala por su cuenta.
- No es un servicio de préstamo de cuentas ni de licencias de Steam, ni reemplaza al cliente de Steam. Esa versión anterior del proyecto (pool de cuentas, alquiler de licencias, contraseñas guardadas) fue descartada; su código quedó en el commit anterior a `43bd354`.
- Sí trae los juegos de Steam **de las cuentas del propio usuario** que Steam ya recuerda en su PC (Seba, 2026-10-25): cambia de cuenta con el inicio de sesión recordado de Steam, sin leer ni guardar contraseñas. Los juegos de Steam son siempre vinculados: Game Access no los descarga por sus fuentes, no los mueve, no los congela ni los desinstala.

## Glosario
- **AppID**: número que identifica un juego en el catálogo.
- **Fuente**: un link o magnet de descarga de un juego, aportado por el plugin.
- **Plugin**: programa externo y opcional que entrega fuentes a Game Access.
- **Llave**: código que activa la versión Plus.
- **Perfil de ejecución**: pasos automáticos de un juego (descomprimir un fix, qué ejecutables probar, correr como admin, idioma). Lo define el plugin o el usuario con un formulario; el launcher no los tiene fijos en el código.
- **Fix**: archivo comprimido que se aplica sobre la carpeta del juego para que funcione; se respalda y se reaplica en cada ejecución.
- **Estado de carpeta**: sufijo del nombre de la carpeta del juego (`preparing`, `downloading`, `installing`, `ready`, `ERROR`).

## Reglas de trabajo
Una sola rama (`dev`), commits chicos con push a `dev` después de cada paso verificado, sin ramas ni PR intermedios. Todavía no hay usuarios: `main` solo se actualiza cuando Seba decide el primer test en vivo. Detalle en `AGENTS.md`. Tareas en [[Tareas]], comunicación en [[Mensajes]], acciones en [[Log]]. Cómo sacar una versión nueva con auto-update: [[Releases]].
