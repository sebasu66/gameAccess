/**
 * Library › Play › By genre: one deck per genre, each game only in the deck of its main genre, or the one the player
 * chose in the game's card (gameCard.ts) (vault/Rediseño de navegación.md §5.9).
 * Only INSTALLED games are shown here (Seba, 2026-11-16: a library can hold hundreds of games); the ones to install are
 * in the library manager and in the common view, which already has its sorting and pages. Each deck has a muted colour plate behind it, like the profile art in the first column, with the genre's
 * name as a big cropped word; closed, a deck is four cards fanned out with the first game in front and "+N" when there are
 * more; on hover it opens a little. A click deals the cards out of the pile across the whole row (GSAP, one after another,
 * a little turned, like cards on a table; the plate itself, or its circle, opens and closes it) and the other decks slide to their new place (Flip); closing gathers the cards
 * back into the pile first. Opening another closes this one, in that order: both go through the transition queue.
 * The cards are printed cards (paper border, scratches blended on top, a flash that follows the pointer). "✕ Close" and
 * Esc close the deck; Tab reaches a deck, Enter or Space opens it. Only the first DEAL_MAX cards are animated and the
 * cards below the fold are not painted until they are near (content-visibility), so a deck of hundreds stays light.
 * Layout only here: sizes are in templates/base.css (`--ga-deck-*`), the look in the flavour.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Flip, gsap, motionOk } from "./motion/gsap";
import { queueTransition } from "./motion/transitions";
import { useI18n } from "./i18n";
import { gameStateManager } from "./GameStateManager";
import { useLibraryScan } from "./libraryScan";
import { genreLabel, primaryGenre } from "./libraryGenres";
import { getGameCard, useGameCards } from "./gameCard";
import SteamCover from "./SteamCover";
import type { DownloadMap } from "./LibraryRoomParts";
import type { CatalogGame } from "./types";
import "./library-decks.css";

/** Cards shown in a closed deck's fan. */
const FAN = 4;
/** Cards of an open deck that are animated when it opens or closes; the rest simply appear. */
const DEAL_MAX = 24;
const NO_GENRE = "__none";

interface Deck { id: string; label: string; games: CatalogGame[] }

/**
 * The games grouped by genre, each game in ONE deck, its main genre (primaryGenre): the biggest decks first, the games
 * with no genre in one deck at the end. A genre chosen in the game's card wins over the automatic one.
 */
export function genreDecks(games: readonly CatalogGame[], noGenreLabel: string): Deck[] {
  const byGenre = new Map<string, CatalogGame[]>();
  for (const game of games) {
    const id = getGameCard(game).genre ?? primaryGenre(game) ?? NO_GENRE;
    const list = byGenre.get(id);
    if (list) list.push(game); else byGenre.set(id, [game]);
  }
  const decks = [...byGenre].filter(([id]) => id !== NO_GENRE).map(([id, list]) => ({ id, label: genreLabel(id), games: list }))
    .sort((a, b) => b.games.length - a.games.length || a.label.localeCompare(b.label));
  const rest = byGenre.get(NO_GENRE);
  return rest ? [...decks, { id: NO_GENRE, label: noGenreLabel, games: rest }] : decks;
}

/** A deck's own muted hue, the same every time for the same genre. */
const hueOf = (id: string) => [...id].reduce((hue, character) => (hue * 31 + character.charCodeAt(0)) % 360, 7);

/** The card's light: a camera flash on its surface, where the pointer is (CSS reads --ga-glare-x / --ga-glare-y). */
function glareFollows(event: PointerEvent<HTMLElement>) {
  const art = event.currentTarget.querySelector<HTMLElement>(".ga-deck-art");
  if (!art) return;
  const box = art.getBoundingClientRect();
  art.style.setProperty("--ga-glare-x", `${Math.round((event.clientX - box.left) / box.width * 100)}%`);
  art.style.setProperty("--ga-glare-y", `${Math.round((event.clientY - box.top) / box.height * 100)}%`);
}

interface Props {
  games: CatalogGame[];
  downloads: DownloadMap;
  /** The index of a game in the library's list: the room opens its detail with it. */
  indexes: Map<number, number>;
  onSelect: (index: number, openDetails?: boolean) => void;
}

/** A small pulse of the deck's circle when it is toggled: the click is answered at once, before the cards move. */
function pulse(deck: HTMLElement) {
  const ring = deck.querySelector(".ga-deck-ring");
  if (ring && motionOk()) gsap.fromTo(ring, { scale: .85 }, { scale: 1, duration: .5, ease: "back.out(2.4)", clearProps: "transform" });
}

/**
 * What the next layout change must animate: where the other decks and the deck's mat were, where the opening deck's pile
 * was (`deck`), or which deck just closed (`closed`).
 */
interface Job { others: Flip.FlipState | null; plate: Flip.FlipState | null; deck: string | null; closed: string | null; pile: DOMRect | null }

/**
 * The beats (Seba, 2026-11-16). Opening: the other decks move aside, then the deck's mat grows, then the cards are dealt.
 * Closing is the same backwards: the cards gather, the mat shrinks, then the others come back. Seconds from the click.
 */
