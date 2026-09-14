from __future__ import annotations

import argparse
import json
from pathlib import Path

from app import main as core
from app.catalog_metadata import coverage, ensure_catalog_schema, import_steam_cache, seed_known_games


def main() -> int:
    parser = argparse.ArgumentParser(description="Build/update the canonical GameAccess catalog database")
    parser.add_argument("--cache-dir", default=str(core.STEAM_CACHE))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    ensure_catalog_schema(core.engine)
    seeded = seed_known_games(core.engine)
    imported = import_steam_cache(core.engine, Path(args.cache_dir))
    result = {
        "ok": True,
        "seeded_rows": seeded,
        "import": imported,
        "coverage": coverage(core.engine),
    }
    print(json.dumps(result, ensure_ascii=False, indent=None if args.json else 2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
