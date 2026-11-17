"""Diagnostic context owned by one operation, discarded on success.

There is deliberately no event or byte limit. This is not a history cache.
The caller must close the transaction with succeed(), fail(), or discard().
"""
from __future__ import annotations

import logging
import re
import threading
import time
import uuid


def redact(message: str) -> str:
    # Provider URLs can carry credentials in paths, query strings and userinfo.
    message = re.sub(r"(?:https?://|magnet:\?)[^\s'\"]+", "[source redacted]", message)
    return re.sub(
        r"(?i)(password|passwd|token|authorization|api[_-]?key|secret)(\s*[:=]\s*)([^\s,;]+)",
        r"\1\2[redacted]", message,
    )


class FlowDiagnostics:
    def __init__(self, logger: logging.Logger, operation: str, app_id=None):
        self.logger = logger
        self.operation = operation
        self.app_id = app_id
        self.flow_id = uuid.uuid4().hex
        self.started = time.monotonic()
        self._records: list[logging.LogRecord] = []
        self._lock = threading.Lock()
        self._closed = False

    def debug(self, message, *args):
        text = redact(str(message) % args if args else str(message))
        record = self.logger.makeRecord(self.logger.name, logging.DEBUG, "", 0,
                                       self._prefix() + text, (), None)
        with self._lock:
            if not self._closed:
                self._records.append(record)

    def _prefix(self):
        return f"flow={self.flow_id} operation={self.operation} app_id={self.app_id} "

    @property
    def pending_count(self):
        with self._lock:
            return len(self._records)

    def discard(self):
        with self._lock:
            self._records.clear()
            self._closed = True

    def succeed(self):
        self.discard()

    def fail(self, error):
        with self._lock:
            if self._closed:
                return
            records, self._records = self._records, []
            self._closed = True
        # handle() intentionally bypasses the logger's INFO threshold: these
        # DEBUG records become durable only now, because the operation failed.
        for record in records:
            self.logger.handle(record)
        self.logger.error("%sfailed after %.3fs: %s", self._prefix(),
                          time.monotonic() - self.started, redact(str(error)))


class FlowLogger:
    """Keep milestones normal; route detailed DEBUG to the transaction."""
    def __init__(self, logger, diagnostics):
        self._logger = logger
        self._diagnostics = diagnostics

    def debug(self, message, *args, **kwargs):
        self._diagnostics.debug(message, *args)

    def __getattr__(self, name):
        return getattr(self._logger, name)
