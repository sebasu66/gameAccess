from pathlib import Path

from app.account_roster import load_account_roster


def test_roster_uses_login_and_password_columns_and_deduplicates_exact_pairs(tmp_path: Path) -> None:
    source = tmp_path / "cuentas.txt"
    source.write_text(
        "| Hora (TimeCreated) | Usuario (Login) | Contraseña (Pass) |\n"
        "| 10:00:00 | `alice` | `alpha-123` |\n"
        "| 10:01:00 | `alice` | `alpha-123` |\n"
        "| 10:02:00 | `alice` | `https://example.invalid/path?q=1` |\n"
        "| 10:03:00 | 'bob' | 'plain value !@#' |\n",
        encoding="utf-8",
    )

    records = load_account_roster(source)

    assert [(item.label, item.login, item.password) for item in records] == [
        ("alice", "alice", "alpha-123"),
        ("alice#2", "alice", "https://example.invalid/path?q=1"),
        ("bob", "bob", "plain value !@#"),
    ]
