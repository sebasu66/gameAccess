import type { TranslationKey } from "../i18n";

/** Canonical hierarchy from vault/Rediseño de navegación.md §2. */
export const NAVIGATION = [
  {
    id: "catalog", label: "navModeCatalog", sections: [
      { id: "explore", label: "navExplore", tabs: [] },
      { id: "smartSearch", label: "navSmartSearch", tabs: [] },
      { id: "aiSuggestions", label: "navAiSuggestions", tabs: [] },
      { id: "newGames", label: "navNewGames", tabs: [
        { id: "catalog", label: "navInCatalog" },
        { id: "downloadable", label: "navReadyToDownload" },
      ] },
      { id: "tasteProfile", label: "navTasteProfile", tabs: [] },
    ],
  },
  {
    id: "library", label: "navModeLibrary", sections: [
      { id: "play", label: "navPlay", tabs: [
        { id: "recent", label: "navLastPlayed" },
        { id: "genres", label: "navByGenre" },
        { id: "favorites", label: "navFavorites" },
        { id: "alphabetical", label: "navAlphabetical" },
      ] },
      { id: "downloads", label: "navDownloads", tabs: [
        { id: "active", label: "navActive" },
        { id: "queued", label: "navQueued" },
        { id: "completed", label: "navCompleted" },
      ] },
      { id: "manager", label: "navManager", tabs: [
        { id: "games", label: "navGames" },
        { id: "space", label: "navSpace" },
        { id: "freeze", label: "navFreeze" },
        { id: "move", label: "navMove" },
        { id: "import", label: "navImport" },
      ] },
    ],
  },
  {
    id: "gameAccess", label: "navModeGameAccess", sections: [
      { id: "news", label: "navNews", tabs: [
        { id: "release", label: "navLatestVersion" },
        { id: "announcements", label: "navAnnouncements" },
      ] },
      { id: "guide", label: "navHowToUse", tabs: [] },
      { id: "account", label: "navMyAccount", tabs: [] },
      { id: "subscription", label: "navSubscription", tabs: [] },
      { id: "help", label: "navHelpContact", tabs: [
        { id: "faq", label: "navFaq" },
        { id: "contact", label: "navContactUs" },
      ] },
    ],
  },
  {
    id: "settings", label: "navModeSettings", sections: [
      { id: "general", label: "navGeneral", tabs: [
        { id: "gamesDownloads", label: "navGamesDownloads" },
        { id: "steam", label: "navSteam" },
        { id: "ai", label: "navArtificialIntelligence" },
        { id: "other", label: "navOtherSettings" },
      ] },
      { id: "appearance", label: "navAppearance", tabs: [
        { id: "general", label: "navGeneral" },
        { id: "style", label: "navStyle" },
        { id: "details", label: "navDetails" },
      ] },
      { id: "plugins", label: "navPlugins", tabs: [] },
      { id: "parental", label: "navParental", tabs: [
        { id: "games", label: "navGames" },
        { id: "time", label: "navTime" },
        { id: "filter", label: "navFilter" },
      ] },
    ],
  },
] as const satisfies readonly {
  id: string;
  label: TranslationKey;
  sections: readonly { id: string; label: TranslationKey; tabs: readonly { id: string; label: TranslationKey }[] }[];
}[];

export type NavigationModeId = (typeof NAVIGATION)[number]["id"];

/** Existing destinations that must keep working while the new presentation is integrated. */
export const LEGACY_DESTINATIONS = {
  catalog: { explore: "catalog", smartSearch: "catalog", aiSuggestions: "home", newGames: "catalog", tasteProfile: "catalog" },
  library: { play: "play", downloads: "downloads", manager: "manager" },
  gameAccess: { news: "home", guide: "home", account: "home", subscription: "home", help: "home" },
  settings: { general: "settings", appearance: "settings", plugins: "settings", parental: "kids" },
} as const;
