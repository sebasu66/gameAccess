# External source provider example

This is the existing Electron/Express example with empty default source configuration, named feeds in bulk results, and an uncapped per-game option list. Configure source JSON URLs/files through the external plugin UI. GameAccess itself does not embed those lists.

Existing plugins can keep the numeric bulk count response; include_sources opts into named feed responses. sourceName on individual options identifies the feed separately from the plugin.

To synchronize this example into an existing installation, first preserve its main.js and configuration, then copy this exact committed main.js into that plugin directory. Keep its existing matcher.js, gofile.js, package.json, index.html and user source configuration.
