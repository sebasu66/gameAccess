import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmNotice, getNotice, hideNotice, runSteps, showNotice, updateNotice } from "./notice";

describe("single notice", () => {
  afterEach(() => hideNotice());

  it("closes a good result with the timer and keeps an error until the player closes it", () => {
    showNotice({ title: "Congelado", tone: "ok" });
    expect(getNotice()?.timer).toBe(true);
    showNotice({ title: "No se pudo", tone: "error" });
    expect(getNotice()?.timer).toBe(false);
  });

  it("replaces the visible notice instead of stacking and tells the replaced one it left", () => {
    const left = vi.fn();
    showNotice({ title: "Primero", tone: "info", onDismiss: left });
    const second = showNotice({ title: "Segundo", tone: "info" });
    expect(left).toHaveBeenCalledOnce();
    expect(getNotice()?.id).toBe(second);
    expect(getNotice()?.title).toBe("Segundo");
  });

  it("updates only the notice it was given", () => {
    const first = showNotice({ title: "A", tone: "info" });
    showNotice({ title: "B", tone: "info" });
    updateNotice(first, { title: "cambiado" });
    expect(getNotice()?.title).toBe("B");
  });

  it("asks with Cancel + action and resolves with the answer", async () => {
    const answer = confirmNotice({ title: "¿Desinstalar?", confirmLabel: "Desinstalar", cancelLabel: "Cancelar" });
    const notice = getNotice()!;
    expect(notice.timer).toBe(false);
    expect(notice.actions.map(action => action.label)).toEqual(["Cancelar", "Desinstalar"]);
    notice.actions[1].run();
    await expect(answer).resolves.toBe(true);
  });

  it("treats a replaced or cancelled confirmation as no", async () => {
    const replaced = confirmNotice({ title: "¿Quitar?", confirmLabel: "Quitar", cancelLabel: "Cancelar" });
    showNotice({ title: "Otra cosa", tone: "info" });
    await expect(replaced).resolves.toBe(false);
    const cancelled = confirmNotice({ title: "¿Quitar?", confirmLabel: "Quitar", cancelLabel: "Cancelar" });
    getNotice()!.actions[0].run();
    await expect(cancelled).resolves.toBe(false);
    expect(getNotice()).toBeNull();
  });

  it("walks through steps and ends with the result", () => {
    const run = runSteps({ title: "Abriendo el juego", steps: ["Preparar", "Iniciar"] });
    expect(getNotice()?.timer).toBe(false);
    run.set(0, "running");
    expect(getNotice()?.steps?.[0].state).toBe("running");
    run.set(0, "done");
    expect(getNotice()?.progress).toBe(.5);
    run.succeed({ title: "Listo: ya estás jugando" });
    expect(getNotice()?.title).toBe("Listo: ya estás jugando");
    expect(getNotice()?.timer).toBe(true);
  });

  it("ends steps with an error that stays", () => {
    const run = runSteps({ title: "Abriendo el juego", steps: ["Preparar"] });
    run.fail({ title: "Error de ejecución", text: "no se encontró el ejecutable", actions: [{ label: "Reintentar", run: () => {} }] });
    expect(getNotice()?.tone).toBe("error");
    expect(getNotice()?.timer).toBe(false);
  });
});
