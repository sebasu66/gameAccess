# gameAccess

Prototype for a local game-access broker/launcher.

## Goals

- Present a clean catalog UI to the customer.
- Track customer credits and time-based entitlements.
- Track a pool of provider/game accounts and their owned games.
- Lease an available account to one customer for a limited time.
- Keep customer identity/profile separate from provider account identity.
- Preserve/restore per-customer save folders through game-specific adapters.
- Keep Steam/provider credentials out of the launcher UI.
- Start with a safe simulation layer; real provider/session automation is implemented only through supported, legitimate session flows.

## MVP architecture

- `apps/api`: FastAPI backend, SQLite, lease allocator, credits, catalog.
- `apps/launcher`: simple Python desktop launcher prototype.
- `docs/architecture.md`: system design and boundaries.

## Quick start

### API

```bash
cd apps/api
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API: `http://127.0.0.1:8000`

### Launcher

```bash
cd apps/launcher
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
python launcher.py
```

The launcher defaults to `http://127.0.0.1:8000`.

## Current scope

The MVP deliberately does **not** bypass Steam DRM, fabricate entitlements, emulate Steamworks, or expose stored credentials. It proves the useful business layer first: catalog, pooling, leasing, expiration, saves, and credits.
