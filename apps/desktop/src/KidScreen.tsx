import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppWindow, Gamepad2, LogOut, Move } from "lucide-react";
import { useI18n } from "./i18n";
import { GaButton } from "./components/ga/Buttons";
import { focusCard } from "./BigScreenControls";
import { GamepadInput } from "./gamepadInput";
import { confirmNotice, showNotice } from "./notice/notice";
import { narrate } from "./narrationLog";
import { landscapeArt, readKidSession, type KidGame, type KidSession } from "./kidMode";
import { resolveLibraryCover } from "./libraryCoverResolver";
import LaunchDialog from "./LaunchDialog";
import { beginLaunch, closeLaunch, getLaunch, launchFailed, launchLocked, launchOpened, useLaunch } from "./launchSession";
import { applyKidScale } from "./kidScale";
import type { CatalogGame } from "./types";
import "./big-picture.css";
import "./kid-screen.css";

/**
 * A child's account (kidMode.ts): Game Access is the whole screen and stays in big picture mode, with only the games
 * the adult chose and the time left today. Mouse, keyboard (arrows, Enter) and controller (stick, A) all play; there is
 * no way out of the mode but "Leave", which signs the child out of Windows.
 */
const KID_CARDS = ".ga-kid-card";
const FIVE_MINUTES = 300;
const SIGN_OUT_AFTER_MS = 60_000;
/** The launch dialog holds the screen until the game opens; kid_mode.rs gives up after 90 s, this is only a backstop. */
const OPEN_WAIT_MS = 120_000;
const pause = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

/** The game as the launch dialog takes it. */
const launchGameOf = (game: KidGame): CatalogGame => ({ id: game.appId, slug: "", name: game.name, app_id: game.appId > 0 ? game.appId : null,
  credit_cost_per_hour: 0, copies_total: 0, copies_available: 0 });

/** Waits until the game the child started is running (kid_game_open); rejects when it never opened. */
async function waitUntilOpen(demo: boolean): Promise<void> {
  if (demo) { await pause(3000); if (new URLSearchParams(window.location.search).has("launchFail")) throw "did_not_open"; return; }
  const deadline = Date.now() + OPEN_WAIT_MS;
  while (Date.now() < deadline) {
    const open = await invoke<boolean | null>("kid_game_open");
    if (open) return;
    if (open === null) throw "did_not_open";
    await pause(1000);
  }
  throw "did_not_open";
}

/**
 * Which games show large (Seba, 2026-10-31): a bento of two sizes only, portrait and landscape, the landscape three
 * times as large. Large: what the child played this week (most played first), then the adult's liked or most played
 * games (`featured`, set when kid mode was applied). With neither, some at random, the same all day. About a quarter of
 * the games, none among fewer than three.
 */
export function wideGames(games: KidGame[], recent: number[] = [], today = new Date().toISOString().slice(0, 10)): Set<number> {
  if (games.length < 3) return new Set();
  const limit = Math.max(1, Math.round(games.length / 4));
  const ids = new Set(games.map(game => game.appId));
  const ranked = [...new Set([...recent.filter(id => ids.has(id)), ...games.filter(game => game.featured).map(game => game.appId)])];
  if (ranked.length) return new Set(ranked.slice(0, limit));
  const shuffle = (id: number) => [...`${today}:${id}`].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
  return new Set([...games].sort((a, b) => shuffle(a.appId) - shuffle(b.appId)).slice(0, limit).map(game => game.appId));
}

/** A card's picture: the one the adult's Game Access found, else the one this account finds, else the other shape;
 *  without any, the card shows its name on the plain background. */
