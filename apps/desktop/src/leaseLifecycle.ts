import type { LeaseResponse } from "./types";
import { releaseActiveLease } from "./api";
import { getSteamSessionStatus, isSteamAppRunning } from "./native";
import { narrate } from "./narrationLog";

const STORAGE_KEY = "gameaccess:active-provider-lease";
const START_GRACE_MS = 45_000;

interface ActiveProviderLease {
  leaseId: number;
  appId: number;
  accountLabel: string;
  createdAt: number;
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
      createdAt: Number(value.createdAt) || 0,
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
    createdAt: Date.now(),
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
  if (Date.now() - active.createdAt < START_GRACE_MS) return false;

  const [session, appRunning] = await Promise.all([
    getSteamSessionStatus().catch(() => null),
    isSteamAppRunning(active.appId).catch(() => false),
  ]);
  const tracked = Boolean(
    session
    && session.appId === active.appId
    && !session.done
    && session.phase !== "idle",
  );
  if (tracked || appRunning) return false;

  try {
    await releaseActiveLease(active.leaseId);
    forgetProviderLease(active.leaseId);
    await narrate(
      `Released completed/stale provider lease ${active.leaseId} for Steam AppID ${active.appId}.`,
      { area: "LAUNCH" },
    );
    return true;
  } catch (error) {
    await narrate(
      `Could not release provider lease ${active.leaseId}; it will be retried: ${error instanceof Error ? error.message : String(error)}.`,
      { area: "LAUNCH", level: "WARN" },
    );
    return false;
  }
}

export function startProviderLeaseMonitor(intervalMs = 3000): () => void {
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
