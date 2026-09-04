from pathlib import Path

from app.account_roster import load_account_roster


def test_roster_reads_two_column_csv_and_deduplicates_exact_pairs(tmp_path: Path) -> None:
    source = tmp_path / "accFull.csv"
    source.write_text(
        "alice,alpha-123\n"
        "alice,alpha-123\n"
        "alice,https://example.invalid/path?q=1\n"
        '"bob","plain value !@#"\n'
        '"comma-user","value,with,commas"\n',
        encoding="utf-8",
    )

    records = load_account_roster(source)

    assert [(item.label, item.login, item.password) for item in records] == [
        ("alice", "alice", "alpha-123"),
        ("alice#2", "alice", "https://example.invalid/path?q=1"),
        ("bob", "bob", "plain value !@#"),
        ("comma-user", "comma-user", "value,with,commas"),
    ]
