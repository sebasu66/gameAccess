"""Entry point the desktop app launches (`digital_downloader.py --app-id ...`). The work lives in game_download_manager."""
import sys
from game_download_manager.worker import main

if __name__ == "__main__":
    sys.exit(main())
