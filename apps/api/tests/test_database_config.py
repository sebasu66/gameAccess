import pytest
from app.database import normalize_database_url, configured_database_url, database_project_ref, verify_shared_database, SHARED_PROJECT_REF


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

def test_missing_configuration_never_falls_back_to_sqlite(monkeypatch):
    monkeypatch.delenv("GAMEACCESS_DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="Configure GAMEACCESS_DATABASE_URL"):
        configured_database_url()


def test_sqlite_requires_explicit_test_mode(monkeypatch):
    monkeypatch.setenv("GAMEACCESS_DATABASE_URL", "sqlite://")
    monkeypatch.delenv("GAMEACCESS_ALLOW_SQLITE_FOR_TESTS", raising=False)
    with pytest.raises(RuntimeError, match="isolated tests"):
        configured_database_url()


def test_direct_supabase_connections_require_ssl():
    url = normalize_database_url(f"postgresql://user:secret@db.{SHARED_PROJECT_REF}.supabase.co/postgres")
    assert url.endswith("?sslmode=require")
    assert database_project_ref(url) == SHARED_PROJECT_REF


def test_pooler_identity_matches_the_same_shared_project():
    url = f"postgresql://postgres.{SHARED_PROJECT_REF}:secret@aws-0-sa-east-1.pooler.supabase.com/postgres"
    assert database_project_ref(url) == SHARED_PROJECT_REF


def test_shared_preflight_rejects_wrong_database_before_connecting():
    class WrongEngine:
        url = "postgresql://user:secret@db.another-project.supabase.co/postgres"
        def connect(self):
            pytest.fail("Wrong project must not be contacted")
    with pytest.raises(RuntimeError, match="shared GameAccess"):
        verify_shared_database(WrongEngine())


def test_shared_connection_failure_never_exposes_credentials():
    class UnreachableEngine:
        url = f"postgresql://postgres:very-private-password@db.{SHARED_PROJECT_REF}.supabase.co/postgres"
        def connect(self):
            raise RuntimeError(str(self.url))
    with pytest.raises(RuntimeError) as failure:
        verify_shared_database(UnreachableEngine())
    assert "very-private-password" not in str(failure.value)
