// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// As in the installed app: the restrictor's and the Windows settings' commands answer (restrictor.rs, uac_password.rs).
const calls = vi.hoisted(() => [] as Array<[string, unknown]>);
const undo = vi.hoisted(() => ({ answer: true, refuse: false }));
vi.mock("./native", () => ({ hasTauriRuntime: () => true }));
vi.mock("./activation", () => ({ ACTIVATION_CHANGED_EVENT: "x", getActivationTier: () => "plus" }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: unknown) => {
    calls.push([command, args]);
    if (command === "uac_password_undo") { if (undo.refuse) throw new Error("cancelled"); return undo.answer; }
    if (command === "restriction_state") return { config: null, service: "running", writable: true };
    if (command === "restriction_programs") return [];
    if (command === "restriction_save") return { config: (args as { config: unknown }).config, service: "running", writable: true };
    return null;
  }),
}));

import { applyKidDraft, loadKidFamily, resetKidMode, setKidDraft, setKidModeEnabled } from "./kidMode";

describe("contraseña de Windows del modo niño", () => {
  beforeEach(() => { calls.length = 0; undo.answer = true; undo.refuse = false; localStorage.clear(); });

  it("quitar el modo niño la devuelve aunque no se haya aplicado ninguna configuración", async () => {
    // The parent only turned the Windows password on from Control parental, then turned kid mode off: the settings
    // were never applied, and this was the case that left Windows asking for the password with no way back.
    await loadKidFamily();
    expect(await resetKidMode()).toBe(false);
    expect(calls.map(([command]) => command)).toContain("uac_password_undo");
  });

  it("si Windows niega el permiso, queda encendida y se avisa", async () => {
    await loadKidFamily();
    undo.refuse = true;
    expect(await resetKidMode()).toBe(true);
  });

  it("el interruptor grande apagado también la devuelve", async () => {
    await loadKidFamily();
    setKidDraft({ name: "Fran", games: [] });
    await applyKidDraft();
    calls.length = 0;
    expect(await setKidModeEnabled(false)).toBe(false);
    expect(calls.map(([command]) => command)).toEqual(["restriction_save", "uac_password_undo"]);
  });
});
