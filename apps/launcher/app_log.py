"""The launcher's general log: one size-capped file that every manager writes its actions and errors to.

`logs/execution.log` holds what the managers do (library scan, import/adoption, repair, batch actions)
and `logs/downloads.log` what the download worker does. Both are capped: when a file reaches its limit
it is moved to `<name>.1` (replacing the previous one), so a log never takes more than about twice its limit."""
from __future__ import annotations
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent / "logs"
MAX_BYTES = 1024 * 1024
BACKUPS = 1  # RotatingFileHandler never rotates with 0 backups: the file would grow forever.
FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
GENERAL = "DigitalExecution"


def configure(name: str = GENERAL, filename: str = "execution.log", directory: Path | None = None,
              max_bytes: int = MAX_BYTES, backups: int = BACKUPS) -> logging.Logger:
    """Attach (or re-point) the capped file handler of logger `name`. Safe to call repeatedly."""
    target = Path(directory or LOG_DIR)
    target.mkdir(parents=True, exist_ok=True)
    path = target / filename
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    for handler in list(logger.handlers):
        if isinstance(handler, RotatingFileHandler):
            if Path(handler.baseFilename) == path.resolve() and handler.maxBytes == max_bytes:
                return logger
            logger.removeHandler(handler)
            handler.close()
    handler = RotatingFileHandler(path, maxBytes=max_bytes, backupCount=backups, encoding="utf-8")
    handler.setFormatter(logging.Formatter(FORMAT))
    logger.addHandler(handler)
    return logger


def manager_logger(manager: str) -> logging.Logger:
    """Logger of one manager ('library', 'importer', 'execution'); it writes to the general log."""
    configure()
    return logging.getLogger(f"{GENERAL}.{manager}")
