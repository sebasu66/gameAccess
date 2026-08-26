# gameAccess desktop UX

## Objective

The desktop client is the primary customer-facing product. The user should think in terms of **games, availability, time and fichas**, not provider accounts or marketplace inventory.

The visual reference is a modern streaming catalog: cinematic hero, shelves, strong cover art, fast browsing, detail overlays and one dominant action per context.

## Implemented stack

- React 18
- TypeScript
- Vite
- Tauri 2 host
- FastAPI local service
- Steam Store metadata adapter with disk cache

The old Tkinter launcher remains only as an experimental harness for Windows Steam chooser behavior.

## Current home screen

The desktop client currently implements:

- fixed dark top navigation;
- gameAccess brand treatment;
- search field;
- wallet/fichas balance;
- featured cinematic hero;
- availability and fichas/hour in the hero;
- `Jugar ahora` and `Más información` actions;
- horizontal game shelves;
- artwork cards with hover state;
- availability chips;
- product-value strip explaining download-first / play entitlement / wallet;
- responsive layouts for smaller windows;
- offline visual fallback when the local API is not running.

The fallback is intentional: visual review should not be blocked by local backend setup. It uses known Steam AppIDs and Steam CDN artwork URLs, while real runtime data comes from the local API.

## Game detail overlay

Selecting a game opens a large modal instead of navigating away from the home experience. It can display:

- Steam hero/background art;
- title;
- capacity state;
- fichas/hour;
- release date;
- Metacritic score when Steam exposes it;
- short description;
- screenshots;
- genres;
- developer/publisher;
- recommendation count;
- Steam reference price;
- trailer link when Steam exposes a movie asset;
- PLAY and DOWNLOAD actions.

Extended metadata comes from `GET /games/{id}/details` and is cached locally by the API.

## Steam metadata pipeline

```text
Steam AppID
-> SteamCatalogAdapter
-> normalized metadata
-> disk cache
-> FastAPI /games/{id}/details
-> React detail view
```

Normalized metadata intentionally separates Steam-specific transport from the UI. A future provider can populate the same product-facing model without rewriting the frontend.

The backend also supports:

```text
POST /admin/games/import-steam/{appid}
```

This imports or updates a catalog record using Steam as the metadata source. The user-facing app should never require manually typing descriptions, images or screenshots for ordinary Steam titles.

## Native Tauri bridge

The current Tauri host has deliberately narrow responsibilities:

- detect whether Steam is installed;
- open a validated `steam://install/<appid>` URI;
- open a validated `steam://run/<appid>` URI.

Provider account selection is **not** implemented by pretending these URIs grant entitlement. The Windows chooser experiment lives separately until a proper local `SteamSessionAdapter` absorbs it.

## Provider abstraction required next

The desired PLAY sequence is:

```text
UI -> POST /leases
   -> broker reserves provider account
   -> local SteamSessionAdapter switches to assigned remembered account
   -> adapter confirms the expected Steam session is ready
   -> native host opens steam://run/<appid>
   -> session timer begins/continues
   -> save/session cleanup on release
```

The UI should receive a customer-safe session state rather than provider account credentials.

Recommended state machine:

```text
IDLE
RESERVING
PREPARING_PROVIDER
STARTING_STEAM
LAUNCHING
PLAYING
ENDING
COMPLETE
ERROR
```

This state machine can drive a polished full-screen preparation overlay rather than exposing Steam internals.

## Visual QA when a human is available

Review at 1440×900 first, then 1920×1080 and 1024×768.

Priorities for human feedback:

1. Is the hero sufficiently premium and readable over real Steam artwork?
2. Are game cards too narrow/wide at normal desktop resolutions?
3. Is the green accent appropriate or should the brand move toward another color system?
4. Does the density feel closer to Netflix/Game Pass than to an admin dashboard?
5. Is the detail modal large enough for screenshots without feeling like a web store?
6. Should fichas/hour be quieter in discovery and stronger only at PLAY time?
7. Are horizontal shelves natural with mouse and controller?

## Controller / TV preparation

The markup and component model are compatible with a later focus-navigation layer. Before TV/controller shipping, add:

- explicit spatial focus graph;
- visible focus rings separate from hover;
- left/right shelf traversal;
- up/down shelf traversal;
- `A/Enter` select;
- `B/Escape` close/back;
- focus restoration after closing game details.

Do not duplicate the UI for controller mode; use the same component tree with an alternate navigation input layer.
