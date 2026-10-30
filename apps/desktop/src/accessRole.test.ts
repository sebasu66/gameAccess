import { beforeEach, describe, expect, it } from "vitest";
import { getAccessRole, isAskingForKey, isPlusLapsed, relock, requestAdmin, requireAdmin, resetAccessRoleForTests, setAccessRole, setAdminKey, setPlusLapsed, settleGateRequest } from "./accessRole";

describe("clave de padre: administrador y jugador", () => {
  beforeEach(() => resetAccessRoleForTests());

  it("sin clave todos son administradores y nada se pide", async () => {
    expect(getAccessRole()).toBe("admin");
    await expect(requestAdmin()).resolves.toBe(true);
    expect(isAskingForKey()).toBe(false);
  });

  it("un jugador que toca algo protegido hace que el portón pida la clave", async () => {
    setAdminKey({ enabled: true, length: 11 });
    setAccessRole("player");
    const first = requestAdmin();
    const second = requestAdmin();
    expect(isAskingForKey()).toBe(true);
    settleGateRequest(true);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(getAccessRole()).toBe("admin");
    expect(isAskingForKey()).toBe(false);
  });

  it("entrar sin clave deja al jugador como jugador y responde que no", async () => {
    setAdminKey({ enabled: true, length: 11 });
    setAccessRole("player");
    const answer = requestAdmin();
    settleGateRequest(false);
    await expect(answer).resolves.toBe(false);
    expect(getAccessRole()).toBe("player");
  });

  it("tras un rato solo, el administrador vuelve a ser jugador sin que se pida la clave", () => {
    setAdminKey({ enabled: true, length: 11 });
    relock();
    expect(getAccessRole()).toBe("player");
    expect(isAskingForKey()).toBe(false);
  });

  it("quitar la clave devuelve a todos a administrador", () => {
    setAdminKey({ enabled: true, length: 11 });
    setAccessRole("player");
    setAdminKey({ enabled: false, length: 0 });
    expect(getAccessRole()).toBe("admin");
  });

  it("si se apaga PLUS la clave queda sin efecto: todos son administradores y nada se pide", async () => {
    setAdminKey({ enabled: true, length: 11 });
    setAccessRole("player");
    setPlusLapsed(true);
    expect(getAccessRole()).toBe("admin");
    await expect(requestAdmin()).resolves.toBe(true);
    await expect(requireAdmin()).resolves.toBeUndefined();
    relock();
    expect(getAccessRole()).toBe("admin");
    expect(isAskingForKey()).toBe(false);
  });

  it("si PLUS se apaga con el portón esperando la clave, el portón se libera", async () => {
    setAdminKey({ enabled: true, length: 11 });
    setAccessRole("player");
    const waiting = requestAdmin();
    expect(isAskingForKey()).toBe(true);
    setPlusLapsed(true);
    await expect(waiting).resolves.toBe(true);
    expect(isAskingForKey()).toBe(false);
  });

  it("al volver PLUS la clave vuelve a regir sola, con la misma palabra", async () => {
    setAdminKey({ enabled: true, length: 11 });
    setAccessRole("player");
    setPlusLapsed(true);
    setPlusLapsed(false);
    expect(isPlusLapsed()).toBe(false);
    expect(getAccessRole()).toBe("player");
    const waiting = requestAdmin();
    expect(isAskingForKey()).toBe(true);
    settleGateRequest(false);
    await expect(waiting).resolves.toBe(false);
  });
});
