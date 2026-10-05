from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from app.database import engine
from app.digital_catalog import sync_digital_catalog


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync digital catalog JSON with Steam metadata and upsert into the database (Supabase/SQLite)."
    )
    parser.add_argument(
        "--catalog",
        help="Path to digital_catalog.json (defaults to app/digital_catalog.json)",
    )
    parser.add_argument(
        "--no-steam",
        action="store_true",
        help="Skip fetching Steam Store details",
    )
    parser.add_argument(
        "--reviews",
        action="store_true",
        help="Also fetch Steam review summaries",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force fresh Steam requests bypassing local disk cache",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.5,
        help="Delay in seconds between Steam API requests (default: 0.5)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output raw JSON summary",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose debug logging",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    result = sync_digital_catalog(
        engine=engine,
        catalog_path=Path(args.catalog) if args.catalog else None,
        fetch_steam=not args.no_steam,
        fetch_reviews=args.reviews,
        force=args.force,
        rate_limit_delay=args.delay,
    )

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"Digital Catalog Sync Completed:")
        print(f"  Total records: {result['total']}")
        print(f"  Processed:     {result['processed']}")
        print(f"  Enriched:      {result['steam_enriched']}")
        if result["errors"]:
            print(f"  Errors ({len(result['errors'])}):")
            for err in result["errors"]:
                print(f"    - {err}")
        else:
            print("  Errors:        None")

    return 0 if not result["errors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
