// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FeaturePanel } from "./LibraryDetailPanel";
import { demoCatalog } from "./devDemo/uiDemo";

vi.mock("./usePluginReady", () => ({ usePluginReady: () => false }));
vi.mock("./navigation/navigationSelection", () => ({ navigationShellEnabled: () => true }));
vi.mock("./useSelectedGameDetails", () => ({ useSelectedGameDetails: () => ({ details: null, loading: false }) }));
vi.mock("./motion/magnetic", () => ({ useMagneticButtons: () => {} }));
vi.mock("./CooptimusDetails", () => ({
  default: () => null,
  loadCooptimusDetails: async () => ({ state: "ready", online_players_max: 4 }),
  CoopFacts: () => <p>4 jugadores</p>,
}));
vi.mock("./aiSuggestions", async importOriginal => {
  const actual = await importOriginal<typeof import("./aiSuggestions")>();
  return {
    ...actual,
    aiWhy: () => null,
    aiCompare: async () => "Comparte la exploración y el ritmo de tus partidas anteriores.",
    aiAsk: async () => {
      const { demoCatalog } = await import("./devDemo/uiDemo");
      return { reply: "Encontré otra aventura con exploración y combates similares.", picks: [
        { game: demoCatalog[1], why: "Combina exploración y combates." },
      ] };
    },
    useAiSearch: () => ({ plus: true, connected: true, on: false }),
    useTasteSignals: () => ({}),
  };
});

it("keeps the sidebar optional, routes co-op and related games to tabs, and renders both simulated AI replies", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const onOpenGame = vi.fn();
  const findButton = (text: RegExp) => [...host.querySelectorAll("button")].find(button => text.test(button.textContent ?? ""));
  try {
    await act(async () => root.render(<FeaturePanel game={demoCatalog[0]} showcaseMode={false}
      actions={[]} focusZone="grid" actionIndex={0} actionRefs={{ current: [] }}
      onPreference={vi.fn()} setFocusZone={vi.fn()} setActionIndex={vi.fn()} onAction={vi.fn()} onOpenGame={onOpenGame} />));
    const sheet = host.querySelector<HTMLElement>(".ga-game-detail.is-sheet")!;
    vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 700));
    const pointerMove = new MouseEvent("pointermove", { bubbles: true, clientX: 900, clientY: 140 });
    Object.defineProperty(pointerMove, "pointerType", { value: "mouse" });
    act(() => { sheet.dispatchEvent(pointerMove); });
    expect(Number(sheet.style.getPropertyValue("--ga-detail-pointer-x"))).toBeCloseTo(0.4);
    expect(Number(sheet.style.getPropertyValue("--ga-detail-pointer-y"))).toBeCloseTo(-0.3);
    expect(host.querySelector(".ga-sheet-extras")).toBeNull();
    expect(host.querySelector(".ga-sheet-rows")?.textContent).toContain("App ID");
    await act(async () => findButton(/Co-Optimus/i)!.click());
    expect(host.querySelector("[role=tabpanel]")?.textContent).toContain("4 jugadores");
    await act(async () => findButton(/Consultar IA|Ask AI/i)!.click());
    expect(host.querySelector(".ga-sheet-panel.is-ai")).not.toBeNull();
    await act(async () => findButton(/Se parece|like others/i)!.click());
    expect(host.querySelector(".ga-sheet-extras")?.textContent).toContain("Comparte la exploración");
    await act(async () => findButton(/Más como este|More like this/i)!.click());
    expect(host.querySelector(".ga-sheet-extras")?.textContent).toContain("Encontré otra aventura");
    await act(async () => findButton(/Relacionados|Related games/i)!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".ga-sheet-panels .ga-ai-pick")!.click());
    expect(onOpenGame).toHaveBeenCalledWith(demoCatalog[1]);
    await act(async () => findButton(/Consultar IA|Ask AI/i)!.click());
    expect(host.querySelector(".ga-sheet-extras")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
