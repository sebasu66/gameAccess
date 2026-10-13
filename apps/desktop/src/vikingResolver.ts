import { getInstallationId, readActivationSession } from "./activation";
import { narrate } from "./narrationLog";
import { getApiBaseUrl } from "./settings";

declare const __BUILD_TIMESTAMP__: string;

/** The server waits for TorBox and ViKiNG, which can take a long time for big files. */
const RESOLVE_TIMEOUT_MS = 50 * 60 * 1000;

export type VikingResolved = {
  url: string;
  name: string;
  sizeBytes: number | null;
  cacheHit: boolean;
};

export type VikingResolveRequest = {
  sourceUrl: string;
  itemName?: string;
  fileName?: string;
  appId?: number | null;
};

/** Only direct links and magnets can go through TorBox. */
export function canAccelerate(source: string): boolean {
  const value = source.trim().toLowerCase();
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("magnet:?");
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const detail = body?.detail;
    if (typeof detail === "string" && detail) return detail;
    if (detail?.message) return String(detail.message);
  } catch {
    // The body was not JSON; fall through to the status line.
  }
  return `el servidor respondió con el código ${response.status}`;
}

/**
 * Sends a download link to the server (cache check, then TorBox, then ViKiNG) and
 * returns the processed link. Every step is written to the console and the activity
 * log. Returns null, never throws, so a failure leaves the normal download working.
 */
export async function resolveVikingDownload(request: VikingResolveRequest): Promise<VikingResolved | null> {
  const area = "DOWNLOAD";
  const source = request.sourceUrl.trim();
  if (!canAccelerate(source)) {
    void narrate("Esta fuente no es un enlace directo ni un magnet; se descarga sin pasar por el servidor.", { area });
    return null;
  }

  const [api, token, installationId] = await Promise.all([getApiBaseUrl(), readActivationSession(), getInstallationId()]);
  if (!api || !token || !installationId) {
    void narrate("No hay una activación vigente; se descarga sin pasar por el servidor.", { area, level: "WARN" });
    return null;
  }

  void narrate(`Enviando petición de descarga al server para el link ${source}`, { area });
  try {
    const response = await fetch(`${api}/downloads/viking-cache`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-GameAccess-Installation": installationId,
      },
      body: JSON.stringify({
        source_url: source,
        item_name: request.itemName ?? "",
        file_name: request.fileName ?? "",
        app_id: request.appId && request.appId > 0 ? request.appId : null,
        client_build: typeof __BUILD_TIMESTAMP__ === "string" ? __BUILD_TIMESTAMP__ : "development",
      }),
    });
    if (!response.ok) {
      const reason = await readError(response);
      void narrate(`Error del server al procesar la descarga: ${reason}`, { area, level: "ERROR" });
      return null;
    }
    const body = await response.json();
    const url = typeof body?.url === "string" ? body.url : "";
    if (!body?.ok || !url) {
      void narrate("Error: el server no devolvió un link de descarga procesado.", { area, level: "ERROR" });
      return null;
    }
    const resolved: VikingResolved = {
      url,
      name: typeof body.name === "string" ? body.name : "",
      sizeBytes: typeof body.size_bytes === "number" ? body.size_bytes : null,
      cacheHit: body.cache_hit === true,
    };
    void narrate(
      `Recibido link de descarga procesado: ${resolved.url}${resolved.cacheHit ? " (ya estaba en caché)" : ""}`,
      { area },
    );
    return resolved;
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    const reason = timedOut ? "el server tardó demasiado en responder" : error instanceof Error ? error.message : String(error);
    void narrate(`Error al pedir el link procesado al server: ${reason}`, { area, level: "ERROR" });
    return null;
  }
}
