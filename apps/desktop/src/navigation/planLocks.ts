/**
 * What the BASE plan does not include (vault/Rediseño de navegación.md §5.12, «PLUS dice “Todo lo de BASE, más:”»):
 * AI-assisted search, suggestions from the player's profile and history, the MCP connector, and parental control
 * (kid mode is PLUS, kidMode.ts `usePlus`). In BASE those
 * sections and submodes keep their usual look with a padlock that says «Disponible en PLUS»; a click opens
 * Game Access › Suscripción.
 */
export const PLUS_SECTIONS: readonly string[] = ["smartSearch", "aiSuggestions", "tasteProfile", "parental"];
export const PLUS_TABS: Readonly<Record<string, readonly string[]>> = { general: ["mcp"] };

/** Whether a section, or one of its submodes, is locked for a player without PLUS. */
export function planLocked(plus: boolean, section: string, tab?: string): boolean {
  if (plus) return false;
  return tab === undefined ? PLUS_SECTIONS.includes(section) : PLUS_TABS[section]?.includes(tab) ?? false;
}
