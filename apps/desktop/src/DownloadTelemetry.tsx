import { useI18n } from "./i18n";
import { formatDownloadBytes } from "./downloadSize";
import type { DownloadProgressSnapshot } from "./downloadProvider";
import type { DownloadSpeedSample } from "./catalog/DigitalDownloadService";

/** Actual worker samples only; gaps before the first sample stay empty. */
export default function DownloadTelemetry({ snapshot, samples }: { snapshot: DownloadProgressSnapshot; samples: readonly DownloadSpeedSample[] }) {
  const { t, locale } = useI18n();
  const peak = Math.max(0, ...samples.map(sample => sample.speedBps));
  const end = samples.at(-1)?.time ?? Date.now();
  const points = samples.map(sample => {
    const x = Math.max(0, Math.min(600, (sample.time - end + 60000) / 100));
    const y = 90 - (peak > 0 ? sample.speedBps / peak * 78 : 0);
    return [x, y] as const;
  });
  const line = points.map(([x,y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = points.length > 1 ? `${line} L600,90 L${points[0][0].toFixed(1)},90 Z` : "";
  const speed = snapshot.phase === "downloading" ? snapshot.speedBps : undefined;
  const percent = Math.max(0, Math.min(100, Number.isFinite(snapshot.progress) ? snapshot.progress : 0));
  return <div className="ga-download-telemetry">
    <div className="ga-download-dial" role="progressbar" aria-label={t("downloadDownloading")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="ga-download-dial-track" cx="50" cy="50" r="42" /><circle className="ga-download-dial-fill" cx="50" cy="50" r="42" pathLength="100" strokeDasharray={`${percent} 100`} /></svg>
      <strong>{Math.round(percent)}<small>%</small></strong>
    </div>
    <div className="ga-download-speed">
      <div className="ga-download-speed-heading"><div><span>{t("downloadsSpeed")}</span><strong>{formatDownloadBytes(speed, locale)}{speed != null ? " / s" : ""}</strong></div><div><span>{t("downloadsPeakSpeed")}</span><strong>{samples.length ? formatDownloadBytes(peak, locale) + " / s" : "—"}</strong></div></div>
      {points.length > 1 ? <svg className="ga-download-speed-chart" viewBox="0 0 600 100" preserveAspectRatio="none" role="img" aria-label={t("downloadsSpeedChart")}>
        <path className="ga-download-speed-grid" d="M0,12 H600 M0,51 H600 M0,90 H600" />
        <path className="ga-download-speed-area" d={area} />
        <path className="ga-download-speed-line" d={line} />
      </svg> : <div className="ga-download-speed-empty">{t("downloadsWaitingSamples")}</div>}
    </div>
  </div>;
}
