#!/usr/bin/env python3
"""Standalone CLI test tool to validate Steam AppID lookups from any JSON file in real time.

Usage:
    python scripts/test_steam_lookup.py <path_to_json> [--limit N]

Examples:
    python scripts/test_steam_lookup.py app/digital_catalog.json
    python scripts/test_steam_lookup.py path/to/hydra_source.json --limit 20
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# Ensure Windows terminal doesn't crash on utf-8 characters
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Add parent directory to sys.path so app modules can be imported directly
CURRENT_DIR = Path(__file__).resolve().parent
API_ROOT = CURRENT_DIR.parent
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.steam_resolver import clean_for_steam_lookup, generate_fallback_queries, resolve_steam_app_id


def extract_titles_from_json(data: object) -> list[str]:
    """Extracts game titles from various JSON formats:

    - Hydra sources: {"name": "...", "downloads": [{"title": "...", ...}]}
    - Catalog JSON: [{"name": "...", "id": ...}]
    - Plain list of strings: ["Game 1", "Game 2"]
    """
    titles: list[str] = []

    if isinstance(data, dict):
        if "downloads" in data and isinstance(data["downloads"], list):
            for d in data["downloads"]:
                if isinstance(d, dict) and "title" in d:
                    titles.append(str(d["title"]))
        elif "items" in data and isinstance(data["items"], list):
            for it in data["items"]:
                if isinstance(it, dict):
                    t = it.get("title") or it.get("name")
                    if t:
                        titles.append(str(t))
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                t = item.get("name") or item.get("title")
                if t:
                    titles.append(str(t))
            elif isinstance(item, str):
                titles.append(item)

    return titles


def main() -> int:
    parser = argparse.ArgumentParser(description="Test Steam AppID progressive lookup on any JSON file in real time.")
    parser.add_argument("json_file", type=str, help="Path to the JSON file to test (Hydra source or catalog)")
    parser.add_argument("--limit", type=int, default=0, help="Optional limit of items to process (0 = all)")
    parser.add_argument("--delay", type=float, default=0.2, help="Delay in seconds between Steam API requests (default: 0.2s)")
    args = parser.parse_args()

    json_path = Path(args.json_file)
    if not json_path.is_file():
        # Check relative to API_ROOT
        alt_path = API_ROOT / args.json_file
        if alt_path.is_file():
            json_path = alt_path
        else:
            print(f"\n[ERROR] El archivo JSON no existe: {args.json_file}\n", file=sys.stderr)
            return 1

    print(f"\n=======================================================")
    print(f" STEAM APP ID RESOLVER - PRUEBA EN TIEMPO REAL")
    print(f" Archivo: {json_path}")
    print(f"=======================================================\n", flush=True)

    try:
        with json_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"[ERROR] Error decodificando el archivo JSON: {e}", file=sys.stderr)
        return 1

    titles = extract_titles_from_json(data)
    total = len(titles)
    if total == 0:
        print("[AVISO] No se detectaron títulos en el archivo JSON provisto.", file=sys.stderr)
        return 0

    if args.limit > 0:
        titles = titles[:args.limit]
        print(f"-> Procesando primeros {len(titles)} títulos de {total} totales...\n", flush=True)
    else:
        print(f"-> Procesando {total} títulos...\n", flush=True)

    matched = []
    unmatched = []
    start_time = time.time()

    for idx, raw_title in enumerate(titles, 1):
        clean_title = clean_for_steam_lookup(raw_title)
        fallbacks = generate_fallback_queries(clean_title)

        print(f"\n[{idx}/{len(titles)}] Título original: \"{raw_title}\"", flush=True)
        print(f"     Limpio: \"{clean_title}\"", flush=True)
        if len(fallbacks) > 1:
            print(f"     Cadena de fallback ({len(fallbacks)}): {fallbacks}", flush=True)

        res = resolve_steam_app_id(
            raw_title,
            log_callback=lambda msg: print(f"     {msg}", flush=True)
        )

        if res:
            app_id, official_name = res
            matched.append((raw_title, app_id, official_name))
        else:
            unmatched.append((raw_title, clean_title))

        if args.delay > 0 and idx < len(titles):
            time.sleep(args.delay)

    duration = time.time() - start_time
    success_rate = (len(matched) / len(titles)) * 100 if titles else 0.0

    print(f"\n=======================================================")
    print(f" RESUMEN DE RESOLUCIÓN DE APP IDs DE STEAM")
    print(f"=======================================================")
    print(f" Total procesados : {len(titles)}")
    print(f" Encontrados [OK] : {len(matched)} ({success_rate:.1f}%)")
    print(f" No encontrados [FAIL]: {len(unmatched)} ({100.0 - success_rate:.1f}%)")
    print(f" Tiempo total     : {duration:.2f}s")
    print(f"=======================================================\n")

    if unmatched:
        print("Títulos que NO se encontraron en Steam (requieren revisión o nombre manual):")
        for idx, (raw, clean) in enumerate(unmatched, 1):
            print(f"  {idx}. \"{raw}\" (buscado como: \"{clean}\")")
        print("")

    return 0


if __name__ == "__main__":
    sys.exit(main())
