import { useEffect, useState, useSyncExternalStore } from "react";
import { resourceGuard } from "./ResourceGuard";
import { startRuntimeMonitor, RUNTIME_LIMITS, type RuntimeReading } from "./runtimeMonitor";

/** Small live bar (fps, busy %, memory) shown only while the profiler is on. */
export default function ResourceMeter() {
 const enabled = useSyncExternalStore(l => resourceGuard.subscribeDebug(l), () => resourceGuard.isDebugEnabled(), () => false);
 const [reading, setReading] = useState<RuntimeReading | null>(null);
 useEffect(() => {
  if (!enabled) { setReading(null); return; }
  return startRuntimeMonitor(setReading);
 }, [enabled]);
 if (!enabled || !reading) return null;
 const hot = reading.busyPercent >= RUNTIME_LIMITS.BUSY_WARN_PERCENT || reading.worstFrameMs >= RUNTIME_LIMITS.FRAME_WARN_MS;
 return <div className={"ga-resource-meter" + (hot ? " is-hot" : "")} role="status" aria-label="Uso de recursos">
  <span>{reading.fps} fps</span><span>CPU {reading.busyPercent}%</span><span>peor cuadro {reading.worstFrameMs} ms</span>
  <span>{reading.heapMb === null ? "memoria n/d" : `${reading.heapMb} MB`}</span>
  {reading.renders.length ? <span className="ga-resource-culprits">{reading.renders.join(" · ")}</span> : null}
  {reading.culprits.length ? <span className="ga-resource-culprits">{reading.culprits.join(" · ")}</span> : null}
 </div>;
}
