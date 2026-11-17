/**
 * What only App knows how to do (App.tsx hands these over while it is on screen): start a download the way the
 * Download button does (Steam's own games through Steam) and launch a game the way Play does (launch dialog,
 * deep-frozen games thawed first, one launch at a time).
 */
import type { CatalogGame } from "../types";
import { ToolError } from "./tools";

export interface AppActions {
  download(game: CatalogGame): Promise<void>;
  play(game: CatalogGame): Promise<void>;
}

let actions: AppActions | null = null;

/** From App, on every render (its handlers close over its state). */
export function provideAppActions(next: AppActions): () => void {
  actions = next;
  return () => { if (actions === next) actions = null; };
}

export function appActions(): AppActions {
  if (!actions) throw new ToolError("Game Access is still opening; try again in a few seconds.");
  return actions;
}
