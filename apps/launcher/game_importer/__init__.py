"""Game Importer package.

    importer.py   GameImporter: issues() what keeps a folder from the standard, adopt() brings it up to it
                  (status suffix, log starting at import, execution manager prepare, obsolete backups removed)

Used by the Game Library Manager, which decides what to import/fix; it calls the Game Execution Manager."""
from .importer import GameImporter, obsolete_backups

__all__ = ["GameImporter", "obsolete_backups"]
