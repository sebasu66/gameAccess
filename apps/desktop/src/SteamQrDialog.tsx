/**
 * The Steam QR code of a free Steam game's download (apps/launcher/steam_depot): only when no remembered account
 * could sign in, and only while DepotDownloader waits for it. A dialog on the smoke (GaSmoke, GUI_DESIGN §4.34) that
 * closes by itself once the phone signed in; closed by hand, it comes back only with a new code.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { activeDownloadService } from "./downloads/activeService";
import { GaButton } from "./components/ga/Buttons";
import { GaSmoke } from "./components/ga/GaSmoke";
import { useI18n } from "./i18n";
import "./steam-qr-dialog.css";

interface Shown { gameId: number; name: string; lines: string[] }

export default function SteamQrDialog() {
  const { t } = useI18n();
  const [shown, setShown] = useState<Shown | null>(null);
  const [dismissed, setDismissed] = useState("");
  useEffect(() => { const service = activeDownloadService(); return service.onGlobalUpdate(snapshot => {
    setShown(current => {
      if (snapshot.steamQr?.length) {
        const name = service.getDownloads().find(entry => entry.snapshot.gameId === snapshot.gameId)?.game.name ?? "";
        return { gameId: snapshot.gameId, name, lines: snapshot.steamQr };
      }
      return current?.gameId === snapshot.gameId ? null : current;   // signed in, or stopped: the code is gone
    });
  }); }, []);
  if (!shown || dismissed === shown.lines.join("\n")) return null;
  const close = () => setDismissed(shown.lines.join("\n"));
  return <GaSmoke className="ga-steam-qr" label={t("steamQrTitle")} onClose={close}>
    {shown.name ? <span className="ga-label">{shown.name}</span> : null}
    <h2 className="ga-steam-qr-title">{t("steamQrTitle")}</h2>
    <p>{t("steamQrText")}</p>
    <pre className="ga-steam-qr-code" aria-label={t("dlDepotQr")}>{shown.lines.join("\n")}</pre>
    <div className="ga-actions">
      <GaButton data-autofocus icon={<X size={16} aria-hidden="true" />} onClick={close}>{t("close")}</GaButton>
    </div>
  </GaSmoke>;
}
