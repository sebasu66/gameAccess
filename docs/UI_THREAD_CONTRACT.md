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
