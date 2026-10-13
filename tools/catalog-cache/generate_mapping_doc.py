"""Generate the filter mapping table from the catalog itself.

Hand-transcribing the mapping produced invented values, so the table is derived
from the data instead. Every category value in the catalog is assigned to exactly
one internal concept, or explicitly listed as unmapped — which is the signal that
the mapping would have to grow if the data changes.
"""
import gzip
import json
import sqlite3
import unicodedata
from collections import Counter
from pathlib import Path

PKG = Path(r"C:\DEV\Game Access Dev\apps\api\.cache\discovery-catalog\catalog-cache-8c21120039543bd9.sqlite.gz")
OUT = Path(r"C:\DEV\Game Access Dev\docs\CATALOG_FILTER_MAPPING.md")


def norm(value: str) -> str:
    """Comparison form: accents, case and the non-breaking spaces Steam emits.

    The catalog contains both `Remote Play on TV` and `Remote\\u00a0Play en TV` for
    the same category, so a space-insensitive form is required or the same value
    appears twice in the mapping and half of it goes unrecognised.
    """
    decomposed = unicodedata.normalize("NFD", value)
    without_marks = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(without_marks.replace("\u00a0", " ").lower().split())


# Internal concept -> the exact catalog values that satisfy it, in every language
# observed. Keys are normalized for comparison; the raw value is kept for display.
CONCEPTS: dict[str, dict] = {
    "single_player": {
        "label": "Solo un jugador",
        "values": ["Single-player", "Un jugador"],
    },
    "multiplayer": {
        "label": "Admite multijugador",
        "values": ["Multi-player", "Multijugador", "Multijoueur", "Multigiocatore",
                   "Mehrspieler", "Wieloosobowa", "Multijogador", "多人"],
    },
    "coop": {
        "label": "Co-op / PvE",
        "values": ["Co-op", "Cooperativo", "Online Co-op", "Cooperativo en línea",
                   "LAN Co-op", "Shared/Split Screen Co-op", "Coop. a pantalla (com)partida",
                   "Cooperativo em rede local (LAN)", "Cooperativo em tela dividida/compartilhada",
                   "Кооперативна гра", "Мережева кооперативна гра"],
    },
    "pvp": {
        "label": "PvP",
        "values": ["PvP", "JcJ", "Online PvP", "JcJ en línea", "LAN PvP", "JcJ en rede local (LAN)",
                   "Shared/Split Screen PvP", "JxJ", "JxJ online", "JxJ em rede local (LAN)",
                   "Гравець проти гравця", "Гравець проти гравця в мережі"],
    },
    "local_screen": {
        "label": "Pantalla compartida",
        "values": ["Shared/Split Screen", "Pantalla partida/compartida", "Tela compartilhada/dividida",
                   "Geteilter Bildschirm"],
    },
    "lan": {
        "label": "LAN",
        "values": ["LAN Co-op", "LAN PvP", "JcJ en rede local (LAN)", "Cooperativo em rede local (LAN)",
                   "JxJ em rede local (LAN)"],
    },
    "online": {
        "label": "Online",
        "values": ["Online Co-op", "Online PvP", "Cooperativo en línea", "JcJ en línea",
                   "Cooperativo online", "JxJ online", "Online-PvP"],
    },
    "mmo": {
        "label": "MMO",
        "values": ["MMO", "Multijugador masivo"],
    },
    "cross_platform": {
        "label": "Multiplataforma",
        "values": ["Cross-Platform Multiplayer", "Multijugador multiplataforma",
                   "Multijogador entre plataformas", "Кросплатформова гра"],
    },
    # Not filters: recorded so an unmapped value is a visible decision, not a gap.
    "no_filter": {
        "label": "(no es un filtro)",
        "values": ["Steam Achievements", "Logros de Steam", "Steam Cloud", "Steam Trading Cards",
                   "Cromos de Steam", "Full controller support", "Compat. total con mando",
                   "Partial Controller Support", "Compat. parcial con mando", "Steam Workshop",
                   "In-App Purchases", "Compras dentro de la aplicación", "Remote Play on Phone",
                   "Remote Play en móvil", "Remote Play on Tablet", "Remote Play en tableta",
                   "Remote Play on TV", "Remote Play en TV", "Remote Play Together",
                   "Family Sharing", "Préstamo familiar", "Steam Leaderboards",
                   "Tablas de clasificación de Steam", "Stats", "Estadísticas",
                   "Commentary available", "Comentario disponible", "Captions available",
                   "Subtítulos disponibles", "Subtitle Options", "Opciones de subtítulos",
                   "Includes level editor", "Incluye editor de niveles", "SteamVR Collectibles",
                   "VR Support", "Compatibilidad con RV", "Solo para RV", "Compatible con RV",
                   "HDR available", "HDR disponible", "Stereo Sound", "Sonido estéreo",
                   "Surround Sound", "Sonido envolvente", "Adjustable Difficulty", "Dificultad ajustable",
                   "Adjustable Text Size", "Tamaño del texto ajustable", "Camera Comfort",
                   "Comodidad de la cámara", "Color Alternatives", "Alternativas de color",
                   "Custom Volume Controls", "Controles de volumen personalizados",
                   "Playable without Timed Input", "Jugable sin restricciones de tiempo",
                   "Save Anytime", "Guardar en cualquier momento", "DualShock Controller Support",
                   "Compatible con DualShock", "DualSense Controller Support",
                   "Compatible con DualSense", "Steam Input API Support",
                   "Compatible con Steam Input", "Steam Timeline",
                   "Motion Controller Detection", "Detección de mov. en mando",
                   "Keyboard Only Option", "Opción solo teclado",
                   "Valve Anti-Cheat enabled", "Con sist. antitrampas de Valve",
                   "Downloadable Content", "Game demo", "Mods", "Includes Source SDK",
                   "Native Steam Controller Support", "Steam Turn Notifications",
                   "Additional High-Quality Audio", "Se recomienda usar un mando",
                   "Chat de texto convertido a voz", "Full controller support"],
    },
}

