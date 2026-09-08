# Pool capacity and allocation: investigation and implementation handoff

Date: 2026-09-08
Status: structural implementation in draft PR #15; not merged or deployed. See latest checkpoint below.
Workspace: `C:\DEV\gameAccess`
Live admin: `http://127.0.0.1:38147/admin-console/`

## User intent and current authorization

The user questioned excessive/inaccurate Copias and Libres counts and asked to verify the family-aware minimum-impact allocation algorithm. They subsequently requested durable tasks so another model, or this model after a usage reset, can resume without repeating the investigation.

This turn saves the analysis and tasks only. No capacity code or inventory correction has been applied. Do not interpret task checkboxes as proof of completion or as authorization to initiate Steam login, scans, account switching, downloads, or sessions. Obtain implementation direction if resuming directly from this documentation-only checkpoint. Follow repository workflow for code, CI, builds, and remote operations.

## Correct semantics

Steam Families permits simultaneous play of the same game when the family owns multiple separate copies. One shared copy visible to six members is still one copy. Two actual copies may support two simultaneous players. Do NOT cap every game at one copy per family.

Official source checked on 2026-09-08:
https://help.steampowered.com/en/faqs/view/054C-3167-DD7F-49D4

For a family with interchangeable eligible copies/accounts:

`available(game, family) = min(unused verified copies of game, free eligible accounts for game)`

Sum across independent families/domains for a per-game capacity. Eligibility must reflect verified access and applicable restrictions. If copies have different compatibility restrictions, a simple minimum is insufficient: use compatible account/copy assignments, not an assumption that every eligible account can consume every copy.

Distinguish:

- Owned license inventory: distinct actual ownership, not library visibility or number of borrowers.
- Potential usable capacity: constrained by enabled eligible seats and applicable copy restrictions; define the intended semantics explicitly.
- Available now: capacity after account occupancy, copy usage, and access checks.
- Free accounts: accounts marked free, not necessarily eligible to play any particular game.
- System-wide simultaneous sessions: cannot be obtained by summing individual games' capacity. Those games compete for the same accounts.
- Allocation score: a heuristic ranking of the next assignment by weighted marginal capacity loss; not a proof of globally optimal future allocations.

## Evidence collected — snapshot, not timeless truth

Source inspected at HEAD `f79d279` (recheck current HEAD). Running API and database were inspected, but process-loaded source identity was not independently hashed. Initial Git status contained pre-existing untracked logs/debug/scanner output and the earlier desktop-layout handoff. Preserve these.

Live `/admin-console/overview` and rendered admin UI showed:

| Metric | Observed value |
| --- | ---: |
| Accounts | 104 |
| Accounts marked free | 103 |
| Disabled accounts | 1 |
| Active leases / leased accounts | 0 / 0 |
| Active games | 1020 |
| Displayed license total | 4036 |
| AccountGame ownership mappings | 3774 |
| Games with displayed licenses | 1081 |

Examples from the SAME overview response:

| Game | Main copies | Main available | Sum of family breakdown available seats |
| --- | ---: | ---: | ---: |
| Counter-Strike 2 | 83 | 67 | 83 |
| PUBG: BATTLEGROUNDS | 58 | 40 | 58 |
| PUBG: Experimental Server | 58 | 22 | 58 |
| PUBG: Test Server | 58 | 16 | 58 |
| Apex Legends | 52 | 26 | 52 |

The main table does use the family calculator for active games. It is not simply counting visible owners everywhere. However, the family breakdown uses a different eligibility rule, and inactive games fall back to ownership mapping counts in the admin.

### Read-only SQLite findings

Database: `C:\DEV\gameAccess\apps\api\gameaccess.db`.
Inspection used SQLite URI `file:C:/DEV/gameAccess/apps/api/gameaccess.db?mode=ro`.

