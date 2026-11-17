# Game Access Cloudflare Pages

Static public landing and stable runtime configuration for the Windows beta.

## Cloudflare Pages settings

- Production branch: `main`
- Preview branch: `dev`
- Framework preset: None
- Build command: leave empty
- Build output directory: `deploy/cloudflare-pages`

The landing itself is static and does not require secrets.

`backend.json` is intentionally uncached and contains only the public HTTPS base URL of the current Game Access API. It can be changed independently from the Windows build.

`client.json` is also uncached and is the stable place for the latest/minimum supported client version and download URL.

The Windows installer should be published through GitHub Releases rather than stored as a Pages asset. Keep the landing download button pointed at the latest release.

After the Pages project has a permanent `*.pages.dev` or custom domain, update the desktop resolver to that site's `/backend.json`.
