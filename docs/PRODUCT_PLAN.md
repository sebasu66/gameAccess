# gameAccess — Product & Business Plan

> Living document. Update this as product, technical, market, and operational discoveries are validated.

## 1. Product vision

gameAccess should feel like a streaming platform for games rather than a reseller dashboard or a clone of Steam.

The customer opens one attractive application, browses large game artwork and collections, downloads games with one click, and sees a simple **PLAY** action when access is available. Provider accounts, Steam identities, account pools, G2G sourcing, cloud providers, and lease mechanics are implementation details and should normally be invisible.

Reference UX: Netflix / Xbox Game Pass / GeForce NOW, with an even simpler purchase and play flow.

## 2. Initial business constraint

Start with little or almost no capital committed before a sale. Do not build a fleet of gaming PCs before demand has been demonstrated.

Initial strategy:

1. Discover high-demand games and bundles.
2. Source low-cost accounts/access only when economics are attractive.
3. Use a very small amount of hot stock only for exceptionally high-demand products where immediate delivery matters.
4. For the long tail, prefer just-in-time acquisition after a customer order where operationally viable.
5. Use Mercado Libre initially as a demand/acquisition channel while building the gameAccess product and brand.
6. Measure actual conversion, replacement rate, support cost, repeat purchase, and margin before scaling inventory or infrastructure.

## 3. Product abstraction

The user should interact with **games**, not provider accounts.

A game can eventually expose one or more ways to play:

- Download / local access
- Temporary access
- Purchase / permanent transfer where applicable
- Cloud play
- Included in a plan
- Promotional/free access

Backend providers may include Steam accounts, account pools, family-access arrangements where applicable, GeForce NOW/cloud services, other storefronts, and later our own infrastructure. The UI should not leak these details unless necessary.

## 4. Netflix-style frontend

Replace the current Tkinter launcher once the broker MVP is validated.

Desired home experience:

- Hero game / current promotion
- New & Popular
- Available Now
- Trending
- New Releases
- Ready on Your PC
- Included in Your Plan
- Cheap / low-credit games
- Cloud Ready
- Multiplayer
- Controller Friendly
- Recommended For You

Game cards should prioritize artwork and immediate actions rather than technical metadata.

Example state:

- `FC — PLAY NOW — 120 tokens / 2 h`
- `Cyberpunk — 2 copies available`
- `Hogwarts — busy, estimated availability 12 min`
- `No Man's Sky — READY ON THIS PC`

Provider account labels, Steam account numbers, lease IDs, and sourcing information belong in admin/debug interfaces only.

## 5. Credits / token economy

The consumer-facing economy should use an internal virtual currency rather than constantly showing ARS/USD prices.

Working term: **tokens / fichas** (final brand/name TBD).

Flow:

`payment method -> top-up -> wallet tokens -> game access`

Users top up once through supported payment methods. Confirmed payments credit the wallet immediately. Games and access durations are priced in tokens.

Advantages:

- very fast repeat purchases;
- simple promotional pricing;
- bonus tokens on larger top-ups;
- rewards and referrals;
- promotional expiration rules;
- easier dynamic pricing without constantly changing displayed fiat prices;
- remaining balance encourages repeat use.

Internally maintain a proper ledger rather than only a mutable balance.

Suggested balance origins:

- `paid`
- `promotion`
- `reward`
- `referral`
- `refund`
- `admin_adjustment`

The UI can display one token balance while the backend retains provenance, expiration, and restrictions.

Do not use virtual currency to intentionally obscure the real economic cost from customers.

## 6. Top-ups and promotions

Potential mechanics:

- first top-up bonus;
- larger top-up bonus tiers;
- happy-hour discounts;
- weekend promotions;
- new-release promotions;
- token cashback;
- referral rewards;
- daily/weekly rewards;
- promotional codes;
- giveaways/sweepstakes where legally and operationally appropriate;
- expiring promotional tokens.

Example only (not final pricing):

