import { genreLabel } from "./libraryGenres";

/**
 * What the player says about themselves for the AI (Settings › AI › Your profile; Seba, 2026-11-05): the genres they
 * like and dislike, how they play and, in their own words, what they want and avoid in a game. Everyone can edit it;
 * it goes with every request to the AI (aiSuggestions.describe), so a change also changes the saved answers.
 */

export type PlayStyle = "single" | "multi" | "both";
export const MULTIPLAYER_MODES = ["coop", "pvp", "mmo", "local", "online"] as const;
export type MultiplayerMode = (typeof MULTIPLAYER_MODES)[number];

export interface AiProfile {
  genres: Record<string, 1 | -1>;
  play: PlayStyle | null;
  modes: MultiplayerMode[];
  positive: string;
  negative: string;
}

/** Sent to the App so its thumbs follow a rating removed from the profile. */
export const PREFERENCES_CHANGED_EVENT = "gameaccess:preferences-changed";
export const AI_PROFILE_EVENT = "gameaccess:ai-profile";
export const PROFILE_TEXT_LIMIT = 500;
const KEY = "gameaccess:ai-profile";
const PREFERENCES_KEY = "gameaccess:preferences";
export const EMPTY_PROFILE: AiProfile = { genres: {}, play: null, modes: [], positive: "", negative: "" };

export function loadAiProfile(): AiProfile {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || "null") as Partial<AiProfile> | null;
    return stored ? { ...EMPTY_PROFILE, ...stored } : EMPTY_PROFILE;
  } catch { return EMPTY_PROFILE; }
}

export function saveAiProfile(profile: AiProfile) {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* the page keeps working without it */ }
  window.dispatchEvent(new Event(AI_PROFILE_EVENT));
}

/** Takes a game off the liked and disliked list. The ratings are the App's (thumbs): it is told to read them again. */
export function removeRating(gameId: number) {
  try {
    const ratings = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}") as Record<number, 1 | -1>;
    delete ratings[gameId];
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(ratings));
  } catch { return; }
  window.dispatchEvent(new Event(PREFERENCES_CHANGED_EVENT));
}

const MODE_NAMES: Record<MultiplayerMode, string> = { coop: "co-op", pvp: "PvP", mmo: "MMO", local: "local multiplayer", online: "online multiplayer" };
const PLAY_NAMES: Record<PlayStyle, string> = { single: "single player", multi: "multiplayer", both: "both single player and multiplayer" };

/** The profile as lines of the prompt; only what the player filled in. */
export function describeProfile(profile: AiProfile): string[] {
  const genres = (value: 1 | -1) => Object.entries(profile.genres).filter(([, rating]) => rating === value).map(([id]) => genreLabel(id));
  const multiplayer = profile.play === "multi" || profile.play === "both";
  const words = (title: string, text: string) => text.trim() ? `${title}: ${JSON.stringify(text.trim().slice(0, PROFILE_TEXT_LIMIT))}` : "";
  return [
    genres(1).length ? `Liked genres: ${genres(1).join("; ")}` : "",
    genres(-1).length ? `Disliked genres: ${genres(-1).join("; ")}` : "",
    profile.play ? `Prefers: ${PLAY_NAMES[profile.play]}` : "",
    multiplayer && profile.modes.length ? `Multiplayer modes they like: ${profile.modes.map(mode => MODE_NAMES[mode]).join("; ")}` : "",
    words("What they want in a game, in their own words", profile.positive),
    words("What they avoid in a game, in their own words", profile.negative),
  ].filter(Boolean);
}

export const profileSignature = (profile: AiProfile) => JSON.stringify(describeProfile(profile));