const BEAT = { others: .55, mat: .65, deal: .7, matAfterOthers: .35, dealAfterMat: .75, othersAfterMat: .5 };

export default function LibraryGenreDecks({ games, downloads, indexes, onSelect }: Props) {
  const { t } = useI18n();
  const scan = useLibraryScan();
  // The same test the bento uses to tell an installed game from one to install (LibraryBento.tsx).
  const folders = useMemo(() => new Map(scan.games.filter(entry => entry.app_id != null && entry.state !== "steam_owned").map(entry => [entry.app_id as number, entry])), [scan.games]);
  const installed = useMemo(() => {
    const installed: CatalogGame[] = [];
    for (const game of games) {
      const state = gameStateManager.resolve((game.app_id ? downloads[game.app_id] : undefined) ?? downloads[game.id]);
      const entry = game.app_id ? folders.get(game.app_id) : undefined;
      if (state.installed || state.prepared || entry?.installed || entry?.misnamed) installed.push(game);
    }
    return installed;
  }, [games, downloads, folders]);
  const cards = useGameCards();
  const decks = useMemo(() => genreDecks(installed, t("bigPictureNoGenre")), [installed, t, cards]);

  const [openId, setOpenId] = useState<string | null>(null);
  const wanted = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const job = useRef<Job | null>(null);
  const deckEl = (id: string) => root.current?.querySelector<HTMLElement>(`[data-deck="${CSS.escape(id)}"]`) ?? null;
  const cardsOf = (id: string) => [...(deckEl(id)?.querySelectorAll<HTMLElement>(".ga-deck-card") ?? [])];
  const othersOf = (id: string) => [...(root.current?.children ?? [])].filter(child => child !== deckEl(id));

  /** Opening: remember where the others, the mat and the pile are, change the layout, and let the layout effect play the beats. */
  const openStep = (id: string) => () => {
    const el = deckEl(id);
    if (!el || !motionOk()) { setOpenId(id); return; }
    const front = el.querySelector(".ga-deck-card[data-fan=\"3\"]") ?? el.querySelector(".ga-deck-card");
    job.current = { others: Flip.getState(othersOf(id)), plate: Flip.getState(el.querySelector(".ga-deck-plate")), deck: id, closed: null, pile: front?.getBoundingClientRect() ?? null };
    setOpenId(id);
    return gsap.timeline().to({}, { duration: BEAT.dealAfterMat + BEAT.deal + .5 });
  };

  /** Closing: the cards gather into a pile (the last ones first); then the layout changes, the mat shrinks and the others come back. */
  const closeStep = (id: string) => () => {
    const el = deckEl(id);
    const cards = cardsOf(id);
    if (!el || !cards.length || !motionOk()) { setOpenId(null); return; }
    // A deal still in flight stops where it is: the pile is measured from the cards' resting places.
    gsap.killTweensOf(cards);
    gsap.set(cards, { clearProps: "transform,opacity" });
    const dealt = cards.slice(0, DEAL_MAX), extra = cards.slice(DEAL_MAX);
    const pile = dealt[0].getBoundingClientRect();
    const moves = dealt.map(card => { const box = card.getBoundingClientRect(); return { x: pile.left - box.left, y: pile.top - box.top }; });
    const timeline = gsap.timeline();
    if (extra.length) timeline.to(extra, { opacity: 0, duration: .2 }, 0);
    timeline.to(dealt, { x: index => moves[index].x, y: index => moves[index].y, rotation: () => gsap.utils.random(-9, 9), scale: .94, duration: .5, ease: "power3.inOut", stagger: { each: .02, from: "end" } }, 0)
      .call(() => {
        gsap.set(cards, { clearProps: "transform,opacity" });
        job.current = { others: Flip.getState(othersOf(id)), plate: Flip.getState(el.querySelector(".ga-deck-plate")), deck: null, closed: id, pile: null };
        setOpenId(null);
      })
      .to({}, { duration: BEAT.othersAfterMat + BEAT.others });
    return timeline;
  };

  /** One request at a time, in order: closing the open deck and then opening another never overlap. */
  const request = (target: string | null) => {
    const before = wanted.current;
    if (before === target) return;
    wanted.current = target;
    if (before) void queueTransition(closeStep(before), "deck-close");
    if (target) void queueTransition(openStep(target), "deck-open");
  };

  useLayoutEffect(() => {
    const work = job.current;
    job.current = null;
    if (!work) return;
    const closing = !work.deck;
    // The beats, in order. Opening: others (0), mat (after them), cards (after the mat). Closing: mat (0), others (after it).
    const othersAt = closing ? BEAT.othersAfterMat : 0;
    const matAt = closing ? 0 : BEAT.matAfterOthers;
    if (work.others) Flip.from(work.others, { duration: BEAT.others, ease: "power3.inOut", delay: othersAt, clearProps: "transform" });
    const target = work.deck ?? work.closed;
    const el = target ? deckEl(target) : null;
    if (work.plate && el) Flip.from(work.plate, { duration: BEAT.mat, ease: "expo.inOut", delay: matAt });
    if (!el) return;
    if (closing) {
      // The closed deck's cards and count come back once the mat has settled.
      gsap.fromTo([el.querySelector(".ga-deck-head"), ...cardsOf(target as string)], { opacity: 0 }, { opacity: 1, duration: .3, delay: BEAT.mat * .6, clearProps: "opacity" });
      return;
    }
    const cards = cardsOf(work.deck as string);
    const dealt = cards.slice(0, DEAL_MAX), extra = cards.slice(DEAL_MAX);
    const pile = work.pile;
    const moves = dealt.map(card => { const box = card.getBoundingClientRect(); return pile ? { x: pile.left - box.left, y: pile.top - box.top } : { x: 0, y: 0 }; });
    // Dealt from the pile once the mat has grown: each card flies from where the deck's front card was, a little turned,
    // and settles flat, with a small overshoot (not a straight line).
    gsap.fromTo(dealt, { x: index => moves[index].x, y: index => moves[index].y, rotation: () => gsap.utils.random(-12, 12), scale: .9 },
      { x: 0, y: 0, rotation: 0, scale: 1, duration: BEAT.deal, ease: "back.out(1.25)", delay: BEAT.dealAfterMat, stagger: { each: .03 }, clearProps: "transform" });
    if (extra.length) gsap.fromTo(extra, { opacity: 0 }, { opacity: 1, duration: .4, delay: BEAT.dealAfterMat + .3, clearProps: "opacity" });
    gsap.fromTo(el.querySelector(".ga-deck-head"), { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: .4, delay: BEAT.dealAfterMat, clearProps: "transform,opacity" });
    gsap.delayedCall(BEAT.dealAfterMat, () => el.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }, [openId]);

  // Only the cards near the screen carry their scratches and light (a deck of hundreds would blend hundreds of layers).
  useEffect(() => {
    if (!openId) return;
    const watcher = new IntersectionObserver(entries => entries.forEach(entry => entry.target.classList.toggle("is-near", entry.isIntersecting)), { rootMargin: "300px" });
    cardsOf(openId).forEach(card => watcher.observe(card));
    return () => watcher.disconnect();
  }, [openId]);

  useEffect(() => {
    if (!openId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      const id = openId;
      request(null);
      root.current?.querySelector<HTMLElement>(`[data-deck="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  });

  if (!decks.length) return null;
  return <div ref={root} className="ga-decks">
      {decks.map(deck => {
        const open = deck.id === openId;
        // A deck of one card does not open (Seba, 2026-11-16): its mat stays as it is and the card opens its game, like
        // any card of the library.
        const single = deck.games.length === 1;
        const openGame = () => { const at = indexes.get(deck.games[0].id); if (at != null) onSelect(at); };
        return <div key={deck.id} data-deck={deck.id} className={open ? "ga-deck is-open" : single ? "ga-deck is-single" : "ga-deck"} style={{ "--ga-deck-hue": hueOf(deck.id), "--ga-deck-chars": Math.max(4, deck.label.length) } as CSSProperties}
          role="button" tabIndex={open ? -1 : 0} aria-expanded={single ? undefined : open}
          aria-label={single ? t("deckSingleAria", { name: deck.label, game: deck.games[0].name }) : t("deckAria", { name: deck.label, n: deck.games.length })}
          onClick={event => { if (single) { openGame(); return; } pulse(event.currentTarget); request(open ? null : deck.id); }}
          onKeyDown={event => { if (!open && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); if (single) openGame(); else request(deck.id); } }}>
          <span className="ga-deck-plate" aria-hidden="true"><span className="ga-deck-word">{deck.label}</span><svg className="ga-deck-ring" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" /><circle className="ga-deck-ring-dot" cx="24" cy="24" r="4" /></svg></span>
          <div className="ga-deck-head">
            <small className="ga-deck-count">{single ? t("deckOneGame") : t("deckGames", { n: deck.games.length })}</small>
            {open ? <button type="button" className="ga-deck-close" onClick={event => { event.stopPropagation(); request(null); }} aria-label={t("deckCloseAria", { name: deck.label })}>✕ {t("deckClose")}</button> : null}
          </div>
          <div className="ga-deck-stack">
            {(open ? deck.games : deck.games.slice(0, FAN)).map((game, index) => <button type="button" key={game.id}
              className="ga-deck-card" data-fan={open ? undefined : FAN - 1 - index} data-library-game-id={game.id}
              tabIndex={open ? 0 : -1} aria-label={game.name} onPointerMove={glareFollows}
              onClick={event => { event.stopPropagation(); const at = indexes.get(game.id); if (at != null) onSelect(at); }}>
              <span className="ga-deck-art"><span className="ga-deck-face"><SteamCover game={game} /></span></span>
              {open ? <span className="ga-deck-title">{game.name}</span> : null}
            </button>)}
            {!open && deck.games.length > FAN ? <span className="ga-deck-more" aria-hidden="true">+{deck.games.length - FAN}</span> : null}
            <i className="ga-deck-glow" aria-hidden="true" />
          </div>
        </div>;
      })}
  </div>;
}
