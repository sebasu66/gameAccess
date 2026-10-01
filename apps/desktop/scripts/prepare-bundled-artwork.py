from __future__ import annotations

import gzip
import io
import json
import os
import shutil
import sqlite3
import tempfile
import textwrap
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageOps
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

DESKTOP_ROOT = Path(__file__).resolve().parents[1]
SEED_ROOT = DESKTOP_ROOT / "src-tauri" / "runtime" / "catalog"
PUBLIC_ROOT = DESKTOP_ROOT / "public"
CACHE_ROOT = DESKTOP_ROOT / ".cache" / "game-assets"
TARGET_SIZE = (180, 270)
MAX_DOWNLOAD_BYTES = 3 * 1024 * 1024
WORKERS = 24

_thread_state = threading.local()
_counter_lock = threading.Lock()
_completed = 0


def session() -> requests.Session:
    cached = getattr(_thread_state, "session", None)
    if cached is not None:
        return cached
    value = requests.Session()
    retry = Retry(total=2, connect=2, read=2, backoff_factor=0.25, status_forcelist=(429, 500, 502, 503, 504))
    value.mount("https://", HTTPAdapter(max_retries=retry, pool_connections=WORKERS, pool_maxsize=WORKERS))
    value.headers.update({"User-Agent": "GameAccess-Artwork-Bundler/1.0"})
    _thread_state.session = value
    return value


def image_urls(app_id: int, payload: dict) -> list[str]:
    base = f"https://cdn.akamai.steamstatic.com/steam/apps/{app_id}"
    shared = f"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{app_id}"
    values = [
        f"{base}/library_600x900.jpg",
        f"{base}/library_600x900_2x.jpg",
        f"{shared}/library_600x900.jpg",
        f"{shared}/library_600x900_2x.jpg",
        payload.get("capsule_image"),
        payload.get("header_image"),
        payload.get("hero_image"),
    ]
    return list(dict.fromkeys(str(value) for value in values if value))


def fetch_image(url: str) -> Image.Image | None:
    try:
        with session().get(url, timeout=(5, 20), stream=True) as response:
            if response.status_code != 200:
                return None
            length = int(response.headers.get("Content-Length") or 0)
            if length > MAX_DOWNLOAD_BYTES:
                return None
            body = response.content
            if not body or len(body) > MAX_DOWNLOAD_BYTES:
                return None
        image = Image.open(io.BytesIO(body))
        image.load()
        return image.convert("RGB")
    except Exception:
        return None


def portrait(image: Image.Image) -> Image.Image:
    width, height = image.size
    ratio = width / max(height, 1)
    if 0.55 <= ratio <= 0.8:
        return ImageOps.fit(image, TARGET_SIZE, method=Image.Resampling.LANCZOS)
    contained = ImageOps.contain(image, TARGET_SIZE, method=Image.Resampling.LANCZOS)
    result = Image.new("RGB", TARGET_SIZE, (18, 18, 18))
    x = (TARGET_SIZE[0] - contained.width) // 2
    y = (TARGET_SIZE[1] - contained.height) // 2
    result.paste(contained, (x, y))
    return result


def placeholder(name: str) -> Image.Image:
    image = Image.new("RGB", TARGET_SIZE, (18, 18, 18))
    draw = ImageDraw.Draw(image)
    wrapped = textwrap.wrap(name or "Steam", width=18)[:6]
    y = max(18, (TARGET_SIZE[1] - len(wrapped) * 18) // 2)
    for line in wrapped:
        box = draw.textbbox((0, 0), line)
        x = max(8, (TARGET_SIZE[0] - (box[2] - box[0])) // 2)
        draw.text((x, y), line, fill=(230, 230, 230))
        y += 18
    return image


def build_cover(app_id: int, name: str, payload: dict, target: Path) -> str:
    if target.is_file() and target.stat().st_size > 200:
        return "cached"
    image = None
    for url in image_urls(app_id, payload):
        image = fetch_image(url)
        if image is not None:
            break
    source = "steam"
    if image is None:
        image = placeholder(name)
        source = "placeholder"
    optimized = portrait(image)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(".tmp")
    optimized.save(temp, "WEBP", quality=72, method=4)
    os.replace(temp, target)
    return source


def hardlink_or_copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def load_catalog_rows(seed_gz: Path) -> list[tuple[int, str, dict]]:
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as temp:
        temp_path = Path(temp.name)
    try:
        with gzip.open(seed_gz, "rb") as source, temp_path.open("wb") as target:
            shutil.copyfileobj(source, target)
        conn = sqlite3.connect(temp_path)
        try:
            rows = []
            for app_id, payload_raw in conn.execute(
                "SELECT app_id, payload FROM catalog_game WHERE app_id IS NOT NULL ORDER BY id"
            ):
                payload = json.loads(payload_raw)
                rows.append((int(app_id), str(payload.get("name") or f"Steam {app_id}"), payload))
            return rows
        finally:
            conn.close()
    finally:
        temp_path.unlink(missing_ok=True)


def main() -> int:
    manifest_path = SEED_ROOT / "manifest.json"
    seed_path = SEED_ROOT / "catalog.sqlite.gz"
    if not manifest_path.is_file() or not seed_path.is_file():
        raise SystemExit("Bundled catalog seed must be prepared before artwork.")

    catalog_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    revision = str(catalog_manifest["revision"])
    rows = load_catalog_rows(seed_path)
    cache_covers = CACHE_ROOT / revision / "covers"
    cache_covers.mkdir(parents=True, exist_ok=True)

    results: dict[int, str] = {}
    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {
            executor.submit(build_cover, app_id, name, payload, cache_covers / f"{app_id}.webp"): app_id
            for app_id, name, payload in rows
        }
        total = len(futures)
        global _completed
        for future in as_completed(futures):
            app_id = futures[future]
            results[app_id] = future.result()
            with _counter_lock:
                _completed += 1
                if _completed % 250 == 0 or _completed == total:
                    print(f"Prepared {_completed}/{total} bundled covers.")

    staging = PUBLIC_ROOT / f"game-assets.staging-{os.getpid()}"
    final = PUBLIC_ROOT / "game-assets"
    shutil.rmtree(staging, ignore_errors=True)
    (staging / "covers").mkdir(parents=True, exist_ok=True)

    games: dict[str, dict[str, str]] = {}
    for app_id, _name, _payload in rows:
        source = cache_covers / f"{app_id}.webp"
        target = staging / "covers" / source.name
        hardlink_or_copy(source, target)
        games[str(app_id)] = {"capsule_image": f"covers/{app_id}.webp"}

    manifest = {
        "version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "catalog_sha256": catalog_manifest.get("sha256"),
        "game_count": len(rows),
        "image_count": len(games),
        "placeholder_count": sum(1 for value in results.values() if value == "placeholder"),
        "games": games,
    }
    (staging / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    shutil.rmtree(final, ignore_errors=True)
    os.replace(staging, final)
    total_bytes = sum(path.stat().st_size for path in (final / "covers").iterdir())
    print(f"Bundled {len(games)} covers for catalog revision {revision}: {total_bytes} bytes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
