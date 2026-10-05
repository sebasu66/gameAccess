import React from "react";
import { Loader2 } from "lucide-react";
import type { GenericDownloadStatus, ManagedDownloadStatus } from "./downloadTypes";
import { getAppLocale } from "./i18n";

export interface DownloadProgressDisplayProps {
  download?: GenericDownloadStatus | ManagedDownloadStatus | null;
  className?: string;
  showMetrics?: boolean;
}

/**
 * Calculates a safe progress percentage (0 - 100) from any download status object.
 */
export function getGenericProgress(status?: GenericDownloadStatus | ManagedDownloadStatus | null): number {
  if (!status) return 0;
  if (status.installed || status.state === "installed" || status.state === "prepared") return 100;
  if (status.bytes_total && status.bytes_total > 0 && status.bytes_downloaded != null) {
    const calculated = (status.bytes_downloaded / status.bytes_total) * 100;
    return Math.max(0, Math.min(100, calculated));
  }
  if (typeof status.progress === "number" && Number.isFinite(status.progress)) {
    return Math.max(0, Math.min(100, status.progress));
  }
  return 0;
}

/**
 * Returns a clean, human-readable status label (e.g. "Preparing", "Downloading 45%", "Decompressing 80%").
 * Completely decoupled from DepotDownloader or any specific download engine.
 */
export function getDownloadStatusLabel(
  status?: GenericDownloadStatus | ManagedDownloadStatus | null,
  providedProgress?: number | null,
): string {
  if (!status) return "";
  if (status.statusText && status.statusText.trim()) {
    return status.statusText.trim();
  }

  const progress = providedProgress ?? getGenericProgress(status);
  const roundedProgress = Math.round(progress);
  const isEn = getAppLocale() === "en";
  const state = String(status.state || "").toLowerCase();

  switch (state) {
    case "requested":
    case "preparing":
      return isEn ? "Preparing" : "Preparando";
    case "downloading":
      return roundedProgress > 0
        ? (isEn ? `Downloading ${roundedProgress}%` : `Descargando ${roundedProgress}%`)
        : (isEn ? "Downloading" : "Descargando");
    case "decompressing":
    case "extracting":
      return roundedProgress > 0
        ? (isEn ? `Decompressing ${roundedProgress}%` : `Descomprimiendo ${roundedProgress}%`)
        : (isEn ? "Decompressing" : "Descomprimiendo");
    case "installing":
      return roundedProgress > 0
        ? (isEn ? `Installing ${roundedProgress}%` : `Instalando ${roundedProgress}%`)
        : (isEn ? "Installing" : "Instalando");
    case "paused":
      return isEn ? "Paused" : "Pausado";
    case "cancelling":
      return isEn ? "Cancelling" : "Cancelando";
    case "interrupted":
      return isEn ? "Interrupted" : "Interrumpida";
    case "installed":
    case "prepared":
      return isEn ? "Installed" : "Listo";
    default:
      return roundedProgress > 0 ? `${roundedProgress}%` : "";
  }
}

export function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const rounded = Math.ceil(seconds);
  if (rounded === 0) return "0 s";
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hours > 0) return `${hours} h ${Math.max(1, minutes)} min`;
  if (minutes > 0) return `${minutes} min ${secs ? `${secs} s` : ""}`.trim();
  return `${secs} s`;
}

export function formatSpeed(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "0 B/s";
  return `${formatBytes(value)}/s`;
}

/**
 * Generic visual component to display download/installation progress and status.
 */
export function GenericDownloadProgressView({
  download,
  className = "library-room-active-download",
  showMetrics = true,
}: DownloadProgressDisplayProps) {
  if (!download) return null;

  const progress = getGenericProgress(download);
  const statusLabel = getDownloadStatusLabel(download, progress);
  const isEn = getAppLocale() === "en";

  const rows: Array<[string, string]> = [];

  if (statusLabel) {
    rows.push([isEn ? "Status" : "Estado", statusLabel]);
  }

  if (showMetrics) {
    if (download.bytes_total != null && download.bytes_total > 0) {
      rows.push([isEn ? "Total Size" : "Tamaño", formatBytes(download.bytes_total)]);
    }
    if (download.bytes_downloaded != null && download.bytes_downloaded > 0) {
      rows.push([isEn ? "Processed" : "Descargado", formatBytes(download.bytes_downloaded)]);
    }
    if (download.speed_bps != null && download.speed_bps > 0) {
      rows.push([isEn ? "Speed" : "Velocidad", formatSpeed(download.speed_bps)]);
    }
    if (download.eta_seconds != null && download.eta_seconds > 0) {
      rows.push([isEn ? "Time Left" : "Tiempo restante", formatEta(download.eta_seconds)]);
    }
  }

  return (
    <div className={className} aria-label="Progreso de la descarga">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
      {Number.isFinite(progress) ? (
        <div className="library-room-progress-inline" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress}%` }} />
          <strong>{Math.round(progress)}%</strong>
        </div>
      ) : null}
    </div>
  );
}

export default GenericDownloadProgressView;
