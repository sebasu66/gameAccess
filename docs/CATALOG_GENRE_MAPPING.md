# Mapeo de géneros del catálogo

Generado desde el paquete de catálogo publicado por
`tools/catalog-cache/generate_genre_mapping_doc.py`. No editar a mano: la tabla vive en
`apps/api/app/genre_concepts.json` (copia idéntica en `apps/desktop/src/genreConcepts.json`) y
este documento solo la mide contra los datos.

Universo medido: **46.923 juegos**, revisión `90bcf17bd608bb5b`, **75 valores distintos** de género.

## Regla de independencia de idioma

El catálogo mezcla fuentes e idiomas: el inglés de Steam, valores traducidos de SteamSpy y
etiquetas de la comunidad. Por eso la lógica interna nunca compara contra el texto de Steam:
cada valor se resuelve a un **concepto interno** estable (`racing`) y los filtros, las
facetas y los chips comparan solo ese id. La traducción vive solo en la UI (columna *Etiqueta*).

Un valor que no está en la tabla **no se adivina**: queda como su propio concepto, con un id
derivado de su texto y ese texto como etiqueta. Se lista abajo como *sin mapear*.

El caso que motivó esto: el panel ofrecía `Racing` y `Carreras` como géneros distintos, de modo
que elegir «Carreras» devolvía 0 juegos de los 1.264 que son
de carreras. Ambos valores son ahora el concepto `racing` (1.264 juegos).

## Conceptos

| Concepto | Etiqueta UI | Valores del catálogo (juegos) | Juegos alcanzados |
|---|---|---|---|
| `action` | Acción | `Action` (15.410)<br>`Combat` (17) | 15.412 |
| `adventure` | Aventura | `Adventure` (15.125)<br>`Narrative` (44)<br>`Exploration` (23) | 15.131 |
| `indie` | Indie | `Indie` (29.599) | 29.599 |
| `casual` | Casual | `Casual` (18.845) | 18.845 |
| `simulation` | Simulación | `Simulation` (10.161)<br>`Managerial` (22)<br>`Economic` (4)<br>`Virtual life` (2) | 10.162 |
| `strategy` | Estrategia | `Strategy` (8.967) | 8.967 |
| `rpg` | RPG | `RPG` (7.751)<br>`JRPG` (10) | 7.752 |
| `free_to_play` | Gratuito | `Free to Play` (9.065) | 9.065 |
| `early_access` | Acceso anticipado | `Early Access` (6.048) | 6.048 |
| `sports` | Deportes | `Sports` (1.564) | 1.564 |
| `racing` | Carreras | `Racing` (1.264)<br>`Off-road` (1) | 1.264 |
| `massively_multiplayer` | Multijugador masivo | `Massively Multiplayer` (1.413) | 1.413 |
| `puzzle` | Puzles | `Puzzle` (1.354)<br>`Quiz/Trivia` (30)<br>`Hidden Object` (9) | 1.373 |
| `shooter` | Disparos | `Shooter` (1.069)<br>`Shoot 'em Up` (7) | 1.070 |
| `platformer` | Plataformas | `Platform` (835) | 835 |
| `visual_novel` | Novela visual | `Visual Novel` (823) | 823 |
| `arcade` | Arcade | `Arcade` (716)<br>`Pinball` (17) | 720 |
| `point_and_click` | Point-and-click | `Point-and-click` (477) | 477 |
| `turn_based_strategy` | Estrategia por turnos | `Turn-based strategy (TBS)` (269) | 269 |
| `real_time_strategy` | Estrategia en tiempo real | `Real Time Strategy (RTS)` (140) | 140 |
| `card_and_board` | Cartas y tablero | `Card & Board Game` (242) | 242 |
| `tactical` | Táctico | `Tactical` (224) | 224 |
| `fighting` | Lucha | `Fighting` (201) | 201 |
| `hack_and_slash` | Hack and slash | `Hack and slash/Beat 'em up` (194) | 194 |
| `music` | Música | `Music` (156) | 156 |
| `horror` | Terror | `Horror` (69) | 69 |
| `roguelike` | Roguelike | `Roguelike` (25) | 25 |
| `survival` | Supervivencia | `Survival` (24) | 24 |
| `sandbox` | Sandbox | `Building` (29)<br>`Sandbox` (14) | 41 |
| `open_world` | Mundo abierto | `Open World` (17) | 17 |
| `stealth` | Sigilo | `Stealth` (11)<br>`Espionage` (1) | 12 |
| `moba` | MOBA | `MOBA` (28) | 28 |
| `metroidvania` | Metroidvania | `Metroidvania` (6) | 6 |
| `fantasy` | Fantasía | `Fantasy` (92) | 92 |
| `sci_fi` | Ciencia ficción | `Sci-fi` (89) | 89 |
| `mystery` | Misterio | `Mystery` (32)<br>`Detective-mystery` (17) | 49 |
| `utilities` · software | Utilidades | `Utilities` (26) | 26 |
| `design_illustration` · software | Diseño e ilustración | `Design & Illustration` (12) | 12 |
| `video_production` · software | Producción de vídeo | `Video Production` (6) | 6 |
| `animation_modeling` · software | Animación y modelado | `Animation & Modeling` (13) | 13 |
| `photo_editing` · software | Edición fotográfica | `Photo Editing` (3) | 3 |
| `web_publishing` · software | Publicación web | `Web Publishing` (2) | 2 |
| `audio_production` · software | Producción de audio | `Audio Production` (7) | 7 |
| `game_development` · software | Desarrollo de juegos | `Game Development` (10) | 10 |
| `education` · software | Educación | `Education` (10) | 10 |
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
| `Turn-based` | 49 |
| `FPP` | 44 |
| `Comedy` | 30 |
| `Real-time` | 24 |
| `Historical` | 19 |
| `Modern` | 17 |
| `TPP` | 12 |
| `Educational` | 2 |
| `Violencia` | 2 |
| `Movie` | 1 |
| `Sangrientos` | 1 |
| `Contenido sexual` | 1 |

## Sin mapear (conceptos propios)

Valores que ninguna entrada de la tabla reconoce. No se fusionan ni se descartan. Si alguno
es una variante de un concepto existente, se agrega a sus `aliases` en la tabla.

| Valor | Juegos |
|---|---|
| _ninguno_ | 0 |
