import {describe,it,expect} from "vitest";
import {consoleShortcut,redactConsoleLine} from "./ActivityConsole";
import {sanitizedRemoteError} from "./narrationLog";
describe("activity console",()=>{
 it("uses the physical Spanish/English key and leaves text editing alone",()=>{
  expect(consoleShortcut(new KeyboardEvent("keydown",{code:"Backquote",key:"º"}))).toBe(true);
  expect(consoleShortcut(new KeyboardEvent("keydown",{code:"Digit1"}))).toBe(false);
  const event=new KeyboardEvent("keydown",{code:"Backquote"});
  Object.defineProperty(event,"target",{value:document.createElement("input")});
  expect(consoleShortcut(event)).toBe(false);
 });
 it("never exposes passwords, auth tokens or database connections",()=>{
  const raw="password=private authorization=secret postgres://user:pass@host/db https://files.invalid/a?token=secret";
  const safe=redactConsoleLine(raw);
  expect(safe).not.toContain("private");expect(safe).not.toContain("pass@");expect(safe).not.toContain("secret");
 });
 it("does not send provider URLs in central error reports",()=>{
  const safe=sanitizedRemoteError("Download https://provider.invalid/file?a=b magnet:?xt=urn:btih:123 failed");
  expect(safe).not.toContain("provider.invalid");expect(safe).not.toContain("urn:btih");
 });
});