- 4063 FamilyGameLicenseCopy rows; none with missing owner IDs.
- 289 copy rows had no corresponding current `(owner_account_id, game_id)` AccountGame mapping; affected 172 games, including inactive games.
- Every current AccountGame mapping had a corresponding family-copy row.
- No duplicate family memberships per account or duplicate `(family, game, owner)` copy groups were found.
- 160 ProviderFamily rows, but only 103 populated groups: 102 single-member groups and one two-member group. Empty historical groups remain.
- Populated group types: 40 `standalone:` groups with 40 members, 15 `steam-family:` groups with 16 managed members, 48 synthetic `account:` groups with 48 members. A single managed member in a real family does NOT prove the Steam family itself has only one member.
- Synthetic groups do not prove independence; they are fallback materializations for accounts absent from the submitted family graph.
- 91 accounts had stored Steam IDs, with no duplicate Steam IDs among those 91. Other identities remain outside that verification.
- 102 account notes contained an accessible-app list; one of those lists was empty. Accessibility is stored evidence, not a live Steam check.
- Ownership verification dates: 91 accounts dated September 4, one September 5, ten September 8, two missing. Do not treat those old timestamps as verified-current access.
- 61 inactive games had 67 ownership mappings; this contributes to mismatched active-game versus displayed-license coverage.

### In-memory reconciliation experiment

Using the current calculator on a read-only SQLModel session, a second in-memory state excluded FamilyGameLicenseCopy rows without a current AccountGame pair. No database rows were changed.

Result: 162 ACTIVE games changed; calculated totals decreased by 279 and calculated available slots by 113. These are consistency diagnostics, NOT authoritative corrected Steam capacity. AccountGame itself can be incomplete or filtered; absence there does not independently prove loss of an actual Steam license.

| Game | Current total / available | Reconciled-in-memory total / available |
| --- | --- | --- |
| Warframe UGC | 17 / 4 | 1 / 1 |
| Unturned - Dedicated Server | 16 / 3 | 1 / 1 |
| Call of Duty: Warzone | 16 / 3 | 3 / 3 |
| OBS Studio | 15 / 6 | 6 / 6 |
| PUBG: Test Server | 58 / 16 | 52 / 11 |
| PUBG: Experimental Server | 58 / 22 | 52 / 17 |
| Blender | 10 / 4 | 4 / 4 |

Some differences involve tools, servers, or filtered catalog entries. Investigate product-type filtering separately from true ownership removal; do not mass-delete the 289 rows on the strength of this experiment.

### Allocation verification

`select_best_account` runs a per-candidate simulation and is called by the real lease-creation route. With the stored database state:

- Counter-Strike 2: 67 candidates; chosen account ID 2, weighted damage 0.01492537, zero newly unavailable games. Worst candidate made 158 games unavailable.
- PUBG: 40 candidates; chosen account ID 45, weighted damage 0.03992537, zero newly unavailable games.
- GTA V Legacy: two candidates; chosen account ID 8, damage 12.22816352 and nine newly unavailable games, versus account ID 98, damage 30.12605817 and fifteen newly unavailable games.

This verifies that the ranking mechanism is active against the current model. It does NOT establish correctness of imported inventory, real Steam access, external occupancy, or concurrency safety.

Validation run: from `apps/api`, `.venv/Scripts/python.exe -m pytest tests/test_family_capacity.py -q` → **7 passed**, four FastAPI startup deprecation warnings. Existing tests do not cover all issues below.

## Source map and causal findings

Paths below are relative to repository root. Search symbols rather than trusting old line numbers.

### `apps/api/app/family_capacity.py`

- `_state`: reads families, memberships, copies, active games, active leases, allocations, demands.
- `_account_can_launch_family_game`: requires stored `accessible_app_ids`; it does not check evidence age. `family_id` is not used to verify copy-specific compatibility.
- `_snapshot`: total is `min(copy count, enabled member count)`; available is `min(copy count minus active uses, free members with accessible app)` per family/game.
- `catalog_metrics` / `game_capacity`: family-aware when any ProviderFamily row exists; otherwise use legacy AccountGame counts.
- `family_breakdowns_by_game`: computes free members WITHOUT `_account_can_launch_family_game`, causing disagreement with `_snapshot`.
- `_weighted_damage`: sums lost per-game capacity weighted by `demand_value * price_factor / previous_available`; tie-breaking uses newly unavailable games, remaining summed per-game capacity, account ID. `remaining_seats` is a summed opportunity metric, not simultaneous system seats.
- `select_best_account`: simulates account busy + one consumed game copy; chooses lowest score. Does not provide a database reservation lock itself.
- `replace_family_graph`: deletes all copy/member rows, commits, then rebuilds and commits again. Accounts missing from incoming families become synthetic one-member groups from AccountGame mappings. Old ProviderFamily rows remain. Copy IDs are recreated while LeaseAllocation references are not explicitly reconciled. This is an integrity/concurrency risk to test, not a proven live incident (there were zero active leases).

