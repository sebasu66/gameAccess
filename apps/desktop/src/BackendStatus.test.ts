import { describe, expect, it } from "vitest";
import { backendStatusPresentation, STATUS_CHECK_MS } from "./BackendStatus";
describe("footer connection status", () => {
 it("never reports green before a successful server check", () => {
  expect(backendStatusPresentation(null,"es")).toEqual({ connected:false,label:"Desconectado" });
  expect(backendStatusPresentation("offline","en")).toEqual({ connected:false,label:"Disconnected" });
 });
 it("distinguishes a developer-local connection from an approved remote connection", () => {
  expect(backendStatusPresentation("local","es")).toEqual({ connected:true,label:"Local" });
  expect(backendStatusPresentation("remote","es")).toEqual({ connected:true,label:"En línea" });
  expect(backendStatusPresentation("remote","en")).toEqual({ connected:true,label:"Online" });
 });
 it("asks the server once a minute, not every few seconds (it must not grow traffic with each open client)", () => {
  expect(STATUS_CHECK_MS).toBe(60_000);
 });
});
