"""What the Simuladores + Carreras filter actually returns, and why.

The panel offers genre markers "+" (require) so two of them should be OR: a game
is a result if it carries either. This lists what the catalog says about the
games visible in the report and about the games that should be there instead.
"""
import gzip
import json
import sqlite3
import unicodedata
from pathlib import Path

PKG = Path(r"C:\DEV\Game Access Dev\apps\api\.cache\discovery-catalog\catalog-cache-8c21120039543bd9.sqlite.gz")
db = sqlite3.connect(":memory:")
db.deserialize(gzip.decompress(PKG.read_bytes()))
games = [json.loads(row) for (row,) in db.execute("SELECT payload FROM catalog_game")]

SIM = "simuladores"
CAR = "carreras"


def norm(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    without = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(without.replace("\u00a0", " ").lower().split())


def genres_of(game):
    return [norm(g) for g in (game.get("genres") or [])]


print(f"juegos en el catalogo: {len(games)}")
print()

sim_games = [g for g in games if SIM in genres_of(g)]
car_games = [g for g in games if CAR in genres_of(g)]
both = [g for g in games if SIM in genres_of(g) and CAR in genres_of(g)]
print(f"genero 'Simuladores' : {len(sim_games)}")
print(f"genero 'Carreras'    : {len(car_games)}")
print(f"los dos a la vez     : {len(both)}")
print(f"union (lo esperado)  : {len(sim_games) + len(car_games) - len(both)}")
print()
print("=== generos disponibles en total ===")
kinds = {}
for game in games:
    for genre in genres_of(game):
        kinds[genre] = kinds.get(genre, 0) + 1
for genre, count in sorted(kinds.items(), key=lambda kv: -kv[1]):
    print(f"   {count:>5}  {genre}")

print()
print("=== los juegos de la captura: que generos declaran? ===")
reported = ["Stumble Guys", "Zero Hour", "Contraband Police", "Poly Bridge",
            "Ages of Conflict", "Drift86", "Taxi Life", "F1 2017", "Lust Theory",
            "Robocraft", "War Thunder", "RACE ROOM", "G.O.P.O.T.A", "eFootball",
            "World of Tanks Blitz", "War Robots", "DCS World"]
for name in reported:
    hits = [g for g in games if name.lower() in (g.get("name") or "").lower()]
    if not hits:
        print(f"   {name:24} (no encontrado por nombre)")
        continue
    game = hits[0]
    matched = [x for x in (SIM, CAR) if x in genres_of(game)]
    print(f"   {game.get('name')[:30]:32} generos={game.get('genres')}  -> matchea {matched}")
