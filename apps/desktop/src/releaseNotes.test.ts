import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { notesFor } from "./releaseNotes";

const data = { versions: [
  { version: "0.1.9", changes: { es: ["nueve"], en: ["nine"] } },
  { version: "0.1.10", date: "2026-11-04", changes: { es: ["diez"], en: ["ten"] } },
] };

describe("release notes on Home", () => {
  it("shows the installed version's own notes in the app's language", () => {
    expect(notesFor(data, "0.1.10", "es")).toEqual({ version: "0.1.10", date: "2026-11-04", changes: ["diez"] });
    expect(notesFor(data, "0.1.9", "en")?.changes).toEqual(["nine"]);
  });

  it("a build between releases shows the last release's notes, never a newer one", () => {
    expect(notesFor(data, "0.1.9.5", "es")?.version).toBe("0.1.9");
    expect(notesFor(data, "0.1.8", "es")).toBeNull();
  });

  it("outside the app shows the newest notes", () => {
    expect(notesFor(data, "0.0.0", "es")?.version).toBe("0.1.10");
  });

  it("the shipped changelog has notes for the app's version in both languages", () => {
    const shipped = JSON.parse(readFileSync(new URL("../public/changelog.json", import.meta.url), "utf8"));
    for (const locale of ["es", "en"]) {
      expect(notesFor(shipped, packageJson.version, locale)?.version).toBe(packageJson.version);
    }
  });
});
