# Mapeo de filtros del catálogo

Generado desde el paquete de catálogo publicado por
`tools/catalog-cache/generate_mapping_doc.py`. No editar a mano: la tabla se
deriva de los datos, porque transcribirla introdujo valores que no existen.

Universo medido: **41,885 juegos**, **59 valores distintos**
de categoría en el catálogo.

## Regla de independencia de idioma

El catálogo guarda los valores tal como los devolvió Steam, en el idioma con que
se pidió el descubrimiento. La misma columna mezcla idiomas, así que la lógica
interna compara solo contra conceptos y nunca contra texto de Steam. Un valor que
no está en el mapa queda **desconocido**: no se adivina.

| Concepto interno | Etiqueta UI | Valores del catálogo | Filas | Juegos alcanzados |
|---|---|---|---|---|
| `single_player` | Solo un jugador | `Single-player`<br>`Un jugador` | 37,217 | 37,217 |
| `multiplayer` | Admite multijugador | `Multi-player`<br>`Multijugador` | 8,274 | 8,274 |
| `coop` | Co-op / PvE | `Co-op`<br>`Shared/Split Screen Co-op`<br>`Cooperativo`<br>`Coop. a pantalla (com)partida` | 5,943 | 4,693 |
| `pvp` | PvP | `PvP`<br>`JcJ` | 5,271 | 5,276 |
| `local_screen` | Pantalla compartida | `Shared/Split Screen`<br>`Pantalla partida/compartida` | 2,225 | 2,225 |
| `lan` | LAN | `LAN Co-op` | 449 | 449 |
| `online` | Online | `Online PvP`<br>`Online Co-op`<br>`Cooperativo en línea`<br>`JcJ en línea` | 7,738 | 5,985 |
| `mmo` | MMO | `Multijugador masivo` | 10 | 10 |
| `cross_platform` | Multiplataforma | `Cross-Platform Multiplayer`<br>`Multijugador multiplataforma` | 1,465 | 1,465 |
| `no_filter` | (no es un filtro) | `Préstamo familiar`<br>`Logros de Steam`<br>`Compras dentro de la aplicación`<br>`Cromos de Steam`<br>`Compat. total con mando`<br>`Steam Cloud`<br>`Compat. parcial con mando`<br>`Compatible con DualShock`<br>`Compatible con DualSense`<br>`Controles de volumen personalizados`<br>`Jugable sin restricciones de tiempo`<br>`Sonido estéreo`<br>`Detección de mov. en mando`<br>`Solo para RV`<br>`Dificultad ajustable`<br>`Remote Play en tableta`<br>`Remote Play en TV`<br>`Tablas de clasificación de Steam`<br>`Alternativas de color`<br>`Remote Play en móvil`<br>`Opciones de subtítulos`<br>`Sonido envolvente`<br>`Se recomienda usar un mando`<br>`Steam Workshop`<br>`Estadísticas`<br>`Comodidad de la cámara`<br>`Guardar en cualquier momento`<br>`Tamaño del texto ajustable`<br>`Remote Play Together`<br>`Compatibilidad con RV`<br>`Chat de texto convertido a voz`<br>`HDR disponible`<br>`Opción solo teclado`<br>`Compatible con Steam Input`<br>`Incluye editor de niveles`<br>`Compatible con RV`<br>`Subtítulos disponibles` | 238 | 58 |

La columna *filas* cuenta apariciones y puede superar a *juegos alcanzados*:
un juego declara varias categorías del mismo concepto (por ejemplo `Co-op` y
`Shared/Split Screen Co-op`), y el filtro lo cuenta una sola vez.

## Por qué el idioma no entra en la lógica

El catálogo mezcla idiomas **dentro del mismo concepto**: `Multi-player` aparece
en inglés y `Multijugador` en español según cómo se pidió cada registro. Los
valores de la tabla son alias de un mismo concepto, y la traducción al español
vive solo en la UI.

**Camino definitivo:** mapear por `steam_category_ids` (los IDs de Steam son
estables y no tienen idioma). Hoy el paquete publicado los trae vacíos, así que
el mapeo por texto es lo que hay hasta que el descubrimiento los complete.

## Filtros de calidad (siempre visibles, nunca anidados)

| Control | Tipo | Default | Concepto |
|---|---|---|---|
| Puntaje mínimo | slider 0–100 % | encendido, 70 % | `minReviewScore` |
| Antigüedad máxima | slider relativo | apagado | `maxAgeMonths` |
| Excluir juegos sin ranking | booleano | encendido | `hideNoReviews` |

La antigüedad es **relativa** ("no más de 6 meses") y no un año fijo: no hay que
mantenerla y expresa lo que el usuario busca. Un juego con fecha ilegible queda
fuera cuando el rango está activo. Un juego sin ranking queda fuera cuando el
puntaje mínimo está activo.

## Tipo de contenido y programas

**El catálogo es solo juegos y el descubrimiento ya lo garantiza.** El crawl usa
`category1=998`, que en Steam significa *Games*: ni DLC ni software entran.
Verificado sobre 41.885 registros: 116 nombres contienen "Demo" y ninguno
"Soundtrack".

Los pocos programas que aparecen son casos archivados que Steam publicó dentro
del catálogo de juegos — `Blender`, `OBS Studio`, `ShareX`, `Godot Engine`,
`Driver Booster 3`. No son falsos positivos del filtro: Steam los lista como
juegos. Medido por género: **10 juegos**.

Se reconocen por el vocabulario de géneros, que es el de SteamSpy y contiene
categorías que no son géneros de juego:

| Género en el catálogo | Juegos |
|---|---|
| `Utilidades` | 6 |
| `Diseño e ilustración` | 3 |
| `Producción de vídeo` | 3 |
| `Animación y modelado` | 2 |
| `Edición fotográfica` | 2 |
| `Producción de audio` | 2 |
| `Publicación web` | 2 |
| `Desarrollo de juegos` | 2 |
| `Educación` | 1 |

**Regla de UI:** esos géneros no son géneros de juego, así que no van en la lista
de géneros. Se agrupan aparte y su suma define el grupo **Programas**. Cuando el
usuario elige Programas, el árbol de multijugador, los géneros y las pantallas de
calidad se bloquean: un programa no tiene PvP, ni LAN, ni modo historia.

**Deuda:** para separarlos con certeza hay que traer el tipo de producto desde el
descubrimiento. `IStoreBrowseService` devuelve `type` e `item_type` por ítem y hoy
no se guardan.

## Datos rotos del catálogo (no son un hueco del mapa)

Steam devolvió un identificador sin resolver en lugar del nombre de la
categoría. No significan nada para el usuario y no se pueden mapear.

| Valor | Veces |
|---|---|
| `#category_contrast_controls` | 3 |
| `#category_playable_at_your_own_pace` | 2 |

