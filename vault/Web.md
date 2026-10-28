---
tipo: proyecto
actualizado: 2026-10-28
---
# Página web (gameaccess.site)

Publicada en here.now (`deploy/here-now/publish_site.py`, fuente en `deploy/website`) y servida en https://gameaccess.site. GitHub solo para las releases de la app (Seba, 2026-10-28). Registro de cambios en [[Log]].

## Dirección visual (Seba, 2026-10-28)
- Logo: el emblema redondo, una G y una A dentro de un círculo (el de la tapa de apertura, `apps/desktop/src/SplashScreen.tsx`). El logo de cubitos (voxel) ya no se usa.
- Hero: el emblema y, en una columna a la derecha, GAME y después ACCESS dibujándose como en la app (`BrandSketch.tsx`, `BrandWall.tsx`, `brandGlyphs.ts`).
- Estilo: consola o terminal retro-futurista, tipo Cyberpunk pero no demasiado hacker; simple.
- Animaciones con GSAP.
- Un video de la app en uso, grabado de corrido y cortado en escenas: cada escena en su sección, con su explicación.

## Funciones a mostrar (lista de Seba, 2026-10-28)
| Función | Estado en el código (revisado 2026-10-28) |
|---|---|
| Catálogo de juegos enriquecido | Existe |
| Editor de filtros intuitivo y simple | Existe |
| Filtro de contenido para adultos | Existe |
| Autosugerencia de juegos según preferencias | A confirmar: hoy hay orden por popularidad; "me gusta / no me gusta" figura como pendiente en [[Tareas]] |
| Diseño moderno, funcional y simple de usar | — |
| Gestor de biblioteca | Existe (administrador de biblioteca) |
| Importador de juegos | Existe |
| Gestor de múltiples usuarios de Steam | Existe |
| Cambio automático de cuenta de Steam al jugar | Existe |
| Automatización de procesos (descarga, instalación, ejecución) | Existe |
| Gestor de descargas con cliente torrent integrado | Existe |
| Modo Big Picture (pantalla grande con mando) | Existe |
| Modo Freeze: archivador, compresor de juegos sin uso | Existe (`game_library_manager/freezer.py`) |
| Extensible mediante plugins | Existe |

**En desarrollo** (se muestran como "próximamente"):
- Múltiples usuarios.
- Registro de tiempo de juego.
- Bloqueo de cuentas infantiles (modo niño, ver [[Modo niño]]).

Nota: torrent y plugins se presentan como funciones genéricas. La web no nombra ni enlaza ningún plugin de fuentes concreto.
