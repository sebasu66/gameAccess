from app import main
def test_current_product_has_no_account_license_rental_routes_or_models():
    paths = {route.path for route in main.app.routes}
    assert "/library/catalog" in paths
    assert "/library/catalog/manifest" in paths
    assert "/activation/redeem" in paths
    assert not any(path.startswith(("/leases", "/credits", "/admin/accounts", "/pool", "/downloads")) for path in paths)
    tables = set(main.SQLModel.metadata.tables)
    assert not tables & {"provideraccount", "accountgame", "lease", "creditledger", "familymember"}
