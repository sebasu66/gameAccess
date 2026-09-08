

import { type MachineProfile, type SteamDownloadStatus } from "./native";
import type { CatalogGame, GameDetails, SteamMetadata } from "./types";

export const stripHtml = (value?: string) =>
  (value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export type VisualCheck = { selector: string; label: string; minWidth?: number; minHeight?: number; mustFitWidth?: boolean };

export function inspectVisualChecks(checks: VisualCheck[]) {
  return checks.map((check) => {
    const element = document.querySelector<HTMLElement>(check.selector);
    const rect = element?.getBoundingClientRect();
    const style = element ? window.getComputedStyle(element) : null;
    const visible = isVisible(element, rect, style);
    const largeEnough = Boolean(rect && rect.width >= (check.minWidth ?? 1) && rect.height >= (check.minHeight ?? 1));
    const fitsWidth = !check.mustFitWidth || Boolean(element && element.scrollWidth <= element.clientWidth + 1);
    return { ...check, visible, largeEnough, fitsWidth, width: Math.round(rect?.width ?? 0), height: Math.round(rect?.height ?? 0), pass: visible && largeEnough && fitsWidth };
  });
}

export type SessionPhase = "reserving" | "preparing" | "launching" | "playing" | "waiting-adapter" | "demo-ready" | "error";
export type Preference = 1 | -1;
export type DownloadMap = Record<number, SteamDownloadStatus>;

export type SessionView = {
  game: CatalogGame;
  phase: SessionPhase;
  title: string;
  detail: string;
  log?: string[];
};

export function availabilityLabel(game: CatalogGame) {
  if (game.copies_available > 0) return `${game.copies_available} disponible${game.copies_available === 1 ? "" : "s"}`;
  if (game.copies_total > 0) return "Ocupado";
  return "Sin stock";
}

function minRamGb(steam?: SteamMetadata | null): number | null {
  const text = stripHtml(steam?.minimum_requirements);
  const matches = [...text.matchAll(/(?:memory|memoria)\s*:?\s*(\d+(?:\.\d+)?)\s*gb/gi)];
  if (!matches.length) return null;
  return Math.max(...matches.map((match) => Number(match[1])).filter(Number.isFinite));
}

export function heavinessLabel(steam?: SteamMetadata | null, machine?: MachineProfile | null) {
  if (!steam) return null;
  const requiredRam = minRamGb(steam);
  if (requiredRam && machine?.memory_gb && requiredRam > machine.memory_gb + 0.25) {
    return { tone: "bad", text: `Muy pesado · pide ${requiredRam} GB RAM` };
  }

  const req = stripHtml(steam.minimum_requirements).toLowerCase();
  const demandingGpu = /(rtx\s*(20|30|40|50)|rx\s*(57|66|67|68|69|76|77|78|79)|gtx\s*1080)/i.test(req);
  if ((requiredRam && requiredRam >= 16) || demandingGpu) {
    return { tone: "warn", text: "Requisitos altos" };
  }
  if (machine && requiredRam) return { tone: "good", text: "Tu RAM cumple el mínimo" };
  return null;
}

export function releaseScore(details?: GameDetails) {
  const date = details?.steam?.release_date;
  if (!date) return 0;
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function GlassActionButton({
  icon,
  label,
  tone = "neutral",
  pulse = false,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "neutral" | "play" | "download";
  pulse?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`glass-action ${tone} ${pulse ? "pulse" : ""}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
    >
      <span className="glass-action-icon">{icon}</span>
      <span className="glass-action-label">{label}</span>
    </button>
  );
}

function isVisible(element: HTMLElement | null, rect: DOMRect | undefined, style: CSSStyleDeclaration | null) {
  if (!element || !rect || !style) return false;
  const hasSize = rect.width > 0 && rect.height > 0;
  const onScreen = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  return hasSize && onScreen && style.visibility !== "hidden" && style.display !== "none";
}
