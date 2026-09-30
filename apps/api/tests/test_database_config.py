from app.database import normalize_database_url


def test_database_url_defaults_to_sqlite() -> None:
    assert normalize_database_url(None).startswith("sqlite:///")


def test_postgres_urls_use_psycopg3() -> None:
    assert normalize_database_url("postgres://user:pass@example.com/db") == (
        "postgresql+psycopg://user:pass@example.com/db"
    )
    assert normalize_database_url("postgresql://user:pass@example.com/db") == (
        "postgresql+psycopg://user:pass@example.com/db"
    )


def test_supabase_connections_require_ssl() -> None:
    result = normalize_database_url(
        "postgresql://postgres.ref:secret@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
    )
    assert result.startswith("postgresql+psycopg://")
    assert result.endswith("?sslmode=require")


def test_existing_sslmode_is_preserved() -> None:
    result = normalize_database_url(
        "postgresql://postgres.ref:secret@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full"
    )
    assert result.endswith("?sslmode=verify-full")
