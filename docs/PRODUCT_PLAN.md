# gameAccess — Product & Business Plan

> Living, self-contained product document. It is written for someone who has never seen the conversations that originated the project. It should explain the business model, product behavior, rationale, constraints, risks, and intended evolution rather than functioning merely as a checklist.

## 1. Product vision

gameAccess is intended to make accessing PC games feel closer to Netflix, Xbox Game Pass, or a modern streaming service than to buying and managing provider accounts. The customer interacts with **games**, while provider accounts, license pools, sourcing, Steam identities, cloud providers, and lease mechanics remain backend implementation details.

The application should be artwork-first and immediately understandable: browse a game, download it, see whether access is available, and press **PLAY**. A user should not need to understand why a particular game is being fulfilled through one provider account, another account, a cloud service, or eventually owned infrastructure.

The project starts under an important economic constraint: it should require little or almost no capital before proving demand. The initial business therefore combines low-cost sourcing and just-in-time fulfillment with a very small amount of inventory for products where immediate availability demonstrably increases sales. Expensive owned cloud-gaming infrastructure is a possible later evolution, not a prerequisite.

## 2. The product abstraction: games rather than accounts

A game can eventually expose one or more ways to play: local temporary access, purchase/permanent transfer where applicable, cloud play, inclusion in a subscription benefit, or promotional/reward-funded access. These are fulfillment methods behind a common game-centric UI.

A customer requesting FC, Cyberpunk, No Man's Sky, or another title should not normally see labels such as `Steam account #17`, `lease #4231`, G2G seller names, or cloud-provider identifiers. Those details belong in administrative and diagnostic interfaces.

This abstraction is strategically important because it lets gameAccess change suppliers and fulfillment mechanisms without forcing the customer to learn a new product each time.

## 3. Netflix-style frontend

The consumer frontend should eventually replace the current utilitarian prototype launcher. The target experience is a polished desktop/living-room application with large artwork, cinematic game pages, keyboard/mouse and controller navigation, and rows such as **New & Popular**, **Available Now**, **Trending**, **Ready on Your PC**, **Included in Your Plan**, **Cloud Ready**, **Multiplayer**, and personalized recommendations.

Availability is itself useful consumer information. A card may say `2 copies available`, `last copy available`, or `currently busy`. This makes a finite pool understandable without exposing its implementation.

The game page should make the next action obvious: **DOWNLOAD**, **PLAY**, **TOP UP**, **TRY**, or **WAIT/NOTIFY ME**. Technical metadata should be secondary.

## 4. Download first; entitlement is checked at Play

A central UX principle is:

> **Discovery and downloading are free. Entitlement is checked at Play, not at Download.**

Where technically and legally possible, clicking a game should be enough to begin downloading/preparing its files even when the customer has no current access or insufficient credits. Large games can therefore be ready before the user decides to spend money.

When the game reaches `READY TO PLAY`, pressing PLAY triggers the availability and entitlement check. If the customer needs credits or a subscription, gameAccess presents the appropriate flow and returns directly to the pending Play action after payment.

Preloading must not fabricate or bypass a provider entitlement. Installation and authorization are separate concerns.

## 5. Internal currency and wallet

The normal in-product unit should be an internal virtual currency—working name **tokens/fichas**, final branding TBD—rather than constantly presenting ARS or USD prices.

The basic flow is:

`payment method -> top-up -> wallet tokens -> game access`

This makes repeat use much faster and supports bonus top-ups, promotional pricing, rewards, referrals, and expiring promotional balances. The UI can show a single token balance while the backend keeps an immutable ledger identifying whether value originated from a paid top-up, promotion, reward, referral, refund, or administrative adjustment.

Virtual currency should simplify the experience and enable promotions, not intentionally obscure the economic cost to the customer.

Top-up packages can reward larger purchases—for example, a larger package may contain proportionally more tokens than a small one. Exact exchange rates and bonuses are commercial variables and should not be hard-coded into the product model.

## 6. Subscription membership, top-up discounts, and free trial

A recurring subscription is a complementary revenue model rather than a replacement for tokens. A member can still spend tokens on games, but receives preferential economics and other benefits.

The most straightforward initial membership benefit is a **discount or bonus on every top-up**. For example, the same payment could purchase more tokens for a subscriber than for a non-subscriber. Other benefits can later include promotional token drops, extended guarantees, priority when capacity is scarce, exclusive offers, or lower token prices for selected inventory.

This has an important business property: subscription revenue becomes recurring while actual game consumption remains metered. gameAccess does not have to promise an unlimited Netflix-style catalog for a fixed monthly fee.

### Trial with payment method

The membership can offer a short free trial—working example: **3 days**—when the customer registers a valid payment method and explicitly accepts the recurring subscription terms.

