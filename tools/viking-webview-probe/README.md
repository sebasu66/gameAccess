# ViKiNG WebView download probe

Standalone Tauri 2 / WebView2 probe for testing the regular ViKiNG file landing flow inside an embedded GameAccess-style window.

It does **not** solve or bypass Cloudflare/Turnstile. The page is loaded normally in WebView2. The probe records top-level navigations, page-load events, document titles, and native download events. If the site starts a normal browser download after the user completes any required interaction, Tauri's `on_download` hook redirects the file to the requested destination and records the result.

Default legal test file:

`https://vikingfile.com/f/YLF8EL0zTY` (Sintel test upload used by the torrent-transfer prototype).

Run on Windows:

```powershell
cargo run --manifest-path tools/viking-webview-probe/Cargo.toml --release -- `
  --url https://vikingfile.com/f/YLF8EL0zTY `
  --timeout 90 `
  --report $env:TEMP\viking-webview-probe.json `
  --download $env:TEMP\sintel-viking-probe.bin
```

The window remains visible. This is intentional: the purpose is to validate an embedded first-party GameAccess flow, not a hidden-browser bypass. If ViKiNG requires a click after Cloudflare validates the session, perform that click in the embedded window. The native Tauri download hook then handles the actual binary download without opening an external browser.
