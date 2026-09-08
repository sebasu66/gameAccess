# Desktop validation and download audit checkpoint

Scope: integrate PR #15 backend capacity fixes, repair inherited desktop validation failures, inspect involved download/session modules. User explicitly retired Godot surface support from the desktop; keep the archived Godot project on disk. No Steam sessions or downloads started during this audit. No live database rows changed.

## Implemented in PR #15

- App presentation split into focused components; retain shelves, detail, library navigation, Play/Download, preferences and session dialog.
- LibraryRoom remains the Tauri React library. Tablet/display surface query parameters and CEF IPC removed. Desktop keyboard navigation, completion/cancel dialogs and installed badges preserved.
- Selection reset effects retain intentionally selected-game dependencies, documented at each effect.
- Removed invented 4-percent requested progress from home cards. Starting a download reads observed status instead of resetting progress to requested.
- Preparing is reported as pending validation/preparation, not as Steam-confirmed transfer.
- Terminal provider errors no longer retain stale preparing/requested states in reconciliation; regression test added.
- Tauri download lifecycle read/modify/write serialized with a mutex. Test registers and completes 32 games concurrently, checks deduplication and preservation. Test storage is isolated from user jobs. This protects one Tauri host process, not multiple independent hosts.
- Rust narration normalization fixed for Clippy; changed Rust modules formatted.

## Confirmed operational evidence (read only)

Local logs: AppID 674750 failed repeatedly before a license scan because no candidate was found in local visible catalog. API database game ID 1392 still has direct AccountGame and family copy for provider-093. The downloader's best-known license snapshots have NO inventory entry for provider-093; local identity matches and has 113 visible games, but not 674750. This proves inventory-source disagreement, not that Steam removed a hidden game's license.

AppID 976310 transferred 16,421,331,655 bytes (13.12 percent), then persisted cancelled. AppID 102840 remained preparing then cancelled. Logs do not identify the cancellation initiator. These used different providers, so shared-account session interference is not proven for these attempts.

## Remaining download work (do not report as fixed)

1. Candidate discovery: provider_download_manager.refresh_original_owner_for_app currently starts only from _cached_access_provider_ids. Try independently verified owner evidence before visible-library hints. For provider-093, obtain fresh authoritative evidence through an explicitly announced Steam scan; do not infer ownership from API rows alone. Do not bulk scan 104 accounts merely because one candidate is missing.
2. provider_download_probe.provider_candidates intersects verified ownership with local visual catalog. A known license must not be rejected merely because a game is hidden or absent in local metadata. Keep Windows/product validation separate from ownership; add hidden/missing-metadata cases and negative unverified-owner cases.
3. Separate hidden from private: Steam documents Hidden as local library presentation; Private hides ownership/activity from others. Do not change Steam privacy settings or bypass private-game sharing restrictions. Reference: https://help.steampowered.com/en/faqs/view/1150-C06F-4D62-4966
4. LoginID is currently derived only from provider, reused by concurrent DepotDownloader processes. Official documentation requires distinct 32-bit LoginIDs for concurrent instances. Use a collision-safe per-live-worker allocation and test two games on one provider. Reference: https://github.com/SteamRE/DepotDownloader#authentication
5. start_provider_download has a startup race: same-app requests can race before worker PID publication, and parent startup status can overwrite newer worker progress. Add per-app start deduplication and coordinated status publication with cancellation identity tests.
6. Clarify prepared vs installed completion UX, including Steam existing-files validation; audit all completion paths without removing Play now/Not now.
7. Persist cancellation reason/initiator and surface asynchronous provider errors visibly, beyond stored status. No evidence proves current cancellations were user-initiated.
8. Cumulative family evidence fixes in PR do not reconstruct successes lost before the sidecar existed. Do not claim current local provider-093 evidence has been recovered.

## Integration gate

Check current PR head and every CI lane. Merge only after the aggregate gate passes, then verify merged-main gate before local pull/build. Keep untracked handoff files: incoming docs/POOL_CAPACITY_HANDOFF_2026-09-08.md collides with an existing local version that contains later notes; back it up and reconcile rather than overwrite.
