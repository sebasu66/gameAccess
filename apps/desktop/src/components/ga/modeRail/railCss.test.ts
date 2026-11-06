// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { validateRailCss } from "./railCss";

describe("validateRailCss", () => {
  it("accepts the rail's own selectors, variables, @media and @keyframes", () => {
    expect(validateRailCss(`
      /* comment { not a rule } */
      :host { --rail: #6fcfb0; }
      :host([data-fmt="caps"]) .body { filter: none; }
      .word { letter-spacing: .04em !important; }
      .char:nth-child(2n) { opacity: .8 }
      .bg { background-image: url("data:image/png;base64,AAAA"); }
      @media (max-height: 800px) { .stage { top: 40px; } }
      @keyframes pulse { from { opacity: 1 } 50%, to { opacity: .4 } }
    `)).toEqual([]);
  });

  it("accepts nothing at all", () => {
    expect(validateRailCss("")).toEqual([]);
    expect(validateRailCss("   /* only a note */  ")).toEqual([]);
  });

  it("finds a missing closing brace and says on which line", () => {
    const problems = validateRailCss(".word { color: red;\n.rail { --rail: #000; }");
    expect(problems[0]).toMatchObject({ line: 1, reason: "unclosed" });
  });

  it("finds an extra closing brace", () => {
    expect(validateRailCss(".word { color: red; }\n}")).toEqual([{ line: 2, text: "}", reason: "extra" }]);
  });

  it("finds a declaration without a colon", () => {
    expect(validateRailCss(".word {\n  colr red;\n}")).toEqual([{ line: 2, text: "colr red", reason: "declaration" }]);
  });

  it("finds a property with no value", () => {
    expect(validateRailCss(".word { color: ; }")).toEqual([{ line: 1, text: "color:", reason: "empty" }]);
  });

  it("finds a selector that cannot be read", () => {
    expect(validateRailCss(".word[ { color: red; }")[0]).toMatchObject({ line: 1, reason: "selector" });
  });

  it("finds text outside any block and @ rules that are not allowed", () => {
    expect(validateRailCss("color: red;")).toEqual([{ line: 1, text: "color: red;", reason: "outside" }]);
    expect(validateRailCss('@import url("x.css");')).toEqual([{ line: 1, text: '@import url("x.css");', reason: "outside" }]);
    expect(validateRailCss("@page { margin: 0 }")[0]).toMatchObject({ reason: "at-rule" });
  });

  it("finds a block nested inside a rule", () => {
    expect(validateRailCss(".rail { .word { color: red } }")[0]).toMatchObject({ reason: "nested" });
  });
});
