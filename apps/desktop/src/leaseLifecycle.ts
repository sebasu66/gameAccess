import type { LeaseResponse } from "./types";
import { getProviderLeaseStatus } from "./api";
import { narrate } from "./narrationLog";

const STORAGE_KEY = "gameaccess:active-provider-lease";
export const PROVIDER_LEASE_RELEASED_EVENT = "gameaccess:provider-lease-released";

interface ActiveProviderLease {
  leaseId: number;
  appId: number;
  accountLabel: string;
}

function readActiveProviderLease(): ActiveProviderLease | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ActiveProviderLease>;
    if (!Number.isInteger(value.leaseId) || Number(value.leaseId) <= 0) return null;
    if (!Number.isInteger(value.appId) || Number(value.appId) <= 0) return null;
    return {
      leaseId: Number(value.leaseId),
      appId: Number(value.appId),
      accountLabel: String(value.accountLabel ?? ""),
    };
  } catch {
    return null;
  }
}

export function rememberProviderLease(lease: LeaseResponse): void {
  const appId = Number(lease.game.app_id ?? 0);
  if (!Number.isInteger(lease.lease_id) || lease.lease_id <= 0 || !Number.isInteger(appId) || appId <= 0) return;
  const value: ActiveProviderLease = {
    leaseId: lease.lease_id,
    appId,
    accountLabel: lease.account?.label ?? "",
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function forgetProviderLease(leaseId?: number): void {
  const current = readActiveProviderLease();
  if (!current) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  if (leaseId == null || current.leaseId === leaseId) localStorage.removeItem(STORAGE_KEY);
}

export async function reconcileProviderLease(): Promise<boolean> {
  const active = readActiveProviderLease();
  if (!active) return false;

  let status;
  try {
    status = await getProviderLeaseStatus(active.leaseId);
  } catch (error) {
    await narrate(
      `Could not refresh provider lease ${active.leaseId}; local Steam/game state is left untouched: ${error instanceof Error ? error.message : String(error)}.`,
      { area: "BACKEND", level: "WARN" },
    );
    return false;
  }
  if (status.status === "active") return false;

  forgetProviderLease(active.leaseId);
  const reason = status.release_reason ?? status.status;
  if (reason === "steam_inactive_timeout") {
    const message = "Se liberó el acceso a la cuenta por 10 minutos sin actividad online. Puedes seguir jugando poniendo Steam en modo offline o desconectando Wi-Fi.";
    window.dispatchEvent(new CustomEvent(PROVIDER_LEASE_RELEASED_EVENT, {
      detail: {
        message,
        leaseId: active.leaseId,
        appId: active.appId,
        accountLabel: active.accountLabel,
        reason,
      },
    }));
  }
  await narrate(
    `Backend marked provider lease ${active.leaseId} as ${status.status}; reason=${reason}. Steam and the running game were not closed by GameAccess.`,
    { area: "BACKEND" },
  );
  return true;
}

export function startProviderLeaseMonitor(intervalMs = 15_000): () => void {
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await reconcileProviderLease();
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = window.setInterval(() => void tick(), intervalMs);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}
