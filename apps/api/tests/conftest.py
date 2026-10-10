"""API tests must never connect to the shared customer database."""
import os
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ["GAMEACCESS_DATABASE_URL"] = "sqlite://"
os.environ["GAMEACCESS_ALLOW_SQLITE_FOR_TESTS"] = "1"
os.environ["GAMEACCESS_DISCOVERY_SYNC"] = "0"

import pytest

@pytest.fixture(autouse=True)
def disable_background_network_workers(monkeypatch):
    from app import main
    monkeypatch.setattr(main, "_start_steam_review_importer", lambda: None)
