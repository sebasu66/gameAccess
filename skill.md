# gameAccess research skill

This file is the living knowledge base for the `gameAccess` project. Future work on this repository should read this file before changing architecture or implementing provider-specific behavior, and should append/update it when new technical, commercial, policy, or operational facts are discovered.

Last updated: 2026-09-04.

## Product thesis

`gameAccess` is a broker/launcher for low-capital access to games and gaming services. The first commercially realistic path is not owning a large cloud-gaming fleet; it is marketplace arbitrage and just-in-time fulfillment, especially G2G -> Mercado Libre, with only tiny hot-stock holdings for very high-demand titles.

Potential products include:

- reselling complete game accounts bought cheaply on G2G;
- bundles of multiple games contained in one account;
- cloud-ready bundles where a game account is already linked to a cloud gaming provider;
- temporary access to provider accounts through a broker/lease model;
- credits earned from legitimate rewarded ads, surveys, referrals, sponsored trials, or CPA offers and spent on access time;
- later, if demand is proven, managed cloud gaming or local GPU capacity.

The key business principle is just-in-time inventory: publish first, buy the supply only after a customer sale where practical. Maintain stock only for titles where immediate delivery materially improves conversion and the replacement cost is low.

## Current repository architecture

The repository currently implements a provider-neutral MVP:

- FastAPI backend + SQLite;
- users and credit ledger;
- games/catalog;
- provider account pool;
- account-to-game ownership mappings;
- exclusive time-bounded leases;
- expiration/release;
- desktop launcher prototype;
- an experimental Windows Steam remembered-account chooser adapter that uses visible UI Automation only.

The current provider adapter target remains:

```python
class ProviderAdapter:
    def prepare_install(self, game): ...
    def start_session(self, account, game, endpoint): ...
    def revoke_session(self, session): ...
    def health(self, account): ...
```

## Steam: identity, licenses, installation, and session separation

Important distinction: a SteamID/player identity is not the same thing as a Steam entitlement/license.

Nucleus Co-op and Steamworks emulators can sometimes assign a different SteamID to a game instance for profile/save/network separation. That does **not** create a legitimate Steam license for that SteamID. Steam can separately validate the account/session and whether it owns the AppID.

Therefore:

- assigning or masking a SteamID is useful for customer abstraction but does not grant access;
- a legitimate session still needs an account or supported licensing mechanism that has an entitlement to the AppID;
- do not design the product around modifying `steam_api64.dll`, Goldberg/SSE, fabricated entitlements, or DRM bypass;
- installation and entitlement are separate concerns: game files may exist locally, but execution of commercial content can still require an authenticated entitled session.

SteamCMD and Steam content infrastructure can be useful for installation/content management, but commercial depots normally still require a valid account/license. Dedicated servers and free content may permit anonymous access; paid games generally do not.

## Steam Families

Steam Families currently supports up to six members total. Members share eligible libraries, can play different games at the same time, and duplicate copies increase simultaneous capacity for the same title.

Example: if the family collectively owns five copies of a title, up to five family members may potentially use that title simultaneously, subject to the title supporting Family Sharing.

However, Steam Families is designed for a household, not a commercial rotating pool. A vacated family slot has a long cooldown before another person can occupy it. The commercially more interesting interpretation for this project is to keep the six Steam accounts as permanent family members owned/controlled by the operator, and potentially lease the use of those accounts rather than repeatedly adding/removing customers as family members.

Even then, Steam's Subscriber Agreement states accounts/subscriptions are personal and generally cannot be sold, rented, or charged for unless Valve expressly permits it. Treat any rental implementation based on consumer Steam accounts as high policy/platform risk and low-capital experimentation only, not infrastructure in which large irreversible capital should be sunk.

## Steam PC Cafe / site-license program

Valve has a Steam PC Cafe / site-license program with commercial packages and floating commercial licenses. This is conceptually close to the desired license-pool model:

- an operator buys commercial licenses;
- licenses are pooled;
- users can use their own Steam identities while consuming an available commercial license;
- multiple simultaneous sessions require multiple licenses;
- Steam also supports local content caching for this environment.

Not every game participates; publishers must expose a commercial package. The program is described around PCs on the licensed establishment/network. Remote-at-home use has not been established as permitted. Do not assume the Cafe program solves remote rental without explicit confirmation from Valve.

## Steam session control

The ideal UX is:

```text
customer logs into gameAccess
-> selects game
-> broker reserves an entitled provider account
-> launcher prepares local files/profile
-> Steam session is authorized
-> game launches
-> session expires
-> save is backed up
-> Steam/provider session is revoked/cleaned
-> account returns to pool
```

