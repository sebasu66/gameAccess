/**
 * The buttons of a download in Library › Downloads (RN9), the same for every download whatever its state: the main
 * action first (pause while it runs, resume when paused, go on or retry when it stopped), in the template's primary
 * style; then the secondary ones (cancel or abort); the folder last, which keeps only its icon in a narrow card. All
 * of them are the template's GaButton, so they follow the current appearance.
 */
import type { ReactNode } from "react";
import { GaButton } from "../components/ga/Buttons";

export interface DownloadAction { id: string; label: string; icon: ReactNode; run: () => void; aria?: string }

export default function DownloadActions({ main, others = [], folder, disabled = false }: {
  main?: DownloadAction; others?: DownloadAction[]; folder?: DownloadAction; disabled?: boolean;
}) {
  return <>
    {main ? <GaButton key={main.id} variant="primary" icon={main.icon} disabled={disabled} aria-label={main.aria} onClick={main.run}><span>{main.label}</span></GaButton> : null}
    {others.map(action => <GaButton key={action.id} variant="secondary" icon={action.icon} disabled={disabled} aria-label={action.aria} onClick={action.run}><span>{action.label}</span></GaButton>)}
    {folder ? <GaButton key={folder.id} variant="secondary" className="ga-wz-minor" icon={folder.icon} disabled={disabled} title={folder.label} aria-label={folder.aria ?? folder.label} onClick={folder.run}><span>{folder.label}</span></GaButton> : null}
  </>;
}