| Top-up | Tokens | Bonus |
|---|---:|---:|
| Small | 500 | — |
| Medium | 1,100 | +10% |
| Large | 2,400 | +20% |
| XL | 5,500 | +30% |

## 7. Earn-to-play / rewarded actions

Users may optionally earn promotional tokens through legitimate monetizable actions.

Potential sources:

- rewarded advertising;
- surveys;
- legitimate CPA offers;
- referrals;
- sponsored game discovery;
- publisher-sponsored trials/events.

Rule: expected net revenue from the action must exceed the expected marginal cost of the reward, with fraud/chargeback/support allowances.

Cheap or already-amortized inventory can be particularly suitable for reward-funded access. Popular/new AAA access should consume more tokens.

## 8. Download first, entitlement at Play

Core UX rule:

> **Discovery and downloading are free. Entitlement is checked at Play, not at Download.**

Where technically and legally possible, a user should be able to click game artwork and begin downloading/preparing game content even with insufficient tokens.

The installed state can become:

`READY TO PLAY`

When the user presses PLAY, gameAccess checks entitlement/availability and, if necessary, presents a top-up flow. After payment, return directly to the pending Play action rather than making the customer find the game again.

This also enables preloading large games before a planned purchase/access period.

Installation/preloading must not fabricate or bypass a provider entitlement; actual authorization remains a separate Play-time operation.

## 9. Account/access pool

The backend models provider accounts as resources. A provider account can own/access multiple games and may be leased exclusively where required.

Example:

`Customer -> requests FC -> allocator -> compatible free provider account -> temporary lease -> play -> release`

Important abstractions:

- game catalog;
- provider account;
- game entitlement/copy;
- availability;
- lease;
- customer identity;
- customer save/profile;
- session;
- wallet/ledger.

The customer identity must remain independent of whichever provider account happens to service a session.

## 10. Saves and customer continuity

A customer's progress should belong to their gameAccess identity, not conceptually to a provider account.

Longer-term adapters may:

1. identify game-specific save locations;
2. restore the customer's save before launch;
3. prevent accidental cross-customer save contamination;
4. capture the save after a session;
5. store/version it under the gameAccess customer profile.

Some games bind progress to SteamID/external publisher accounts and will require explicit compatibility testing. Maintain a per-game compatibility database.

## 11. Availability and dynamic pricing

Inventory is capacity, not merely a list of accounts.

Track per game:

- copies/entitlements;
- currently leased copies;
- free copies;
- historical occupancy;
- peak/off-peak demand;
- acquisition/replacement cost;
- expected support/replacement rate;
- profitability.

Future pricing can respond to availability and demand in tokens, e.g. off-peak discounts or promotions for underused inventory. Avoid surprising or deceptive pricing.

## 12. Sourcing / G2G -> Mercado Libre experiment

Initial low-capital opportunity discovery:

`G2G listings -> normalize game/account contents -> compare demand/competition -> calculate costs/fees/risk -> opportunity score`

Prefer high-demand, recent/popular games and bundles with meaningful price gaps.

Two inventory modes:

### Hot stock

Keep approximately one immediately deliverable unit for a small number of very high-demand products. After sale, replenish.

### Just-in-time catalog

Do not pre-purchase long-tail inventory. Acquire after an order when the sourcing/fulfillment SLA makes that viable. Do not promise instant delivery when supplier response cannot actually be guaranteed.

Opportunity scoring should eventually include:

- source price;
- alternative suppliers;
- seller reputation/history;
- target-market competition;
- apparent demand;
- fees/taxes/payment cost;
- expected replacement/refund cost;
- net margin;
- product freshness/trend;
- bundle value;
- cloud compatibility where relevant.

## 13. Bundles

A source account containing several desirable games may be worth more as a consumer-facing bundle than as a generic account.

Example presentation:

`AAA PACK — Cyberpunk + Hogwarts + RDR2 + No Man's Sky`

The opportunity engine should understand account contents and estimate the best merchandising strategy rather than applying a simple source-price multiplier.

## 14. Cloud gaming / future expansion

Do not invest in a large local GPU/PC fleet before demand is proven.

