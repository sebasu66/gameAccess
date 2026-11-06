from __future__ import annotations

import argparse
import os
from pathlib import Path

from sqlalchemy import MetaData, create_engine, func, inspect, select, text
from sqlmodel import SQLModel

from app.access_keys import ensure_access_key_schema
from app.catalog_metadata import ensure_catalog_schema
from app.database import DB_PATH, normalize_database_url


def _target_url() -> str:
    value = os.environ.get("GAMEACCESS_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not value:
        raise SystemExit("Set GAMEACCESS_DATABASE_URL or DATABASE_URL to the target PostgreSQL database.")
    url = normalize_database_url(value)
    if url.startswith("sqlite:"):
        raise SystemExit("The target URL must be PostgreSQL/Supabase, not SQLite.")
    return url


def _row_count(connection, table) -> int:
    return int(connection.execute(select(func.count()).select_from(table)).scalar_one())


def _reset_postgres_sequences(engine, metadata: MetaData) -> None:
    if engine.dialect.name != "postgresql":
        return
    preparer = engine.dialect.identifier_preparer
    with engine.begin() as connection:
        for table in metadata.sorted_tables:
            integer_pks = [column for column in table.primary_key.columns if getattr(column.type, "python_type", None) is int]
            if len(integer_pks) != 1:
                continue
            column = integer_pks[0]
            sequence = connection.execute(
                text("SELECT pg_get_serial_sequence(:table_name, :column_name)"),
                {"table_name": table.name, "column_name": column.name},
            ).scalar()
            if not sequence:
                continue
            quoted_table = preparer.quote(table.name)
            quoted_column = preparer.quote(column.name)
            maximum = connection.execute(
                text(f"SELECT MAX({quoted_column}) FROM {quoted_table}")
            ).scalar()
            if maximum is None:
                connection.execute(
                    text("SELECT setval(CAST(:sequence AS regclass), 1, false)"),
                    {"sequence": sequence},
                )
            else:
                connection.execute(
                    text("SELECT setval(CAST(:sequence AS regclass), :value, true)"),
                    {"sequence": sequence, "value": int(maximum)},
                )


def migrate(source_path: Path, target_url: str, chunk_size: int) -> dict[str, int]:
    if not source_path.exists():
        raise SystemExit(f"Source SQLite database does not exist: {source_path}")
    source_engine = create_engine(f"sqlite:///{source_path}")
    target_engine = create_engine(target_url, pool_pre_ping=True)

    # Importing the model module registers every SQLModel table before create_all.
    from app import main as core  # noqa: F401

    SQLModel.metadata.create_all(target_engine)
    ensure_access_key_schema(target_engine)
    ensure_catalog_schema(target_engine)

    source_meta = MetaData()
    source_meta.reflect(bind=source_engine)
    target_meta = MetaData()
    target_meta.reflect(bind=target_engine)

    copied: dict[str, int] = {}
    with source_engine.connect() as source, target_engine.begin() as target:
        for source_table in source_meta.sorted_tables:
            if source_table.name.startswith("game_search_fts"):
                continue
            target_table = target_meta.tables.get(source_table.name)
            if target_table is None:
                continue
            existing = _row_count(target, target_table)
            if existing:
                raise SystemExit(
                    f"Target table {source_table.name!r} already contains {existing} rows. "
                    "Migration only runs against an empty target."
                )
            rows = [dict(row._mapping) for row in source.execute(select(source_table))]
            for offset in range(0, len(rows), chunk_size):
                target.execute(target_table.insert(), rows[offset : offset + chunk_size])
            copied[source_table.name] = len(rows)

    _reset_postgres_sequences(target_engine, target_meta)
    return copied


def main() -> None:
    parser = argparse.ArgumentParser(description="Copy the GameAccess SQLite database to PostgreSQL/Supabase.")
    parser.add_argument("--source", type=Path, default=DB_PATH, help="Path to the source SQLite database.")
    parser.add_argument("--chunk-size", type=int, default=1000)
    args = parser.parse_args()
    copied = migrate(args.source, _target_url(), max(1, args.chunk_size))
    total = sum(copied.values())
    print(f"Migrated {total} rows across {len(copied)} tables.")
    for table, count in copied.items():
        print(f"  {table}: {count}")


if __name__ == "__main__":
    main()
