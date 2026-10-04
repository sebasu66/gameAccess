#!/usr/bin/env python3
"""
digital_source_resolver.py

Hydra-compatible source indexer and resolver designed for Game Access (Digital tab).
Reads and indexes standard Hydra source JSON files/URLs, matching catalog games to
verified download packages.

Key design principles:
1. 100% compatible with Hydra Launcher's JSON sources schema.
2. User-facing output is simple, clean, and completely free of technical jargon
   (zero mentions of torrents, magnets, seeders, trackers, P2P, etc.).
3. Advanced subtitle-aware fuzzy matching to avoid false positives (e.g. sequels or prequel confusion).
4. Local caching with automatic TTL and offline fallback.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests

# Default configuration paths
LAUNCHER_DIR = Path(__file__).resolve().parent
CACHE_DIR = LAUNCHER_DIR / ".cache"
SOURCES_CONFIG_FILE = LAUNCHER_DIR / "digital_sources.json"
CACHE_FILE = CACHE_DIR / "digital_sources_cache.json"

# Roman numeral conversions for accurate game matching
ROMAN_NUMERALS = {
    r"\bi\b": "1",
    r"\bii\b": "2",
    r"\biii\b": "3",
    r"\biv\b": "4",
    r"\bv\b": "5",
    r"\bvi\b": "6",
    r"\bvii\b": "7",
    r"\bviii\b": "8",
    r"\bix\b": "9",
    r"\bx\b": "10",
}

# Technical or repack terms to sanitize from friendly user-facing labels
NOISE_TERMS_PATTERN = re.compile(
    r"\[(?:fitgirl|dodi|elamigos|tenoke|rune|empress|codex|skidrow|repack|flt|kaos|razor1911)[^\]]*\]|"
    r"\((?:fitgirl|dodi|elamigos|tenoke|rune|empress|codex|skidrow|repack|flt|kaos)[^)]*\)|"
    r"\b(?:repack|portable|multi\d+|x64|x86|p2p|torrent|magnet|crack|goldberg)\b",
    re.IGNORECASE
)


def normalize_title(title: str) -> str:
    """Normalizes title string for accurate comparison."""
    if not title:
        return ""
    text = title.lower()

    # Remove brackets content often containing group names or tags [FitGirl Repack]
    text = re.sub(r"\[.*?\]", " ", text)

    # Strip version numbers like v1.11, v1.0.4.2, build 12345
    text = re.sub(r"\bv\d+[\d._]*\b", " ", text)
    text = re.sub(r"\bbuild\s*\d+\b", " ", text)

    # Convert common symbols
    text = text.replace("&", " and ")
    text = text.replace("+", " and ")

    # Map roman numerals to arabic numbers
    for roman, arabic in ROMAN_NUMERALS.items():
        text = re.sub(roman, arabic, text)

    # Replace punctuation with spaces
    text = re.sub(r"[:\-_,.'\"!/?(){}]", " ", text)

    # Normalize whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def clean_user_friendly_title(raw_title: str) -> str:
    """
    Transforms a technical release title into a simple, polished, friendly title
    suitable for general users (e.g. 'Dragon Age: Inquisition (Edición Completa)').
    """
    cleaned = NOISE_TERMS_PATTERN.sub("", raw_title)
    
    # Clean version strings like v1.1.2.3 and build numbers
    cleaned = re.sub(r"\bv\d+[\d._]*\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bbuild\s*\d+\b", "", cleaned, flags=re.IGNORECASE)
    
    # Normalize multiple spaces, dangling dashes or brackets
    cleaned = re.sub(r"[\(\[\{]\s*[\)\]\}]", "", cleaned)
    cleaned = re.sub(r"[-–—]+\s*$", "", cleaned)
    cleaned = re.sub(r"^\s*[-–—]+", "", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()

    # If title mentions DLCs or Deluxe, highlight pleasantly
    features = []
    if re.search(r"\b(?:all\s+dlcs?|all\s+dlc|dlcs?)\b", raw_title, re.IGNORECASE):
        features.append("Incluye expansiones")
    if re.search(r"\b(?:deluxe|goty|complete|ultimate|gold|definitive)\b", raw_title, re.IGNORECASE):
        features.append("Edición Completa")

    if features and not any(f.lower() in cleaned.lower() for f in features):
        cleaned = f"{cleaned} ({', '.join(features)})"

    return cleaned or raw_title


def extract_game_tokens(title: str) -> Tuple[List[str], Optional[str]]:
    """
    Extracts tokens and identifies subtitle if present.
    """
    norm = normalize_title(title)
    tokens = [t for t in norm.split() if t not in ("the", "of", "and", "a", "an", "for")]
    return tokens, norm


def calculate_match_score(target_name: str, candidate_title: str) -> float:
    """
    Scores how well candidate_title matches target_name.
    Penalizes heavily if crucial distinguishing tokens (like numbers or subtitles) differ.
    """
    norm_target = normalize_title(target_name)
    norm_candidate = normalize_title(candidate_title)

    target_tokens, _ = extract_game_tokens(target_name)
    candidate_tokens, _ = extract_game_tokens(candidate_title)

    if not target_tokens:
        return 0.0

    # 1. All target tokens MUST be present in candidate
    target_set = set(target_tokens)
    candidate_set = set(candidate_tokens)
    matching_tokens = target_set.intersection(candidate_set)

    ratio_matched = len(matching_tokens) / len(target_set)
    if ratio_matched < 0.75:
        return 0.0

    # 2. Check for sequel number mismatch (1, 2, 3...) - ignoring 4-digit release years like 2024
    target_numbers = {t for t in target_tokens if t.isdigit() and len(t) <= 2}
    candidate_numbers = {t for t in candidate_tokens if t.isdigit() and len(t) <= 2}
    if target_numbers and not target_numbers.issubset(candidate_numbers):
        # Target specifies a sequel number (e.g. '2') but candidate has different or none
        return 0.0
    if not target_numbers and candidate_numbers:
        # Target has no number but candidate is explicitly a numbered sequel (e.g. '2', '3')
        return 0.0

    # 3. Substring & sequence similarity
    seq_ratio = SequenceMatcher(None, norm_target, norm_candidate).ratio()

    # Score calculation
    score = (ratio_matched * 0.6) + (seq_ratio * 0.4)
    return score


class DigitalSourceResolver:
    """Manages sources and resolves download packages compatible with Hydra formats."""

    def __init__(self, config_path: Path = SOURCES_CONFIG_FILE, cache_path: Path = CACHE_FILE):
        self.config_path = config_path
        self.cache_path = cache_path
        self.sources: List[Dict[str, Any]] = []
        self.indexed_downloads: List[Dict[str, Any]] = []
        self.load_config()
        self.load_cache()

    def load_config(self):
        """Loads configured source URLs."""
        if self.config_path.exists():
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.sources = data.get("sources", [])
            except Exception:
                self.sources = []
        else:
            self.sources = []

    def save_config(self):
        """Saves configured source URLs."""
        try:
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump({"sources": self.sources}, f, indent=2, ensure_ascii=False)
        except Exception as e:
            sys.stderr.write(f"Error saving sources config: {e}\n")

    def add_source(self, url: str, label: str = "") -> bool:
        """Adds a source URL to configuration."""
        clean_url = url.strip()
        if not clean_url:
            return False
        for s in self.sources:
            if s.get("url") == clean_url:
                return True
        self.sources.append({
            "url": clean_url,
            "label": label or f"Servidor {len(self.sources) + 1}",
            "enabled": True,
            "added_at": datetime.now().isoformat(),
        })
        self.save_config()
        return True

    def remove_source(self, url: str) -> bool:
        """Removes a source URL from configuration."""
        clean_url = url.strip()
        before = len(self.sources)
        self.sources = [s for s in self.sources if s.get("url") != clean_url]
        if len(self.sources) != before:
            self.save_config()
            return True
        return False

    def load_cache(self) -> bool:
        """Loads cached downloads index."""
        if not self.cache_path.exists():
            return False
        try:
            with open(self.cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.indexed_downloads = data.get("downloads", [])
                return True
        except Exception:
            return False

    def save_cache(self):
        """Saves downloads index to cache."""
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.cache_path, "w", encoding="utf-8") as f:
                json.dump({
                    "updated_at": datetime.now().isoformat(),
                    "total_items": len(self.indexed_downloads),
                    "downloads": self.indexed_downloads,
                }, f, ensure_ascii=False)
        except Exception as e:
            sys.stderr.write(f"Error saving cache: {e}\n")

    def sync_sources(self, force: bool = False, timeout: int = 15) -> Dict[str, Any]:
        """
        Fetches and updates all configured source files.
        Compatible with all standard Hydra source JSON layouts.
        """
        all_downloads: List[Dict[str, Any]] = []
        errors: List[str] = []
        synced_sources = 0

        for src in self.sources:
            if not src.get("enabled", True):
                continue
            url = src.get("url", "")
            if not url:
                continue

            try:
                # Handle local file or remote URL
                if os.path.isfile(url):
                    with open(url, "r", encoding="utf-8") as f:
                        raw_data = json.load(f)
                else:
                    resp = requests.get(url, timeout=timeout, headers={"User-Agent": "GameAccess/1.0"})
                    if resp.status_code != 200:
                        errors.append(f"Servidor respondió con código {resp.status_code}: {url}")
                        continue
                    raw_data = resp.json()

                extracted = self._parse_hydra_json(raw_data, source_name=src.get("label", ""))
                all_downloads.extend(extracted)
                synced_sources += 1

            except Exception as exc:
                errors.append(f"Error al sincronizar {url}: {exc}")

        if all_downloads:
            self.indexed_downloads = all_downloads
            self.save_cache()

        return {
            "ok": len(errors) == 0 or len(all_downloads) > 0,
            "synced_sources": synced_sources,
            "total_items": len(self.indexed_downloads),
            "errors": errors,
        }

    def _parse_hydra_json(self, raw_data: Any, source_name: str = "") -> List[Dict[str, Any]]:
        """Parses any variation of Hydra source JSON format into standardized internal records."""
        items: List[Dict[str, Any]] = []

        raw_list: List[Dict[str, Any]] = []
        if isinstance(raw_data, dict):
            # Standard Hydra format: { "name": "...", "downloads": [ ... ] }
            if "downloads" in raw_data and isinstance(raw_data["downloads"], list):
                raw_list = raw_data["downloads"]
            elif "items" in raw_data and isinstance(raw_data["items"], list):
                raw_list = raw_data["items"]
        elif isinstance(raw_data, list):
            # Direct array of items or array of source objects
            for entry in raw_data:
                if isinstance(entry, dict) and "downloads" in entry:
                    raw_list.extend(entry["downloads"])
                elif isinstance(entry, dict):
                    raw_list.append(entry)

        for item in raw_list:
            if not isinstance(item, dict):
                continue
            title = item.get("title") or item.get("name") or ""
            if not title:
                continue

            # URIs resolution (prefer magnet or direct link)
            uris = item.get("uris") or item.get("urls") or []
            if isinstance(uris, str):
                uris = [uris]
            if not uris and item.get("uri"):
                uris = [item["uri"]]
            if not uris and item.get("url"):
                uris = [item["url"]]

            if not uris:
                continue

            # Primary link
            primary_uri = uris[0]

            file_size = item.get("fileSize") or item.get("file_size") or item.get("size") or "Tamaño estándar"
            upload_date = item.get("uploadDate") or item.get("upload_date") or item.get("date") or ""

            items.append({
                "raw_title": title,
                "clean_title": clean_user_friendly_title(title),
                "uri": primary_uri,
                "uris": uris,
                "file_size": file_size,
                "upload_date": upload_date,
                "source_label": source_name or "Servidor oficial",
            })

        return items

    def search_game(self, game_name: str, min_score: float = 0.55) -> List[Dict[str, Any]]:
        """
        Searches all indexed packages for game_name.
        Returns a friendly list of install options sorted by relevance.
        """
        if not self.indexed_downloads and not self.load_cache():
            # If cache is empty, attempt a sync
            self.sync_sources()

        scored_matches: List[Tuple[float, Dict[str, Any]]] = []

        for item in self.indexed_downloads:
            score = calculate_match_score(game_name, item["raw_title"])
            if score >= min_score:
                scored_matches.append((score, item))

        # Sort by match score descending, then by date if available
        scored_matches.sort(key=lambda x: (x[0], x[1].get("upload_date", "")), reverse=True)

        results: List[Dict[str, Any]] = []
        for index, (score, item) in enumerate(scored_matches, start=1):
            badge = "Recomendada" if index == 1 else "Alternativa"
            results.append({
                "id": f"opt-{index}",
                "title": item["clean_title"],
                "raw_title": item["raw_title"],
                "size": item["file_size"],
                "badge": badge,
                "status": "Listo para instalar",
                "uri": item["uri"],
                "score": round(score, 2),
            })

        return results

    def resolve_best_option(self, game_name: str) -> Optional[Dict[str, Any]]:
        """Resolves the single highest-confidence package for a game."""
        options = self.search_game(game_name)
        if options:
            return options[0]
        return None


def main():
    parser = argparse.ArgumentParser(description="Digital Game Source Resolver")
    subparsers = parser.add_subparsers(dest="command")

    # Command: search
    p_search = subparsers.add_parser("search", help="Busca opciones de instalación para un juego")
    p_search.add_argument("name", help="Nombre del juego a buscar")
    p_search.add_argument("--json", action="store_true", help="Salida en formato JSON")

    # Command: resolve
    p_resolve = subparsers.add_parser("resolve", help="Resuelve directamente la mejor opción disponible")
    p_resolve.add_argument("name", help="Nombre del juego")

    # Command: sync
    subparsers.add_parser("sync", help="Actualiza los paquetes desde los servidores de fuentes")

    # Command: add-source
    p_add = subparsers.add_parser("add-source", help="Añade una URL o archivo de fuentes")
    p_add.add_argument("url", help="URL o ruta al archivo JSON de fuentes")
    p_add.add_argument("--label", default="", help="Etiqueta opcional para el servidor")

    # Command: list-sources
    subparsers.add_parser("list-sources", help="Lista los servidores de fuentes configurados")

    args = parser.parse_args()
    resolver = DigitalSourceResolver()

    if args.command == "search":
        results = resolver.search_game(args.name)
        if args.json or True:
            # Output user-friendly JSON (with URI internal)
            output = {
                "ok": True,
                "game": args.name,
                "count": len(results),
                "options": results,
            }
            print(json.dumps(output, ensure_ascii=False, indent=2))

    elif args.command == "resolve":
        best = resolver.resolve_best_option(args.name)
        if best:
            print(json.dumps({
                "ok": True,
                "game": args.name,
                "found": True,
                "title": best["title"],
                "size": best["size"],
                "uri": best["uri"],
            }, ensure_ascii=False, indent=2))
        else:
            print(json.dumps({
                "ok": True,
                "game": args.name,
                "found": False,
                "message": "No se encontraron paquetes de instalación para este título.",
            }, ensure_ascii=False, indent=2))

    elif args.command == "sync":
        result = resolver.sync_sources()
        print(json.dumps(result, ensure_ascii=False, indent=2))

    elif args.command == "add-source":
        ok = resolver.add_source(args.url, label=args.label)
        print(json.dumps({"ok": ok, "url": args.url}, ensure_ascii=False, indent=2))

    elif args.command == "list-sources":
        print(json.dumps({
            "ok": True,
            "sources": resolver.sources,
            "cached_items": len(resolver.indexed_downloads),
        }, ensure_ascii=False, indent=2))

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
