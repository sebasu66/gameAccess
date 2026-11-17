"""Per-request diagnostic detail, durable only when that request fails."""
from contextvars import ContextVar
import logging
import time
import uuid

logger = logging.getLogger("gameaccess.request")
_current = ContextVar("request_diagnostics", default=None)


def detail(message, *args):
    records = _current.get()
    if records is not None:
        records.append(logger.makeRecord(logger.name, logging.DEBUG, "", 0,
                                         message, args, None))


async def trace_request(request, call_next):
    # Query strings and headers deliberately excluded: keys can be present there.
    operation = request.url.path
    flow_id = uuid.uuid4().hex
    started = time.monotonic()
    records = []  # One transaction; no history, capacity, or eviction policy.
    token = _current.set(records)
    status = None
    failed = False
    try:
        detail("Request entered: method=%s path=%s", request.method, operation)
        response = await call_next(request)
        status = response.status_code
        failed = status >= 400
        return response
    except Exception:
        failed = True
        raise
    finally:
        _current.reset(token)
        elapsed = time.monotonic() - started
        if failed:
            for record in records:
                record.msg = f"flow={flow_id} " + record.msg
                logger.handle(record)
            logger.error("flow=%s path=%s failed status=%s elapsed=%.3fs",
                         flow_id, operation, status, elapsed)
        elif operation.startswith(("/digital/", "/library/", "/discovery/")):
            logger.info("flow=%s path=%s completed status=%s elapsed=%.3fs",
                        flow_id, operation, status, elapsed)
        records.clear()
