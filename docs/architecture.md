# Architecture

## Target topology

`gameAccess` is **not** intended to ship as a local client/server pair on the customer's Windows machine.

The production customer application should be a **single installable Windows desktop application**. The current React/Vite UI can remain, wrapped by Tauri (or an equivalent desktop shell), but the user should not have to install, start, configure, or keep a separate local API/server process running.

The target topology is:

```text
                         +---------------------------+
                         |   Admin web application   |
                         +-------------+-------------+
                                       |
                                       | HTTPS/authenticated admin API
                                       v
+----------------------+       +-----------------------------+
| Windows gameAccess   | HTTPS | Central gameAccess backend  |
| desktop executable   +------>+-----------------------------+
|                      |       | users / wallet / catalog    |
| React UI + native    |       | provider accounts           |
| Tauri/local adapters |       | licenses / entitlements     |
+----------+-----------+       | leases / sessions           |
           |                   | demand / operations         |
           | local OS/native   +-------------+---------------+
           v                                 |
+----------------------+                     | operator/provider integrations
| Steam client / game  |                     v
| files / saves / OS   |            +------------------------+
+----------------------+            | Steam/provider systems |
                                    +------------------------+
```

There are therefore **two very different kinds of backend logic**:

1. **Local native application logic**, bundled inside the Windows executable. This handles operations that must occur on the customer's PC: Steam detection, installation/launch orchestration, local session preparation, save handling, process observation, cleanup, and other narrowly scoped OS integrations. It is not a separately deployed localhost web server.
2. **Central service backend**, deployed remotely and shared by all customers. This is authoritative for customer identity, catalog data, wallet/credits, provider profiles, license/entitlement inventory, capacity, leases, session coordination, revocation, demand telemetry, and administrative operations.

The current `apps/api` FastAPI project is a prototype of **the second category**. Running it at `127.0.0.1` is a development convenience only; production clients should call a hosted backend over HTTPS.

The current `apps/desktop` Tauri project is the intended basis of **the first category**. Where prototype functionality currently depends on a localhost API purely for implementation convenience, it should either move into Tauri/native local commands when it is inherently local, or remain in `apps/api` and be deployed as part of the central backend when it is shared/authoritative state.

## Core idea

`gameAccess` separates the customer identity from third-party provider accounts.

```text
Customer -> Windows app -> central broker API -> lease allocator -> provider adapter
                              |                    |
                              |                    +-> provider account/license pool
                              +-> users / wallet / catalog / demand / sessions
```

The customer application asks the central backend for authorization and allocation decisions, but performs the necessary endpoint-local work through bundled native adapters.

## Administrative plane

The resource administration UI should be a **web application connected to the same central backend** used by desktop clients, with separate operator authentication/authorization.

It should eventually manage and observe at least:

- provider/Steam profiles;
- licenses and per-game entitlements;
- account pools and availability;
- active and historical leases/sessions;
- disabled/quarantined resources;
- catalog and compatibility metadata;
- users, wallet/ledger and subscriptions when implemented;
- demand telemetry and procurement recommendations;
- operational alerts, health and audit history.

The admin web app should not become a second source of truth. It is an operator interface over the central backend and database.

## Authority and trust boundaries

The central backend is authoritative for scarce/shared resources. A desktop client must not be trusted to decide that a license is free, mint credits, extend its own lease, or choose an account outside the allocation returned by the service.

Conversely, operations that inherently require access to the customer's Windows environment should remain local to the bundled desktop application rather than being awkwardly simulated by a remote service.

A useful rule is:

```text
shared truth / scarce resources / money / authorization -> central backend
Windows OS / Steam client / local files / processes      -> desktop executable
operator visibility and control                           -> admin web app -> same backend
```

## Security boundary

The desktop application should never receive stored provider passwords, email credentials, Steam Guard seeds, or other account-recovery secrets merely because those secrets exist in the operator system.

Provider-specific authentication belongs behind controlled provider/session mechanisms. For local third-party sessions, assume the endpoint is hostile: anything materialized on the customer's PC can potentially be inspected by an administrator.

Therefore the design favors supported provider session mechanisms and short-lived/revocable access. It does not rely on obscurity of a SteamID and it does not emulate Steamworks or bypass license checks.

## Lease model

A provider account/license is a scarce resource. A lease is exclusive for the MVP where the underlying provider requires exclusivity:

```text
FREE -> LEASED -> FREE
              -> DISABLED (operator action)
```

A lease contains:

- customer;
- game;
- provider account / entitlement;
- endpoint/session identity;
- start/expiration;
- credits charged;
- status.

The lease must be created and released by the central backend so multiple desktop clients cannot independently allocate the same scarce resource.

This also gives us a provider-neutral scheduler later for Steam, cloud gaming, or other fulfillment methods.

## Credits/rewards

Credits are ledger-backed and centrally authoritative. Future reward sources can implement a simple adapter contract:

```text
RewardProvider.verify(event) -> RewardGrant
RewardGrant(user_id, credits, external_event_id)
```

Good candidates are rewarded advertising, referral payouts, surveys, sponsored trials, and other opt-in offers where the provider explicitly permits incentivized traffic. Every external event should be idempotent to prevent double-crediting.

## Saves

Save operations themselves occur on the customer's endpoint, but customer save identity/version metadata can be coordinated centrally. Future save adapters should be per game rather than assuming a universal Steam Cloud model:

```text
SaveAdapter.backup(customer, game)
SaveAdapter.restore(customer, game)
SaveAdapter.clean_provider_profile(account, game)
```

Each game can define paths, exclusions, Steam Cloud behavior, and compatibility notes.

## Provider adapter interface

Provider/session orchestration spans the central and local boundaries. The central backend decides **which authorized resource/session** is assigned; the desktop-side adapter performs only the local operations necessary to realize that assignment.

Conceptually:

```python
# Central service responsibilities
allocate(customer, game) -> SessionGrant
release(session_id)
revoke(session_id)

# Bundled Windows-side responsibilities
prepare_install(game)
prepare_local_session(session_grant)
launch(game, session_grant)
observe_exit()
cleanup_local_session(session_grant)
```

The first real Steam implementation should focus on observing and orchestrating legitimate Steam Client session state on a test machine, not credential extraction or DRM replacement.

## Deployment rule

For production, the expected deployment model is:

```text
Customer PC:
  gameAccess.exe (single desktop application)
  Steam + installed games as required

Cloud / hosted infrastructure:
  gameAccess central API/backend
  persistent database
  shared provider/license/session state
  admin web application
  background operational jobs/integrations as needed
```

A localhost FastAPI server may remain useful for development, tests, mocks, or debugging, but **it is not part of the intended customer installation architecture**.
