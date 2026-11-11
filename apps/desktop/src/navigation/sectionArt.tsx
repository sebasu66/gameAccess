/**
 * The sections' watermarks (vault/Rediseño de navegación.md §4.2): line drawings with fine strokes and a soft fill,
 * larger than the button, so only their right half shows inside it. Each keeps its telling detail on that side.
 * Lines take the stroke, `f` parts the soft fill and `s` parts a stronger one (navigation-shell.css).
 */
import type { ReactNode } from "react";

const Art = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">{children}</svg>;

/** Explore: a magnifier over a folded map. */
const explore = <Art>
  <path className="f" d="M10 40l12-5 12 5 12-5v20l-12 5-12-5-12 5z" /><path d="M22 35v20M34 40v20" />
  <circle className="f" cx="36" cy="24" r="14" /><circle cx="36" cy="24" r="11" /><path d="M28 19a9 9 0 0 1 6-5" />
  <path d="M29 27l4-3 4 2 5-4" /><circle className="s" cx="42" cy="22" r="1.4" />
  <path className="f" d="M45 33l4 4-3 3-4-4z" /><path className="s" d="M48 38l8 8a2.5 2.5 0 0 1-3.5 3.5l-8-8z" /><path d="M51 44l-2.5 2.5M54 47l-2.5 2.5" />
</Art>;

/** Smart search: a magnifier holding a spark, with circuit traces. */
const smartSearch = <Art>
  <circle className="f" cx="28" cy="28" r="17" /><circle cx="28" cy="28" r="13.5" />
  <path className="s" d="M28 17l2.4 7.6L38 27l-7.6 2.4L28 37l-2.4-7.6L18 27l7.6-2.4z" />
  <path className="s" d="M37 18l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
  <path className="f" d="M39 40l4 4-3 3-4-4z" /><path className="s" d="M42 45l10 10a2.5 2.5 0 0 1-3.5 3.5L38.5 48.5z" />
  <path d="M46 14h6l3 3h4M47 22h8M45 30h5l2 2h6" /><circle cx="60" cy="17" r="1.3" /><circle cx="56" cy="22" r="1.3" /><circle cx="59" cy="32" r="1.3" />
</Art>;

/** AI suggestions: a lit bulb with its filament, rays and a spark. */
const aiSuggestions = <Art>
  <path className="f" d="M32 7a16 16 0 0 0-9 29.3c2.1 1.7 3 3.9 3 6.7h12c0-2.8.9-5 3-6.7A16 16 0 0 0 32 7z" />
  <path d="M27 43V33l-2.5-5M37 43V33l2.5-5M24.5 28c2.5 2 5-2 7.5 0s5-2 7.5 0" />
  <path className="s" d="M26 46h12v3H26zM27 51h10v3H27z" /><path d="M29 56h6" />
  <path d="M52 22l5-2M52 30h6M50 39l5 3M12 22l-5-2M6 30h6" />
  <path className="s" d="M53 7l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" /><path d="M44 12l-1.5 2.2M36 13.5a10 10 0 0 1 7 6" />
</Art>;

/** New games: a star with its burst and a new tag. */
const newGames = <Art>
  <path className="f" d="M28 6l6.6 13.5 14.9 2.1-10.8 10.5 2.6 14.8L28 39.9l-13.3 7 2.6-14.8L6.5 21.6l14.9-2.1z" />
  <path d="M28 14l4 8.2 9 1.3-6.5 6.4 1.5 9L28 34.6l-8 4.3 1.5-9-6.5-6.4 9-1.3z" />
  <path className="s" d="M40 44h20l-2 5 2 5H40z" /><circle cx="43.5" cy="49" r="1.2" /><path d="M47 47.5h8M47 50.5h6" />
  <path d="M50 10l3-3M54 16h4M52 26l3 2M20 54l-2 4M36 52l2 4" />
</Art>;