Potential later providers/infrastructure:

- GeForce NOW or other cloud-gaming services where the commercial model is workable;
- full cloud PCs;
- GPU providers plus streaming stack;
- dedicated gameAccess PCs;
- hybrid owned capacity + cloud overflow.

Potential eventual product:

`game -> click -> ready-to-play local or cloud session`

Cloud availability should be another backend fulfillment method, not a separate consumer experience.

## 15. Security / provider sessions

Keep provider credentials out of normal UI.

A future provider adapter should prefer supported real session/authentication flows and manage account leases centrally. Do not treat a SteamID as a license: identity and entitlement are separate concepts.

A customer-controlled Windows machine is an untrusted endpoint. Absolute secrecy of reusable provider session material cannot be guaranteed if that material must execute on a machine the customer administrates. Design replacement/revocation economics accordingly.

See `skill.md` for accumulated Steam/session research and technical findings.

## 16. Mercado Libre risk

Mercado Libre reputation/account health is an important business asset. Product selection and fulfillment should optimize not only gross margin but also:

- cancellation rate;
- delivery SLA;
- complaints;
- refunds;
- replacement incidents;
- support burden;
- platform-policy risk.

Do not optimize short-term margin in a way that predictably destroys the acquisition channel.

## 17. MVP roadmap

### Phase 0 — current broker prototype

- FastAPI backend
- SQLite
- catalog
- credits
- provider account pool
- timed leases
- basic launcher

### Phase 1 — validate provider/session mechanics

- experimental Steam provider adapter
- supported login/session flow research
- lease lifecycle
- expiration/release
- session cleanup/revocation tests
- per-game compatibility metadata

### Phase 2 — opportunity radar

- G2G/source ingestion
- Mercado Libre demand/competition inputs
- normalization
- margin calculator
- opportunity scoring
- manual approval before purchase/publication

### Phase 3 — consumer frontend

Replace Tkinter with a polished Netflix/Game-Pass-style desktop frontend. Candidate stack: React + Tauri (preferred to evaluate) or Electron.

Requirements:

- artwork-first catalog;
- gamepad/keyboard/mouse navigation;
- hero sections and carousels;
- install/download state;
- availability state;
- Play flow;
- wallet/top-up UX;
- promotions;
- responsive living-room-friendly layout.

### Phase 4 — wallet/payments

- immutable ledger
- paid/promotional/reward balances
- top-ups
- payment webhooks
- bonus rules
- refunds/adjustments
- promotional expiration

### Phase 5 — saves/profiles

- game adapters
- backup/restore
- conflict handling
- compatibility database

### Phase 6 — automation

Only after economics are validated:

- automatic repricing;
- replenishment recommendations;
- optional just-in-time purchasing with safeguards;
- fulfillment automation;
- dynamic inventory allocation;
- fraud/risk controls;
- demand forecasting.

### Phase 7 — cloud/owned infrastructure

Only after recurring demand justifies capital expenditure.

## 18. Metrics that decide whether to continue

Do not judge the project only by technical success.

Track:

- listing impressions -> inquiries;
- inquiries -> purchases;
- first purchase -> second purchase;
- token top-up frequency;
- average revenue per paying user;
- gross and contribution margin;
- supplier fulfillment latency;
- replacement/refund rate;
- support minutes per order;
- game occupancy/concurrency;
- unused inventory;
- customer retention;
- complaint rate.

Repeat purchase is especially important: a customer returning to spend remaining/top-up tokens is much more valuable than a one-off arbitrage sale.

## 19. Immediate next steps

1. Keep validating Steam/session control experimentally with low-value test accounts.
2. Build the opportunity radar before committing meaningful inventory.
3. Identify a very small initial set of high-demand games.
4. Keep hot stock minimal.
5. Define the token ledger properly before real money is accepted.
6. Replace the prototype UI with the streaming-style frontend once the underlying Play/session flow is demonstrable.
7. Continuously add validated discoveries to `skill.md` and update this plan when product decisions change.
