import { useSyncExternalStore } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { getParentalPolicy, isParentalLocked, setParentalPolicy, subscribeParentalPolicy, type ParentalLevel } from "./parentalControl";
import { useI18n } from "./i18n";

/** Reactive view of the enforced state, for any panel that must reflect it. */
export function useParentalLocked(): boolean {
  return useSyncExternalStore(subscribeParentalPolicy, isParentalLocked, () => false);
}

/** Reactive view of the whole policy, so edits re-render the controls. */
function useParentalPolicy() {
  return useSyncExternalStore(subscribeParentalPolicy, getParentalPolicy, getParentalPolicy);
}

/**
 * Parental policy editor.
 *
 * These criteria are NEGATIVE only: they remove content, never search for it.
 * That is why they show "solo excluir" instead of the include/exclude pair the
 * other groups use, and why the rest of the panel's content discovery is
 * disabled while a policy is enforced.
 */
export default function ParentalControlSection() {
  const { t } = useI18n();
  const policy = useParentalPolicy();
  const locked = policy.enabled && policy.level !== "off";
  const setLevel = (level: ParentalLevel) => setParentalPolicy({ enabled: level !== "off", level });
  const levels: { id: ParentalLevel; label: string; detail: string }[] = [
    { id: "off", label: "Sin control", detail: "Todo visible" },
    { id: "adult-only", label: "Solo adultos", detail: "Oculta el contenido sexual exclusivo para adultos (descriptor 3/4 de Valve)" },
    { id: "strict", label: "Estricto", detail: "Oculta además el contenido sexual sugerido (descriptor 1), como South Park" },
  ];
  return <details className={"ga-filter-accordion ga-parental" + (locked ? " is-locked" : "")} open={locked}>
    <summary>
      {locked ? <Lock size={12} aria-hidden="true" /> : <ShieldCheck size={12} aria-hidden="true" />}
      Control parental
      {locked ? <small className="ga-filter-locked-note">{t("uiActivo")}</small> : null}
    </summary>
    <p className="ga-parental-note">
      Estos criterios solo <strong>{t("uiExcluyen")}</strong>. Mientras estén activos, el filtro de contenido queda bloqueado para que no se pueda revelar lo excluido.
    </p>
    <div className="ga-parental-levels">
      {levels.map(({ id, label, detail }) => <label key={id} title={detail}>
        <input type="radio" name="ga-parental-level" checked={policy.level === id && (id === "off" || policy.enabled)} onChange={() => setLevel(id)} />
        <span>{label}<small>{detail}</small></span>
      </label>)}
    </div>
    <label className="ga-parental-violence">
      <input type="checkbox" checked={policy.hideViolence} onChange={event => setParentalPolicy({ hideViolence: event.target.checked })} />
      <span>{t("uiOcultarTambienViolenciaY")}<small>{t("uiDescriptor2DeValve")}</small></span>
    </label>
  </details>;
}
