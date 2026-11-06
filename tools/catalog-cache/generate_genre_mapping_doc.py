"""Generate docs/CATALOG_GENRE_MAPPING.md from the published catalog.

The genre table is data (apps/api/app/genre_concepts.json). This script measures
it against the real catalog so the document lists what the data contains, not
what someone remembers: every distinct genre value is assigned to one concept, or
explicitly listed as a maturity label or as unmapped. Run it after editing the
table or after a new package is published:

    python tools/catalog-cache/generate_genre_mapping_doc.py
"""
from __future__ import annotations

import gzip
import json
import sqlite3
import sys
import tempfile
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "api"))
from app.genre_normalization import CONCEPTS, NOT_A_GENRE, concept_for  # noqa: E402

PACKAGES = ROOT / "deploy" / "catalog-cache"
OUT = ROOT / "docs" / "CATALOG_GENRE_MAPPING.md"


def norm(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    return " ".join("".join(c for c in decomposed if not unicodedata.combining(c)).lower().split())


def fmt(number: int) -> str:
    return f"{number:,}".replace(",", ".")


def load_games() -> tuple[list[dict], str]:
    manifest = json.loads((PACKAGES / "catalog-manifest.json").read_text(encoding="utf-8"))
    package = PACKAGES / f"catalog-cache-{manifest['revision']}.sqlite.gz"
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "catalog.sqlite"
        path.write_bytes(gzip.decompress(package.read_bytes()))
        db = sqlite3.connect(path)
        games = [json.loads(payload) for (payload,) in db.execute("SELECT payload FROM catalog_game")]
        db.close()
    return games, manifest["revision"]


def main() -> int:
    games, revision = load_games()
    rows: Counter[str] = Counter()          # value -> games carrying it
    for game in games:
        for value in set(v.strip() for v in game.get("genres") or [] if isinstance(v, str) and v.strip()):
            rows[value] += 1

    by_concept: dict[str, list[tuple[str, int]]] = {c["id"]: [] for c in CONCEPTS}
    maturity: list[tuple[str, int]] = []
    unmapped: list[tuple[str, int]] = []
    for value, count in rows.most_common():
        if norm(value) in NOT_A_GENRE:
            maturity.append((value, count))
            continue
        concept = concept_for(value)
        if concept is None:
            unmapped.append((value, count))
        else:
            by_concept[concept["id"]].append((value, count))

    def reach(concept_id: str) -> int:
        return sum(1 for game in games
                   if any((concept_for(v) or {}).get("id") == concept_id for v in game.get("genres") or []))

    lines = [
        "# Mapeo de géneros del catálogo",
        "",
        "Generado desde el paquete de catálogo publicado por",
        "`tools/catalog-cache/generate_genre_mapping_doc.py`. No editar a mano: la tabla vive en",
        "`apps/api/app/genre_concepts.json` (copia idéntica en `apps/desktop/src/genreConcepts.json`) y",
        "este documento solo la mide contra los datos.",
        "",
        f"Universo medido: **{fmt(len(games))} juegos**, revisión `{revision}`, "
        f"**{len(rows)} valores distintos** de género.",
        "",
        "## Regla de independencia de idioma",
        "",
        "El catálogo mezcla fuentes e idiomas: el inglés de Steam, valores traducidos de SteamSpy y",
        "etiquetas de la comunidad. Por eso la lógica interna nunca compara contra el texto de Steam:",
        "cada valor se resuelve a un **concepto interno** estable (`racing`) y los filtros, las",
        "facetas y los chips comparan solo ese id. La traducción vive solo en la UI (columna *Etiqueta*).",
        "",
        "Un valor que no está en la tabla **no se adivina**: queda como su propio concepto, con un id",
        "derivado de su texto y ese texto como etiqueta. Se lista abajo como *sin mapear*.",
        "",
        "El caso que motivó esto: el panel ofrecía `Racing` y `Carreras` como géneros distintos, de modo",
        f"que elegir «Carreras» devolvía {rows.get('Carreras', 0)} juegos de los {fmt(rows.get('Racing', 0) + rows.get('Carreras', 0))} que son",
        f"de carreras. Ambos valores son ahora el concepto `racing` ({fmt(reach('racing'))} juegos).",
        "",
        "## Conceptos",
        "",
        "| Concepto | Etiqueta UI | Valores del catálogo (juegos) | Juegos alcanzados |",
        "|---|---|---|---|",
    ]
    for concept in CONCEPTS:
        seen = by_concept[concept["id"]]
        values = "<br>".join(f"`{v}` ({fmt(n)})" for v, n in seen) or "_ninguno en esta revisión_"
        tag = " · software" if concept.get("software") else ""
        lines.append(f"| `{concept['id']}`{tag} | {concept['label']} | {values} | {fmt(reach(concept['id']))} |")

    lines += [
        "",
        "Los conceptos marcados *software* no son géneros de juego (Blender, OBS Studio): se agrupan",
        "aparte como «Programas» y no aparecen en la lista de géneros. Ver",
        "[CATALOG_FILTER_MAPPING.md](CATALOG_FILTER_MAPPING.md).",
        "",
        "## Etiquetas de contenido que no son géneros",
        "",
        "Describen madurez, no qué es el juego. Pertenecen a los descriptores de contenido de Valve y",
        "se descartan de la lista de géneros.",
        "",
        "| Valor | Juegos |",
        "|---|---|",
    ]
    lines += [f"| `{v}` | {fmt(n)} |" for v, n in maturity] or ["| _ninguno_ | 0 |"]
    lines += [
        "",
        "## Sin mapear (conceptos propios)",
        "",
        "Valores que ninguna entrada de la tabla reconoce. No se fusionan ni se descartan. Si alguno",
        "es una variante de un concepto existente, se agrega a sus `aliases` en la tabla.",
        "",
        "| Valor | Juegos |",
        "|---|---|",
    ]
    lines += [f"| `{v}` | {fmt(n)} |" for v, n in unmapped] or ["| _ninguno_ | 0 |"]
    lines.append("")
    OUT.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    mapped = sum(len(v) for v in by_concept.values())
    print(f"wrote {OUT} - {len(rows)} values: {mapped} mapped, {len(maturity)} maturity, {len(unmapped)} unmapped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
