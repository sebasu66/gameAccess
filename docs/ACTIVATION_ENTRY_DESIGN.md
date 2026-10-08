# Activation entry: cinematic portal and admission tickets

The approved concept groups the brand and activation form at the left and the
access-plan comparison alongside it. The existing stabilized G/A voxel film is
preserved. Audiowide supplies the silver/orange live wordmark; Manrope supplies
headings, forms, prices and feature text. Audiowide is self-hosted with its OFL
license and FONTLOG, sourced from Google's official fonts repository.

BASE and PLUS share the same grid width, row height, content padding, ticket
silhouette, introductory text area and bottom action alignment. Their only
material distinction is a standard slate/silver ticket versus a premium gold
ticket. Distinct feature icons convey download, television, time, search,
included features, parallel downloads and speed. The footer keeps connection
status left and globe/language controls right. All live text remains localized.

The form preserves single-button activation/retry behavior, bounded server
attempts without a total wake deadline, and a separate previous-key notice.
The free-key tutorial opens below the main layout. PLUS stays pending until a
real checkout is configured. These visuals do not add payment integrations,
tiers, Sentry or provider changes.

## Generated artwork

The entry background is a generated, Baldur's Gate-inspired coastal cityscape:
a dense walled city, monumental stone bridge, harbor, storm-lit skyline and
distant nautiloid-like silhouettes. It is original illustrative artwork, not
official game art, and contains no logo or interface text. The BASE and PLUS
textures are custom matching admission tickets. The tickets have no embedded
UI text, key, barcode or price. Their quiet centers and CSS shading preserve
foreground readability.

Prompt summary:
- World: Baldur's Gate 3-inspired harbor city at dusk, Wyrm's Crossing-like
  stone bridge and crowded fortified skyline, storm clouds, warm city lights,
  distant nautiloid silhouettes, atmospheric and readable behind UI; no
  characters, logos, UI or text.
- BASE: front-facing dark slate paper admission ticket, restrained silver
  engraving, castle/mountains at top, matching stub notches and perforation.
- PLUS: preserve BASE geometry and engraving; replace slate/silver with dark
  bronze and gold foil; leave the center quiet for localized copy.

The selected assets are published to
`apps/desktop/public/brand/entry-adventure.webp`,
`access-ticket-base.webp` and `access-ticket-plus.webp` through the committed
`tools/brand/publish-entry-assets.py` helper, then synchronized from GitHub.
WebP encoding preserves original pixel dimensions and alpha. Original generated
PNGs remain in the Codex generated-images folder.

## Responsive behavior and motion

Wide desktop uses two main columns with two equal tickets. Narrow desktop
groups the brand and form above the comparison; mobile stacks them and, below
600 px, stacks equally sized tickets. Content scrolls inside the entry surface,
above a persistent footer. Existing logo motion and startup behavior continue;
ticket hover is subtle and removed for reduced motion. Keyboard focus remains
visible and decorative images/icons are hidden from assistive technology.

## Ticket border spacing and centered headings

A fresh screenshot of the running desktop entry was checked against the actual
transparent ticket image rails. Ticket copy now sits farther inside those rails
with responsive horizontal padding. BASE and PLUS titles are centered inside
the engraved upper arch with the gamepad or crown beside the name. The beta
badge sits below, and the price line is lowered to open space after the heading.
The same relationships continue at narrow card widths.
