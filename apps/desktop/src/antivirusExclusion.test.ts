// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { antivirusDismissed, antivirusState, coveredBy, dismissAntivirus, excludedByHand, markExcludedByHand, type AntivirusProbe } from "./antivirusExclusion";

// What antivirus_probe's PowerShell prints, as JSON, on the PCs this has to handle.
const ps = (text: string) => JSON.parse(text) as AntivirusProbe;
const DEFENDER_HIDDEN = ps('{"products":[{"name":"Windows Defender","state":397568}],"exclusions":null,"policyExclusions":[],"localMergeDisabled":false,"recorded":[],"defenderMode":"Normal"}');
const DEFENDER_SHOWN = ps('{"products":[{"name":"Windows Defender","state":397568}],"exclusions":["C:\\\\GA_Juegos","D:\\\\Otros"],"policyExclusions":[],"localMergeDisabled":false,"recorded":[],"defenderMode":"Normal"}');
const RECORDED = ps('{"products":[{"name":"Windows Defender","state":397568}],"exclusions":null,"policyExclusions":[],"localMergeDisabled":false,"recorded":["C:\\\\GA_Juegos","C:\\\\Users\\\\ana\\\\Downloads\\\\GameAccessDownloads"],"defenderMode":"Normal"}');
// Avast on, Defender in passive mode (Security Center lists both; Defender's state has no 0x1000 bit).
const OTHER = ps('{"products":[{"name":"Windows Defender","state":393472},{"name":"Avast Antivirus","state":266240}],"exclusions":null,"policyExclusions":[],"localMergeDisabled":false,"recorded":[],"defenderMode":"Passive Mode"}');
const MANAGED = ps('{"products":[{"name":"Windows Defender","state":397568}],"exclusions":null,"policyExclusions":["C:\\\\GA_Juegos"],"localMergeDisabled":true,"recorded":["C:\\\\Users\\\\ana\\\\Downloads\\\\GameAccessDownloads"],"defenderMode":"Normal"}');
const DEFENDER_OFF = ps('{"products":[{"name":"Windows Defender","state":393472}],"exclusions":null,"policyExclusions":[],"localMergeDisabled":false,"recorded":[],"defenderMode":""}');

const GAMES = "C:\\GA_Juegos";
const DOWNLOADS = "C:\\Users\\ana\\Downloads\\GameAccessDownloads";

describe("antivirus exclusions", () => {
  beforeEach(() => localStorage.clear());

  it("a folder is covered by itself or a folder above it, whatever the case, slashes or trailing \\*", () => {
    expect(coveredBy("C:\\GA_Juegos", ["c:/ga_juegos/"])).toBe(true);
    expect(coveredBy("C:\\GA_Juegos\\Portal 2", ["C:\\GA_Juegos"])).toBe(true);
    expect(coveredBy("C:\\GA_Juegos", ["C:\\"])).toBe(true);
    expect(coveredBy("C:\\GA_Juegos", ["C:\\GA_Juegos\\*"])).toBe(true);
    expect(coveredBy("C:\\GA_Juegos2", ["C:\\GA_Juegos"])).toBe(false);
    expect(coveredBy("C:\\GA_Juegos", ["C:\\GA_Juegos\\Portal 2"])).toBe(false);
    expect(coveredBy("C:\\GA_Juegos", ["C:\\*.exe"])).toBe(false);
  });

  it("without administrator rights the exclusions are unknown, so both folders are offered", () => {
    expect(antivirusState(DEFENDER_HIDDEN, [GAMES, DOWNLOADS])).toEqual({ kind: "missing", missing: [GAMES, DOWNLOADS], known: false });
  });

  it("exclusions Windows shows count, and only what is not covered is offered", () => {
    expect(antivirusState(DEFENDER_SHOWN, [GAMES, DOWNLOADS])).toEqual({ kind: "missing", missing: [DOWNLOADS], known: true });
    expect(antivirusState(DEFENDER_SHOWN, [GAMES])).toEqual({ kind: "covered" });
  });

  it("the record the installer or the button left in the registry counts as excluded", () => {
    expect(antivirusState(RECORDED, [GAMES, DOWNLOADS])).toEqual({ kind: "covered" });
    // A new games folder is not in the record.
    expect(antivirusState(RECORDED, ["D:\\Juegos", DOWNLOADS])).toEqual({ kind: "missing", missing: ["D:\\Juegos"], known: false });
  });

  it("another antivirus on: set by hand in that antivirus, until the person says they did it", () => {
    expect(antivirusState(OTHER, [GAMES, DOWNLOADS])).toEqual({ kind: "other", product: "Avast Antivirus", missing: [GAMES, DOWNLOADS] });
    expect(antivirusState(OTHER, [GAMES, DOWNLOADS], [GAMES, DOWNLOADS])).toEqual({ kind: "covered" });
  });

  it("an organization that ignores local exclusions: only its policy (or the person) counts", () => {
    expect(antivirusState(MANAGED, [GAMES, DOWNLOADS])).toEqual({ kind: "managed", missing: [DOWNLOADS] });
  });

  it("Defender off and no other antivirus: nothing to ask", () => {
    expect(antivirusState(DEFENDER_OFF, [GAMES, DOWNLOADS])).toEqual({ kind: "covered" });
  });

  it("\"No, thanks\" is kept for these folders only, and \"I did it\" counts as excluded", () => {
    dismissAntivirus([GAMES, DOWNLOADS]);
    expect(antivirusDismissed([DOWNLOADS.toUpperCase(), GAMES])).toBe(true);
    expect(antivirusDismissed(["D:\\Juegos", DOWNLOADS])).toBe(false);
    markExcludedByHand([GAMES]);
    expect(antivirusState(DEFENDER_HIDDEN, [GAMES, DOWNLOADS], excludedByHand())).toEqual({ kind: "missing", missing: [DOWNLOADS], known: false });
  });
});
