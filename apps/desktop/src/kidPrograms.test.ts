// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// As in the installed app: the restrictor's commands answer (restrictor.rs).
const calls = vi.hoisted(() => [] as Array<[string, unknown]>);
vi.mock("./native", () => ({ hasTauriRuntime: () => true }));
vi.mock("./activation", () => ({ ACTIVATION_CHANGED_EVENT: "x", getActivationTier: () => "plus" }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: unknown) => {
    calls.push([command, args]);
    if (command === "restriction_state") return { config: null, service: "running", writable: true };
    if (command === "restriction_programs") return [
      { name: "Blender", publisher: "Blender Foundation", folder: "C:\\Program Files\\Blender", kind: "program" },
      { name: "Krita", publisher: "KDE", folder: "C:\\Program Files\\Krita", kind: "program" },
      { name: "Portal 2", publisher: "Valve", folder: "D:\\SteamLibrary\\steamapps\\common\\Portal 2", kind: "game" },
      { name: "Microsoft 365", publisher: "Microsoft", folder: "C:\\Program Files\\Microsoft Office", kind: "windows" },
    ];
    if (command === "restriction_save") return { config: (args as { config: unknown }).config, service: "running", writable: true };
    if (command === "run_digital_process") return { ok: false };
    return null;
  }),
}));

import { allowBlocked, applyKidDraft, loadDetectedPrograms, loadKidFamily, setKidDraft, setKidModeEnabled, toggleKidProgram } from "./kidMode";
import { blockNotice } from "./restrictionNotice";

describe("programas permitidos del modo niño", () => {
  beforeEach(() => { calls.length = 0; localStorage.clear(); });

  it("los programas instalados empiezan permitidos; los juegos y lo de Windows no se eligen", async () => {
    await loadKidFamily();
    await loadDetectedPrograms();
    setKidDraft({ name: "Fran", games: [] });
    toggleKidProgram({ name: "Krita", folder: "C:\\Program Files\\Krita" });
    allowBlocked({ at: 1, name: "tool", path: "C:\\Users\\x\\Tools\\tool.exe", game: false, count: 1 });
    await applyKidDraft();
    const saved = calls.find(([command]) => command === "restriction_save")![1] as { config: { enabled: boolean; programs: Array<{ folder: string }> } };
    // Blender stays, Krita was unticked, the blocked tool's folder was allowed; Portal 2 is not allowed, and Office (a
    // Windows program) always goes along without being a choice.
    expect(saved.config.programs.map(item => item.folder)).toEqual(["C:\\Program Files\\Blender", "C:\\Users\\x\\Tools", "C:\\Program Files\\Microsoft Office"]);
    // Setting kid mode up turns it on.
    expect(saved.config.enabled).toBe(true);
  });

  it("el interruptor grande guarda encendido o apagado al momento", async () => {
    await setKidModeEnabled(false);
    const saved = calls.find(([command]) => command === "restriction_save")![1] as { config: { enabled: boolean; kid: { name: string } } };
    expect(saved.config.enabled).toBe(false);
    expect(saved.config.kid.name).toBe("Fran");
  });

  it("el aviso dice qué hacer: un juego va a la biblioteca, un programa a los permitidos", () => {
    expect(blockNotice({ at: 1, name: "Hades", path: "x", game: true, count: 1 }).text).toMatch(/biblioteca|library/);
    expect(blockNotice({ at: 1, name: "tool", path: "x", game: false, count: 1 }).text).toMatch(/programas permitidos|allowed programs/);
  });
});
