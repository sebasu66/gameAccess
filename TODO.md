# gameAccess — Central TODO

> **Authoritative prioritized implementation queue**  
> Last reviewed: 2026-08-28
>
> Keep this file ordered by priority. When a task is completed, mark it `[x]` and add a short result/commit note where useful. New work should be inserted according to dependency/priority rather than simply appended.

## P0 — Validate blocking assumptions

- [ ] **Steam Families applicability study.** Test/document current eligibility, household/family restrictions, invitation/cooldown behavior, game opt-outs, simultaneous-copy behavior and whether it can legitimately improve UX for a user's own eligible family accounts. Do not build fulfillment around it until validated.
- [x] **Check automated Steam store-country change assumption.** Result: do not implement an Argentina-region switcher. Valve requires store country to reflect actual residence; a legitimate change after moving is completed through Steam purchase flow with a local payment method and is currently limited to once every 3 months. No documented Steamworks consumer API was found for arbitrarily setting store country.
- [ ] **Revalidate provider/account transfer model and supplier/platform terms** before treating dedicated inventory as transferable customer ownership. Keep `private/dedicated access` distinct from `account ownership/transfer` in the domain model.

## P1 — Desktop architecture

- [ ] Make `apps/desktop` build/install as the single customer-facing Windows application (`gameAccess.exe` / installer).
- [ ] Remove production dependency on a separately running localhost FastAPI process.
- [ ] Classify existing API calls: machine-local operations move behind Tauri/native adapters; shared/global operations remain central backend calls.
- [ ] Add environment/config handling for development backend URL vs later production backend URL.
- [ ] Preserve browser/Vite mode only as a development convenience.

## P1 — Local Steam integration and unified library

- [ ] Detect Steam installation reliably on Windows.
- [ ] Discover Steam users/accounts already known on the local machine using supported/non-secret local state.
- [ ] Discover installed games and determine available ownership/library information per local Steam identity as reliably as possible.
- [ ] Build a unified game-centric local model across multiple local Steam users.
- [ ] Clearly classify each game/access path: `OWNED_LOCAL`, `BUY_STEAM`, `GAMEACCESS_SHARED`, `GAMEACCESS_PRIVATE` (names may evolve).
- [ ] For owned games, select/use the appropriate local Steam identity without involving paid gameAccess allocation.
- [ ] For unowned games, expose a normal Buy on Steam action that exits the gameAccess commercial flow.
- [ ] Keep ficha/token balance persistently visible in the customer UI.

## P1 — Central backend / entitlement allocator

- [ ] Treat `apps/api` as the seed of the hosted central service, not a desktop companion process.
- [ ] Define stable API contracts for customer identity, catalog, fichas, provider profiles, entitlements, availability, leases and sessions.
- [ ] Ensure allocation is authoritative/server-side and concurrency-safe.
- [ ] Model provider account -> contained games/entitlements explicitly.
- [ ] Model shared vs dedicated/private inventory as different entitlement/product types.
- [ ] Implement lease expiration/release and failure recovery.
- [ ] Keep prototype persistence simple for live testing (SQLite acceptable); design repository/storage boundary so it can migrate to PostgreSQL later.

## P1 — Waitlist / reservation UX

- [ ] Add per-game server-side waitlist when compatible shared capacity is exhausted.
- [ ] Define deterministic queue ordering and cancellation.
- [ ] When capacity frees, create a short bounded reservation for the next eligible user.
- [ ] Deliver desktop notification with direct **PLAY NOW** action.
- [ ] Expire an unclaimed reservation and advance the queue automatically.
- [ ] Show queue/wait state clearly in the game detail UI.
- [ ] Record waitlist joins, wait duration, abandonment and conversion as demand telemetry.
- [ ] Allow a separate **GET PRIVATE ACCESS / SKIP THE WAIT** offer only when legitimate dedicated sourcing exists.

## P2 — Internet live-development environment

