/**
 * Auto-compression of games (Seba, 2026-11-18; docs/GUI_DESIGN.md §4.46): what it is and how often it runs, said once
 * over the whole window (GaSheet) from Manager › Space.
 *
 * It is Windows' own compression, applied **to each game**, not to the disk: a game nobody has played for a while is
 * compressed where it is, keeps playing exactly the same (it does not have to be unpacked first) and takes up less
 * room. Here the player chooses after how long it happens — 30, 60 or 90 days without playing — or turns it off.
 * Three times that, a game that is still untouched goes to deep freeze (freezer.py).
 */
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import GaSheet from "../components/ga/Sheet";
import { GaButton } from "../components/ga/Buttons";
import { digitalProcessManager, type DigitalStorageSettings } from "../catalog/DigitalProcessManager";
import { notify } from "../toasts";

/** Off, or the days without playing before a game is compressed. */
const CHOICES = [0, 30, 60, 90] as const;

export default function AutoCompressSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<DigitalStorageSettings | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void digitalProcessManager.settings().then(result => {
      if (!alive) return;
      const found = result.settings ?? null;
      setSettings(found);
      setChoice(found?.auto_freeze ? found.auto_freeze_days ?? 30 : 0);
    }).catch(() => { if (alive) setChoice(0); });
    return () => { alive = false; };
  }, []);

  const save = async (days: number) => {
    setChoice(days);
    if (!settings) return;
    setSaving(true);
    try {
      const next = { ...settings, auto_freeze: days > 0, auto_freeze_days: days > 0 ? days : settings.auto_freeze_days ?? 30 };
      const result = await digitalProcessManager.saveSettings(next);
      setSettings(result.settings ?? next);
      notify(days > 0 ? t("autoZipSaved", { days }) : t("autoZipSavedOff"), { tone: "success" });
    } catch (failure) {
      notify(t("autoZipFailed", { error: failure instanceof Error ? failure.message : String(failure) }), { tone: "error" });
    } finally { setSaving(false); }
  };

  return <GaSheet className="ga-manager-scope" eyebrow={t("navSpace")} title={t("autoZipTitle")} lead={t("autoZipLead")} onClose={onClose}
    actions={<GaButton variant="primary" onClick={onClose}>{t("autoZipDone")}</GaButton>}>
    <p>{t("autoZipHow")}</p>
    <p>{t("autoZipPlay")}</p>
    <div className="ga-stack">
      <span className="ga-label" id="ga-autozip-when">{t("autoZipWhen")}</span>
      <div className="ga-midsheet-choice" role="radiogroup" aria-labelledby="ga-autozip-when">
        {CHOICES.map(days => <button key={days} type="button" role="radio" aria-checked={choice === days} disabled={saving || choice === null}
          onClick={() => void save(days)}>{days ? t("autoZipDays", { days }) : t("autoZipOff")}</button>)}
      </div>
      <p className="ga-hint">{choice ? t("autoZipDeep", { days: choice * 3 }) : t("autoZipOffHint")}</p>
    </div>
  </GaSheet>;
}
