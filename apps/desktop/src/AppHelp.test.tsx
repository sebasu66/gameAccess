import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AppHelp, { supportEmail, supportMailto } from "./AppHelp";

describe("help", () => {
 it("builds a mailto with the subject encoded", () => {
  expect(supportMailto("a@b.com", "Ayuda con Game Access")).toBe("mailto:a@b.com?subject=Ayuda%20con%20Game%20Access");
 });
 it("has no address until one is configured", () => {
  expect(supportEmail()).toBe("");
 });
 it("shows a labelled help button that is closed at first", () => {
  const html = renderToStaticMarkup(<AppHelp />);
  expect(html).toContain("ga-help-fab");
  expect(html).toMatch(/aria-label="(Ayuda|Help)"/);
  expect(html).not.toContain('role="dialog"');
 });
});
