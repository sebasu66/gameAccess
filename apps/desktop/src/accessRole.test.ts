import { beforeEach, describe, expect, it } from "vitest";
import { isAskingForKey, isPlusLapsed, requestParentKey, resetAccessRoleForTests, setAdminKey, setPlusLapsed, settleKeyRequest } from "./accessRole";

describe("parent's key", () => {
  beforeEach(() => resetAccessRoleForTests());

  it("asks for nothing without a key", async () => {
    await expect(requestParentKey()).resolves.toBe(true);
    expect(isAskingForKey()).toBe(false);
  });

  it("opens the dialog with a key, and the key lets every waiting request in", async () => {
    setAdminKey({ enabled: true, length: 5 });
    const first = requestParentKey();
    const second = requestParentKey();
    expect(isAskingForKey()).toBe(true);
    settleKeyRequest(true);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(isAskingForKey()).toBe(false);
  });

  it("closing the dialog without the key keeps parental control shut", async () => {
    setAdminKey({ enabled: true, length: 5 });
    const answer = requestParentKey();
    settleKeyRequest(false);
    await expect(answer).resolves.toBe(false);
  });

  it("with PLUS ended the key asks for nothing, and a waiting dialog lets the parent in", async () => {
    setAdminKey({ enabled: true, length: 5 });
    const waiting = requestParentKey();
    expect(isAskingForKey()).toBe(true);
    setPlusLapsed(true);
    await expect(waiting).resolves.toBe(true);
    expect(isAskingForKey()).toBe(false);
    expect(isPlusLapsed()).toBe(true);
    await expect(requestParentKey()).resolves.toBe(true);
  });
});
