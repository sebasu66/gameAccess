# Steam download manager

## Runtime lifecycle

1. Clicking **Download** emits a local pending event immediately, before Steam account switching or any Steam UI.
2. The game is pinned to the first available slot of the GameAccess library grid while the request is pending or downloading.
3. Its cover is grayscale while pending. Confirmed download progress reveals the original color from bottom to top.
4. GameAccess polls Steam independently every 2.5 seconds. It does not stop tracking merely because Steam has not created the app manifest yet.
5. A request gets a 90 second confirmation window. Once Steam has shown actual activity, two consecutive `not-installed` observations are treated as cancellation/removal.
6. When Steam reports the app fully installed, the pin is released and GameAccess prompts the user to play immediately.

## Steam library selection research

Steam's public `steam://install/<appid>` protocol opens Steam's own install flow and does not expose a documented library-folder argument.

The Steam client console does expose both:

- `library_folder_list`
- `app_install <appid> [volumeindex]`

GameAccess already has `apps/launcher/steam_console_command.py`, which can submit Steam console commands to the signed-in client. The local pool now also exposes the index/path pairs parsed from `steamapps/libraryfolders.vdf` as `library_folders`.

The remaining integration step is to bridge an explicit GameAccess library choice to `app_install <appid> <volumeindex>` and verify on Windows that the command can be submitted without surfacing a confusing Steam console/install window. Until that verification is complete, the production install trigger remains the standard `steam://install/<appid>` path.

## Steam progress source

The current native status bridge reads `appmanifest_<appid>.acf` across all configured Steam libraries and uses `BytesDownloaded`, `BytesToDownload`, and `StateFlags`. The manager treats the manifest as Steam's source of truth and retains its own pending state during the period before Steam creates that manifest.
