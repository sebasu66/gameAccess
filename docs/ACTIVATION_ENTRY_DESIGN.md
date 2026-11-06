# Activation entry: cinematic portal and admission tickets

The approved concept groups the brand and activation form at the left and the
access-plan comparison alongside it. The existing stabilized G/A voxel film is
preserved. Audiowide supplies the silver/orange live wordmark; Manrope supplies
headings, forms, prices and feature text. Audiowide is self-hosted with its OFL
license and FONTLOG, sourced from Google's official fonts repository.

BASE and PLUS share the same grid width, row height, content padding, access
card proportions, introductory text area and bottom action alignment. BASE uses
graphite grey; PLUS uses brushed metallic titanium with a restrained warm rim.
Distinct feature icons convey download, television, time, search, included
features, parallel downloads and speed. The footer keeps connection status left
and globe/language controls right. All live text remains localized.

The form preserves single-button activation/retry behavior, bounded server
attempts without a total wake deadline, and a separate previous-key notice.
The free-key tutorial opens below the main layout. PLUS stays pending until a
real checkout is configured. These visuals do not add payment integrations,
tiers, Sentry or provider changes.

## Entry backdrop and access card artwork

During activation, the actual GameAccess Digital interface is mounted beneath
the foreground gate. A noninteractive layer dims and softly blurs that live
application view; it is not a generated game scene or marketing illustration.
The foreground retains the animated brand, activation form, BASE and PLUS plan
comparison, and persistent footer. The normal application reveal continues
after successful activation.

BASE and PLUS use matching portrait access-card textures sized to the existing
plan panels. BASE is graphite grey. PLUS is brushed metallic titanium with a
subtle warm edge. Both leave the center and lower area matte and quiet for live
localized headings, prices, benefits and buttons. The textures contain no
words, numbers, labels, logos, codes or baked-in UI copy.

Prompt summary:
- BASE: front-facing graphite-grey security access card with restrained
  embossed perimeter detail and smooth dark text-safe center.
- PLUS: matching portrait card in brushed titanium, with a subdued metallic
  rim and the same smooth text-safe center.

The selected card assets are published to
`apps/desktop/public/brand/access-ticket-base.webp` and
`access-ticket-plus.webp` through the committed
`tools/brand/publish-entry-assets.py` helper, then synchronized from GitHub.
WebP encoding preserves the generated image dimensions. Original generated
PNGs remain in the Codex generated-images folder. The unused cinematic world
asset is removed from the desktop build.

## Responsive behavior and motion

Wide desktop uses two main columns with two equal tickets. Narrow desktop
groups the brand and form above the comparison; mobile stacks them and, below
600 px, stacks equally sized tickets. Content scrolls inside the entry surface,
above a persistent footer. Existing logo motion and startup behavior continue;
ticket hover is subtle and removed for reduced motion. Keyboard focus remains
visible and decorative images/icons are hidden from assistive technology.

## Access card spacing and centered headings

A fresh screenshot of the running desktop entry was checked against the access
card edges. Card copy keeps responsive horizontal padding; BASE and PLUS titles
remain centered with their gamepad or crown icon, with the beta label below and
price separated from the heading. The same spacing continues at narrow widths.
