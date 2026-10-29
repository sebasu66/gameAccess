import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Eye, KeyRound, Trash2 } from "lucide-react";
import { useI18n } from "./i18n";
import { GaButton } from "./components/ga/Buttons";
import { confirmNotice, showNotice } from "./notice/notice";
import { hasTauriRuntime } from "./native";
import { loadAdminKey, setAdminKey, useAdminKey, type AdminKeyState } from "./accessRole";
import { useKidState, usePlus } from "./kidMode";

/**
 * The parent's key tab of the kids screen. It can be turned on once PLUS has kid mode running (a child's account
 * exists): until then there is no child to protect. The key is a word only the parent knows, woven with the date every
 * day (admin_key.rs); how is explained here and nowhere else, for the parent's eyes. The word is never shown back.
 * This screen is only reachable as the administrator (accessRole.ts), so nothing here asks for the key again.
 */
const SHOW_MS = 15_000;
const validWord = (word: string) => /^\p{L}{3,20}$/u.test(word.trim());

export default function AdminKeySection() {
  const { t } = useI18n();
  const key = useAdminKey();
  const plus = usePlus();
  const { applied } = useKidState();
  const [word, setWord] = useState("");
  const [changing, setChanging] = useState(false);
  const [today, setToday] = useState("");
  const [error, setError] = useState("");
  const hide = useRef(0);
  useEffect(() => { void loadAdminKey().catch(() => undefined); return () => window.clearTimeout(hide.current); }, []);

  const save = async () => {
    if (!validWord(word)) { setError(t("adminKeyBadWord")); return; }
    setError("");
    try {
      const current = key.enabled ? await invoke<string | null>("admin_key_today") : null;
      const next = await invoke<AdminKeyState>("admin_key_set", { word: word.trim(), current });
      setAdminKey(next); setWord(""); setChanging(false); setToday("");
      showNotice({ tone: "ok", title: t("adminKeySaved") });
    } catch (failure) { setError(String(failure) === "bad_word" ? t("adminKeyBadWord") : t("adminKeyFailed", { error: String(failure) })); }
  };
  const showToday = async () => {
    const value = await invoke<string | null>("admin_key_today").catch(() => null);
    if (!value) return;
    setToday(value);
    window.clearTimeout(hide.current);
    hide.current = window.setTimeout(() => setToday(""), SHOW_MS);
  };
  const remove = async () => {
    if (!await confirmNotice({ title: t("adminKeyRemoveTitle"), text: t("adminKeyRemoveText"), confirmLabel: t("adminKeyRemove"), cancelLabel: t("noticeCancel") })) return;
    try {
      const current = await invoke<string | null>("admin_key_today");
      await invoke("admin_key_clear", { current });
      setAdminKey({ enabled: false, length: 0 }); setToday("");
      showNotice({ tone: "ok", title: t("adminKeyRemoved") });
    } catch (failure) { setError(t("adminKeyFailed", { error: String(failure) })); }
  };

  const ready = plus && Boolean(applied) && hasTauriRuntime();
  const form = <>
    <label className="ga-field"><span>{t("adminKeyWord")}</span>
      <input value={word} maxLength={20} autoComplete="off" spellCheck={false} placeholder={t("adminKeyWordPlaceholder")} onChange={event => setWord(event.target.value.replace(/\s/g, ""))} /></label>
    <div><GaButton variant="primary" icon={<KeyRound size={16} aria-hidden="true" />} disabled={!validWord(word)} onClick={() => void save()}>{key.enabled ? t("adminKeyChange") : t("adminKeyActivate")}</GaButton></div>
  </>;
  return <div className="ga-adminkey">
    <p className="ga-kid-hint">{t("adminKeyIntro")}</p>
    {key.enabled || ready ? null : <p className="ga-kid-hint" role="note">{t("adminKeyNeedsKidMode")}</p>}
    {key.enabled ? <>
      <p className="ga-adminkey-on"><KeyRound size={16} aria-hidden="true" />{t("adminKeyActive")}</p>
      <div className="ga-adminkey-actions">
        <GaButton icon={<Eye size={16} aria-hidden="true" />} onClick={() => void showToday()}>{t("adminKeyShowToday")}</GaButton>
        <GaButton onClick={() => setChanging(open => !open)} aria-expanded={changing}>{t("adminKeyChange")}</GaButton>
        <GaButton variant="danger" icon={<Trash2 size={16} aria-hidden="true" />} onClick={() => void remove()}>{t("adminKeyRemove")}</GaButton>
      </div>
      {today ? <p className="ga-adminkey-today" role="status">{t("adminKeyToday", { key: today })}</p> : null}
      {changing ? form : null}
    </> : ready ? form : null}
    {error ? <p className="ga-parental-error" role="alert">{error}</p> : null}
    <details className="ga-adminkey-how">
      <summary>{t("adminKeyHowTitle")}</summary>
      <p>{t("adminKeyHow1")}</p><p>{t("adminKeyHow2")}</p><p>{t("adminKeyHow3")}</p><p>{t("adminKeyHow4")}</p>
    </details>
  </div>;
}
