"""The catalog/activation server owns no provider credentials or download data."""
from app import main
def test_server_exposes_no_archive_password_routes():
    paths = {route.path for route in main.app.routes}
    assert not any("archive-password" in path for path in paths)
    assert not hasattr(main, "read_archive_passwords")
    assert not hasattr(main, "save_archive_passwords")
