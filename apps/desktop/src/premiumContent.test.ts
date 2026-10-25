import { describe, expect, it } from "vitest";
import { DEFAULT_PREMIUM_CONTENT, isAllowedLink, methodsFor, parsePremiumContent } from "./premiumContent";
import { PLUS_URL } from "./projectConfig";

const text = (value: string) => ({ es: value, en: value });
const valid = () => ({
  version: 1,
  title: text("Premium"),
  intro: text("Intro"),
  plans: [{ id: "boost", name: text("Boost"), price: text("2 USD"), perks: { es: ["a"], en: ["a"] } }],
  regions: {
    default: { label: text("Other"), methods: [{ label: text("Web"), url: "https://gameaccess.site/plus" }] },
    AR: { label: text("AR"), methods: [{ label: text("Pesos"), url: "https://www.patreon.com/x" }] },
  },
  region: "AR",
});

describe("premium content", () => {
  it("accepts the expected shape and keeps the server's region", () => {
    const content = parsePremiumContent(valid());
    expect(content?.region).toBe("AR");
    expect(methodsFor(content!, "AR")[0].url).toContain("patreon");
  });

  it("falls back to the default region when the guessed one is unknown", () => {
    const content = parsePremiumContent({ ...valid(), region: "ZZ" })!;
    expect(content.region).toBe("default");
    expect(methodsFor(content, "FR")).toEqual(content.regions.default.methods);
  });

  it("rejects content without a default region or with a wrong version", () => {
    const noDefault = valid() as any;
    delete noDefault.regions.default;
    expect(parsePremiumContent(noDefault)).toBeNull();
    expect(parsePremiumContent({ ...valid(), version: 2 })).toBeNull();
    expect(parsePremiumContent("<script>")).toBeNull();
  });

  it("drops links that are not https or not on the allow-list", () => {
    const data = valid() as any;
    data.regions.AR.methods = [
      { label: text("Bad"), url: "http://www.patreon.com/x" },
      { label: text("Evil"), url: "https://evil.example/pay" },
      { label: text("Script"), url: "javascript:alert(1)" },
      { label: text("Creds"), url: "https://user:pw@www.patreon.com/x" },
      { label: text("Good"), url: "https://mpago.la/abc" },
    ];
    const content = parsePremiumContent(data)!;
    expect(content.regions.AR.methods.map(method => method.url)).toEqual(["https://mpago.la/abc"]);
  });

  it("the built-in fallback is itself valid", () => {
    expect(parsePremiumContent(DEFAULT_PREMIUM_CONTENT)).not.toBeNull();
    expect(isAllowedLink(PLUS_URL)).toBe(true);
  });
});
