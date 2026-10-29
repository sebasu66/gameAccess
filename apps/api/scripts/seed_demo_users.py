"""Sample users for a local test server (US.1): one per state, so what the client sees can be tried end to end.

Only for an isolated SQLite file: it refuses any other database, so it can never touch the shared customer database.
Run it through `run_demo_users_api.ps1`, which also starts the server on that file. Prints each user's PLUS key.

  Pagado      PLUS paid for a month: kid mode and the parent's key work.
  Por vencer  PLUS ends in 3 days.
  Sin pagar   Had PLUS; the payment was marked as not received: the key is ended.
  Sin llave   A user without any key yet.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_ROOT))


def main() -> None:
    url = os.environ.get("GAMEACCESS_DATABASE_URL", "")
    if not url.startswith("sqlite:///") or os.environ.get("GAMEACCESS_ALLOW_SQLITE_FOR_TESTS") != "1":
        raise SystemExit("Only for a local SQLite test file (set by run_demo_users_api.ps1); the shared database is never seeded.")
    from sqlmodel import Session, SQLModel, select
    from app.database import engine
    from app.access_keys import ensure_access_key_schema
    from app.accounts import Account, create_account, issue_account_key, set_membership

    SQLModel.metadata.create_all(engine)
    ensure_access_key_schema(engine)
    now = datetime.now(timezone.utc)
    samples = [
        ("Pagado", "pagado@ejemplo.test", now + timedelta(days=30), True, True),
        ("Por vencer", "por-vencer@ejemplo.test", now + timedelta(days=3), True, True),
        ("Sin pagar", "sin-pagar@ejemplo.test", now + timedelta(days=20), False, True),
        ("Sin llave", "sin-llave@ejemplo.test", None, False, False),
    ]
    with Session(engine) as session:
        for name, email, until, paid, with_key in samples:
            if session.exec(select(Account).where(Account.email == email)).first():
                print(f"{name:<11} ya existe ({email})")
                continue
            account = create_account(session, email=email, name=name, password="prueba-1234")
            key = None
            if with_key:
                # The key is given while paid, so it starts like a real customer's; "Sin pagar" is then marked unpaid.
                set_membership(session, account, paid=True, plus_until=until, note="Datos de prueba")
                _, key = issue_account_key(session, account)
                if not paid:
                    set_membership(session, account, paid=False, plus_until=None, note="Pago no recibido (prueba)")
            print(f"{name:<11} {email:<26} {key or '(sin llave)'}")


if __name__ == "__main__":
    main()
