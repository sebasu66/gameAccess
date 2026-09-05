# UI Thread Contract

The desktop UI must remain interactive regardless of metadata, Steam, filesystem, network, download-size, trailer, or backend latency.

## Non-negotiable rules

1. Rendering, selection changes, keyboard navigation, scrolling, and button focus must never wait for data loading.
2. Game detail loading is progressive and asynchronous. The catalog/selection renders immediately from the data already available; Steam/backend metadata fills in later.
3. Native Tauri commands that can wait on subprocesses, network, Steam, package/license probing, or substantial filesystem work must be `async` commands whose blocking work runs through `tauri::async_runtime::spawn_blocking` (or an equivalent worker boundary).
4. Never call `Command::output`, long-running scans, Steam metadata retrieval, provider validation, or manifest/depot probing directly on the UI/runtime command path.
5. Images and Steam trailers are optional progressive enhancements. Failure or slowness must not block browsing.
6. The library game grid is the primary desktop surface and should receive more screen width than the detail document where practical.

`src/uiThreadIsolation.test.ts` enforces the critical source-level parts of this contract so regressions fail the test suite.

7. Catalog startup may load only lightweight baseline state needed to render the grid (for example installed AppIDs). It must not fan out screenshots, trailers, requirements, download size, download progress, provider validation, or size estimation across games.
8. Heavy data is requested only after the user navigates to a specific game (or a display explicitly navigates to it), and resolved metadata/estimates must be cached.
9. A transition from an active download state to `installed` must raise the download-complete / Play Now dialog exactly once.
10. Every installed game must show the green installed badge in the grid; pool availability must not suppress that local installation indicator.
