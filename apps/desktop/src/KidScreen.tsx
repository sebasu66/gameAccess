import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppWindow, Gamepad2, LogOut, Move } from "lucide-react";
import { useI18n } from "./i18n";
import { GaButton } from "./components/ga/Buttons";
import { focusCard } from "./BigScreenControls";
import { GamepadInput } from "./gamepadInput";
import { showNotice } from "./notice/notice";
import { readKidSession, type KidGame, type KidSession } from "./kidMode";
import "./big-picture.css";
import "./kid-mode.css";

/**
 * A child's account (kidMode.ts): Game Access is the whole screen and stays in big picture mode, with only the games
 * the adult chose and the time left today. Mouse, keyboard (arrows, Enter) and controller (stick, A) all play; there is
 * no way out of the mode but "Leave", which signs the child out of Windows.
 */
const KID_CARDS = ".ga-kid-card";
const FIVE_MINUTES = 300;
const SIGN_OUT_AFTER_MS = 60_000;
const cover = (appId: number) => `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;

export default function KidScreen({ initial, demo = false }: { initial: KidSession; demo?: boolean }) {
  const { t } = useI18n();
  const [session, setSession] = useState(initial);
  const [error, setError] = useState("");
  const warned = useRef(false);
  const signOut = () => { if (!demo) void invoke("kid_sign_out"); };

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

  const left = session.remainingSeconds;
  useEffect(() => {
    if (left == null || left <= 0 || left > FIVE_MINUTES || warned.current) return;
    warned.current = true;
    showNotice({ tone: "info", title: t("kidFiveMinutesTitle"), text: t("kidFiveMinutesText") });
  }, [left, t]);

  // The day's time is over: the game was closed; a minute later the child is signed out if nobody pressed "Leave".
  useEffect(() => {
    if (!session.timeUp || demo) return;
    const timer = window.setTimeout(signOut, SIGN_OUT_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [session.timeUp, demo]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = async (game: KidGame) => {
    setError("");
    if (session.timeUp) return;
    try {
      if (!demo) await invoke("kid_play", { appId: game.appId });
      setSession(current => ({ ...current, playing: game.appId }));
    } catch (failure) {
      const code = String(failure);
      setError(code === "time_up" ? t("kidTimeUpTitle") : code === "already_playing" ? t("kidAlreadyPlaying") : t("kidPlayFailed", { name: game.name }));
    }
  };
  const latest = useRef({ play, games: session.kid.games }); latest.current = { play, games: session.kid.games };

  // Keyboard: arrows move between the games, Enter plays the focused one; Escape and F11 do nothing here.
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "F11" || event.key === "F5") { event.preventDefault(); event.stopPropagation(); return; }
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
    {session.kid.games.length ? <div className="ga-kid-grid">
      {session.kid.games.map(game => <button key={game.appId} type="button" className={game.appId === session.playing ? "ga-kid-card is-playing" : "ga-kid-card"} data-kid-game={game.appId} onClick={() => void play(game)} aria-label={t("kidPlayAria", { name: game.name })}>
        <span className="ga-kid-art">{game.appId > 0 ? <Gamepad2 size={40} aria-hidden="true" /> : <AppWindow size={40} aria-hidden="true" />}{game.appId > 0 ? <img src={cover(game.appId)} alt="" draggable={false} onError={event => { event.currentTarget.hidden = true; }} /> : null}</span>
        <span className="ga-kid-name">{game.name}</span>
      </button>)}
    </div> : <p className="ga-kid-empty">{t("kidNoGames")}</p>}
    {error ? <p className="ga-kid-error" role="alert">{error}</p> : null}
    <p className="ga-big-picture-label" role="status"><Gamepad2 size={20} aria-hidden="true" /><strong>{playing ? t("kidPlaying", { name: playing.name }) : t("bigPictureTitle")}</strong>
      <span className="ga-pad-legend"><span className="ga-pad-key is-a">A</span>{t("kidPlayKeys")}</span>
      <span className="ga-pad-legend"><span className="ga-pad-key"><Move size={15} strokeWidth={2.4} aria-hidden="true" /></span>{t("kidMoveKeys")}</span></p>
    {session.timeUp ? <div className="ga-kid-over" role="alertdialog" aria-labelledby="ga-kid-over-title">
      <section><h2 id="ga-kid-over-title">{t("kidTimeUpTitle")}</h2><p>{t("kidTimeUpText")}</p>
        <GaButton variant="primary" icon={<LogOut size={18} aria-hidden="true" />} onClick={signOut} autoFocus>{t("kidLeave")}</GaButton></section>
    </div> : null}
  </main>;
}
