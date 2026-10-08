import { useEffect, useState } from "react";
import { digitalDownloadService } from "./catalog/DigitalDownloadService";
import FloatingDownloadIndicator from "./FloatingDownloadIndicator";

const terminal = new Set(["completed", "cancelled", "error", "interrupted"]);
type Entry = ReturnType<typeof digitalDownloadService.getDownloads>[number];

export default function DigitalDownloadToast({ onOpen }: { onOpen: () => void }) {
  const [entries, setEntries] = useState(() => digitalDownloadService.getDownloads());
  const [notice, setNotice] = useState<Entry | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = digitalDownloadService.onGlobalUpdate(snapshot => {
      const current = digitalDownloadService.getDownloads();
      setEntries(current);
      if (terminal.has(snapshot.phase)) {
        setNotice(current.find(entry => entry.snapshot.gameId === snapshot.gameId) ?? null);
        clearTimeout(timer);
        timer = setTimeout(() => setNotice(null), 8000);
      }
    });
    setEntries(digitalDownloadService.getDownloads());
    return () => { unsubscribe(); clearTimeout(timer); };
  }, []);
  const pending = entries.filter(entry => !terminal.has(entry.snapshot.phase));
  const entry = pending.find(item => !["queued", "paused"].includes(item.snapshot.phase)) ?? pending[0] ?? notice;
  if (!entry) return null;
  const active = pending.filter(item => !["queued", "paused"].includes(item.snapshot.phase));
  return <FloatingDownloadIndicator game={entry.game} snapshot={entry.snapshot} additional={Math.max(0, active.length - 1)} onOpen={onOpen}/>;
}
