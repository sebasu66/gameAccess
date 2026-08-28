# gameAccess

> **Project status / handoff document**  
> Last reviewed: 2026-08-28

`gameAccess` is an experimental PC-game access platform whose goal is to make temporary or alternative access to games feel like using **Netflix, Xbox Game Pass, or GeForce NOW**, rather than buying, receiving, or manually managing provider accounts.

The customer-facing abstraction is the **game**. Provider accounts, license pools, suppliers, leases, Steam identities, fulfillment mechanisms, and eventually cloud capacity should remain implementation details behind the product.

This repository is currently an **MVP / technical and business validation project**, not a production service.

---

## 1. Product intent

The intended experience is deliberately low-friction:

```text
open gameAccess
-> browse a visual game catalog
-> open a rich Steam-powered game page
-> download / prepare the game
-> press PLAY
-> gameAccess checks wallet + availability
-> allocate a compatible entitlement/session
-> launch the game
```

A customer should not normally have to understand which provider account, seller, entitlement, pool entry, machine, or cloud service fulfills the request.

The long-term product is therefore **not an account marketplace UI**. It is a game-access layer capable of changing fulfillment mechanisms underneath a stable customer experience.

---

## 2. Business goal

The project is being designed around a capital-light validation strategy.

Before investing in expensive inventory or owned GPU/cloud infrastructure, gameAccess should prove that users want particular games, that sessions can be fulfilled reliably, and that the economics work.

Potential revenue mechanisms include:

- wallet top-ups using an internal token/credit balance;
- temporary game access;
- recurring membership with preferential top-up economics and other benefits;
- a short capacity-limited free trial tied to a recurring subscription;
- promotional/reward-funded access where economically viable;
- later, additional fulfillment methods such as cloud gaming.

A major strategic feature is **demand sensing**: searches, installs, Play attempts, blocked Play attempts, occupancy, and repeat demand should tell the operator what inventory is worth acquiring instead of buying inventory speculatively.

The full commercial/product rationale lives in [`docs/PRODUCT_PLAN.md`](docs/PRODUCT_PLAN.md).

---

## 3. Current repository architecture

```text
gameAccess/
├─ apps/
│  ├─ api/       FastAPI + SQLite backend
│  ├─ desktop/   React + Vite + Tauri 2 desktop client
│  └─ launcher/  earlier Windows/Tkinter experimental launcher
├─ docs/
│  ├─ PRODUCT_PLAN.md
│  └─ architecture.md
├─ skill.md      accumulated implementation/research knowledge
└─ README.md     project entry point + current handoff/status
```

### `apps/api`

Current backend responsibilities include:

- game catalog;
- Steam Store metadata integration and cache;
- credits / wallet prototype mechanics;
- provider-account inventory;
- entitlement/account availability;
- timed leases;
- administrative inventory synchronization.

This is presently a prototype domain backend, not a hardened production financial or identity system.

### `apps/desktop`

This is the intended primary consumer frontend.

It uses **React + Vite + Tauri 2** and is deliberately styled closer to Game Pass / GeForce NOW / Netflix than to a utilitarian Steam-account manager.

Implemented/prototyped UI concepts include:

- cinematic hero area;
- horizontal catalog shelves;
- cover-art cards;
- search;
- wallet balance;
- game detail view;
- availability and token-price presentation;
- Steam screenshots, descriptions, genres and publisher/developer metadata;
- trailers when available;
- PLAY and DOWNLOAD actions;
- responsive layout;
- offline visual fallback when the API is unavailable.

The Tauri host currently exposes only narrow native behavior required by the prototype, such as detecting Steam and opening validated Steam install/run URIs.

### `apps/launcher`

This is an **earlier experimental Windows harness**.

It was used to validate local Steam/session/account-selection behavior. It should not be mistaken for the intended final customer UI. Useful validated behaviors should progressively move behind proper local provider/session adapters while the React/Tauri desktop app remains the product frontend.

---

## 4. Current state — 2026-08-28

### Implemented / present in the repository

- FastAPI backend and SQLite prototype.
- Game catalog model.
- Provider account/inventory model.
- Availability and timed lease mechanics.
- Steam Store metadata adapter/cache.
- Steam-driven rich catalog/game-detail data.
- React/Vite/Tauri desktop application.
- Streaming-style visual catalog direction.
- Basic wallet/credits concepts.
- PLAY / DOWNLOAD UI actions.
- Experimental local Windows Steam launcher/session work.
- Product/business plan.
- Architecture notes and a living implementation/research knowledge base (`skill.md`).

### Validated direction, but still experimental

- Treating games rather than provider accounts as the consumer-facing product.
- Separating download/preparation from entitlement checking at Play time.
- Allocating finite provider capacity through leases.
- Local Steam integration as part of fulfillment.
- Using Steam metadata to populate the catalog rather than manually maintaining presentation data.
- Capital-light sourcing and inventory experimentation.

### Not production-ready / still to be built or proven

