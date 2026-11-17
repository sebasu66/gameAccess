import { useId } from "react";
import { useI18n } from "./i18n";
import { formatDownloadBytes } from "./downloadSize";
import type { DownloadSpeedSample } from "./catalog/DigitalDownloadService";

/**
 * The download speed drawn over the game's picture (a collapsed download row), as in the approved demo
 * (docs/design/gameaccess-gsap-demo-2026-10-23, `.dl-spark`): the last minute of real samples as an orange line over a
 * fading orange area, scaled to the peak, with the current speed on top.
 */
export default function DownloadSpeedSpark({ samples, speedBps }: { samples: readonly DownloadSpeedSample[]; speedBps?: number }) {
  const { t, locale } = useI18n();
  const id = useId().replace(/:/g, "");
  const peak = Math.max(0, ...samples.map(sample => sample.speedBps));
  const end = samples.at(-1)?.time ?? Date.now();
  const points = samples.map(sample => {
    const x = Math.max(0, Math.min(120, (sample.time - end + 60000) / 500));
    const y = 32 - (peak > 0 ? sample.speedBps / peak * 28 : 0);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <span className="ga-dl-spark">
      {points.length > 1 ? (
        <svg viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#cc8333" stopOpacity=".45" /><stop offset="1" stopColor="#cc8333" stopOpacity="0" /></linearGradient></defs>
          <path d={`M${points[0].split(",")[0]},32L${points.join("L")}L${points.at(-1)!.split(",")[0]},32Z`} fill={`url(#${id}-fill)`} />
          <path d={`M${points.join("L")}`} fill="none" stroke="#cc8333" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : null}
      <strong aria-label={t("downloadsSpeed")}>{speedBps != null ? `${formatDownloadBytes(speedBps, locale)} / s` : "—"}</strong>
    </span>
  );
}