Do not pass Steam passwords in command-line arguments. `steam.exe -login user password` exists but exposing secrets via command line/process inspection is inappropriate for a customer-controlled endpoint.

Steam supports QR-code login through the Steam Mobile app / Steam Guard. This allows a new device to be authorized without typing the account password on that PC. Steam Mobile shows details about the login attempt and can approve/deny it.

Steam also exposes an Authorized Devices view in the mobile app, showing where the account is signed in and allowing access to be revoked. This makes supported device/session authorization and revocation the most promising direction for a real Steam adapter.

### Confirmed local remembered-account chooser behavior

A controlled Windows test on 2026-08-26 confirmed the following behavior for the currently installed Steam client:

- after Steam is returned to its sign-in/account-choice state, it can show a remembered-account chooser without asking for the password again;
- Windows UI Automation can read the text that is already visibly exposed by that chooser;
- each remembered account card exposed both a visible display name and a visible localized `Account name:`/`Nombre de la cuenta:` field;
- multiple remembered accounts were enumerated successfully without reading Steam credential files or reusable authentication material;
- the chooser can remain usable even when helper processes make a strict `steam.exe` shutdown timeout unreliable, so adapter logic should prefer observed visible chooser state over process shutdown alone;
- account switching can therefore target a remembered account by either its visible display name or its visible account/login name and click the corresponding visible account card.

Privacy/design rule: do **not** commit real customer/operator Steam account names into this public repository. Discover them locally at runtime and store any operator inventory mapping only in the local/runtime database.

The current launcher includes an operator inventory flow: discover remembered Steam accounts from the visible chooser, select one, declare which catalog games it owns, and sync only that local mapping to the gameAccess API. This removes the need to type account names manually while keeping credentials outside gameAccess.

Important security boundary: if Steam runs on a PC controlled by the customer, assume the endpoint is hostile. Anything written to disk or memory can potentially be inspected by an administrator/debugger. The goal is not mathematically perfect secrecy; it is to avoid intentionally disclosing credentials/recovery material and to make access revocable and operationally cheap to replace.

Protect especially:

- password;
- email credentials;
- Steam Guard / mobile-authenticator secrets;
- account recovery information;
- reusable session/auth tokens.

A SteamID/account name is not itself a strong secret. Hiding it in the normal UI is useful UX, but should not be relied upon as a security boundary.

If the customer somehow learns username + password but does not control the account email or Steam Guard, takeover becomes materially harder. Still, do not rely solely on that assumption; session/token theft on an already authorized endpoint remains relevant.

## Steam location / regional signals

Steam clearly uses network geography as one signal.

Valve's own Steam Mobile announcement says QR/login approval shows a map and the approximate geolocation of the device attempting to sign in. This demonstrates that Valve derives approximate login location for authentication/device review.

Steamworks documentation for transaction/fraud analysis exposes a `Country` signal representing the country from which the user is connecting for a purchase. Valve also recommends comparing that country against the user's Steam Wallet currency as an additional fraud/risk signal.

Steam account creation asks for a country of residence. Steam purchasing also has store country, wallet currency, billing/payment data, and transaction context.

Practical inference for `gameAccess`: do not assume Steam only sees the account's configured country. A pool account logging in from customers in distant regions can expose changing IP-based geography and device patterns even if the account's store country remains unchanged.

Valve's Subscriber Agreement explicitly prohibits IP proxying or other methods used to disguise residence to evade geographical content restrictions or geography-specific pricing. The project must not implement location masking for that purpose.

Relevant official/public sources:

- Steam Subscriber Agreement: https://store.steampowered.com/subscriber_agreement/
- Steam account creation / residence field: https://store.steampowered.com/join
- Steamworks transaction/fraud documentation: https://partner.steamgames.com/doc/features/microtransactions
- Steam Mobile / QR sign-in announcement and Authorized Devices behavior: https://store.steampowered.com/news/posts/?enddate=1668646446&feed=steam_blog

## Customer-local launcher security model

For a local launcher, separate customer identity from provider identity.

```text
gameAccess customer ID
-> lease
-> provider account ID
-> provider session
```

The customer should normally see only the gameAccess account and game catalog. The provider account label/SteamID can remain an internal implementation detail.

For Windows, a future provider/session helper may run as a separate Windows Service or privileged helper rather than embedding secrets into the GUI process. Local secrets should use OS-provided protection such as Windows DPAPI/Credential Manager where appropriate.

However, on a customer-owned PC with administrator access, no local secret can be guaranteed permanently unextractable. Design around revocation, limited leases, monitoring, replacement cost, and minimal stored secrets rather than pretending local encryption makes the client trustworthy.

## Save/profile portability

Do not rely on Steam Cloud as the sole customer-save model when rotating provider accounts. gameAccess should own the customer-level save abstraction.