During the trial, the user can experience the service and membership benefits, but free game access can be **capacity-limited**. Paid customers and already-purchased access should not be displaced merely to satisfy unlimited trial demand. Trial availability can therefore be drawn from spare capacity, selected promotional games, or a defined trial allowance.

The lifecycle is conceptually:

`start trial -> payment method authorized/stored by payment provider -> 3-day trial -> cancel before renewal = no subscription charge -> remain subscribed = first recurring charge at renewal`

The checkout must clearly disclose the trial duration, the amount/cadence of the subsequent charge, and how to cancel. The payment provider—not gameAccess source code—should hold sensitive card credentials. The system needs explicit subscription states such as `trialing`, `active`, `cancel_at_period_end`, `past_due`, `canceled`, and appropriate webhook/idempotency handling.

The trial is valuable not only as marketing but as a conversion measurement: we can observe trial start -> actual play -> first top-up -> paid renewal -> subsequent retention.

## 7. Promotions and reward-funded play

Tokens make promotional mechanics straightforward: first-top-up bonuses, happy hours, weekend events, token cashback, referral rewards, promo codes, giveaways where legally appropriate, and expiring promotional balances.

Users may also earn promotional tokens through legitimate monetizable actions such as rewarded advertising, surveys, referrals, sponsored discovery, or publisher-sponsored trials. The economic rule is simple: expected net revenue from an action must exceed the expected marginal cost of the reward after fraud, support, and payment costs.

Cheap or already-amortized inventory is especially suitable for reward-funded access. New/high-demand games should consume more capacity and therefore generally more tokens.

## 8. Provider-account and access pool

The backend models provider accounts and entitlements as resources. A provider account may contain several games and, when required by the underlying provider, may be leased exclusively to one active customer/session.

Conceptually:

`customer requests game -> allocator finds compatible free entitlement/account -> lease -> session -> release`

Core domain concepts are the game catalog, provider account, entitlement/copy, customer identity, lease, session, availability, customer save/profile, wallet, and ledger.

The customer's gameAccess identity must remain independent of whichever provider identity happens to service a session.

## 9. Customer saves and continuity

The intended experience is that progress belongs to the gameAccess customer, not to an arbitrary provider account. Per-game adapters can eventually locate saves, restore the customer's version before play, prevent cross-customer contamination, capture progress afterward, and version it under the customer's profile.

This cannot be assumed to work universally. Some games bind progression to SteamID or a separate publisher account. Each game therefore needs compatibility metadata and real testing.

## 10. Demand sensing: the users tell us what inventory to buy

Inventory purchasing should be driven by **observed unmet demand**, not merely by intuition about which games seem popular.

gameAccess should record the entire intent funnel while respecting appropriate privacy boundaries:

`search -> search result/no result -> game-page view -> download intent -> installation -> Play attempt -> successful allocation OR blocked by no availability -> wait/abandon -> actual session`

These events have different predictive value. A search is weak interest; downloading 100 GB is substantially stronger intent; pressing PLAY while every copy is occupied is direct evidence of demand that the business failed to monetize.

### Example: Cyberpunk shortage

Suppose gameAccess has two usable Cyberpunk copies and five customers attempt to play during the same period. Two sessions are fulfilled and three customers are blocked by inventory. The system should expose this as **three units of immediately unmet demand**, rather than merely reporting that both licenses are busy.

If acquisition economics remain favorable, that can trigger a high-priority procurement recommendation or alert. The operational objective for hot inventory can be to acquire and make another compatible copy available **within roughly one hour**, allowing waiting customers to be notified and converted while their intent is still fresh.

The system should not blindly purchase one copy for every blocked click. Procurement decisions combine concurrent unmet demand, unique customers, repeated attempts, historical conversion, occupancy, current acquisition price, supplier availability, expected margin, and the probability that demand persists after the current spike.

### Installation as a leading indicator

Because downloading is allowed before payment, installations become a valuable forward-looking signal. If 30 customers install Cyberpunk this week but gameAccess owns capacity for only three simultaneous users, the business can increase inventory **before** all 30 press PLAY.

Likewise, searches for titles that are not in the catalog reveal completely unserved demand. An administrative demand view might report:

`Game X — 83 searches / 7 days — 31 unique interested users — 19 strong intents — inventory 0 — suggested acquisition: test 2 copies`

### Demand Engine

Architecturally this becomes:

`Telemetry -> Demand Engine -> Inventory/Procurement`

The Demand Engine should calculate an opportunity score using signals such as unique demand, blocked Play attempts, installations, occupancy, recent trend acceleration, acquisition/replacement cost, expected selling price/token consumption, supplier depth, and expected contribution margin.

A cheap account is not an opportunity merely because it is cheap. It becomes an opportunity when **we have evidence that customers want the capacity it contains**.

