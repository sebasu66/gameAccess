from pathlib import Path

from app.account_roster import load_account_roster


def test_roster_collapses_same_login_and_keeps_latest_password(tmp_path: Path) -> None:
    source = tmp_path / "accFull.csv"
    source.write_text(
        "alice,old-password\n"
        "alice,old-password\n"
        "alice,new-password\n"
        '"bob","plain value !@#"\n'
        '"comma-user","value,with,commas"\n',
        encoding="utf-8",
    )

    records = load_account_roster(source)

    assert [(item.label, item.login, item.password) for item in records] == [
        ("alice", "alice", "new-password"),
        ("bob", "bob", "plain value !@#"),
        ("comma-user", "comma-user", "value,with,commas"),
    ]
