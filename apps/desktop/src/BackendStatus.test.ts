import { describe, expect, it } from "vitest";
import { backendStatusPresentation } from "./BackendStatus";
describe("footer connection status", () => {
 it("never reports green before a successful server check", () => {
  expect(backendStatusPresentation(null,"es")).toEqual({ connected:false,label:"Desconectado" });
  expect(backendStatusPresentation("offline","en")).toEqual({ connected:false,label:"Disconnected" });
 });
 it("distinguishes a developer-local connection from an approved remote connection", () => {
  expect(backendStatusPresentation("local","es")).toEqual({ connected:true,label:"Local" });
  expect(backendStatusPresentation("remote","es")).toEqual({ connected:true,label:"Conectado" });
  expect(backendStatusPresentation("remote","en")).toEqual({ connected:true,label:"Connected" });
 });
});
