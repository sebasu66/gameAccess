import { useCallback, useEffect, useRef, useState } from "react";

type SplashScreenProps = { onComplete: () => void };
type SplashPhase = "waiting" | "slide" | "reveal" | "idle" | "compact";

const layers = ["/logo/fondo.png", "/logo/portal.png", "/logo/g.png", "/logo/a.png"];

/** Reassembles the supplied layered logo, then leaves it in the access screen corner. */
export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<SplashPhase>("waiting");
  const [loaded, setLoaded] = useState(false);
  const [started, setStarted] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const timersRef = useRef<number[]>([]);

  const start = useCallback(() => {
    if (started || !loaded) return;
    setStarted(true);
    const context = audioRef.current;
    const begin = () => {
      if (context) playSwell(context, 1.5);
      setPhase("slide");
      timersRef.current = [
        window.setTimeout(() => setPhase("reveal"), 1500),
        window.setTimeout(() => setPhase("idle"), 3000),
        window.setTimeout(() => setPhase("compact"), 4000),
        window.setTimeout(onComplete, 5500),
      ];
    };
    if (context?.state === "suspended") void context.resume().then(begin).catch(begin);
    else begin();
  }, [loaded, onComplete, started]);

  useEffect(() => {
    try { audioRef.current = new AudioContext(); } catch { audioRef.current = null; }
    let cancelled = false;
    Promise.all(layers.map(src => new Promise<void>(resolve => {
      const image = new Image();
      image.onload = image.onerror = () => resolve();
      image.src = src;
    }))).then(() => { if (!cancelled) setLoaded(true); });
    return () => {
      cancelled = true;
      timersRef.current.forEach(window.clearTimeout);
      void audioRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setPhase("compact");
      const timer = window.setTimeout(onComplete, 80);
      return () => window.clearTimeout(timer);
    }
    if (audioRef.current?.state === "running") start();
  }, [loaded, onComplete, start]);

  return (
    <div className={`gameaccess-splash${phase === "compact" ? " is-settled" : ""}`} aria-label="Iniciando Game Access">
      <div className={`gameaccess-splash-stage phase-${phase}`} aria-hidden="true">
        <img className="splash-layer splash-background" src="/logo/fondo.png" alt="" />
        <img className="splash-layer splash-portal" src="/logo/portal.png" alt="" />
        <img className="splash-layer splash-g" src="/logo/g.png" alt="" />
        <img className="splash-layer splash-a" src="/logo/a.png" alt="" />
      </div>
      {phase === "waiting" ? <button type="button" className="gameaccess-splash-start" onClick={start} disabled={!loaded}>TOCÁ PARA ENTRAR</button> : null}
      {started && phase !== "compact" ? <span className="gameaccess-splash-caption">INICIANDO GAME ACCESS</span> : null}
      <span className="gameaccess-splash-announcer" role="status">{loaded ? "" : "Cargando identidad visual…"}</span>
    </div>
  );
}

function playSwell(context: AudioContext, duration: number) {
  const startAt = context.currentTime;
  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, startAt);
  master.gain.exponentialRampToValueAtTime(0.18, startAt + duration);
  master.gain.exponentialRampToValueAtTime(0.0001, startAt + duration + 0.6);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 6;
  filter.frequency.setValueAtTime(200, startAt);
  filter.frequency.exponentialRampToValueAtTime(4000, startAt + duration);
  [["sawtooth", 110, 0], ["sawtooth", 110, 7], ["sine", 220, -5]].forEach(([type, frequency, detune]) => {
    const oscillator = context.createOscillator();
    oscillator.type = type as OscillatorType;
    oscillator.detune.value = detune as number;
    oscillator.frequency.setValueAtTime(frequency as number, startAt);
    oscillator.frequency.exponentialRampToValueAtTime((frequency as number) * 2, startAt + duration);
    oscillator.connect(filter);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.7);
  });
  filter.connect(master).connect(context.destination);
}
