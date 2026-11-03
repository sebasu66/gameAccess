// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { AppShortcut } from "./appShortcuts";
import { getPlusGraceDays, isPlusLapsed, resetAccessRoleForTests } from "./accessRole";
import { applyKidDraft, dropKidGames, PLUS_GRACE_DAYS, reportPlus, reportPlusUnreachable, kidGameCount, kidGamesAmong, NEW_KID, resetKidMode, setKidDraft, toggleKidShortcut } from "./kidMode";

const shortcut = (id: number, name: string) => ({ id, name, folder: "C:/x", target: "C:/x/a.exe", arguments: [] }) as unknown as AppShortcut;

describe("modo niño: juegos que salen de la biblioteca", () => {
  it("quita del niño solo los juegos que se van y dice cuántos le quedan", async () => {
    setKidDraft({ name: "Juan", games: [] });
    toggleKidShortcut(shortcut(1, "Roblox"));
    toggleKidShortcut(shortcut(2, "Paint"));
    expect(kidGameCount()).toBe(2);
    expect(kidGamesAmong([-1, 99]).map(game => game.name)).toEqual(["Roblox"]);
    expect(dropKidGames([-1, 99]).map(game => game.name)).toEqual(["Roblox"]);
    expect(kidGameCount()).toBe(1);
    expect(dropKidGames([-1])).toEqual([]);
  });

  it("deshacer el modo niño vuelve todo a cero", async () => {
    setKidDraft({ name: "Juan", games: [] });
    toggleKidShortcut(shortcut(3, "Dibujo"));
    await applyKidDraft();
    await resetKidMode();
    expect(kidGameCount()).toBe(0);
    setKidDraft({});
    expect(NEW_KID.weekdays).toBe("12-21");
  });

  it("lo que dice la verificación de PLUS se refleja en la clave de padre", () => {
    resetAccessRoleForTests();
    reportPlus(false);
    expect(isPlusLapsed()).toBe(true);
    reportPlus(true);
    expect(isPlusLapsed()).toBe(false);
  });

  it("sin conexión hay una gracia contada desde la última vez que se confirmó PLUS", () => {
    resetAccessRoleForTests();
    const day = 86_400_000, now = Date.now();
    localStorage.setItem("gameaccess.plusConfirmedAt", String(now - 2 * day));
    reportPlusUnreachable(now);
    // Two of the days are gone: nothing is paused, and the notice counts what is left.
    expect(isPlusLapsed()).toBe(false);
    expect(getPlusGraceDays()).toBe(PLUS_GRACE_DAYS - 2);
    // Past the grace it counts as ended.
    reportPlusUnreachable(now + (PLUS_GRACE_DAYS + 1) * day);
    expect(isPlusLapsed()).toBe(true);
    expect(getPlusGraceDays()).toBeNull();
  });

  it("una PC que nunca confirmó PLUS empieza a contar la gracia recién ahora", () => {
    resetAccessRoleForTests(); localStorage.clear();
    reportPlusUnreachable(Date.now());
    expect(isPlusLapsed()).toBe(false);
    expect(getPlusGraceDays()).toBe(PLUS_GRACE_DAYS);
  });

  it("volver a confirmar PLUS corta la gracia y cuenta de nuevo desde ese momento", () => {
    resetAccessRoleForTests();
    const day = 86_400_000, now = Date.now();
    localStorage.setItem("gameaccess.plusConfirmedAt", String(now - 5 * day));
    reportPlusUnreachable(now);
    expect(getPlusGraceDays()).toBe(PLUS_GRACE_DAYS - 5);
    reportPlus(true);
    expect(getPlusGraceDays()).toBeNull();
    reportPlusUnreachable(Date.now());
    expect(getPlusGraceDays()).toBe(PLUS_GRACE_DAYS);
  });

  it("una respuesta explícita de que no hay PLUS no tiene gracia", () => {
    resetAccessRoleForTests();
    reportPlus(false);
    expect(isPlusLapsed()).toBe(true);
  });
});
