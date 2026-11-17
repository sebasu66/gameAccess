"""One Steam adapter shared by API routes and maintenance workers."""
from .database import DB_PATH
from .steam_catalog import SteamCatalogAdapter

STEAM_CACHE = DB_PATH.parent / ".steam_cache"
steam_catalog = SteamCatalogAdapter(STEAM_CACHE)