### `apps/api/app/admin_console_routes.py` and `apps/api/admin/index.html`

- `dashboard`: gets main metrics and family breakdown through separate state builds.
- Active-game metrics missing from the returned map cause fallback to raw owner mapping totals/free-owner count, including inactive games.
- `license_mappings` is the sum of the displayed `copies_total` values, not the actual mapping count or physical-copy table count.
- `accounts_available` checks account status only; UI labels it `Asientos libres` / `disponibles ahora`.
- HTML renders `copies_total` as Copias and `copies_available` as Libres; no provenance/freshness/unknown distinctions.
- Dashboard calls `expire_old_leases`; reading the HTTP overview can perform normal application housekeeping. Do not describe that endpoint as a guaranteed side-effect-free SQL inspection.

### `apps/launcher/provider_account_onboard.py`

- `_merge_family_inventory` overlays ONLY the newly scanned provider onto `provider_licenses.json`, the last full snapshot. It does not accumulate other more recent partial scans into that base.
- Current last full snapshot was September 4 with 46 accounts. Last-scan file was September 8 with 104 roster accounts, but only one scanned and 103 `not_scanned`.
- Subsequent family graph rebuilds can reintroduce old ownership for base accounts and materialize omitted newer accounts as synthetic groups. This is a concrete source-level stale-data mechanism; exact history of every inconsistent row was not reconstructed.
- `_import_verified_games` filters to Windows games and can skip unresolved/non-game AppIDs. Family graph import and catalog import must have consistent inclusion semantics without equating filtering with license revocation.

### Other ingestion files

- `apps/launcher/family_refresh.py::build_family_graph`: groups verified owners by family, deduplicates owned AppIDs per provider, creates quantity from owner labels. `refresh` triggers REAL scans and backend writes: do not run as a read-only audit.
- `apps/launcher/provider_license_scan.py`: resolves original owner via OwnerAccountID, avoids treating borrowed visibility as ownership, stores accessible apps separately. Missing/zero family ID is interpreted as standalone.
- `tools/steamkit-license-scanner/Program.cs`: family query begins with standalone defaults; query failure records `family_error` but can leave those defaults. Therefore unknown family membership can become standalone downstream. Checked snapshot files had zero family errors, so this is a risk, not the demonstrated origin of all current synthetic groups.
- `apps/api/app/pool_routes.py::_sync_account`: authoritative ownership updates AccountGame; access notes can change independently; family copies are maintained by a separate sync route. Review partial/not-scanned input handling.
- `apps/api/app/main.py`: lease selection, account-status update, lease commit, and allocation registration occur in separate steps/commits. Concurrent requests and family refresh during leases need explicit tests.

## Implementation tasks — ordered, bounded checkpoints

### 1. Define metrics and a single calculation contract

- [ ] Read current repository instructions, workflow, code and CI gates; recheck source and live database identity. Preserve dirty work.
- [ ] Define separate fields for verified copy inventory, per-game available assignments, free account count, and unknown/unverified capacity. Preserve API consumers through an intentional migration, not silent semantic changes.
- [ ] Use one shared state/calculator for catalog, admin totals/breakdowns and allocator simulation. Ensure sum of family breakdown availability equals game availability for the same snapshot.
- [ ] Decide and document active/inactive game treatment. Do not silently fall back to a different capacity definition for inactive games.
- [ ] Retain the minimum-impact ranking and its deterministic tie-breaks; name summed opportunity metrics accurately.

### 2. Fix inventory synchronization at the source

- [ ] Maintain latest verified per-account ownership/family/access evidence with timestamps and explicit provenance. Merge successive partial successes; do not overwrite newer evidence with an old full snapshot.
- [ ] `not_scanned`, failed, unknown, confirmed standalone and confirmed family membership must be distinct states. A failed family query must not create an independent domain.
- [ ] Reconcile the family graph from that merged evidence. Reject duplicate memberships, duplicate owner/game copies, invalid quantities, and incompatible family claims. Do not count borrowers as owners.
- [ ] Preserve verified ownership through transient scan failure, but do not advertise unsupported current availability. Define freshness policy explicitly; do not choose an arbitrary TTL without explaining consequences.
- [ ] Make catalog filtering consistent with copy accounting. Retain actual ownership evidence separately if catalog filtering would otherwise erase it.
- [ ] Make graph replacement atomic and safe for active leases/copy identity; avoid intermediate empty states and dangling allocations. Prefer stable identities or a deliberate migration strategy.