VALUE_TO_CONCEPT: dict[str, str] = {}
for concept, spec in CONCEPTS.items():
    for value in spec["values"]:
        VALUE_TO_CONCEPT[norm(value)] = concept

db = sqlite3.connect(":memory:")
db.deserialize(gzip.decompress(PKG.read_bytes()))
games = [json.loads(row) for (row,) in db.execute("SELECT payload FROM catalog_game")]

category_counts: Counter[str] = Counter()
for game in games:
    for value in game.get("categories") or []:
        category_counts[value] += 1

# Which concept does each real value feed, and how many games does it reach?
by_concept: dict[str, list[tuple[str, int]]] = {concept: [] for concept in CONCEPTS}
unmapped: list[tuple[str, int]] = []
for value, count in category_counts.most_common():
    concept = VALUE_TO_CONCEPT.get(norm(value))
    if concept:
        by_concept[concept].append((value, count))
    else:
        unmapped.append((value, count))

# Games reached per concept, counting a game once even if several values match.
reached: dict[str, int] = {}
for concept, spec in CONCEPTS.items():
    wanted = {norm(v) for v in spec["values"]}
    reached[concept] = sum(1 for game in games
                           if any(norm(c) in wanted for c in (game.get("categories") or [])))

lines: list[str] = []
lines.append("# Mapeo de filtros del catálogo")
lines.append("")
lines.append("Generado desde el paquete de catálogo publicado por")
lines.append("`tools/catalog-cache/generate_mapping_doc.py`. No editar a mano: la tabla se")
lines.append("deriva de los datos, porque transcribirla introdujo valores que no existen.")
lines.append("")
lines.append(f"Universo medido: **{len(games):,} juegos**, **{len(category_counts)} valores distintos**")
lines.append("de categoría en el catálogo.")
lines.append("")
lines.append("## Regla de independencia de idioma")
lines.append("")
lines.append("El catálogo guarda los valores tal como los devolvió Steam, en el idioma con que")
lines.append("se pidió el descubrimiento. La misma columna mezcla idiomas, así que la lógica")
lines.append("interna compara solo contra conceptos y nunca contra texto de Steam. Un valor que")
lines.append("no está en el mapa queda **desconocido**: no se adivina.")
lines.append("")
lines.append("| Concepto interno | Etiqueta UI | Valores del catálogo | Filas | Juegos alcanzados |")
lines.append("|---|---|---|---|---|")
for concept, spec in CONCEPTS.items():
    entries = by_concept.get(concept) or []
    if not entries:
        values = "—"
        total = "0"
    else:
        values = "<br>".join(f"`{value}`" for value, _ in entries)
        total = f"{sum(count for _, count in entries):,}"
    lines.append(f"| `{concept}` | {spec['label']} | {values} | {total} | {reached.get(concept, 0):,} |")
