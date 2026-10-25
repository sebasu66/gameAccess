# Mapeo de géneros del catálogo

Generado desde el paquete de catálogo publicado por
`tools/catalog-cache/generate_genre_mapping_doc.py`. No editar a mano: la tabla vive en
`apps/api/app/genre_concepts.json` (copia idéntica en `apps/desktop/src/genreConcepts.json`) y
este documento solo la mide contra los datos.

Universo medido: **41.729 juegos**, revisión `e2c499094f2fefeb`, **100 valores distintos** de género.

## Regla de independencia de idioma

El catálogo mezcla fuentes e idiomas: el inglés de Steam, valores traducidos de SteamSpy y
etiquetas de la comunidad. Por eso la lógica interna nunca compara contra el texto de Steam:
cada valor se resuelve a un **concepto interno** estable (`racing`) y los filtros, las
facetas y los chips comparan solo ese id. La traducción vive solo en la UI (columna *Etiqueta*).

Un valor que no está en la tabla **no se adivina**: queda como su propio concepto, con un id
derivado de su texto y ese texto como etiqueta. Se lista abajo como *sin mapear*.

El caso que motivó esto: el panel ofrecía `Racing` y `Carreras` como géneros distintos, de modo
que elegir «Carreras» devolvía 3 juegos de los 1.170 que son
de carreras. Ambos valores son ahora el concepto `racing` (1.170 juegos).

## Conceptos

| Concepto | Etiqueta UI | Valores del catálogo (juegos) | Juegos alcanzados |
|---|---|---|---|
| `action` | Acción | `Action` (14.440)<br>`Acción` (36) | 14.476 |
| `adventure` | Aventura | `Adventure` (14.499)<br>`Aventura` (15) | 14.514 |
| `indie` | Indie | `Indie` (28.747) | 28.747 |
| `casual` | Casual | `Casual` (18.470) | 18.470 |
| `simulation` | Simulación | `Simulation` (9.432)<br>`Simulator` (2.689)<br>`Simuladores` (12) | 9.724 |
| `strategy` | Estrategia | `Strategy` (8.601)<br>`Estrategia` (10) | 8.611 |
| `rpg` | RPG | `RPG` (7.167)<br>`Role-playing (RPG)` (2.277)<br>`Role-playing` (112)<br>`Rol` (18) | 7.431 |
| `free_to_play` | Gratuito | `Free To Play` (8.936)<br>`Free to Play` (5.241) | 9.049 |
| `early_access` | Acceso anticipado | `Early Access` (5.843)<br>`Acceso anticipado` (8) | 5.851 |
| `sports` | Deportes | `Sports` (1.434)<br>`Sport` (522)<br>`Deportes` (3) | 1.468 |
| `racing` | Carreras | `Racing` (1.167)<br>`Carreras` (3) | 1.170 |
| `massively_multiplayer` | Multijugador masivo | `Massively Multiplayer` (1.346)<br>`Multijugador masivo` (16) | 1.362 |
| `puzzle` | Puzles | `Puzzle` (1.354) | 1.354 |
| `shooter` | Disparos | `Shooter` (1.069) | 1.069 |
| `platformer` | Plataformas | `Platform` (833)<br>`Platformer` (78) | 835 |
| `visual_novel` | Novela visual | `Visual Novel` (823) | 823 |
| `arcade` | Arcade | `Arcade` (716) | 716 |
| `point_and_click` | Point-and-click | `Point-and-click` (477) | 477 |
| `turn_based_strategy` | Estrategia por turnos | `Turn-based strategy (TBS)` (269) | 269 |
| `real_time_strategy` | Estrategia en tiempo real | `Real Time Strategy (RTS)` (140) | 140 |
| `card_and_board` | Cartas y tablero | `Card & Board Game` (241)<br>`Card Game` (6) | 242 |
| `tactical` | Táctico | `Tactical` (224) | 224 |
| `fighting` | Lucha | `Fighting` (201) | 201 |
| `hack_and_slash` | Hack and slash | `Hack and slash/Beat 'em up` (194) | 194 |
| `music` | Música | `Music` (156) | 156 |
| `horror` | Terror | `Horror` (69) | 69 |
| `utilities` · software | Utilidades | `Utilities` (19)<br>`Utilidades` (6) | 25 |
| `design_illustration` · software | Diseño e ilustración | `Design & Illustration` (9)<br>`Diseño e ilustración` (3) | 12 |
| `video_production` · software | Producción de vídeo | `Producción de vídeo` (3)<br>`Video Production` (3) | 6 |
| `animation_modeling` · software | Animación y modelado | `Animation & Modeling` (10)<br>`Animación y modelado` (2) | 12 |
| `photo_editing` · software | Edición fotográfica | `Edición fotográfica` (2)<br>`Photo Editing` (1) | 3 |
| `web_publishing` · software | Publicación web | `Publicación web` (2) | 2 |
| `audio_production` · software | Producción de audio | `Audio Production` (6)<br>`Producción de audio` (1) | 7 |
| `game_development` · software | Desarrollo de juegos | `Game Development` (8)<br>`Desarrollo de juegos` (1) | 9 |
| `education` · software | Educación | `Education` (9)<br>`Educación` (1) | 10 |
| `accounting` · software | Contabilidad | `Accounting` (1) | 1 |
| `software_training` · software | Software Training | `Software Training` (3) | 3 |
| `programming` · software | Programming | `Programming` (3) | 3 |

Los conceptos marcados *software* no son géneros de juego (Blender, OBS Studio): se agrupan
aparte como «Programas» y no aparecen en la lista de géneros. Ver
[CATALOG_FILTER_MAPPING.md](CATALOG_FILTER_MAPPING.md).

## Etiquetas de contenido que no son géneros

Describen madurez, no qué es el juego. Pertenecen a los descriptores de contenido de Valve y
se descartan de la lista de géneros.

| Valor | Juegos |
|---|---|
| `Violent` | 56 |
| `Gore` | 42 |
| `Sexual Content` | 25 |
| `Nudity` | 18 |

## Sin mapear (conceptos propios)

Valores que ninguna entrada de la tabla reconoce. No se fusionan ni se descartan. Si alguno
es una variante de un concepto existente, se agrega a sus `aliases` en la tabla.

| Valor | Juegos |
|---|---|
| `Fantasy` | 92 |
| `Sci-fi` | 89 |
| `Turn-based` | 49 |
| `FPP` | 44 |
| `Narrative` | 44 |
| `Mystery` | 32 |
| `Quiz/Trivia` | 30 |
| `Comedy` | 30 |
| `Building` | 29 |
| `MOBA` | 28 |
| `Roguelike` | 25 |
| `Survival` | 24 |
| `Real-time` | 24 |
| `Exploration` | 23 |
| `Managerial` | 22 |
| `Historical` | 19 |
| `Open World` | 17 |
| `Modern` | 17 |
| `Combat` | 17 |
| `Detective-mystery` | 17 |
| `Pinball` | 17 |
| `Sandbox` | 14 |
| `TPP` | 12 |
| `Stealth` | 11 |
| `JRPG` | 10 |
| `Hidden Object` | 9 |
| `Shoot 'em Up` | 7 |
| `Metroidvania` | 6 |
| `Economic` | 4 |
| `Educational` | 2 |
| `Virtual life` | 2 |
| `Movie` | 1 |
| `Off-road` | 1 |
| `Espionage` | 1 |