Demand telemetry also feeds merchandising: trending rows, recommendations, promotions for underused inventory, and alerts when a popular title is close to saturation.

## 11. Availability, capacity, and dynamic pricing

Inventory is capacity, not merely a list of accounts. Per game, gameAccess should understand copies/entitlements, active leases, available copies, blocked demand, occupancy by time of day, acquisition/replacement cost, support/replacement rate, and profitability.

Future token pricing can respond to genuine capacity conditions—for example, off-peak promotions for underused inventory—while avoiding surprising or deceptive pricing.

## 12. Low-capital sourcing and the G2G -> Mercado Libre experiment

The initial commercial experiment is deliberately capital-light. gameAccess can discover source listings, normalize the games contained in an account, compare target-market demand and competition, estimate fees/risk, and produce an opportunity score.

For a very small set of exceptionally high-demand games, maintaining approximately one immediately deliverable unit can be worthwhile. When it sells, the system recommends or initiates replenishment according to configured safeguards.

For the long tail, inventory should preferably be acquired just in time after a customer order when supplier response and the promised fulfillment SLA make that viable. The business must not promise instant delivery when the upstream supplier cannot actually guarantee it.

Source evaluation eventually includes price, seller history/reputation, alternative suppliers, target-market demand, competition, fees, expected replacement/refund cost, margin, trend freshness, bundle value, and compatibility with supported access methods.

## 13. Bundles and merchandising

A provider account containing several desirable games may have much greater perceived value as a curated bundle than as a generic account. The opportunity engine should understand account contents and estimate merchandising strategies such as an `AAA PACK — Cyberpunk + Hogwarts + RDR2 + No Man's Sky`, rather than simply multiplying source cost by a fixed markup.

## 14. Cloud gaming and owned infrastructure are later fulfillment options

A large local fleet should not be purchased before recurring demand is proven. Future fulfillment may use GeForce NOW or other cloud services where commercially workable, full cloud PCs, GPU providers plus streaming software, dedicated gameAccess machines, or a hybrid of owned base capacity and cloud overflow.

Cloud play should ultimately appear to the customer as another way to press PLAY, not as an entirely separate product that requires understanding infrastructure.

## 15. Security and provider sessions

Provider credentials should remain outside the normal UI. Provider adapters should prefer supported real authentication/session mechanisms and centrally manage leases. A SteamID is an identity, not a license; entitlement and identity are separate concerns.

A customer-controlled Windows PC is an untrusted endpoint. If reusable provider session material must execute there, absolute secrecy cannot be guaranteed against a sufficiently technical administrator. The architecture therefore needs sensible revocation, replacement, and risk economics rather than assuming client-side secrets are mathematically inaccessible.

`skill.md` contains the accumulated Steam/session research and should be updated as technical facts are validated.

## 16. Mercado Libre and channel risk

Mercado Libre can provide initial discovery and trust, but account reputation is itself a valuable business asset. Product selection and fulfillment therefore need to optimize cancellation rate, delivery SLA, complaints, refunds, replacement incidents, support burden, and platform-policy risk in addition to gross margin.

Short-term profit should not be optimized in a way that predictably destroys the acquisition channel.

## 17. What the current prototype is proving

The repository currently contains an early FastAPI/SQLite broker, catalog, credits, provider-account pool, timed leases, and a basic launcher. Its purpose is to validate domain mechanics, not to represent the intended consumer experience.

The next technical validations concern real provider/session lifecycle behavior, entitlement compatibility, expiration/release, session cleanup/revocation, and per-game compatibility. In parallel, an opportunity/demand layer should begin measuring what inventory would actually be worth acquiring.

Once a demonstrable Play/session flow exists, the utilitarian launcher should be replaced with the polished streaming-style frontend described above. A web-tech desktop shell such as React + Tauri is a strong candidate because it allows rich animation and catalog UI without forcing the backend into the desktop process.

Real-money integration requires a proper immutable wallet ledger, top-ups, payment-provider webhooks, subscription/trial lifecycle, refunds, bonus rules, and idempotency before accepting production payments.

Automation of purchasing, repricing, replenishment, and fulfillment should follow demonstrated economics rather than precede them.

## 18. Metrics that determine whether the business works

Technical success is insufficient. The business needs to measure acquisition and retention: listing impressions to inquiries, inquiries to purchases, trial starts to actual plays, trial to paid subscription conversion, first purchase to second purchase, top-up frequency, average revenue per paying user, contribution margin, supplier fulfillment latency, replacement/refund rate, support time, inventory occupancy, unmet demand, unused inventory, retention, and complaint rate.

Repeat use is especially important. A customer who returns, consumes remaining tokens, tops up again, or keeps a subscription is substantially more valuable than a one-off arbitrage sale.
