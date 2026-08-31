# GameAccess development workflow

GameAccess uses GitHub as the source of truth. Local Windows builds are consumers of commits that have already passed CI.

## Required flow

1. Create a branch from the current `main` commit.
2. Make the change in GitHub / the remote development branch.
3. Add or update unit tests for changed behavior.
4. Open a pull request to `main`.
5. Wait for the GitHub Actions `quality-gate` check to be green.
6. Merge only after `quality-gate` succeeds.
7. Wait for the merged `main` commit to pass `quality-gate` as well.
8. Only then instruct AI Local Access (the local runner) to `git fetch`, `git checkout main`, `git pull --ff-only`, and build the Windows debug/release artifacts.

The local runner must never be used as the primary editing environment for normal product changes. Its role is final Windows integration/build/smoke testing after the remote commit is verified.

## Quality limits

The desktop architecture gate enforces:

- maximum source file length: **600 lines**;
- maximum class length: **600 lines**;
- maximum cyclomatic complexity per function: **15**;
- Biome lint on changed TypeScript/React files;
- Ruff lint on changed Python files, including McCabe complexity **10**;
- `rustfmt` and `clippy` for the Tauri/Rust host;
- frontend Vitest unit tests;
- API Pytest unit tests;
- Rust unit tests that do not require a real local Steam installation;
- production frontend and native compile checks.

React is function/component based, so the 600-line class rule is also enforced as a 600-line source-file ceiling. Large components should be decomposed into focused components/hooks/modules rather than collected in one file.

## Existing technical debt

A legacy file that already violates a limit can be listed by its exact Git blob SHA in `apps/desktop/quality-baseline.json`. This is not a permanent exemption: CI accepts the violation only while that exact file remains unchanged. Any edit to that file requires bringing it back within the quality limits (normally by refactoring it first).

## Definition of done

A change is not ready for a local build merely because it compiles on a developer PC. It is ready only when the exact commit to be pulled has a green `quality-gate` on GitHub.
