# Visual debug workflow

Run the desktop application with:

```powershell
gameaccess-desktop.exe --visual-debug
```

`-visual-debug`, `--auto-snapshot`, and `-auto-snapshot` are accepted as aliases. A run creates one shared session folder under `debug/visual/<timestamp>/`. Every filename is prefixed by its viewport profile and screen name, and `manifest.json` records the basic visibility, minimum-size, and horizontal-overflow checks.

## Required coverage

Each run captures both supported viewport profiles:

- `medium`: 1100 x 760 window.
- `maximized`: the current monitor's maximized working area.

The current screen tour covers:

- Home and its global search field, featured game, and library cards.
- Global search results.
- 3D library and its search/close controls.
- Selected-library-game dialog.
- Game detail view.
- Session dialog.

## Acceptance rule

The manifest checks are guardrails, not visual approval. After a new visual screen or any visual feature change, the developer or agent must open and inspect every generated PNG in both viewport profiles. Confirm that intended controls are visible, legible, correctly sized, inside the viewport, and usable. Also inspect for overlap, cropping, broken images, unreadable text, weak hierarchy, and accidental mixing between neighboring images.

A successful build or a passing manifest does not prove the UI is visually correct. The change is visually verified only after the generated screenshots have been reviewed directly.
