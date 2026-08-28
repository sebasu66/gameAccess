# gameAccess

> **Project status / handoff document**  
> Last reviewed: 2026-08-28

`gameAccess` is an experimental PC-game access platform whose goal is to make temporary or alternative access to games feel like using **Netflix, Xbox Game Pass, or GeForce NOW**, rather than buying, receiving, or manually managing provider accounts.

The customer-facing abstraction is the **game**. Provider accounts, license pools, suppliers, leases, Steam identities, fulfillment mechanisms, and eventually cloud capacity should remain implementation details behind the product.

This repository is currently an **MVP / technical and business validation project**, not a production service.

## Product intent

The target customer experience is one Windows executable (`gameAccess.exe`) connected over HTTPS to a central hosted gameAccess backend. The customer must not need to run a separate local API/server process. React/Vite may remain the UI implementation inside Tauri, while machine-local Steam/process/filesystem behavior belongs in the native desktop layer.

The central backend is authoritative for shared state: customers, wallet/fichas, provider profiles, licenses/entitlements, availability, queues, leases/sessions, catalog, telemetry and later payments. A web administration application uses the same backend and data model.

```text
Customer PC                              Hosted gameAccess
┌──────────────────────────────┐         ┌──────────────────────────────┐
│ gameAccess.exe               │ HTTPS   │ Central backend             │
│ React UI + Tauri/native      ├────────>│ accounts/licenses/leases    │
│ Steam/local adapters         │         │ queues/wallet/catalog       │
└──────────────────────────────┘         └──────────────┬───────────────┘
                                                       │
                                                Admin web app
```

## Unified Steam + gameAccess experience

The desktop application should make gameAccess feel like an extension of the user's existing PC-game library rather than a separate account marketplace.

At startup it should discover the Steam users/accounts already present on the machine and determine, as reliably as supported interfaces/local metadata allow, which games are installed/owned/available through those accounts. Multiple local Steam accounts should be represented in one game-centric catalog.

For every game the UI should clearly distinguish the access source while keeping the workflow simple:

1. **Owned / local access** — the user already owns the game through one of their Steam accounts. Launch normally using the appropriate local identity.
2. **Buy on Steam** — for an unowned game, offer the normal Steam Store purchase route and leave the gameAccess commercial flow.
3. **gameAccess shared access** — spend fichas/tokens for temporary access, initially envisioned as time-based access where appropriate.
4. **Dedicated/private access** — where commercially and contractually viable, offer dedicated inventory rather than waiting for shared capacity.

The ficha balance remains persistently visible. Subscription economics, recurring plans and exact token packages are intentionally deferred until the core access flow is validated.

## Availability and waiting queue

Shared inventory is finite. When a gameAccess copy is available, the normal action is **PLAY**. When all compatible capacity is occupied, the user should be able to **JOIN WAITLIST** rather than repeatedly retrying.

The central backend owns queue order and reservations. When capacity becomes available, the next eligible user receives a desktop notification with a direct **PLAY NOW** action and a bounded reservation window; if it expires, capacity can move to the next user.

The waiting state is also a high-value demand signal and should feed procurement analytics.

A user waiting for a game may also be shown a separate **GET PRIVATE ACCESS / SKIP THE WAIT** offer when dedicated inventory can legitimately be sourced. This must remain a distinct entitlement/product type from a temporary shared lease.

## Steam Families research direction

A usability hypothesis is to reduce account switching by using **Steam Families** where Valve's rules genuinely permit it: a user's primary account could access shareable games owned by another eligible family member while retaining their own saves/achievements/account experience.

This is **research, not an assumed fulfillment mechanism**. Steam Families is a Valve feature intended for a family/household context, has membership/eligibility restrictions, and individual games may opt out of Family Sharing. gameAccess must validate current Steam rules and technical behavior before depending on it. It must not manufacture or rotate families merely to circumvent account, regional, licensing, household or sharing restrictions.

