import { setAppScreen } from "./appScreen";

/** A plugin in the on-screen list takes you to its section in Settings › Plugins. */
export const PLUGIN_SECTION_EVENT = "gameaccess:plugin-section";
let pending: string | null = null;

export function openPluginSection(id: string): void {
  pending = id;
  setAppScreen("settings");
  // Settings already open: it hears this; otherwise it takes the section when it opens.
  window.dispatchEvent(new Event(PLUGIN_SECTION_EVENT));
}
export const pluginSection = () => pending;
export function clearPluginSection(): void { pending = null; }
