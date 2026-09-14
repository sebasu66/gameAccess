from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app import main as core
from app.catalog_metadata import (
    coverage,
    ensure_catalog_schema,
    import_appinfo_catalog,
    import_steam_cache,
    seed_known_games,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build/update the canonical GameAccess catalog database")
    parser.add_argument("--cache-dir", default=str(core.STEAM_CACHE))
    parser.add_argument("--appinfo", help="Optional path to Steam appcache/appinfo.vdf")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    ensure_catalog_schema(core.engine)
    seeded = seed_known_games(core.engine)
    imported = import_steam_cache(core.engine, Path(args.cache_dir))
    appinfo_result = None
    if args.appinfo:
        launcher_dir = Path(__file__).resolve().parents[1] / "launcher"
        sys.path.insert(0, str(launcher_dir))
        from steam_appinfo import read_local_app_catalog

        with core.engine.begin() as conn:
            app_ids = {
                int(row[0])
                for row in conn.exec_driver_sql(
                    "SELECT app_id FROM game WHERE app_id IS NOT NULL"
                ).all()
            }
        appinfo = read_local_app_catalog(Path(args.appinfo), app_ids)
        appinfo_result = import_appinfo_catalog(core.engine, appinfo)
    result = {
        "ok": True,
        "seeded_rows": seeded,
        "import": imported,
        "appinfo": appinfo_result,
        "coverage": coverage(core.engine),
    }
    print(json.dumps(result, ensure_ascii=False, indent=None if args.json else 2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