### 3. Verify eligibility and reservation correctness

- [ ] Availability and candidate selection must apply the same eligibility, occupancy, usage and family rules. Review owner-specific/non-shareable restrictions and evidence limitations before claiming every family copy is interchangeable.
- [ ] Audit occupancy sources: current model uses GameAccess leases/status. Do not claim real-time Steam-wide free capacity if external Steam activity is not observed.
- [ ] Reserve the selected account and compatible copy transactionally; revalidate on contention. Concurrent requests must not consume the same account/copy twice.
- [ ] Ensure expiration/release restores both account and copy capacity consistently, including after graph refresh. Avoid replacing the allocator with a first-free-account shortcut.

### 4. Correct the admin presentation

- [ ] Label verified copies, available game slots, and free accounts distinctly. Explain that per-game slots share accounts and cannot be summed into total concurrent sessions.
- [ ] Display provenance/freshness or explicit unknown states where needed. A large count is not itself a bug, especially for common/free apps; prove discrepancies from data.
- [ ] Show family-level explanation using the SAME eligibility logic as the total; avoid exposing account secrets or raw private family identifiers.
- [ ] Preserve the prior bulk-snapshot performance and `refreshPending` frontend guard; do not restore one expensive query per game on each three-second refresh.

### 5. Regression tests and validation

- [ ] One owned copy visible to six eligible members → one simultaneous game slot.
- [ ] Two distinct owned copies in one family → up to two slots, subject to eligible free accounts.
- [ ] Occupying an account affects other games appropriately; candidate selection preserves scarce/high-weight alternatives.
- [ ] Main availability equals summed breakdown availability with inaccessible, disabled, busy, and unknown accounts.
- [ ] Sequential partial scans A then B preserve A's newer evidence even when the last full snapshot is old; missing/failed family queries never imply standalone.
- [ ] Product-type filtering and unresolved imports do not masquerade as license revocation or leave two contradictory inventories.
- [ ] Duplicate membership/copy payloads fail validation or deduplicate safely; synthetic unknown groups cannot inflate independent capacity.
- [ ] Refresh with active leases, concurrent requests for the last copy, release, expiry, and failed transaction preserve invariants.
- [ ] Unit tests run on isolated fixture databases. Run relevant API/launcher tests and required quality gates; record commands and results. Existing seven tests passing is not sufficient acceptance.
- [ ] Validate populated admin UI against the actual API and a consistent database snapshot, including a known single-copy family and a multi-copy family. Record before/after figures with timestamps.

### 6. Reviewable live-data reconciliation (separate from code changes)

- [ ] Prepare a protected database backup using a SQLite-consistent mechanism before any migration.
- [ ] Generate a dry-run reconciliation report with per-game deltas and reasons: stale ownership, filtered product, unknown family, missing access evidence, occupancy, duplicate data. Do not include credentials.
- [ ] Do not automatically delete the 289 unmatched rows; establish authoritative evidence for each class of difference first.
- [ ] Review concrete changes before mutating live inventory. Real Steam re-verification may be needed; explain that it invokes account scans and coordinate it with the user.
- [ ] Apply only reviewed reconciliation, retain rollback material, and recheck admin/catalog/allocator agreement on the resulting data.

## Resume protocol / checkpoint log

At each meaningful completed checkpoint, update this document with changed files, commit/branch, test results, outstanding blockers, and the exact next action. Do not mark a box complete from source inspection alone if it requires runtime or data evidence.

| Checkpoint | Status / evidence |
| --- | --- |
| Investigation | Completed as described above; snapshots may age |
| Code changes | Remote branch `codex/pool-capacity-integrity`, draft PR #15; partial implementation |
| New regression tests | Checkpoint 1: all 26 API tests passed in CI; checkpoint 2 CI pending |
| Live inventory migration | NOT STARTED |
| Steam re-scan | NOT RUN |
| Admin visual acceptance | NOT DONE for any corrected build |

Implementation was authorized in the conversation after this document was created. Continue from the checkpoint below; do not repeat the initial investigation. Keep documentation and code checkpoints reviewable so a usage limit does not leave ambiguous work.

