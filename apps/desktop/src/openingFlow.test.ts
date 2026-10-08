import { describe, expect, it } from "vitest";
import { openingStage } from "./openingFlow";
describe("opening and activation order", () => {
 it("shows only the opening even if verification returns immediately", () => {
  expect(openingStage({ introReady:false, verificationReady:true, approved:true, docked:false })).toBe("intro");
  expect(openingStage({ introReady:false, verificationReady:true, approved:false, docked:false })).toBe("intro");
 });
 it("holds the large logo while the server is still checking", () => {
  expect(openingStage({ introReady:true, verificationReady:false, approved:false, docked:false })).toBe("holding");
 });
 it("never docks or reveals the application without approved access", () => {
  for (const docked of [false,true]) expect(openingStage({ introReady:true, verificationReady:true, approved:false, docked })).toBe("validation");
 });
 it("docks only after formation and approval, then enters the app", () => {
  expect(openingStage({ introReady:true, verificationReady:true, approved:true, docked:false })).toBe("docking");
  expect(openingStage({ introReady:true, verificationReady:true, approved:true, docked:true })).toBe("ready");
 });
 it("returns to validation when an already-open session expires", () => {
  expect(openingStage({ introReady:true, verificationReady:true, approved:false, docked:true })).toBe("validation");
 });
});