- [ ] Prepare backend to run independently from the desktop checkout.
- [ ] Import/deploy the backend to an Internet-accessible development environment (Replit is the current candidate, but architecture must remain host-independent).
- [ ] Establish stable DEV backend URL and configuration.
- [ ] Create a web admin application against the same backend/API.
- [ ] Admin: provider profiles/accounts.
- [ ] Admin: games/licenses/entitlements and account contents.
- [ ] Admin: availability, active leases, queues and reservations.
- [ ] Admin: customers and ficha balances for test operation.
- [ ] Admin: disable/quarantine broken inventory.
- [ ] Test two or more Windows clients against the same hosted backend.

## P2 — End-to-end Steam session lifecycle

- [ ] Select one representative supported Steam game for the reference flow.
- [ ] Prove: request -> allocation -> local preparation -> launch -> running session -> exit detection -> cleanup -> lease release.
- [ ] Formalize provider/session adapter interface and migrate useful behavior from `apps/launcher`.
- [ ] Handle failure/restart/timeout without leaving capacity permanently leased.
- [ ] Build per-game compatibility records: external launcher/account, Family Sharing eligibility, SteamID-bound state, save locations, Steam Cloud behavior and cleanup requirements.
- [ ] Design/test customer save continuity where technically valid.

## P2 — Steam Families usability experiment

- [ ] Using only accounts genuinely eligible under Valve's current rules, create/test a Steam Family manually first.
- [ ] Verify whether the primary account sees shareable games from the second account without switching Steam identity.
- [ ] Verify saves, achievements, simultaneous use and multiple-copy selection behavior.
- [ ] Identify games that opt out or otherwise fail the desired experience.
- [ ] Only after policy + behavior validation, decide whether any supported Family-management assistance belongs in gameAccess.

## P3 — Demand telemetry and Demand Engine

- [ ] Record search, no-result search, game-page view, download intent, install, Play attempt, successful allocation, blocked Play, waitlist join, private-access interest and completed session.
- [ ] Aggregate unique users, concurrency, occupancy and unmet demand per game/time window.
- [ ] Build opportunity score combining demand, blocked plays, supplier price/depth, expected margin and inventory utilization.
- [ ] Surface procurement recommendations in admin UI.

## P3 — Standalone supplier / offer intelligence module

- [ ] Keep supplier discovery/pricing independent from the Windows launcher.
- [ ] Research permitted/robust G2G data-access approach and current terms before automating crawling.
- [ ] Search offers by game and normalize candidate listings.
- [ ] Extract structured facts: price, included games, seller/reputation signals, delivery/transfer claims and restrictions.
- [ ] Rank roughly the 10 cheapest **viable** offers rather than blindly the 10 lowest prices.
- [ ] Obtain relevant Steam Argentina/reference purchase price through supported sources.
- [ ] Implement deterministic pricing/margin rules.
- [ ] Use an LLM only to translate/summarize verified structured facts into Spanish customer copy; never let it invent commercial facts.
- [ ] Generate proposed gameAccess private-access offer for admin review.
- [ ] Later evaluate external marketplace publication (e.g. Mercado Libre) separately against its current policies/API and economics.

## P4 — Wallet and commercialization hardening

- [ ] Replace prototype credit mutation with immutable ficha ledger.
- [ ] Define ficha packages/top-ups.
- [ ] Implement real payment-provider integration with idempotency/webhooks/refunds.
- [ ] Define pay-per-use charging rules and reservation/refund behavior.
- [ ] Later define subscription vs one-off top-up economics.
- [ ] Later implement trial lifecycle only after core access mechanics work.

## P5 — Production readiness (not current milestone)

- [ ] Production authentication/authorization.
- [ ] PostgreSQL or selected production datastore migration.
- [ ] Secrets management and provider-session revocation strategy.
- [ ] Observability, audit logs, backups and disaster recovery.
- [ ] Rate limiting/abuse/fraud controls.
- [ ] Production hosting/deployment pipeline.
- [ ] Installer signing/update strategy for Windows client.
- [ ] Legal/platform-policy review before public commercial launch.
- [ ] Controlled first-customer beta.

## Deferred / explicitly not now

- Owned GPU/cloud fleet.
- Broad speculative inventory purchasing.
- Fully automated purchasing/repricing before demand economics are demonstrated.
- Automatic Steam region manipulation.
- Treating Steam Families as a generic account-pooling workaround.
