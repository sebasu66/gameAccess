/** What the content header (§4.3) shows in each section: nothing in the game sections (their search sits with the
 *  filters, DownloadCatalogPanel), a search over what is on screen, or a summary. */
export const GAME_SEARCH_SECTIONS: readonly string[] = ["explore", "newGames", "play", "manager"];
export const PAGE_SEARCH_SECTIONS: readonly string[] = ["support", "general", "appearance", "plugins", "parental"];
export type HeaderKind = "games" | "page" | "summary";
export const headerKind = (section: string): HeaderKind =>
  GAME_SEARCH_SECTIONS.includes(section) ? "games" : PAGE_SEARCH_SECTIONS.includes(section) ? "page" : "summary";

/** Blocks a search over the screen can hide: settings groups and fields, help topics. */
export const PAGE_SEARCH_BLOCKS = ".ga-settings-group, fieldset, .ga-rail-field, .ga-help-topic";

/** Accent- and case-free text, the way the game search compares names. */
export const plainText = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Shows only the blocks under `root` whose text has every word of `query`; returns how many stayed. */
export function filterBlocks(root: ParentNode, query: string, hiddenClass = "ga-nav-filtered"): number {
  const words = plainText(query.trim()).split(/\s+/).filter(Boolean);
  let shown = 0;
  root.querySelectorAll<HTMLElement>(PAGE_SEARCH_BLOCKS).forEach(block => {
    const text = plainText(block.textContent ?? "");
    const match = words.every(word => text.includes(word));
    block.classList.toggle(hiddenClass, !match);
    if (match && words.length && block instanceof HTMLDetailsElement) block.open = true;
    if (match) shown += 1;
  });
  return shown;
}
