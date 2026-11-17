# GameAccess logo recorder

The fixed voxel constellation and G/A sweep come from the approved logo demo.
The perspective camera changes distance from 30 to 1000 world units while preserving
the apparent size. A static 0.1-3500 clipping range loses depth precision at the
distant endpoints. The recorder now follows the subject with clipping planes
15 units in front of and behind the camera's target distance. This preserves
the lens motion, cube positions, colors, lighting, and timings.

The entry film is encoded at 640 px instead of enlarging the 192 px header film.
The entry wordmark is custom squared, chamfered SVG lettering, stacked GAME / ACCESS.
The access panel reuses the app's Bebas Neue title and orange accent with neutral
36 px frosted glass. Footer and all activation flows remain present.

## Recording and GitHub-first publication

Run the committed server with a scratch output directory outside the checkout:

```powershell
python tools/brand/record-server.py --output C:/path/to/recording
```

Open http://127.0.0.1:38483/animation-studio.html in a WebGL browser and press
“Grabar las tres animaciones”. After the archive is saved:

```powershell
python tools/brand/encode-assets.py --recording C:/path/to/recording
python tools/brand/publish-assets.py --assets C:/path/to/recording/assets --branch BRANCH --expected-sha PUSHED_SHA
```

The scripts only generate scratch artifacts and publish through GitHub. Fetch and
fast-forward the pushed commit before rebuilding the desktop app. FFmpeg,
Python with Pillow, and an authenticated GitHub CLI are required. VP9 files
preserve alpha and run at 30 fps. The recorder publishes camera near/far values
as data attributes so the moving clipping range can be inspected.