Use game-specific adapters:

```text
SaveAdapter.backup(customer, game)
SaveAdapter.restore(customer, game)
SaveAdapter.clean_provider_profile(account, game)
```

Each compatibility record should eventually capture:

- save locations;
- whether save data is portable between Steam accounts;
- Steam Cloud behavior and whether it needs disabling/coordination;
- whether progress is bound to SteamID or an external publisher account;
- multiplayer/anti-cheat restrictions;
- launch dependencies (EA, Ubisoft, Rockstar, etc.);
- Family Sharing eligibility;
- cloud-gaming compatibility.

## Account-pool scheduling

Treat each provider account as a scarce resource with an exclusive lease in the first implementation.

Example:

```text
account_17
status = FREE
games = [FC, Cyberpunk, Hogwarts]

customer requests FC
-> reserve account_17
-> account_17 = LEASED
-> session ends
-> cleanup/revoke
-> account_17 = FREE
```

Do not assign the same Steam account to two customers simultaneously until real provider behavior has been proven safe and supported. Resource scheduling should be based on actual concurrent copies, not registered user count.

The long-term inventory model can track, per game:

- copies_total;
- copies_available;
- active_sessions;
- historical utilization;
- peak-hour utilization;
- replacement cost;
- expected revenue per hour/day;
- failure/replacement rate.

This allows the system to recommend when another copy/account is economically justified.

## Marketplace / arbitrage findings

The current low-capital commercial priority is G2G -> Mercado Libre Argentina.

Observed pattern: international account marketplaces can price prepared game accounts far below Argentine listings for similar access products. Mercado Libre adds local payment, trust, Spanish-language support, instructions, and delivery handling; those are real value layers rather than pure price duplication.

High-value categories to watch:

- newly released AAA games;
- annual sports titles such as EA Sports FC;
- games receiving a major update/expansion that causes a demand spike;
- multi-game accounts/bundles where the local perceived value is greater than the international account price;
- cloud-ready accounts where compatible games are already linked to a supported cloud service.

Use a scanner before fully automating fulfillment. Desired inputs:

- G2G listing price;
- seller reputation/sales history;
- alternate suppliers;
- account characteristics (platform, region, email changeability, online/offline, game list);
- Mercado Libre competitor price and apparent demand;
- fees/taxes/payment friction;
- expected warranty/replacement cost;
- net margin;
- popularity/new-release/update signals;
- cloud-provider compatibility.

A useful opportunity score should combine margin, demand, liquidity, supplier redundancy, and replacement/platform risk.

Do not promise "instant delivery" for just-in-time items unless stock exists. A safer catalog can have:

- hot stock: a few high-demand items physically/digitally held for immediate delivery;
- just-in-time catalog: bought only after the ML sale, with a longer stated delivery window;
- bundles: accounts with several valuable games priced as a package.

## Mercado Libre risk perspective

The durable asset is the marketplace seller account/reputation, not an individual cheap provider account. Operational design should prioritize minimizing complaints, refunds, delivery failures, misleading listings, and policy violations that could damage the Mercado Libre account.

A replacement guarantee can be modeled economically as an expected cost. Track failure rate and replacement cost rather than assuming it is zero.

Do not design flows intended to evade Mercado Libre fees for a transaction that originated on Mercado Libre. An independent store/brand may be built for separately acquired future customers, but protecting the ML account is strategically more valuable than squeezing one commission.

## Cloud gaming / cloud PCs

GeForce NOW works well technically in Argentina/LatAm for many users, and it can link supported Steam, Epic, Ubisoft, and Xbox/Game Pass libraries. This creates a potentially strong product: "game ready to play without a gamer PC."

However, consumer GeForce NOW / ABYA terms are personal/non-commercial and are not a wholesale/team pool by default. Treat shared/rented consumer subscriptions as policy risk. A suspended cloud account may be cheap to replace economically, but repeated provider enforcement can still create support/reliability problems.

Shadow PC is a full streamed PC rather than a mere compute terminal: users control a remote Windows gaming machine and can install launchers/games. Similar services exist. For owned infrastructure, Sunshine + Moonlight is a strong open-source low-latency streaming stack; Parsec is another practical remote-interactive option. Games on Whales/Wolf is relevant for multi-user game streaming on one host, but Windows/anti-cheat compatibility needs game-by-game validation.

Owning a fleet is not the current priority because it requires capital and concurrency capacity before demand is proven. Revisit only after low-capital marketplace activity produces recurring revenue and demand data.

## Reward credits

Credits can be earned from opt-in actions that actually generate revenue and are permitted by the ad/offer provider:

- rewarded video ads;
- surveys;
- CPA/app trials;
- referrals;
- sponsored game trials;
- promotions.

The credit ledger must be auditable and idempotent. External reward events need a unique provider event ID so the same conversion cannot be credited twice.

Possible economics:

```text
external action revenue
- fraud/chargeback allowance
- provider fees
= net reward revenue

net reward revenue > marginal cost of granted play/access
```

Credits are particularly useful for low-cost or already-amortized games and for filling otherwise idle capacity.

## Dynamic pricing / yield management

For any product based on expiring hour pools, treat hours as perishable inventory. Price can depend on:

- remaining hours;
- time remaining in billing cycle;
- current concurrent demand;
- peak/off-peak period;
- replacement cost;
- target margin;
- historical conversion.

Do not implement aggressive dynamic pricing before enough data exists. Start with a simple transparent tariff and collect demand/utilization data first.

## Evidence-first execution protocol

`docs/EXECUTION_PROTOCOL.md` is mandatory operating procedure for non-trivial engineering, provider/API research, and local-agent work in this project.

The required sequence is:

1. read the relevant project instructions/specifications;
2. inspect the current code and runtime state instead of assuming what exists;
3. inspect the schemas/contracts/capability registry of every tool that will be used;
4. check current official documentation/source for external libraries, APIs, and services;
5. reuse existing functions/actions/capabilities before creating another mechanism;
6. design the smallest evidence-producing test;
7. if one path is blocked, identify the blocked layer and enumerate other permitted end-to-end routes before concluding the task cannot be done.

For `AI_Local_Access`, specifically inspect `runner.py`, `local_actions.py`, and the relevant action module before inventing job payloads or shell scripts. Search both the runner `CAPABILITIES` registry and registered actions such as `fs.read_text` before claiming a capability is missing.

Do not disguise data or semantics to evade a safety/policy control. “Think outside the box” here means finding a different legitimate transport, API, existing capability, project script, environment/configuration mechanism, connector, or execution architecture that reaches the same end state.

## Research and implementation rules for future agents

1. Read `skill.md`, `docs/EXECUTION_PROTOCOL.md`, `README.md`, and `docs/architecture.md` before provider-specific work.
2. Preserve the separation between customer identity, provider account, lease, save profile, and game entitlement.
3. Prefer official provider session/auth mechanisms over credential exposure.
4. Do not implement DRM bypass, fabricated entitlements, Steamworks emulation, location masking for regional-pricing evasion, or anti-cheat evasion.
5. Treat customer PCs as hostile endpoints; minimize secrets and design for revocation/replacement.
6. Record every important new discovery here, including source URLs and whether the fact is confirmed, inferred, or still unknown.
7. Mark hypotheses clearly. Do not promote an inference to a confirmed platform capability without testing or authoritative documentation.
8. Keep the initial business low-capital and just-in-time. Do not add infrastructure cost unless observed demand justifies it.
9. Do not commit real operator/customer provider-account identifiers into the public repo; discover and map them locally at runtime.
10. Never claim that a function, capability, action, file, endpoint, or integration is missing until the current repository/tool registry has actually been searched and the relevant implementation inspected.
11. Before experimenting with a third-party dependency, verify its current version and consult current official documentation/upstream source or a maintained reference implementation.
12. After a blocked approach, evaluate alternate permitted routes before adding complexity or asking the user to do manual work.

## Open technical questions

These still need direct experimentation or authoritative confirmation:

- Can a Steam device/session be authorized through QR/Steam Guard in a way that is sufficiently automatable for the operator without exposing reusable secrets to the customer endpoint?
- What exact local files/tokens remain after QR authorization, and what survives logout/restart?
- What happens to an already-running game if a device/session is revoked?
- Can an individual authorized Steam device be revoked cleanly without invalidating other active customers on the same provider account?
- How robust is offline mode after the operator intends a lease to end?
- Which game saves are portable across provider accounts and which are SteamID/external-account bound?
- Which high-demand games support Steam Families and which opt out?
- What are the practical device/login anomaly thresholds for repeated geographically distributed logins? Valve does not publicly document a precise threshold; do not invent one.
- Which commercial/site-license programs, if any, explicitly permit remote end-user access from home?

## Next recommended implementation

Continue the **experimental SteamSessionAdapter** on a controlled test PC.

Near-term validation order:

1. use visible chooser discovery to register local provider-account inventory without typing identifiers;
2. map at least one remembered account to a real catalog game;
3. reserve that game and prove the launcher selects the correct remembered Steam account automatically;
4. launch the entitled game through its normal Steam AppID URI;
5. observe end-of-session/logout behavior and then design save backup/restore around the confirmed lifecycle.

Store experiment results as structured diagnostics and update this file with confirmed behavior.