import pathlib
import re

p = pathlib.Path('apps/api/app/digital_admin_routes.py')
c = p.read_text('utf-8')

# Remove populate_catalog_from_sources
c = re.sub(r'@router\.post\("/catalog/populate-from-sources"\).*?return \{"ok": True.*?\}', '', c, flags=re.DOTALL)
c = re.sub(r'def _populate_catalog_bg.*?finally:\s*SYNC_STATUS\["is_running"\] = False', '', c, flags=re.DOTALL)

# Let's add an endpoint to add a Steam game manually
steam_adder = '''
@router.post("/catalog/add-steam-game/{steam_id}")
def add_steam_game(steam_id: int) -> dict[str, Any]:
    """Agrega un juego de Steam al catálogo general descargando sus metadatos básicos."""
    from .steam_catalog import SteamCatalogAdapter
    
    adapter = SteamCatalogAdapter()
    details = adapter.fetch_game_details(steam_id)
    if not details:
        raise HTTPException(404, "No se pudo obtener información de Steam para este ID.")
        
    game_name = details.get("name", f"Steam Game {steam_id}")
    
    # Lo guardamos en el JSON del catálogo genérico
    catalog = load_digital_catalog_json()
    
    # Check if exists
    if any(g.get("id") == steam_id for g in catalog):
        return {"ok": True, "message": "El juego ya estaba en el catálogo genérico", "game": game_name}
        
    new_game = {
        "id": steam_id,
        "name": game_name,
        "image": details.get("header_image", ""),
        "steam_id": steam_id,
        "release_date": details.get("release_date", {}).get("date", ""),
        "type": "digital"
    }
    catalog.append(new_game)
    save_catalog_json(catalog)
    
    # Sincronizamos la base de datos local para que quede listo para las búsquedas
    from .digital_catalog import sync_digital_catalog
    sync_digital_catalog(force=True)
    
    return {"ok": True, "message": f"Agregado {game_name} al catálogo.", "game": new_game}
'''

if 'add_steam_game' not in c:
    c = c + '\n' + steam_adder

p.write_text(c, 'utf-8')
print("Updated digital_admin_routes.py")
