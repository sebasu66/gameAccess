"""Review maintenance."""
from __future__ import annotations
import logging
import os
import threading
import time
from .database import engine
from .steam_client import steam_catalog
from .steam_catalog import SteamReviewRateLimited
from .catalog_metadata import next_steam_review_target, save_steam_review_summary, defer_steam_review_summary

_review_worker_started = False
_catalog_logger = logging.getLogger("gameaccess.catalog")


def _steam_review_import_loop() -> None:
    interval = max(2.0, float(os.environ.get("GAMEACCESS_STEAM_REVIEW_INTERVAL_SECONDS", "2.5")))
    while True:
        target = next_steam_review_target(engine)
        if target is None:
            time.sleep(300)
            continue
        game_id, app_id = target
        try:
            summary = steam_catalog.fetch_review_summary(app_id)
            save_steam_review_summary(engine, game_id, summary)
        except SteamReviewRateLimited as exc:
            # Save our place and stop on Steam throttling; a later service restart
            # can resume after the persisted retry time instead of hammering Steam.
            defer_steam_review_summary(engine, game_id, max(6 * 60 * 60, exc.retry_after))
            _catalog_logger.warning("Steam review import paused after HTTP 429; progress is saved.")
            return
        except Exception as exc:
            defer_steam_review_summary(engine, game_id, 60 * 60)
            _catalog_logger.warning("Steam review import deferred one title after an error: %s", exc)
        time.sleep(interval)






def _start_steam_review_importer() -> None:
    global _review_worker_started
    if _review_worker_started:
        return
    _review_worker_started = True
    threading.Thread(
        target=_steam_review_import_loop,
        name="gameaccess-steam-review-import",
        daemon=True,
    ).start()