Completion requires consistent and accurately labelled metrics, preserved allocator behavior, safe ingestion/reservation invariants, passing required tests, and live verification. Until authoritative Steam evidence is refreshed where needed, report model-consistent capacity separately from verified-current operational capacity.

## Implementation checkpoint — 2026-09-08, PR #15

Remote PR: https://github.com/sebasu66/gameAccess/pull/15
Branch: `codex/pool-capacity-integrity`
Base at branch creation: `7309529f2b562d3670a535329ee906e03df8715d`.
Local checkout remains on main at the older inspected source; do NOT mistake local files for the PR changes. Other desktop work advanced remote main concurrently; preserve it.

### Saved source commits

- `b9536f4f6621de1d63b372c297bf22301c66b294`: common `_family_counts` used by snapshot and breakdown; atomic validated graph writer extracted to `family_graph_write.py`; preserves unchanged copy IDs; rejects active leases/leased accounts with HTTP 409; rolls back failures; validates distinct membership/owner counts. New `test_family_graph_integrity.py`.
- `166ac93b642f960a7a6dc5ce447423c70b52bc4c`: cumulative per-account evidence in `provider_family_evidence.py`, integrated into onboarding, incremental sync and full family refresh; removes empty-access-to-ownership fallback in onboarding/incremental sync; regression tests for successive/stale/failed/concurrent partial scans. Required launcher test lane moved to Windows, where its existing UI imports are supported. No tests are skipped and the aggregate gate requires that lane.
- A following checkpoint commit seeds a partially successful full refresh from the existing complete snapshot before merging cumulative evidence, and publishes this handoff. Resolve current PR HEAD rather than assuming the second commit is final.

The evidence sidecar is `apps/launcher/.gameaccess/provider_family_evidence.db`; it is created only when the new sync code runs. It stores whitelisted inventory fields and timestamps, not credentials. No sidecar or live inventory migration was run locally during authoring. Importing the new code does not perform scans.

### Validation and known gate blockers

- Checkpoint 1 changed Python lint passed; all 26 API tests passed in CI, including new atomic rollback and six-member copy tests.
- Checkpoint 1 launcher tests could not collect on Linux because `steam_pool` imports `steam_switch`, which imports Windows-only `pywinauto.Desktop`. Checkpoint 2 moves the full launcher test suite to a required Windows lane; await its result.
- Frontend architecture gate failed on unchanged/inherited `App.tsx`, `LibraryRoom.tsx`, `LibraryDetailPanel.tsx`, `LibraryRoomParts.tsx`, `api.ts`, and `native.ts` limits. This capacity PR has no frontend source changes. Do not enlarge baseline exemptions or refactor unrelated UI to hide this failure. The aggregate gate must remain required; no merge/build/deployment while it fails.
- Full current-head API/launcher/native status must be checked on PR #15; earlier passes do not certify a later commit.

### Explicit remaining structural work

1. Finish CI validation and address defects in this patch; coordinate existing frontend gate failures separately. Remote-first workflow still applies.
2. Lease selection/reservation is not yet transactional with the graph writer. Writer lock serializes graph writes, but does not fix a lease request that selected an account before a refresh. Add last-copy contention tests and transactional reservation before claiming concurrent allocation safety.
3. Admin still builds metrics and breakdown from separate reads, and still has inactive-game fallback/ambiguous aggregate labels. `_family_counts` fixes the eligibility formula discrepancy only; the shared request snapshot and metric schema remain to implement.
4. Synthetic `account:` groups retain compatibility behavior in the graph writer. Unknown family-query evidence is no longer labelled confirmed standalone in the cumulative store, but downstream fallback/provenance and availability policy are NOT fully fixed. Do not claim unknown membership fails closed end-to-end.
5. Cumulative sidecar serializes evidence updates by timestamp, but graph sync requests still lack a generation/version check. Concurrent sync requests can arrive at the backend out of order; address this before claiming end-to-end monotonic synchronization.
6. Evidence freshness TTL, external Steam occupancy, per-copy compatibility, and product-type filtering reconciliation remain open. Existing old partial scans not present in the last full snapshot cannot be reconstructed magically by the new sidecar.
7. Live reconciliation is still a separate dry-run/review/backup step. Do not delete the previously identified 289 records automatically.

Next action: inspect current PR checks, verify Windows launcher tests, and record the exact current-head outcomes here. The user asked to prioritize structural fixes; do not move into cosmetic admin changes or unrelated desktop layout work.

