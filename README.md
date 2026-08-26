# gameAccess

Prototype for a low-friction game-access broker/launcher with a visual desktop client.

## Product direction

The customer should experience gameAccess like a streaming/game-subscription catalog rather than like an account marketplace. Provider accounts, pool IDs and fulfillment details stay behind the product layer.

Core UX:

```text
open gameAccess
-> browse a visual catalog
-> open a rich game page populated from Steam
-> download/prepare the game
-> press PLAY
-> gameAccess checks credits + capacity
-> reserve a provider entitlement/session
-> launch through Steam
```

## Repository architecture

- `apps/api`: FastAPI + SQLite backend, credits, catalog, account pool and leases.
- `apps/api/app/steam_catalog.py`: Steam Store metadata adapter and cache.
- `apps/desktop`: React + Vite + Tauri 2 desktop UI, designed as the main customer experience.
- `apps/launcher`: earlier Tkinter/Windows experimental launcher used to validate Steam account chooser automation.
- `docs/PRODUCT_PLAN.md`: self-contained product/business design.
- `docs/architecture.md`: system boundaries.
- `skill.md`: living implementation/research knowledge base.

## Desktop UI

The current desktop UI is intentionally much closer to Netflix / Game Pass / GeForce NOW than to Steam's library UI:

- large cinematic hero;
- horizontal shelves;
- cover-art cards;
- visible availability and token price;
- search;
- wallet balance;
- game-detail overlay;
- Steam screenshots, descriptions, genres, publisher/developer, price reference and trailers when available;
- PLAY and DOWNLOAD actions;
- responsive layout;
- offline visual fallback so the interface can still be reviewed when the API is not running.

### Run the UI in browser/Vite mode

```bash
cd apps/desktop
npm install
npm run dev
```

Open `http://127.0.0.1:1420`.

### Run as Tauri desktop app

Install the normal Tauri 2 prerequisites for your platform, then:

```bash
cd apps/desktop
npm install
npm run tauri dev
```

The Tauri host exposes only narrow native commands required by the current prototype: detect Steam and open validated `steam://install/<appid>` / `steam://run/<appid>` URIs.

## API

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API: `http://127.0.0.1:8000`

Useful endpoints:

- `GET /catalog` — product catalog + availability + Steam artwork URLs.
- `GET /games/{id}/details` — catalog record enriched with cached Steam Store metadata.
- `GET /steam/apps/{appid}` — normalized Steam metadata for one AppID.
- `POST /admin/games/import-steam/{appid}` — add/update a catalog game directly from Steam metadata.
- `POST /leases` — reserve an available provider account for a timed session.
- `POST /admin/accounts/sync` — operator-side local inventory mapping.

Steam metadata is cached on disk under `apps/api/.steam_cache` so the home page does not need to hit Steam repeatedly.

## Important boundaries

The MVP does **not** bypass Steam DRM, fabricate entitlements, emulate Steamworks, collect Steam passwords, or read Steam Guard secrets. Installation, metadata, account selection, entitlement and leasing are separate concerns.

The desktop visual layer is now the primary frontend. The Tkinter launcher remains useful only as an experimental Windows harness until its confirmed Steam-session behaviors are moved behind a proper local provider adapter.