## Steam store country / Argentina — important constraint

Do **not** implement an automatic "change this Steam account to Argentina" function as a gameAccess provisioning shortcut.

Valve's current Steam Support rules state that the store country must correspond to where the account holder currently resides, and changing it after moving requires completing a purchase with a payment method from the new country. Steam currently limits changing store country to once every three months. This is therefore not simply an editable profile field that gameAccess should programmatically force, and there is no documented Steamworks API intended for a third-party launcher to arbitrarily set a consumer account's store country.

GameAccess may detect/display relevant regional compatibility and guide a legitimate user through Steam's own supported flow when they actually qualify, but regional manipulation must not become part of automated account provisioning.

## Business goal

The project is designed around capital-light validation. Before investing in broad inventory or owned GPU/cloud infrastructure, prove demand, reliable fulfillment and unit economics.

Potential revenue mechanisms include wallet top-ups, temporary access, recurring membership, trials/promotions and later additional fulfillment methods such as cloud gaming.

A strategic feature is **demand sensing**: searches, installs, Play attempts, waitlist joins, blocked demand, occupancy and repeat demand should tell the operator what inventory is worth acquiring.

See [`docs/PRODUCT_PLAN.md`](docs/PRODUCT_PLAN.md) for the detailed commercial model.

## Procurement / market-offer module

Build sourcing as a standalone backend module rather than coupling it to the Windows launcher. The initial research target is G2G or other permitted suppliers.

Conceptual pipeline:

```text
game title
-> supplier search/discovery
-> normalize candidate offers
-> extract structured account/game facts
-> filter/rank viable low-cost offers
-> compare with Steam Argentina reference price
-> apply risk + margin + pricing rules
-> optional LLM Spanish presentation text
-> admin review / gameAccess offer / external-channel candidate
```

Structured facts and prices must be extracted and validated deterministically where possible. An LLM may translate/summarize verified facts into customer-readable Spanish, but must not invent ownership, transferability, included games, guarantees or price facts.

Pricing should maximize sustainable contribution margin while remaining meaningfully competitive with the relevant legitimate purchase alternative. Supplier/platform terms and account-transfer rules must be checked before automating purchasing, resale or external marketplace publication.

## Repository architecture

```text
gameAccess/
├─ apps/
│  ├─ api/       prototype backend; evolves into hosted central service
│  ├─ desktop/   React + Vite + Tauri 2 Windows customer application
│  └─ launcher/  earlier Windows/Tkinter experimental harness
├─ docs/
│  ├─ PRODUCT_PLAN.md
│  └─ architecture.md
├─ TODO.md       centralized prioritized implementation queue
├─ skill.md      accumulated implementation/research knowledge
└─ README.md     project direction + current handoff/status
```

### `apps/api`

Current responsibilities include catalog, Steam Store metadata/cache, credits prototype, provider-account inventory, availability, timed leases and administrative inventory synchronization. In production this is a **hosted service**, not a companion localhost process for the desktop app.

### `apps/desktop`

The intended consumer product. React/Vite/Tauri provides the streaming-style catalog and native Windows integration. It should ultimately ship as a normal Windows executable/installer with no separately managed local backend.

### `apps/launcher`

Earlier experimental Windows harness used to validate Steam/session/account-selection behavior. Useful findings should migrate behind proper native adapters; this is not the intended final UI.

## Current state — 2026-08-28

### Present/prototyped

- FastAPI + SQLite backend prototype.
- Game catalog and Steam metadata adapter/cache.
- Provider account/inventory model.
- Availability and timed lease mechanics.
- React/Vite/Tauri desktop application and streaming-style catalog.
- Basic wallet/fichas concepts.
- PLAY / DOWNLOAD UI actions.
- Experimental local Windows Steam launcher/session work.
- Product/business and architecture documentation.

### Still to prove/build

