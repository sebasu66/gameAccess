import type { MachineProfile, SteamDownloadStatus } from "./native";
import type { CatalogGame, SteamMetadata } from "./types";

export type Capability = "single" | "online" | "local" | "lan";

export interface HardwareWarning {
  title: string;
  detail: string;
}

export function stripSteamHtml(value?: string) {
  return (value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function gameCapabilities(categories: string[] = []): Capability[] {
  const normalized = categories.map((value) => value.toLocaleLowerCase("en"));
  const has = (needle: string) => normalized.some((value) => value.includes(needle));
  const result: Capability[] = [];
  if (has("single-player")) result.push("single");
  if (has("online pvp") || has("online co-op") || has("cross-platform multiplayer") || has("multi-player")) result.push("online");
  if (has("shared/split screen")) result.push("local");
  if (has("lan pvp") || has("lan co-op")) result.push("lan");
  return [...new Set(result)];
}

export function accountSummary(game: CatalogGame): string[] {
  const labels = game.local_account_labels?.filter(Boolean) ?? [];
  if (labels.length <= 2) return labels;
  return [labels[0], labels[1], "…"];
}

function unitToGb(value: number, unit: string) {
  const normalized = unit.toLocaleLowerCase("en");
  if (normalized === "tb") return value * 1024;
  if (normalized === "mb") return value / 1024;
  return value;
}

export function requiredStorageGb(steam?: SteamMetadata | null): number | null {
  const text = stripSteamHtml(steam?.minimum_requirements);
  const direct = text.match(/(?:storage|almacenamiento|espacio(?: disponible)?)[^\d]{0,24}(\d+(?:[.,]\d+)?)\s*(tb|gb|mb)/i);
  const fallback = text.match(/(\d+(?:[.,]\d+)?)\s*(tb|gb|mb)\s+(?:available|disponible)/i);
  const match = direct ?? fallback;
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) ? unitToGb(value, match[2]) : null;
}

export function formatBytes(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  const mb = bytes / 1024 / 1024;
  return `${Math.max(1, Math.round(mb))} MB`;
}

export function installationSizeLabel(steam?: SteamMetadata | null, download?: SteamDownloadStatus): string | null {
  const currentDownload = formatBytes(download?.bytes_total);
  if (download && !download.installed && currentDownload) return `${currentDownload} de descarga`;
  const required = requiredStorageGb(steam);
  if (!required) return null;
  const rounded = required >= 10 ? required.toFixed(0) : required.toFixed(1);
  return `≈ ${rounded} GB instalados`;
}

function minimumRamGb(steam?: SteamMetadata | null): number | null {
  const text = stripSteamHtml(steam?.minimum_requirements);
  const match = text.match(/(?:memory|memoria)\s*:?\s*(\d+(?:[.,]\d+)?)\s*gb/i);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

export function hardwareWarning(steam?: SteamMetadata | null, machine?: MachineProfile | null): HardwareWarning | null {
  const minimumRam = minimumRamGb(steam);
  const installedRam = machine?.memory_gb;
  if (minimumRam && installedRam && installedRam + 0.25 < minimumRam) {
    return {
      title: "Esta PC queda por debajo del mínimo informado por Steam",
      detail: `Steam pide al menos ${minimumRam} GB de RAM y detectamos ${installedRam.toFixed(1)} GB.`,
    };
  }
  return null;
}

export function isSensitiveSteamContent(steam?: SteamMetadata | null, raw?: Record<string, unknown> | null): boolean {
  const age = Number(steam?.required_age ?? 0);
  if (Number.isFinite(age) && age >= 18) return true;
  const descriptors = raw?.content_descriptors;
  if (!descriptors || typeof descriptors !== "object") return false;
  const ids = (descriptors as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) return false;
  return ids.some((value) => [1, 3, 4].includes(Number(value)));
}
