import {describe,it,expect} from "vitest";
import {consoleShortcut,redactConsoleLine} from "./ActivityConsole";
import {sanitizedRemoteError} from "./narrationLog";
describe("activity console",()=>{
 it("uses the physical Spanish/English key and leaves text editing alone",()=>{
  expect(consoleShortcut(({code:"Backquote",key:"º"} as KeyboardEvent))).toBe(true);
  expect(consoleShortcut(({code:"Digit1"} as KeyboardEvent))).toBe(false);
  const event={code:"Backquote",target:{closest:()=>({})}} as unknown as KeyboardEvent;
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