- Single packaged Windows application with local API dependency removed.
- Discovery/unification of multiple local Steam identities and owned libraries.
- Clear Owned / Buy on Steam / gameAccess access states.
- Central hosted backend reachable across the Internet.
- Queue/reservation/notification lifecycle.
- End-to-end reliable provider session lifecycle and cleanup.
- Per-game compatibility matrix and save continuity.
- Production authentication and immutable wallet ledger.
- Payments/subscriptions/trials.
- Demand telemetry and procurement engine.
- Admin web application.
- Supplier integration and offer normalization.
- Production-grade security/revocation.
- Cloud fulfillment.

**The next stage is an Internet-connected live-development system, not production:** packaged Windows client + hosted development backend + lightweight test persistence + admin web UI. The API contract should survive the later migration to production persistence/hosting.

## Immediate development priorities

`TODO.md` is the authoritative prioritized work queue. At a high level the sequence is:

1. Prove constraints that could invalidate fulfillment assumptions (Steam regional rules, Families applicability, session behavior).
2. Convert the desktop into a self-contained Windows application and separate local/native responsibilities from remote/shared responsibilities.
3. Implement local Steam-account/library discovery and unified access-state UX.
4. Harden the central entitlement allocator and implement waitlists/reservations.
5. Put the backend on a stable Internet-accessible development environment and add the admin UI.
6. Prove one complete real Play -> cleanup -> lease-release lifecycle.
7. Add demand telemetry and the standalone sourcing/pricing module.
8. Harden wallet/payments only after access mechanics and economics are demonstrated.

## Product/architecture rules

- The customer interacts with **games**, not raw provider accounts.
- One customer-facing Windows executable; no separately managed localhost server in production.
- Shared truth, money, scarce resources and authorization live on the central backend.
- Windows/Steam/process/filesystem operations live in the desktop/native layer.
- Admin tooling uses the same backend, not a parallel data model.
- Owned/local access and paid gameAccess access must always be distinguishable to the customer.
- Download/preparation and entitlement are separate concepts.
- A SteamID is identity, not proof of ownership/license.
- Do not bypass Steam DRM, fabricate entitlements, collect Steam Guard secrets as a shortcut, manipulate regions, or rely on sharing mechanisms outside their permitted use.
- Customer machines are untrusted endpoints.
- Inventory acquisition follows demonstrated demand/economics.
- The legacy Tkinter launcher is an experimental harness only.

## Development quick start

Desktop/Vite:

```bash
cd apps/desktop
npm install
npm run dev
```

Tauri:

```bash
cd apps/desktop
npm install
npm run tauri dev
```

Prototype API:

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The localhost API is a **development convenience only**. Production/live-test desktop builds should target the configured hosted backend.

## Documentation map

Read in this order when taking over the project:

1. `README.md` — direction, architecture and handoff.
2. `TODO.md` — authoritative next work, priority ordered.
3. `docs/PRODUCT_PLAN.md` — detailed product/business model.
4. `docs/architecture.md` — technical boundaries.
5. `skill.md` — living Steam/session implementation research.

Update `skill.md` when technical Steam/session facts change. Update this README when product direction or implementation status changes. Keep `TODO.md` current whenever work is completed, reprioritized or newly discovered.

## Handoff summary

**What are we building?** A game-centric Windows application that combines the user's existing Steam access with clearly labeled optional paid gameAccess fulfillment.

**What is the architecture?** One native desktop product connected to a hosted central backend, plus an operator web application using that same backend.

**What is the next milestone?** A live-development environment where a packaged Windows client discovers local Steam access, communicates with the hosted allocator, shows Owned/Steam/gameAccess choices, can queue for scarce capacity, and completes one reliable real-game session lifecycle.

**What should not happen next?** Do not prematurely add production payments, buy broad inventory, assume Steam Families can be used as a generic fulfillment mechanism, or attempt automated Steam-region changes.