- End-to-end reliable production session lifecycle.
- Robust account/session switching and cleanup across supported games.
- Per-game compatibility matrix.
- Save-game isolation/restoration and customer continuity.
- Production authentication/user accounts.
- Immutable wallet ledger.
- Real payment-provider integration.
- Subscription lifecycle and 3-day trial implementation.
- Refund/idempotency/webhook handling.
- Demand telemetry and Demand Engine.
- Automated inventory/procurement recommendations.
- Production supplier integrations.
- Production-grade security/revocation strategy for provider sessions.
- Cloud-gaming fulfillment.
- Operational/admin tooling required to run the service at scale.

In short: **the catalog, broker concepts and desktop experience exist as a meaningful prototype; the next critical milestone is proving a robust real PLAY/session lifecycle and the economics around it.**

---

## 5. Immediate development priorities

Work should prioritize validation over feature breadth.

1. **Make one complete Play flow dependable.**
   Select a representative Steam game and prove allocation -> local session preparation -> launch -> exit -> cleanup -> lease release.

2. **Formalize provider/session adapters.**
   Move useful behavior out of the legacy launcher into explicit interfaces rather than coupling the customer UI directly to Steam/account automation.

3. **Create a per-game compatibility model.**
   Record whether a game works with the current access method, external publisher accounts, SteamID-bound progression, save locations, cloud-save behavior, and known cleanup requirements.

4. **Instrument demand.**
   Capture search, game-page view, download intent, installation, Play attempt, blocked Play attempt, successful allocation and session completion.

5. **Build the Demand Engine before buying substantial inventory.**
   Use unmet demand, occupancy, acquisition price, supplier depth and expected contribution margin to generate procurement recommendations.

6. **Only after the above, harden monetization.**
   Introduce an immutable ledger, top-ups, payment webhooks, membership/trial lifecycle, refunds and idempotency before accepting production money.

---

## 6. Important product rules / boundaries

The architecture should preserve these rules unless deliberately reconsidered:

- The customer interacts with **games**, not raw provider accounts.
- Provider credentials and fulfillment identities belong behind the product layer.
- Download/preparation and entitlement are separate concepts.
- A SteamID is an identity, not proof of ownership/license.
- The system must not bypass Steam DRM, fabricate entitlements, emulate ownership, or collect/store Steam Guard secrets as a shortcut.
- Customer machines are untrusted endpoints; client-side provider material cannot be assumed perfectly secret from a local administrator.
- Inventory acquisition should follow demonstrated demand and economics.
- Cloud/owned GPU infrastructure is a later fulfillment option, not an MVP prerequisite.
- The old Tkinter launcher is an experimental harness; the React/Tauri app is the intended frontend direction.

---

## 7. Running the desktop UI

### Browser / Vite mode

```bash
cd apps/desktop
npm install
npm run dev
```

Then open:

```text
http://127.0.0.1:1420
```

### Tauri desktop mode

Install the normal Tauri 2 platform prerequisites, then:

```bash
cd apps/desktop
npm install
npm run tauri dev
```

---

## 8. Running the API

On Windows:

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Default API URL:

```text
http://127.0.0.1:8000
```

Useful prototype endpoints include:

```text
GET  /catalog
GET  /games/{id}/details
GET  /steam/apps/{appid}
POST /admin/games/import-steam/{appid}
POST /leases
POST /admin/accounts/sync
```

Steam metadata is cached under:

```text
apps/api/.steam_cache
```

---

## 9. Documentation map

When taking over or resuming the project, read in this order:

1. **`README.md`** — current intent, architecture, status and handoff.
2. **`docs/PRODUCT_PLAN.md`** — detailed product/business model, demand strategy, sourcing and intended evolution.
3. **`docs/architecture.md`** — technical boundaries and architecture.
4. **`skill.md`** — living implementation/research knowledge, especially Steam/session findings.
5. Inspect `apps/api`, `apps/desktop`, and only then `apps/launcher` as needed.

If a technical discovery materially changes what is known about Steam/session behavior, update `skill.md`. If the implementation status or project direction changes materially, update this README as part of the same work.

---

## 10. Handoff summary

For a developer or AI agent arriving without prior conversation context:

**What are we building?**  
A polished game-centric access service where users browse, prepare and play games while fulfillment accounts/capacity remain hidden behind the platform.

**What exists today?**  
A FastAPI/SQLite broker prototype, Steam-enriched catalog, provider inventory/lease concepts, a substantially more appropriate React/Tauri consumer UI, and an older Windows launcher used for Steam/session experiments.

**What is the most important unsolved problem?**  
A dependable, repeatable, secure-enough end-to-end provider/session lifecycle for real games, including launch, cleanup/release and per-game compatibility.

**What should not happen next?**  
Do not prematurely build a huge cloud fleet, buy broad inventory, automate purchasing at scale, or add production payments before the real Play flow and unit economics are demonstrated.

**What should happen next?**  
Prove one excellent Play flow, turn the experimental launcher findings into formal adapters, measure demand, and then use that evidence to decide what inventory and monetization deserve automation.
