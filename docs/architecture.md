# Architecture

## Core idea

`gameAccess` separates the customer identity from third-party provider accounts.

```text
Customer -> gameAccess launcher -> broker API -> lease allocator -> provider adapter
                                      |                 |
                                      |                 +-> provider account pool
                                      +-> credits / saves / catalog
```

## Security boundary

The launcher should never receive stored provider passwords, email credentials, Steam Guard seeds, or other account-recovery secrets.

Provider-specific authentication belongs behind a provider adapter controlled by the operator. For local third-party sessions, assume the endpoint is hostile: anything materialized on the customer's PC can potentially be inspected by an administrator.

Therefore the design favors supported provider session mechanisms and short-lived/revocable access. It does not rely on obscurity of a SteamID and it does not emulate Steamworks or bypass license checks.

## Lease model

A provider account is a scarce resource. A lease is exclusive for the MVP:

```text
FREE -> LEASED -> FREE
              -> DISABLED (operator action, future)
```

A lease contains:

- customer
- game
- provider account
- start/expiration
- credits charged
- status

This gives us a provider-neutral scheduler later for Steam, cloud gaming, or other services.

## Credits/rewards

Credits are ledger-backed. Future reward sources can implement a simple adapter contract:

```text
RewardProvider.verify(event) -> RewardGrant
RewardGrant(user_id, credits, external_event_id)
```

Good candidates are rewarded advertising, referral payouts, surveys, sponsored trials, and other opt-in offers where the provider explicitly permits incentivized traffic. Every external event should be idempotent to prevent double-crediting.

## Saves

Future save adapters should be per game rather than assuming a universal Steam Cloud model:

```text
SaveAdapter.backup(customer, game)
SaveAdapter.restore(customer, game)
SaveAdapter.clean_provider_profile(account, game)
```

Each game can define paths, exclusions, Steam Cloud behavior, and compatibility notes.

## Provider adapter interface (next step)

```python
class ProviderAdapter:
    def prepare_install(self, game): ...
    def start_session(self, account, game, endpoint): ...
    def revoke_session(self, session): ...
    def health(self, account): ...
```

The first real Steam adapter should focus on observing and orchestrating legitimate Steam Client session state on a test machine, not credential extraction or DRM replacement.