/** Taste profile: a heart crossed by a pulse line, with a small heart beside. */
const tasteProfile = <Art>
  <path className="f" d="M30 54S6 41 6 25.5A11.5 11.5 0 0 1 30 20a11.5 11.5 0 0 1 24 5.5C54 41 30 54 30 54z" />
  <path d="M30 48S11 38 11 26a7 7 0 0 1 13-3.5" />
  <path d="M4 34h12l3.5-7 5 14 4.5-11 3 5h10l2-3 2 3h14" />
  <path className="s" d="M54 9s-5-2.8-5-6a2.4 2.4 0 0 1 5-1 2.4 2.4 0 0 1 5 1c0 3.2-5 6-5 6z" transform="translate(0 4)" />
</Art>;

/** Play: a gamepad with its cross, buttons and sticks. */
const play = <Art>
  <path className="f" d="M17 20h30c8 0 12.5 6 13.6 15.5l1.2 10.5c.8 6.8-6 9.6-10 4.8L46 44H18l-5.8 6.8c-4 4.8-10.8 2-10-4.8l1.2-10.5C4.5 26 9 20 17 20z" />
  <path d="M14.5 30h4v-4h4v4h4v4h-4v4h-4v-4h-4z" />
  <circle className="s" cx="47" cy="27.5" r="2.3" /><circle cx="52.5" cy="33" r="2.3" /><circle className="s" cx="47" cy="38.5" r="2.3" /><circle cx="41.5" cy="33" r="2.3" />
  <circle cx="24" cy="43" r="3.5" /><circle cx="40" cy="43" r="3.5" /><path d="M28.5 27h7M22 20l2-4h16l2 4" />
</Art>;

/** Downloads: an arrow into a tray with its progress bar and speed lines. */
const downloads = <Art>
  <path className="f" d="M27 5h10v19h8L32 39 19 24h8z" />
  <path d="M7 40v12a4 4 0 0 0 4 4h42a4 4 0 0 0 4-4V40" /><path className="f" d="M7 44h50v8a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4z" />
  <path d="M13 50h38" /><path className="s" d="M13 48.8h24v2.4H13z" />
  <path d="M44 9h12M47 15h10M50 21h7M44 30l5 5" />
</Art>;

/** Manager: a game table with checkboxes, covers, names and size bars. */
const manager = <Art>
  <path className="f" d="M6 9h52v46H6z" /><path d="M6 17h52M6 27h52M6 37h52M6 47h52" />
  <path d="M9.5 20.5h4v4h-4zM9.5 30.5h4v4h-4zM9.5 40.5h4v4h-4z" /><path className="s" d="M9.5 30.5h4v4h-4z" />
  <path className="s" d="M17 19.5h6v6h-6zM17 29.5h6v6h-6zM17 39.5h6v6h-6z" />
  <path d="M26 21h14M26 24h9M26 31h12M26 34h7M26 41h15M26 44h10M10 13h10M26 13h10" />
  <path className="s" d="M45 21h10v3H45zM45 31h6v3h-6zM45 41h8v3h-8z" /><path d="M45 13h9" />
</Art>;

/** News: a megaphone with its sound waves. */
const news = <Art>
  <path className="f" d="M14 25l24-13v40L14 39z" /><path className="s" d="M7 25h7v14H7z" />
  <path d="M18 39l4 14h6l-3.5-12M38 12v40" /><path d="M20 30h4" />
  <path d="M44 24a10 10 0 0 1 0 16M49 18a18 18 0 0 1 0 28M54 12a26 26 0 0 1 0 40" />
</Art>;

/** Subscription: a crown with its jewels. */
const subscription = <Art>
  <path className="f" d="M9 45L5 18l14 12 13-19 13 19 14-12-4 27z" /><path className="s" d="M9 45h46v8H9z" />
  <circle className="s" cx="5" cy="17" r="2.6" /><circle className="s" cx="32" cy="9" r="2.6" /><circle className="s" cx="59" cy="17" r="2.6" />
  <path d="M19 30l4 15M45 30l-4 15M32 11v34" /><path d="M29 49h6M15 49h4M45 49h4" />
  <path d="M32 27l3 4-3 4-3-4z" /><path d="M50 8l2-3M55 11h3" />
