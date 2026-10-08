# Client catalog updates and floating downloads

The Digital client establishes its comparison baseline after its initial catalog
load. It then refreshes from the configured API every 30 minutes while the client
is running. The footer refresh button requests the same operation without a page
reload. A focus event catches up after the client/PC has slept beyond that interval.
Manual and timed requests share one in-flight operation; unmount cancels the timer
and ignores late responses. This does not replace the separate Steam metadata worker.

`CatalogUpdater` compares game IDs against the last successful result. Metadata
changes, ordering changes and duplicate records do not create new-game notices.
Remote failures preserve the current grid and baseline. Refresh requires a valid
remote array and cannot substitute bundled JSON on failure; an empty remote array
is accepted as a legitimate catalog result. Initial startup does not announce the
entire library. The comparison baseline is scoped to the running client session.

Each added game gets a notice at the upper right, newest first, stacking downward.
Every notice owns a deadline of 10 seconds from arrival, unaffected by other
notices. Each can also be dismissed. One quiet synthesized bell sounds per batch
with additions; unavailable audio does not prevent the notices.

The download indicator shows the leading active Digital job, falling back to a
queued/paused job or a short terminal-status notice. The cover is clipped to a
circle with a 48-cell progress ring; preparing/queued phases have an indeterminate
ring. `+#` counts additional active jobs (excluding paused/queued/terminal jobs).
Hover/focus reveals name, percentage and transfer rate on a fading glass panel.
The panel flips inward near the right screen edge. Clicking opens the existing
download manager. Pointer dragging suppresses that click, clamps the circle inside
the viewport and saves its normalized position locally. Alt + arrow keys also
move it. Resize clamps restored coordinates; reduced-motion preferences are respected.

All visual rules and section comments remain in `apps/desktop/src/gameaccess-theme.css`.
Completed download rows have a PLAY/JUGAR button using the existing Digital
launch flow. Download screen labels, accessibility labels, phase names, new-game
notices and floating-indicator text use the shared Spanish/English translation
catalog; byte formatting follows the selected locale. Backend diagnostic messages
retain the original text supplied by the process.

Package sizes come from the selected provider JSON source on the server. The
catalog joins cached provider records by exact download URI, emitting
`download_size`, `download_size_bytes` and source provenance. It does not substitute
Steam's installation requirements or a similarly named release's size. Download
buttons show `Descargar (6 GB)` / `Download (6 GB)` when present, and only the action
when absent. Download rows also show this declared package size, while transferred
bytes remain live metrics. Restored jobs read current catalog sizes by game ID.
Behavior lives in `catalogUpdates.ts`, `useCatalogUpdates.ts`,
`CatalogNewGameNotices.tsx`, and `FloatingDownloadIndicator.tsx`.

Validation: updater timer, overlap, additions, failed refresh, disposal and sleep
catch-up tests; authoritative remote/fallback tests; circle bounds/progress tests.
Browser fixture checks cover independent expiry, ordering, loaded artwork, segmented
progress, detail reveal, drag without click and position restoration. The production
30-minute wall-clock tick and audible bell need observation in the native client.
