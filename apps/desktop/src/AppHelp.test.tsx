import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AppHelp, { HelpContent, supportEmail } from "./AppHelp";

describe("help", () => {
 it("writes to the project's contact address unless one is configured", () => {
  expect(supportEmail()).toBe("game-access-contacto@proton.me");
 });
 it("shows a labelled help button that is closed at first", () => {
  const html = renderToStaticMarkup(<AppHelp />);
  expect(html).toContain("ga-help-fab");
  expect(html).toMatch(/aria-label="(Ayuda|Help)"/);
  expect(html).not.toContain('role="dialog"');
 });
 it("has the contact form, which does not take the focus when Home opens, and the address", () => {
  const html = renderToStaticMarkup(<HelpContent />);
  expect(html).toContain("ga-help-form");
  expect(html).toContain("data-no-autofocus");
  expect(html).toContain("<textarea");
  expect(html).toContain('type="email"');
  expect(html).toContain("game-access-contacto@proton.me");
 });
});
