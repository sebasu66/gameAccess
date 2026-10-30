// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ParentModeButton from "./ParentModeButton";
import { getAccessRole, isAskingForKey, resetAccessRoleForTests, setAccessRole, setAdminKey, settleGateRequest } from "./accessRole";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let host: HTMLDivElement;
const button = () => host.querySelector<HTMLButtonElement>(".ga-parent-mode");

beforeEach(() => { resetAccessRoleForTests(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("botón de modo padre", () => {
  it("sin clave de padre no está", async () => {
    await act(async () => { root.render(<ParentModeButton />); });
    expect(button()).toBeNull();
  });

  it("como jugador pide la clave una vez, y en modo padre vuelve al modo jugador sin pedir nada", async () => {
    setAdminKey({ enabled: true, length: 5 });
    setAccessRole("player");
    await act(async () => { root.render(<ParentModeButton />); });
    await act(async () => { button()!.click(); });
    expect(isAskingForKey()).toBe(true);
    await act(async () => { settleGateRequest(true); });
    expect(getAccessRole()).toBe("admin");
    await act(async () => { button()!.click(); });
    expect(getAccessRole()).toBe("player");
    expect(isAskingForKey()).toBe(false);
  });
});
