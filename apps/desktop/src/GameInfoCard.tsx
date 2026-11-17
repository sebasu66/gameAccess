import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy } from "lucide-react";
import { GaClose } from "./components/ga/Buttons";
import { useDialogFocus } from "./dialogFocus";
import { useI18n } from "./i18n";
import { useLibraryEntry } from "./libraryScan";
import type { CatalogGame } from "./types";
import "./game-info-card.css";

/**
 * The game's properties card (Seba, 2026-11-05), from "Details" in the card and detail menus: name, AppID, the
 * download source and the link that download used. The source and link exist only for games Game Access downloaded;
 * a row with nothing to say is left out. Two small controls: close and copy (all the rows as text).
 */
export default function GameInfoCard({ game, onClose }: { game: CatalogGame; onClose: () => void }) {
  const { t } = useI18n();
  const ref = useDialogFocus(onClose);
  const entry = useLibraryEntry(game.app_id ?? undefined);
  const [copied, setCopied] = useState(false);
  const source = [entry?.source_provider, entry?.source_title].filter(Boolean).join(" · ");
  const rows: Array<[string, string]> = [
    [t("infoName"), entry?.label || game.name],
    ...(game.app_id ? [[t("infoAppId"), String(game.app_id)] as [string, string]] : []),
    ...(source ? [[t("infoSource"), source] as [string, string]] : []),
    ...(entry?.source_link ? [[t("infoLink"), entry.source_link] as [string, string]] : []),
    ...(entry?.folder ? [[t("infoFolder"), entry.folder] as [string, string]] : []),
  ];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rows.map(([label, value]) => `${label}: ${value}`).join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* the clipboard can be refused: nothing to undo */ }
  };
  return createPortal(
    <div className="ga-dialog-backdrop" role="presentation" onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
      <section ref={ref} className="ga-info-card" role="dialog" aria-modal="true" aria-label={t("infoTitle", { name: game.name })}>
        <div className="ga-info-tools">
          <button type="button" className="ga-info-copy" aria-label={t("infoCopy")} title={copied ? t("infoCopied") : t("infoCopy")} onClick={() => void copy()}>
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          </button>
          <GaClose label={t("close")} size={16} onClick={onClose} />
        </div>
        <span className="ga-info-eyebrow">{t("infoEyebrow")}</span>
        <dl className="ga-info-rows">
          {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        {!entry ? <small className="ga-info-note">{t("infoNotInstalled")}</small> : null}
      </section>
    </div>,
    document.body,
  );
}
