"""Steam Account Manager package: the local Steam client, its remembered accounts, who owns each game, and signing
Steam in to the owner before playing. Read the package docstring in manager.py for how it talks to the library."""
from .manager import SteamAccountManager

__all__ = ["SteamAccountManager"]
