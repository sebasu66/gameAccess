import {describe,expect,it} from "vitest";
import {downloadButtonLabel} from "./downloadSize";
import type {CatalogGame} from "./types";
describe("source download size button",()=>{
  it("uses the source package size in both languages",()=>{
    const game={download_size_bytes:6*1024**3} as CatalogGame;
    expect(downloadButtonLabel(game,"es")).toBe("Descargar (6 GB)");
    expect(downloadButtonLabel(game,"en")).toBe("Download (6 GB)");
  });
  it("never substitutes Steam installed size for a missing source size",()=>{
    expect(downloadButtonLabel({steam:{minimum_requirements:"100 GB"}} as unknown as CatalogGame,"es")).toBe("Descargar");
  });
});
