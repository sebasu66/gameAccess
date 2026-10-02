import type { LeaseResponse } from "./types";
import { releaseActiveLease } from "./api";
import { getSteamSessionStatus, steamAccountActivity } from "./native";
import { narrate } from "./narrationLog";

const STORAGE_KEY = "gameaccess:active-provider-lease";
const START_GRACE_MS = 45_000;
const IDLE_RELEASE_MS = 10 * 60_000;
export const PROVIDER_LEASE_RELEASED_EVENT = "gameaccess:provider-lease-released";

interface ActiveProviderLease {
  leaseId: number;
  appId: number;
  accountLabel: string;
  createdAt: number;
  idleSince: number | null;
  expectedUserId32: number | null;
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
      idleSince: Number(value.idleSince) || null,
      expectedUserId32: Number(value.expectedUserId32) || null,
    };
  } catch {
    return null;
  }
}

function writeActiveProviderLease(value: ActiveProviderLease): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function rememberProviderLease(lease: LeaseResponse): void {
  const appId = Number(lease.game.app_id ?? 0);
  if (!Number.isInteger(lease.lease_id) || lease.lease_id <= 0 || !Number.isInteger(appId) || appId <= 0) return;
  const value: ActiveProviderLease = {
    leaseId: lease.lease_id,
    appId,
    accountLabel: lease.account?.label ?? "",
    createdAt: Date.now(),
    idleSince: null,
    expectedUserId32: Number(lease.account?.user_id32) || null,
  };
  writeActiveProviderLease(value);
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

  const [session, accountActivity] = await Promise.all([
    getSteamSessionStatus().catch(() => null),
    active.expectedUserId32
      ? steamAccountActivity(active.expectedUserId32).catch(() => null)
      : Promise.resolve(null),
  ]);
  const trackedLaunch = Boolean(
    session
    && session.accountName === active.accountLabel
    && !session.done
    && session.phase !== "idle",
  );
  const accountPlaying = Boolean(accountActivity?.playing);

  if (trackedLaunch || accountPlaying) {
    if (active.idleSince != null) {
      active.idleSince = null;
      writeActiveProviderLease(active);
      await narrate(
        "Provider lease became active again; inactivity countdown cleared.",
        { area: "LAUNCH" },
      );
    }
    return false;
  }

  const now = Date.now();
  if (active.idleSince == null) {
    active.idleSince = now;
    writeActiveProviderLease(active);
    await narrate(
      "Provider lease entered inactivity grace. It will be released after 10 continuous minutes without a running game.",
      { area: "LAUNCH" },
    );
    return false;
  }
  if (now - active.idleSince < IDLE_RELEASE_MS) return false;

  try {
    await releaseActiveLease(active.leaseId);
    forgetProviderLease(active.leaseId);
    const message = "Se ha liberado el acceso a la cuenta por inactividad.";
    window.dispatchEvent(new CustomEvent(PROVIDER_LEASE_RELEASED_EVENT, {
      detail: {
        message,
        leaseId: active.leaseId,
        appId: active.appId,
        accountLabel: active.accountLabel,
      },
    }));
    await narrate(
      "Released provider lease after 10 continuous minutes without a running game.",
      { area: "LAUNCH" },
    );
    return true;
  } catch (error) {
    await narrate(
      "Could not release provider lease; it will be retried: " + (error instanceof Error ? error.message : String(error)) + ".",
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
