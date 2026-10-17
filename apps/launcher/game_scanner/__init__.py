"""Game Scanner package.

    scanner.py   GameScanner: drives() and scan(drives) look for installed games in the usual places
                 (games/juegos/library folders, Steam libraries, Program Files\\Steam, Downloads)

It only reads. Importing what it finds is the Game Importer's job (link, or move into the library)."""
from .scanner import GameScanner, is_steam_path

__all__ = ["GameScanner", "is_steam_path"]
