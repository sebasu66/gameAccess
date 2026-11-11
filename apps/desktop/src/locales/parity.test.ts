import { describe, expect, it } from "vitest";
import { en } from "./en";
import { es } from "./es";

// Valores que pueden ser iguales en ambos idiomas (marcas, nombres propios, símbolos).
const SAME_VALUE_ALLOWED = new Set<string>(["activityCategory_app", "genre_indie", "genre_casual", "genre_rpg", "genre_arcade", "genre_point_and_click", "genre_hack_and_slash", "genre_roguelike", "genre_sandbox", "genre_moba", "genre_metroidvania", "aiProfileMode_pvp", "aiProfileMode_mmo", "infoAppId", "pluginsTab", "uiZoom", "chipPvp", "chipMmo", "chipLan", "chipOnline", "filterTagRating", "pluginIndicatorTip", "languageNameEs", "languageNameEn", "steamTitle", "bigScreenEnter", "lmKindDirect", "lmKindSteam", "sentenceModeOnline", "freezeSpeed", "freezeEvFile", "freezeEvFileStored", "freezeEvFailed", "downloadsPlanLabel", "kidDurationHM", "kidDurationH", "kidDurationM", "kidAddMinutes", "kidLimitGeneral", "kidNo", "bigKeyEnter", "bigKeySearch", "bigKeyEsc"]);
for (const key of ["navModeGameAccess", "navAlphabetical", "navManager", "navGeneral", "navSteam", "navPlugins"]) SAME_VALUE_ALLOWED.add(key);

const esKeys = Object.keys(es);
const enKeys = Object.keys(en);

describe("paridad de idiomas", () => {
  it("todas las claves de es existen en en", () => {
    expect(esKeys.filter(key => !(key in en))).toEqual([]);
  });

  it("todas las claves de en existen en es", () => {
    expect(enKeys.filter(key => !(key in es))).toEqual([]);
  });

  it("los parametros {{x}} del ingles existen en el espanol", () => {
    const params = (value: string) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
    const bad = esKeys.filter(key => key in en && !params((en as Record<string, string>)[key]).every(p => params((es as Record<string, string>)[key]).includes(p)));
    expect(bad).toEqual([]);
  });

  it("ningun valor en ingles es igual al espanol (salvo excepciones)", () => {
    const same = esKeys.filter(
      key => key in en && (es as Record<string, string>)[key] === (en as Record<string, string>)[key] && !SAME_VALUE_ALLOWED.has(key),
    );
    expect(same).toEqual([]);
  });
});