</Art>;

/** Support: a life ring with its bands and rope. */
const support = <Art>
  <circle className="f" cx="32" cy="32" r="24" /><circle cx="32" cy="32" r="11" />
  <path className="s" d="M11.2 20A24 24 0 0 1 20 11.2l6.5 11.3a11 11 0 0 0-4 4zM44 11.2a24 24 0 0 1 8.8 8.8l-11.3 6.5a11 11 0 0 0-4-4zM52.8 44a24 24 0 0 1-8.8 8.8l-6.5-11.3a11 11 0 0 0 4-4zM20 52.8a24 24 0 0 1-8.8-8.8l11.3-6.5a11 11 0 0 0 4 4z" />
  <path d="M32 4.5c3 2 3 4 0 6M59.5 32c-2 3-4 3-6 0" />
  <path d="M29 29.5a3 3 0 1 1 4.2 2.7c-.8.4-1.2 1-1.2 1.8v.6M32 37.6v.4" />
</Art>;

/** General: a panel of sliders with ticks. */
const general = <Art>
  <rect className="f" x="5" y="9" width="54" height="46" rx="4" />
  <path d="M17 15v34M32 15v34M47 15v34" /><path d="M20 19h3M20 25h3M20 31h3M20 37h3M20 43h3M35 19h3M35 25h3M35 31h3M35 37h3M35 43h3M50 19h3M50 25h3M50 31h3M50 37h3M50 43h3" />
  <path className="s" d="M12.5 33h9v6h-9zM27.5 20h9v6h-9zM42.5 38h9v6h-9z" />
</Art>;

/** Appearance: a palette with paint and a brush. */
const appearance = <Art>
  <path className="f" d="M30 7C16 7 5 17.5 5 31c0 11.5 8.5 20 18.5 20 4.5 0 5.5-3.7 3.6-6.6-1.6-2.6 0-6.4 4.4-6.4H39c8.5 0 15-5.5 15-14C54 14 43 7 30 7z" />
  <circle className="s" cx="18" cy="23" r="3.6" /><circle className="s" cx="29" cy="16" r="3.6" /><circle className="s" cx="41" cy="20" r="3.6" /><circle cx="15" cy="35" r="3.2" />
  <path d="M60 28L43 47M57 25l6 6" /><path className="s" d="M43 47c-3.2.8-6 4.6-5.2 9 4.2 1 8.4-2 9.2-5.2z" /><path d="M41 49l4 4" />
</Art>;

/** Plugins: a plug with its cable and a charge. */
const plugins = <Art>
  <path d="M25 6v14M39 6v14" /><path className="s" d="M23 5h4v4h-4zM37 5h4v4h-4z" />
  <path className="f" d="M19 20h26v14a13 13 0 0 1-26 0z" /><path d="M19 26h26" />
  <path className="s" d="M33.5 29l-5 8h5l-3 7 7-10h-5l2-5z" />
  <path d="M32 47v4c0 6 5 8 11 8h16M49 13l4-4M53 20h5M49 27l4 3" />
</Art>;

/** Parental control: a shield with a child and a clock. */
const parental = <Art>
  <path className="f" d="M30 5l22 8v16c0 14-10 24-22 29C18 53 8 43 8 29V13z" /><path d="M30 10l17 6v13c0 11-7.5 19-17 23" />
  <circle cx="25" cy="23" r="4.5" /><path d="M17 40c0-5.5 3.5-9 8-9s8 3.5 8 9" />
  <circle className="s" cx="50" cy="49" r="8" /><circle cx="50" cy="49" r="6" /><path d="M50 45v4l3 2M50 42.2v.9M56.8 49h-.9" />
</Art>;

export const SECTION_ART: Readonly<Record<string, ReactNode>> = {
  explore, smartSearch, aiSuggestions, newGames, tasteProfile, play, downloads, manager,
  news, support, subscription, general, appearance, plugins, parental,
};
