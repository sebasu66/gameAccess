#!/usr/bin/env python
"""Administrative entrypoint; the shared discovery worker lives in the API."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps/api"))
from app.discovery_catalog import main

if __name__ == "__main__":
    main()
