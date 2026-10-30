import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Eye, KeyRound } from "lucide-react";
import { useI18n } from "./i18n";
import { GaButton } from "./components/ga/Buttons";
import { showNotice } from "./notice/notice";
import { hasTauriRuntime } from "./native";
import { loadAdminKey, setAdminKey, useAdminKey, usePlusLapsed, type AdminKeyState } from "./accessRole";
import { useKidState, usePlus } from "./kidMode";

/**
 * The parent's key tab of the kids screen. It can be turned on once PLUS has kid mode running (a child's account
 * exists): until then there is no child to protect. The key is a plain password the parent chooses (admin_key.rs).
 *
 * It stays hidden like a wallet's balance: it shows only while its eye is held pressed and hides again on release, so
 * nothing is left on screen for a child walking by. Changing or removing the key asks for it. This screen is only
 * reachable as the administrator (accessRole.ts); with PLUS ended everyone is, so the eye is not offered then.
 */
/** The parent's password: 4 to 40 characters, no spaces (admin_key.rs). */
export const validWord = (word: string) => /^\S{4,40}$/u.test(word.trim());
const HIDDEN = "••••••";

/** The word, hidden until its eye is held pressed (pointer, Space or Enter) and hidden again on release. */
function HiddenWord() {
  const { t } = useI18n();
  const [word, setWord] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  // Each press is one ask; an answer that arrives after the release is dropped.
  const press = useRef(0);
  const show = () => {
    const id = ++press.current;
    setHeld(true);
    void invoke<string | null>("admin_key_word").then(value => { if (id === press.current) setWord(value ?? null); }, () => undefined);
  };
  const hide = () => { press.current++; setHeld(false); setWord(null); };
  // Leaving the window (another program, the screen locked) hides it too.
  useEffect(() => {
    if (!held) return;
    const away = () => hide();
    window.addEventListener("blur", away);
    document.addEventListener("visibilitychange", away);
    return () => { window.removeEventListener("blur", away); document.removeEventListener("visibilitychange", away); };
  }, [held]);
  const key = (event: KeyboardEvent, down: boolean) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!down) hide(); else if (!event.repeat) show();
  };
  return <div className="ga-adminkey-word">
    <span className="ga-label">{t("adminKeyYourWord")}</span>
    <output className={held && word ? "ga-adminkey-secret is-shown" : "ga-adminkey-secret"} aria-live="off">{held && word ? word : HIDDEN}</output>
    <GaButton icon={<Eye size={16} aria-hidden="true" />} aria-pressed={held}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); show(); }}
      onPointerUp={hide} onPointerCancel={hide} onLostPointerCapture={hide} onBlur={hide} onContextMenu={event => event.preventDefault()}
      onKeyDown={event => key(event, true)} onKeyUp={event => key(event, false)}>{t("adminKeyHoldToSee")}</GaButton>
    <p className="ga-hint">{t("adminKeyHoldHint")}</p>
  </div>;
}

/** Only changing it: the key exists for kid mode and goes with it ("Remove kid mode", Seba 2026-10-30). */
type Mode = "change" | null;

export default function AdminKeySection() {
  const { t } = useI18n();
  const key = useAdminKey();
  const plus = usePlus();
  const lapsed = usePlusLapsed();
  const { applied } = useKidState();
  const [word, setWord] = useState("");
  const [current, setCurrent] = useState("");
  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState("");
  useEffect(() => { void loadAdminKey().catch(() => undefined); }, []);

  const fail = (failure: unknown) => {
    const code = String(failure);
    setError(code === "bad_word" ? t("adminKeyBadWord") : code === "wrong_key" ? t("adminKeyWrong") : t("adminKeyFailed", { error: code }));
  };
  const open = (next: Mode) => { setMode(mode === next ? null : next); setCurrent(""); setWord(""); setError(""); };
  const save = async () => {
    if (!validWord(word)) { setError(t("adminKeyBadWord")); return; }
    setError("");
    try {
      const next = await invoke<AdminKeyState>("admin_key_set", { word: word.trim(), current: key.enabled ? current : null });
      setAdminKey(next); setWord(""); setCurrent(""); setMode(null);
      showNotice({ tone: "ok", title: t("adminKeySaved") });
    } catch (failure) { fail(failure); }
  };

  const ready = plus && Boolean(applied) && hasTauriRuntime();
  const currentField = <label className="ga-field"><span>{t("adminKeyCurrent")}</span>
    <input type="password" value={current} maxLength={40} autoComplete="off" spellCheck={false} data-lpignore="true" onChange={event => setCurrent(event.target.value)} /></label>;
  const wordField = <label className="ga-field"><span>{key.enabled ? t("adminKeyNewWord") : t("adminKeyWord")}</span>
    <input value={word} maxLength={40} autoComplete="off" spellCheck={false} placeholder={t("adminKeyWordPlaceholder")} onChange={event => setWord(event.target.value.replace(/\s/g, ""))} /></label>;
  return <div className="ga-adminkey ga-stack">
    <p className="ga-hint">{t("adminKeyIntro")}</p>
    {key.enabled || ready ? null : <p className="ga-hint" role="note">{t("adminKeyNeedsKidMode")}</p>}
    {key.enabled ? <>
      <p className="ga-status is-ok"><KeyRound size={16} aria-hidden="true" />{t("adminKeyActive")}</p>
      {lapsed ? null : <HiddenWord />}
      <div className="ga-adminkey-actions ga-actions">
        <GaButton onClick={() => open("change")} aria-expanded={mode === "change"}>{t("adminKeyChange")}</GaButton>
      </div>
      {mode === "change" ? <div className="ga-adminkey-form ga-stack">
        {currentField}{wordField}
        <div className="ga-actions"><GaButton variant="primary" icon={<KeyRound size={16} aria-hidden="true" />} disabled={!current.trim() || !validWord(word)} onClick={() => void save()}>{t("adminKeySaveNew")}</GaButton></div>
      </div> : null}
    </> : ready ? <div className="ga-adminkey-form ga-stack">
      {wordField}
      <div className="ga-actions"><GaButton variant="primary" icon={<KeyRound size={16} aria-hidden="true" />} disabled={!validWord(word)} onClick={() => void save()}>{t("adminKeyActivate")}</GaButton></div>
    </div> : null}
    {error ? <p className="ga-status is-error" role="alert">{error}</p> : null}
    <p className="ga-hint">{t("adminKeyHow1")}</p>
  </div>;
}