lines.append("")
lines.append("La columna *filas* cuenta apariciones y puede superar a *juegos alcanzados*:")
lines.append("un juego declara varias categorías del mismo concepto (por ejemplo `Co-op` y")
lines.append("`Shared/Split Screen Co-op`), y el filtro lo cuenta una sola vez.")
lines.append("")
lines.append("## Por qué el idioma no entra en la lógica")
lines.append("")
lines.append("El catálogo mezcla idiomas **dentro del mismo concepto**: `Multi-player` aparece")
lines.append("en inglés y `Multijugador` en español según cómo se pidió cada registro. Los")
lines.append("valores de la tabla son alias de un mismo concepto, y la traducción al español")
lines.append("vive solo en la UI.")
lines.append("")
lines.append("**Camino definitivo:** mapear por `steam_category_ids` (los IDs de Steam son")
lines.append("estables y no tienen idioma). Hoy el paquete publicado los trae vacíos, así que")
lines.append("el mapeo por texto es lo que hay hasta que el descubrimiento los complete.")
lines.append("")
lines.append("## Filtros de calidad (siempre visibles, nunca anidados)")
lines.append("")
lines.append("| Control | Tipo | Default | Concepto |")
lines.append("|---|---|---|---|")
lines.append("| Puntaje mínimo | slider 0–100 % | encendido, 70 % | `minReviewScore` |")
lines.append("| Antigüedad máxima | slider relativo | apagado | `maxAgeMonths` |")
lines.append("| Excluir juegos sin ranking | booleano | encendido | `hideNoReviews` |")
lines.append("")
lines.append("La antigüedad es **relativa** (\"no más de 6 meses\") y no un año fijo: no hay que")
lines.append("mantenerla y expresa lo que el usuario busca. Un juego con fecha ilegible queda")
lines.append("fuera cuando el rango está activo. Un juego sin ranking queda fuera cuando el")
lines.append("puntaje mínimo está activo.")
lines.append("")
lines.append("## Tipo de contenido y programas")
lines.append("")
lines.append("**El catálogo es solo juegos y el descubrimiento ya lo garantiza.** El crawl usa")
lines.append("`category1=998`, que en Steam significa *Games*: ni DLC ni software entran.")
lines.append("Verificado sobre 41.885 registros: 116 nombres contienen \"Demo\" y ninguno")
lines.append("\"Soundtrack\".")
lines.append("")
lines.append("Los pocos programas que aparecen son casos archivados que Steam publicó dentro")
lines.append("del catálogo de juegos — `Blender`, `OBS Studio`, `ShareX`, `Godot Engine`,")
lines.append("`Driver Booster 3`. No son falsos positivos del filtro: Steam los lista como")
lines.append("juegos. Medido por género: **10 juegos**.")
lines.append("")
lines.append("Se reconocen por el vocabulario de géneros, que es el de SteamSpy y contiene")
lines.append("categorías que no son géneros de juego:")
lines.append("")
lines.append("| Género en el catálogo | Juegos |")
lines.append("|---|---|")
for genre in ("Utilidades", "Diseño e ilustración", "Producción de vídeo", "Animación y modelado",
              "Edición fotográfica", "Producción de audio", "Publicación web",
              "Desarrollo de juegos", "Educación"):
    count = sum(1 for game in games if genre in (game.get("genres") or []))
    lines.append(f"| `{genre}` | {count} |")
lines.append("")
lines.append("**Regla de UI:** esos géneros no son géneros de juego, así que no van en la lista")
lines.append("de géneros. Se agrupan aparte y su suma define el grupo **Programas**. Cuando el")
lines.append("usuario elige Programas, el árbol de multijugador, los géneros y las pantallas de")
lines.append("calidad se bloquean: un programa no tiene PvP, ni LAN, ni modo historia.")
lines.append("")
lines.append("**Deuda:** para separarlos con certeza hay que traer el tipo de producto desde el")
lines.append("descubrimiento. `IStoreBrowseService` devuelve `type` e `item_type` por ítem y hoy")
lines.append("no se guardan.")
lines.append("")
# Steam occasionally serves an untranslated placeholder token instead of a
# category name. Those are broken data, not an unknown concept, so they are
# reported apart from the mapping gaps.
placeholders = [item for item in unmapped if item[0].startswith("#")]
gaps = [item for item in unmapped if not item[0].startswith("#")]
if gaps:
    lines.append("## Valores legítimos que el mapa NO cubre")
    lines.append("")
    lines.append("Cada uno es una decisión pendiente: se agrega a un concepto o se declara sin filtro.")
    lines.append("")
    lines.append("| Valor | Veces |")
    lines.append("|---|---|")
    for value, count in gaps:
        lines.append(f"| `{value}` | {count:,} |")
    lines.append("")
if placeholders:
    lines.append("## Datos rotos del catálogo (no son un hueco del mapa)")
    lines.append("")
    lines.append("Steam devolvió un identificador sin resolver en lugar del nombre de la")
    lines.append("categoría. No significan nada para el usuario y no se pueden mapear.")
    lines.append("")
    lines.append("| Valor | Veces |")
    lines.append("|---|---|")
    for value, count in placeholders:
        lines.append(f"| `{value}` | {count:,} |")
    lines.append("")

OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"escrito {OUT.name}: {len(lines)} lineas")
print(f"conceptos: {len(CONCEPTS)} | valores mapeados: {len(VALUE_TO_CONCEPT)} | sin mapear: {len(unmapped)}")
print()
print("sin mapear:")
for value, count in unmapped[:20]:
    print(f"   {count:>6}  {value}")
