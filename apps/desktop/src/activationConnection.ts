import { getBackendConnection, type BackendConnection } from "./settings";

export function activationRetryDelay(signal: AbortSignal, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export async function waitForActivationConnection(
  signal: AbortSignal,
  onWaiting: () => void,
  probe: () => Promise<BackendConnection> = () => getBackendConnection(true, signal),
): Promise<BackendConnection> {
  while (!signal.aborted) {
    const connection = await probe();
    if (signal.aborted) break;
    if (connection.url) return connection;
    onWaiting();
    await activationRetryDelay(signal);
  }
  throw new DOMException("Aborted", "AbortError");
}
