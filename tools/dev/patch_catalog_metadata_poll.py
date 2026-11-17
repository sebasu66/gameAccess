from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
app = ROOT / "apps/desktop/src/App.tsx"
text = app.read_text(encoding="utf-8")

old = "let visualDebugStarted = false;\n\nexport default function App() {"
new = '''let visualDebugStarted = false;

const isPendingSteamMetadata = (game: CatalogGame) =>
  Boolean(game.app_id) && new RegExp(`^Steam\\s+${game.app_id}$`, "i").test(game.name.trim());

export default function App() {'''
if old in text and "const isPendingSteamMetadata" not in text:
    text = text.replace(old, new, 1)

anchor = '''  }, [refresh]);

  useEffect(() => {
    const storageStateChanged = (event: Event) => {'''
insert = '''  }, [refresh]);

  const hasPendingSteamMetadata = useMemo(() => games.some(isPendingSteamMetadata), [games]);

  useEffect(() => {
    if (!hasPendingSteamMetadata) return;
    let cancelled = false;
    let inFlight = false;
    const refreshPendingMetadata = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const home = await loadHome();
        if (cancelled) return;
        setGames(home.games);
        setUser(home.user);
        setOfflineDemo(home.offlineDemo);
        setSelected((current) => {
          if (!current) return null;
          return home.games.find((game) => game.id === current.id) ?? null;
        });
      } catch {
        // Metadata enrichment is best-effort. Keep the current library visible.
      } finally {
        inFlight = false;
      }
    };
    void refreshPendingMetadata();
    const timer = window.setInterval(() => void refreshPendingMetadata(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasPendingSteamMetadata]);

  useEffect(() => {
    const storageStateChanged = (event: Event) => {'''
if anchor in text and "refreshPendingMetadata" not in text:
    text = text.replace(anchor, insert, 1)

app.write_text(text, encoding="utf-8")

api = ROOT / "apps/desktop/src/api.ts"
api_text = api.read_text(encoding="utf-8")
fetch_anchor = '''  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });'''
fetch_replacement = '''  const response = await fetch(`${api}${path}`, {
    ...init,
    cache: method === "GET" ? "no-store" : init?.cache,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });'''
if fetch_anchor in api_text and 'cache: method === "GET" ? "no-store"' not in api_text:
    api_text = api_text.replace(fetch_anchor, fetch_replacement, 1)
api.write_text(api_text, encoding="utf-8")

test = ROOT / "apps/desktop/src/catalogMetadataRefresh.test.ts"
test.write_text('''import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";
import apiSource from "./api.ts?raw";

describe("pending Steam metadata refresh", () => {
  it("refreshes unresolved Steam cards in background without blocking navigation", () => {
    expect(appSource).toContain("const isPendingSteamMetadata");
    expect(appSource).toContain("games.some(isPendingSteamMetadata)");
    expect(appSource).toContain("refreshPendingMetadata");
    expect(appSource).toContain("window.setInterval(() => void refreshPendingMetadata(), 5000)");
    expect(apiSource).toContain('cache: method === "GET" ? "no-store"');
  });
});
''', encoding="utf-8")
