from app import main
def test_current_product_has_no_account_license_rental_routes_or_models():
    paths = {route.path for route in main.app.routes}
    # The catalog and game details come from GitHub and Steam; the server serves neither.
    assert not any(path.startswith(("/library/catalog", "/catalog", "/digital/games", "/steam/apps")) for path in paths)
    assert "/activation/redeem" in paths
    assert not any(path.startswith(("/leases", "/credits", "/admin/accounts", "/pool", "/downloads")) for path in paths)
    tables = set(main.SQLModel.metadata.tables)
    assert not tables & {"provideraccount", "accountgame", "lease", "creditledger", "familymember"}