function KidArt({ game, wide }: { game: KidGame; wide: boolean }) {
  const [found, setFound] = useState<string | null>(null);
  useEffect(() => {
    if (wide || game.cover || game.appId <= 0) return;
    let live = true;
    void resolveLibraryCover(game.appId, "2x").then(url => { if (live) setFound(url); }).catch(() => undefined);
    return () => { live = false; };
  }, [game.appId, game.cover, wide]);
  const header = game.appId > 0 ? game.header || landscapeArt(game.appId) : "";
  const sources = [...new Set((wide ? [header, game.cover] : [game.cover, found ?? "", header]).filter(Boolean))] as string[];
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [sources.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const source = sources[index];
  return <span className="ga-kid-art">
    {game.appId > 0 ? <Gamepad2 size={40} aria-hidden="true" /> : <AppWindow size={40} aria-hidden="true" />}
    {source ? <img key={source} src={source} alt="" draggable={false} onError={() => setIndex(current => current + 1)} /> : null}
  </span>;
}

export default function KidScreen({ initial, demo = false }: { initial: KidSession; demo?: boolean }) {
  const { t } = useI18n();
  const [session, setSession] = useState(initial);
  const [error, setError] = useState("");
  const warned = useRef(false);
  const signOut = () => { if (!demo) void invoke("kid_sign_out"); };
  const launch = useLaunch();
  const [launchText, setLaunchText] = useState("");

  // The screen's size follows the monitor: its resolution and Windows' scale (kidScale.ts).
  useEffect(() => applyKidScale(), []);

  useEffect(() => {
    document.body.classList.add("ga-big-screen", "ga-kid-screen");
    if (!demo) void invoke("window_set_big_screen", { on: true }).catch(() => undefined);
    const timer = window.setTimeout(() => document.querySelector<HTMLElement>(KID_CARDS)?.focus(), 300);
    return () => { window.clearTimeout(timer); document.body.classList.remove("ga-big-screen", "ga-kid-screen"); };
  }, [demo]);

  useEffect(() => {
    if (demo) return;
    const timer = window.setInterval(() => { void readKidSession().then(next => { if (next) setSession(next); }); }, 5000);
    return () => window.clearInterval(timer);
  }, [demo]);

  // Kid mode's guard (kid_mode.rs) closed something Steam started that is not one of the child's games: say why.
  useEffect(() => {
    if (demo) return;
    let stop: (() => void) | undefined;
    let live = true;
    void listen<string>("gameaccess:kid-blocked", event => showNotice({ tone: "info", title: t("kidBlockedTitle"), text: t("kidBlockedText", { name: event.payload }) }))
      .then(unlisten => { if (live) stop = unlisten; else unlisten(); });
    return () => { live = false; stop?.(); };
  }, [demo, t]);

  const left = session.remainingSeconds;
  useEffect(() => {
    if (left == null || left <= 0 || left > FIVE_MINUTES || warned.current) return;
    warned.current = true;
    showNotice({ tone: "info", title: t("kidFiveMinutesTitle"), text: t("kidFiveMinutesText") });
  }, [left, t]);

  // The day's time is over, or kid mode is paused (PLUS ended): the game was closed; a minute later the child is signed out if nobody pressed "Leave".
  const over = session.timeUp || Boolean(session.paused);
  useEffect(() => {
    if (!over || demo) return;
    const timer = window.setTimeout(signOut, SIGN_OUT_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [over, demo]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Seconds left of a game's own limit today; undefined when it has none. */
  const gameLeft = (game: KidGame) => game.dailyMinutes ? session.gameRemaining?.[String(game.appId)] ?? game.dailyMinutes * 60 : undefined;
  const spent = (game: KidGame) => gameLeft(game) === 0;

  const play = async (game: KidGame, afterClosing = false): Promise<void> => {
    setError("");
    // While a game is starting the launch dialog holds the screen: another tap, Enter or A starts nothing.
    if (over || (launchLocked() && !afterClosing)) return;
    if (spent(game)) { setError(t("kidGameSpent")); return; }
    // The launch dialog, as on the adult's account (App.tsx launchGame), from the tap until the game is running.
    // Steam's sign-in window does not fill in the account the first time on this Windows account: the dialog names it.
    setLaunchText(game.steam ? game.steamAccount ? t("kidLaunchSteamAccount", { account: game.steamAccount }) : t("kidLaunchSteamDetail") : "");
    const run = getLaunch()?.game.id === game.appId && afterClosing ? getLaunch()! : beginLaunch(launchGameOf(game));
    try {
      if (!demo) await invoke("kid_play", { appId: game.appId });
      setSession(current => ({ ...current, playing: game.appId }));
      await waitUntilOpen(demo);
      launchOpened(run.id);
    } catch (failure) {
      const code = String(failure);
      // Another game is open (Seba, 2026-10-31): the child chooses, close it and open this one, or leave it be.
      if (code === "already_playing" && !afterClosing && !demo) {
        closeLaunch(run.id);
        const before = session.kid.games.find(item => item.appId === session.playing)?.name;
        const swap = await confirmNotice({ title: t("kidSwapTitle"), text: before ? t("kidSwapText", { before, name: game.name }) : t("kidSwapTextUnknown", { name: game.name }),
          confirmLabel: t("kidSwapConfirm"), cancelLabel: t("kidSwapCancel"), kind: "primary" });
        if (!swap) return;
        const again = beginLaunch(launchGameOf(game));
        try { await invoke("kid_stop_playing"); }
        catch { launchFailed(again.id, t("kidSwapFailed")); return; }
        setSession(current => ({ ...current, playing: null }));
        return play(game, true);
      }
      if (code === "did_not_open") setSession(current => ({ ...current, playing: current.playing === game.appId ? null : current.playing }));
      const expected = ["time_up", "paused", "game_time_up", "already_playing", "did_not_open"].includes(code);
      const text = code === "time_up" ? t("kidTimeUpTitle") : code === "paused" ? t("kidPausedTitle") : code === "game_time_up" ? t("kidGameSpent")
        : code === "already_playing" ? t("kidAlreadyPlaying") : code === "no_executable" ? t("kidNoExecutable", { name: game.name })
        : code === "did_not_open" ? t("kidLaunchNotOpened", { name: game.name }) : t("kidPlayFailedDetail", { name: game.name, error: code });
      launchFailed(run.id, text);
      // Kept in the child's log by kid_mode.rs; an unexpected one also reaches the server.
      if (!expected) void narrate(`Kid mode: ${game.name} (${game.appId}) did not start: ${code}`, { area: "KID_MODE", level: "ERROR" });
    }
  };
  const latest = useRef({ play, games: session.kid.games }); latest.current = { play, games: session.kid.games };
  const wide = useMemo(() => wideGames(session.kid.games, session.recent), [session.kid.games, session.recent]);

  // Keyboard: arrows move between the games, Enter plays the focused one; Escape and F11 do nothing here.
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === "F11" || event.key === "F5") { event.preventDefault(); event.stopPropagation(); return; }
      // The launch dialog is up: its own keys (Tab, Enter, Escape once it can close) and nothing behind it.
      if (getLaunch()) { if (event.key.startsWith("Arrow")) event.preventDefault(); return; }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); return; }
      const direction = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const)[event.key as "ArrowLeft"];
      if (direction) { event.preventDefault(); focusCard(direction, KID_CARDS); }
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, []);

  // Controller: the stick or the pad moves, A plays.
  useEffect(() => {
    const input = new GamepadInput();
    let frame = 0;
    const tick = (now: number) => {
      const pad = Array.from(navigator.getGamepads?.() ?? []).find(item => item?.connected && item.mapping === "standard");
      if (pad && document.hasFocus()) {
        for (const action of input.read(pad, now)) {
          // The launch dialog is up: A presses its button (once it has one), nothing else moves.
          if (getLaunch()) { if (action === "accept") document.querySelector<HTMLElement>(".ga-launch footer button, .ga-launch .ga-launch-close")?.click(); continue; }
          if (action === "left" || action === "right" || action === "up" || action === "down") focusCard(action, KID_CARDS);
          else if (action === "accept") {
            const id = Number(document.activeElement?.closest<HTMLElement>(KID_CARDS)?.dataset.kidGame);
            const game = latest.current.games.find(item => item.appId === id);
            if (game) void latest.current.play(game);
            else document.querySelector<HTMLElement>(KID_CARDS)?.focus();
          }
        }
      } else input.reset();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const minutes = left == null ? null : Math.ceil(left / 60);
  const time = minutes == null ? t("kidNoLimit") : minutes <= 0 ? t("kidNoTimeLeft") : t("kidTimeLeft", { minutes: String(minutes) });
  const playing = session.kid.games.find(game => game.appId === session.playing);
  return <main className="ga-kid-root">
    <header className="ga-kid-head">
      <div><span className="eyebrow">GAME ACCESS</span><h1>{t("kidHello", { name: session.kid.name })}</h1></div>
      <p className={minutes != null && minutes <= 5 ? "ga-kid-time is-low" : "ga-kid-time"} role="status">{time}</p>
      <GaButton icon={<LogOut size={18} aria-hidden="true" />} onClick={signOut}>{t("kidLeave")}</GaButton>
    </header>
    {session.kid.games.length ? <div className="ga-kid-games"><div className="ga-kid-grid">
      {session.kid.games.map(game => <button key={game.appId} type="button" className={`ga-kid-card${wide.has(game.appId) ? " is-wide" : ""}${game.appId === session.playing ? " is-playing" : ""}${spent(game) ? " is-spent" : ""}`} data-kid-game={game.appId} onClick={() => void play(game)} aria-label={t("kidPlayAria", { name: game.name })}>
        <KidArt game={game} wide={wide.has(game.appId)} />
        <span className="ga-kid-label"><span className="ga-kid-name">{game.name}</span></span>
        {gameLeft(game) != null ? <span className="ga-kid-left">{spent(game) ? t("kidGameSpent") : t("kidGameLeft", { minutes: String(Math.ceil(gameLeft(game)! / 60)) })}</span> : null}
      </button>)}
    </div></div> : <p className="ga-kid-empty">{t("kidNoGames")}</p>}
    {error ? <p className="ga-kid-error" role="alert">{error}</p> : null}
    <p className="ga-big-picture-label" role="status"><Gamepad2 size={20} aria-hidden="true" /><strong>{playing ? t("kidPlaying", { name: playing.name }) : t("bigPictureTitle")}</strong>
      <span className="ga-pad-legend"><span className="ga-pad-key is-a">A</span>{t("kidPlayKeys")}</span>
      <span className="ga-pad-legend"><span className="ga-pad-key"><Move size={15} strokeWidth={2.4} aria-hidden="true" /></span>{t("kidMoveKeys")}</span></p>
    {launch ? <LaunchDialog session={launch} kid text={launchText} /> : null}
    {over ? <div className="ga-kid-over" role="alertdialog" aria-labelledby="ga-kid-over-title">
      <section><h2 id="ga-kid-over-title">{session.paused ? t("kidPausedTitle") : t("kidTimeUpTitle")}</h2><p>{session.paused ? t("kidPausedText") : t("kidTimeUpText")}</p>
        <GaButton variant="primary" icon={<LogOut size={18} aria-hidden="true" />} onClick={signOut} autoFocus>{t("kidLeave")}</GaButton></section>
    </div> : null}
  </main>;
}
