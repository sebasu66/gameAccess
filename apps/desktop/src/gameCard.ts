/**
 * The player's own card for a game of the library (Seba, 2026-11-16): the name it shows, its cover, the genre that
 * represents it best and whether it is shown in Play. Steam's data stays as it is; this only corrects how the library
 * presents the game. Edited in the game's options (DigitalGameOptions › Card) and by the app's MCP tools
 * (mcp/libraryTools.ts). Keyed by Steam app id (the catalog id for a game without one), saved on this PC.
 */
import { useSyncExternalStore } from "react";
import type { CatalogGame } from "./types";

export interface GameCard {
  /** Name shown in the library instead of the store's. */
  name?: string;
  /** Cover shown instead of Steam's: a web address or a picture on this PC. */
  cover?: string;
  /** Genre concept id (genreConcepts.json) that decides the game's deck instead of the automatic one. */
  genre?: string;
  /** Not shown in Library › Play; the library manager still lists it so it can be shown again. */
  hidden?: boolean;
}

export const GAME_CARD_KEY = "gameaccess:game-card:v1";

type Cards = Readonly<Record<string, GameCard>>;

function clean(value: unknown): GameCard {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (field: unknown) => typeof field === "string" && field.trim() ? field.trim() : undefined;
  const card: GameCard = { name: text(raw.name), cover: text(raw.cover), genre: text(raw.genre), hidden: raw.hidden === true || undefined };
  return Object.fromEntries(Object.entries(card).filter(([, field]) => field !== undefined)) as GameCard;
}

function load(): Cards {
  try {
    const raw = JSON.parse(localStorage.getItem(GAME_CARD_KEY) || "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).map(([key, card]) => [key, clean(card)]).filter(([, card]) => Object.keys(card).length));
  } catch { return {}; }
}

let cards: Cards = load();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const gameCardKey = (game: Pick<CatalogGame, "app_id" | "id">) => String(game.app_id ?? game.id);

export function getGameCard(game: Pick<CatalogGame, "app_id" | "id">): GameCard {
  return cards[gameCardKey(game)] ?? {};
}

/** Replaces the card of a game; an empty card removes it (the game goes back to Steam's data). */
export function setGameCard(game: Pick<CatalogGame, "app_id" | "id">, card: GameCard): GameCard {
  const key = gameCardKey(game);
  const next = clean(card);
  const { [key]: _old, ...rest } = cards;
  cards = Object.keys(next).length ? { ...rest, [key]: next } : rest;
  try { localStorage.setItem(GAME_CARD_KEY, JSON.stringify(cards)); } catch { /* kept for this session */ }
  listeners.forEach(listener => listener());
  return next;
}

/** Every card, re-rendering when one changes. */
export const useGameCards = () => useSyncExternalStore(subscribe, () => cards, () => cards);

/** The game as the library shows it: with the card's name. The cover and genre are read where they are drawn. */
export function withGameCard<T extends CatalogGame>(game: T, all: Cards = cards): T {
  const name = all[gameCardKey(game)]?.name;
  return name && name !== game.name ? { ...game, name } : game;
}

export const isHiddenGame = (game: Pick<CatalogGame, "app_id" | "id">, all: Cards = cards) => all[gameCardKey(game)]?.hidden === true;
