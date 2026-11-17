/**
 * The sections' watermarks (vault/Rediseño de navegación.md §4.2): simple symbols, a fine outline with a soft fill and
 * few lines (Seba: too many lines blur what the drawing is), larger than the button and fading out behind the name.
 * Lines take the stroke, `f` parts the soft fill and `s` parts a stronger one (navigation-shell.css).
 */
import type { ReactNode } from "react";

const Art = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">{children}</svg>;

/** Explore: a magnifier. */
const explore = <Art>
  <circle className="f" cx="27" cy="27" r="17" /><path d="M18 22a11 11 0 0 1 8-6" />
  <path className="s" d="M39 37l4-4 16 16a2.8 2.8 0 0 1-4 4z" />
</Art>;

/** Smart search: a magnifier holding a spark. */
const smartSearch = <Art>
  <circle className="f" cx="27" cy="27" r="17" />
  <path className="s" d="M27 16l2.6 8.4L38 27l-8.4 2.6L27 38l-2.6-8.4L16 27l8.4-2.6z" />
  <path className="s" d="M39 37l4-4 16 16a2.8 2.8 0 0 1-4 4z" />
</Art>;

/** AI suggestions: a lit bulb. */
const aiSuggestions = <Art>
  <path className="f" d="M32 6a17 17 0 0 0-9.5 31c2.2 1.8 3.5 4 3.5 7h12c0-3 1.3-5.2 3.5-7A17 17 0 0 0 32 6z" />
  <path className="s" d="M26 48h12v4H26zM28 55h8v3h-8z" /><path d="M56 23h5M3 23h5M52 9l3-3M12 9L9 6" />
</Art>;

/** New games: a star. */
const newGames = <Art>
  <path className="f" d="M32 5l8 16.4 18 2.6-13 12.7 3 18L32 46.2 16 54.7l3-18L6 24l18-2.6z" />
</Art>;

/** Taste profile: a heart. */
const tasteProfile = <Art>
  <path className="f" d="M32 56S5 41 5 23.5A13 13 0 0 1 32 17a13 13 0 0 1 27 6.5C59 41 32 56 32 56z" />
</Art>;

/** Play: a gamepad. */
const play = <Art>
  <path className="f" d="M17 18h30c8 0 12.5 6 13.6 15.5l1.2 10.5c.8 6.8-6 9.6-10 4.8L46 42H18l-5.8 6.8c-4 4.8-10.8 2-10-4.8l1.2-10.5C4.5 24 9 18 17 18z" />
  <path className="s" d="M15 28h4v-4h4v4h4v4h-4v4h-4v-4h-4z" /><circle className="s" cx="45" cy="27" r="2.6" /><circle className="s" cx="45" cy="37" r="2.6" />
</Art>;

/** Downloads: an arrow into a tray. */
const downloads = <Art>
  <path className="f" d="M26 5h12v20h9L32 42 17 25h9z" /><path className="s" d="M7 44h50v8a5 5 0 0 1-5 5H12a5 5 0 0 1-5-5z" />
</Art>;

/** Manager: a list of games. */
const manager = <Art>
  <rect className="f" x="6" y="8" width="52" height="48" rx="4" />
  <path className="s" d="M12 16h8v8h-8zM12 28h8v8h-8zM12 40h8v8h-8z" /><path d="M26 20h24M26 32h24M26 44h18" />
</Art>;

/** News: a megaphone. */
const news = <Art>
  <path className="f" d="M12 24l28-14v44L12 40z" /><path className="s" d="M5 24h7v16H5z" /><path d="M17 40l4 14h6l-3.5-13" />
  <path d="M47 24a10 10 0 0 1 0 16M53 17a19 19 0 0 1 0 30" />
</Art>;

/** Subscription: a crown. */
const subscription = <Art>
  <path className="f" d="M9 46L5 18l14 12 13-19 13 19 14-12-4 28z" /><path className="s" d="M9 46h46v8H9z" />
</Art>;

/** Support: a life ring. */
const support = <Art>
  <circle className="f" cx="32" cy="32" r="25" /><circle cx="32" cy="32" r="11" />
  <path className="s" d="M10.4 19.5A25 25 0 0 1 19.5 10.4l6.6 11.4a11 11 0 0 0-4.3 4.3zM44.5 10.4a25 25 0 0 1 9.1 9.1l-11.4 6.6a11 11 0 0 0-4.3-4.3zM53.6 44.5a25 25 0 0 1-9.1 9.1l-6.6-11.4a11 11 0 0 0 4.3-4.3zM19.5 53.6a25 25 0 0 1-9.1-9.1l11.4-6.6a11 11 0 0 0 4.3 4.3z" />
</Art>;

/** General: three sliders. */
const general = <Art>
  <path d="M16 8v48M32 8v48M48 8v48" /><path className="s" d="M10 34h12v8H10zM26 16h12v8H26zM42 40h12v8H42z" />
</Art>;

/** Appearance: a palette. */
const appearance = <Art>
  <path className="f" d="M31 6C16 6 5 17 5 31c0 12 9 21 19.5 21 4.5 0 5.6-3.8 3.6-6.8-1.7-2.7 0-6.6 4.6-6.6H40c9 0 16-5.8 16-14.6C56 13.5 45 6 31 6z" />
  <circle className="s" cx="18" cy="24" r="4" /><circle className="s" cx="30" cy="16" r="4" /><circle className="s" cx="43" cy="21" r="4" />
</Art>;

/** Plugins: a plug. */
const plugins = <Art>
  <path className="s" d="M22 5h5v15h-5zM37 5h5v15h-5z" /><path className="f" d="M16 20h32v13a16 16 0 0 1-32 0z" /><path d="M32 49v9" />
</Art>;

/** Parental control: a shield with a child. */
const parental = <Art>
  <path className="f" d="M32 5l23 8v17c0 14-10 24-23 29C19 54 9 44 9 30V13z" />
  <circle className="s" cx="32" cy="24" r="5.5" /><path className="s" d="M22 44c0-6.5 4.5-11 10-11s10 4.5 10 11z" />
</Art>;

export const SECTION_ART: Readonly<Record<string, ReactNode>> = {
  explore, smartSearch, aiSuggestions, newGames, tasteProfile, play, downloads, manager,
  news, support, subscription, general, appearance, plugins, parental,
};
