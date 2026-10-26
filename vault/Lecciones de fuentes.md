---
tipo: diseño
actualizado: 2026-10-26
---
# Lecciones de fuentes — lo que un jugador aprende no le vuelve a pasar a otro

Pedido de Seba (2026-10-26): bajó un juego, esperó unos 15 minutos y lo descargado no era un juego. La app ya lo detectaba (`not_a_game`: sin ejecutable, instalador ni archivos por descomprimir; se borra y se avisa), pero ese aprendizaje se perdía. Tarea en [[Tareas]] (sección "Descargas y servidor").

## Cómo funciona
1. **Huella de la fuente.** Cada fuente se identifica por un SHA-256, el mismo que ya usa la caché de ViKiNG en el servidor (`viking_cache_service.normalize_source_url`): un magnet es su info-hash (sin trackers ni nombre); un link directo es esquema, host, puerto, ruta y la query estable (sin tokens ni firmas que vencen). El cliente la calcula igual (`apps/desktop/src/catalog/sourceFingerprint.ts`); los dos lados prueban los mismos valores dorados. **La URL nunca viaja ni se guarda en el servidor.**
2. **Reporte.** Cuando el launcher da `not_a_game`, el aviso de descarga fallida (`DigitalDownloadErrorDialog.tsx`) manda `POST /source-lessons/report` con la huella de la fuente tal como la listó el plugin, el motivo, el AppID y qué traía (códigos cortos: `audio`, `images`…). Lo guarda también en este PC, así a este jugador le cuenta enseguida.
3. **Servidor.** Tabla `source_lesson_report` (Supabase, se crea sola al arrancar): un voto por instalación y por (alcance, sujeto, motivo). La instalación se guarda como HMAC de su id: sirve para contar personas distintas sin saber quiénes son. Límite de 30 reportes por hora por dirección. Una lección se publica cuando la reportan **2 instalaciones distintas** (`GAMEACCESS_LESSON_MIN_REPORTS`), y pasa a "confirmada" con el doble; un administrador puede publicar una al instante (`POST /admin/source-lessons`).
4. **Lista publicada.** `GET /source-lessons` devuelve la lista entera (es chica) con una revisión; con `?since=<revisión>` responde solo "sin cambios". El cliente la pide junto con la sincronización del catálogo (al arrancar y cada día, y como mucho cada 6 h) y la guarda en `localStorage`, así ordena bien las fuentes sin servidor. Va aparte del snapshot/deltas del catálogo porque es otra cosa (fuentes, no juegos), cambia más seguido y no pasa por SQLite.
5. **Consulta en el cliente.** `getPluginSources` marca cada fuente con su huella y, si hay una lección "evitar" (por huella o por proveedor), la manda **al final** con el motivo ("Otros jugadores: no era un juego" / "Ya te pasó: …") en el menú de fuentes. El botón Descargar y "Instalar" del menú eligen la primera **no marcada**; si todas están marcadas no arrancan solos: el botón dice "Fuentes marcadas: elegí una" y abre el menú. "Probar otra fuente" no prueba las marcadas.

## Formato de una lección
| Campo | Qué es |
|---|---|
| `scope` | `source` (una huella), `provider` (un nombre de fuente, sin mayúsculas) o `game` (un AppID) |
| `subject` | la huella, el nombre del proveedor o el AppID |
| `reason` | código: `not_a_game`, `wrong_password`, `corrupt_archive`, `malware_flagged`, `incomplete`; el administrador puede usar otros (`needs_online_fix`…) |
| `action` | `avoid` (bajar en el orden), `prefer` o `note` (consejos que no son lista negra; el cliente todavía no los muestra) |
| `app_id`, `detail` | juego en que pasó y qué se vio (códigos cortos) |
| `reports`, `confidence` | instalaciones distintas; `flagged` (umbral), `confirmed` (doble o administrador), `mine` (solo en este PC) |
| `first_seen`, `last_seen` | fechas del primer y último reporte |

## Abierto
- **Decisiones de Seba:** umbral (hoy 2 instalaciones), si una fuente confirmada se oculta del todo o solo baja en el orden (hoy solo baja, con el motivo), y cuándo se despliega (Render despliega desde `main`; la tabla se crea sola en Supabase al primer arranque).
- **Otros motivos:** el diseño los acepta; falta que el launcher distinga contraseña incorrecta y archivo dañado con su propio `errorCode` para reportarlos.
- **Plugin de fuentes:** podría recibir la lista (o la huella de cada fuente) para no ofrecer las marcadas desde su lado. Pregunta para Seba, no se tocó.
- **Señal positiva:** contar instalaciones exitosas por huella bajaría la confianza de un reporte aislado; no se implementó para no mandar cada instalación al servidor.
