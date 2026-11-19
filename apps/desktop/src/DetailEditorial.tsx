/**
 * The subtle editorial layers of the game's detail (Seba, 2026-11-17; docs/GUI_DESIGN.md §4.43): a technical grid over
 * the art and sight corners in the frame, behind the content and never read aloud. Sizes --ga-ed-* in
 * templates/base.css, colours in the flavor.
 */
import "./detail-editorial.css";

/** The file's number: the Steam app id, or a stable number drawn from the game's id. */
export function editorialNumber(appId: number | null | undefined, id: string): string {
  if (appId) return String(appId).padStart(7, "0");
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 9_999_999;
  return String(hash).padStart(7, "0");
}

export function DetailEditorial() {
  return <div className="ga-ed" aria-hidden="true">
    <div className="ga-ed-grid" />
    <i className="ga-ed-corner is-tl" /><i className="ga-ed-corner is-tr" /><i className="ga-ed-corner is-bl" /><i className="ga-ed-corner is-br" />
  </div>;
}
