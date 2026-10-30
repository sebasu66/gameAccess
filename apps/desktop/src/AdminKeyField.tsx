import { useCallback, useEffect, useRef, useState } from "react";
import { Gamepad2 } from "lucide-react";
import { useI18n } from "./i18n";
import { GaButton } from "./components/ga/Buttons";
import { checkAdminKey } from "./accessRole";
import { showNotice } from "./notice/notice";
import "./admin-gate.css";

/**
 * The gate's key field: a short rounded LCD set into the metal beside the padlock, about four dots wide. Every typed
 * character is a dot; a longer key slides on past its left edge, so how many there are is not seen (Seba, 2026-10-30).
 * Every key press ticks. There is no button:
 * when the typed length is the key's (the gate knows it), each change asks whether it matches; typing and deleting is
 * free until it does, and then the dots turn green and the gate opens. Beside it: "enter as a player" (no key) and
 * "I forgot the key".
 */
const GREEN_MS = 650;

let audio: AudioContext | null = null;
/** A short mechanical tick, made with the sound card (no file): a click of noise-free tone with a fast fall. */
function tick() {
  try {
    audio ??= new AudioContext();
    const start = audio.currentTime;
    const tone = audio.createOscillator();
    const level = audio.createGain();
    tone.type = "square";
    tone.frequency.setValueAtTime(2100, start);
    tone.frequency.exponentialRampToValueAtTime(900, start + 0.03);
    level.gain.setValueAtTime(0.035, start);
    level.gain.exponentialRampToValueAtTime(0.0001, start + 0.045);
    tone.connect(level).connect(audio.destination);
    tone.start(start);
    tone.stop(start + 0.05);
  } catch { /* no sound: the dots still say it */ }
}

/** Recovering the key needs the parent's Game Access user (the accounts come with the server); until then, say so. */
export function useForgotAdminKey() {
  const { t } = useI18n();
  return useCallback(() => showNotice({ tone: "info", title: t("adminKeyForgotTitle"), text: t("adminKeyForgotText") }), [t]);
}

export default function AdminKeyField({ length, onSuccess, onPlayer, onForgot }: { length: number; onSuccess: () => void; onPlayer: () => void; onForgot: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [ok, setOk] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const attempt = useRef(0);
  const done = useRef(onSuccess);
  done.current = onSuccess;
  useEffect(() => { input.current?.focus(); }, []);

  const change = (next: string) => {
    if (ok) return;
    setValue(next);
    tick();
    const id = ++attempt.current;
    // Only a key of the right length is worth asking about.
    if (next.length !== length) return;
    void checkAdminKey(next).then(match => {
      if (!match || id !== attempt.current) return;
      setOk(true);
      window.setTimeout(() => done.current(), GREEN_MS);
    });
  };

  return <div className="gs-keypad" onPointerDown={event => { if (!(event.target as HTMLElement).closest("button")) { event.preventDefault(); input.current?.focus(); } }}>
    <label className={`gs-lcd${ok ? " is-ok" : ""}`}>
      <span className="gs-lcd-dots" aria-hidden="true">{Array.from({ length: value.length }, (_, index) => <i key={index} />)}</span>
      <input ref={input} type="password" value={value} autoComplete="off" spellCheck={false} aria-label={t("adminKeyLabel")} data-lpignore="true"
        onChange={event => change(event.target.value)} readOnly={ok} />
    </label>
    <p className="gs-keypad-status" role="status">{ok ? t("adminKeyOk") : ""}</p>
    <div className="gs-keypad-links">
      <GaButton icon={<Gamepad2 size={16} aria-hidden="true" />} onClick={onPlayer} disabled={ok}>{t("adminKeyPlayer")}</GaButton>
      <button type="button" className="gs-keypad-forgot" onClick={onForgot} disabled={ok}>{t("adminKeyForgot")}</button>
    </div>
  </div>;
}
