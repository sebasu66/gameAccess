import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DigitalDownloadsScreen, { formatDownloadBytes } from "./DigitalDownloadsScreen";
import { DigitalDownloadService } from "./catalog/DigitalDownloadService";
import type {CatalogGame} from "./types";
const language=vi.hoisted(()=>({locale:"es" as "es"|"en"}));
vi.mock("./i18n",async importOriginal=>{
  const actual=await importOriginal<typeof import("./i18n")>();
  return {...actual,useI18n:()=>({locale:language.locale,t:(key:Parameters<typeof actual.translate>[0],params?:import("./i18n").TranslationParams)=>actual.translate(key,params,language.locale)})};
});
vi.mock("./narrationLog", () => ({ narrate: vi.fn().mockResolvedValue(undefined) }));
describe("Digital download screen", () => {
  beforeEach(()=>{language.locale="es";});
  it("shows an actionable empty state", () => {
    const html = renderToStaticMarkup(<DigitalDownloadsScreen service={new DigitalDownloadService()} onClose={() => {}} />);
    expect(html).toContain("No hay descargas");
    expect(html).toContain("Explorar catálogo");
    expect(html).toContain("Cerrar descargas y volver a la pantalla principal");
    expect(html).not.toContain("NaN");
  });
  it("offers abort and retry for a failed download", () => {
    const service = new DigitalDownloadService();
    service.recordFailure({ id: 1912410, app_id: 1912410, name: "Minecraft Dungeons II" } as import("./types").CatalogGame, "Contraseña inválida");
    const html = renderToStaticMarkup(<DigitalDownloadsScreen service={service} onClose={() => {}} />);
    expect(html).toContain("Abortar descarga de Minecraft Dungeons II");
    expect(html).toContain(">Abortar</button>");
    expect(html).toContain("Reintentar");
    expect(html).toContain("Cerrar descargas y volver a la pantalla principal");
  });
  it.each(["es","en"] as const)("labels browser handoffs without offering PLAY (%s)",locale=>{
    language.locale=locale;
    const service=new DigitalDownloadService();
    const game={id:7,name:"Browser fixture"} as CatalogGame;
    vi.spyOn(service,"getDownloads").mockReturnValue([
      {game,snapshot:{gameId:7,phase:"external",progress:0,statusText:"Enlace abierto en el navegador; todavía no está instalado."}},
    ]);
    const html=renderToStaticMarkup(<DigitalDownloadsScreen service={service} onClose={()=>{}}/>);
    expect(html).not.toContain('class="ga-download-play"');
    expect(html).toContain(locale==="es"?"Abrir enlace":"Open link");
    expect(html).toContain("todavía no está instalado");
  });
  it("retains the selected package size after a metadata-only catalog refresh", () => {
    const service = new DigitalDownloadService();
    const game = {id:42, app_id:42, name:"Fixture", download_size:"6 GB"} as CatalogGame;
    vi.spyOn(service,"getDownloads").mockReturnValue([{game,snapshot:{gameId:42,phase:"queued",progress:0}}]);
    const metadata = {...game,download_size:null,download_size_bytes:null};
    const html = renderToStaticMarkup(<DigitalDownloadsScreen service={service} catalogGames={[metadata]} onClose={()=>{}} />);
    expect(html).toContain("6 GB");
  });
  it("formats missing and invalid metrics without invented values", () => {
    expect(formatDownloadBytes(undefined)).toBe("—");
    expect(formatDownloadBytes(NaN)).toBe("—");
    expect(formatDownloadBytes(1024)).toBe("1 KB");
    expect(formatDownloadBytes(-1)).toBe("0 B");
  });
  it.each(["es","en"] as const)("shows a translated PLAY action only for completed games (%s)",locale=>{
    language.locale=locale;
    const service=new DigitalDownloadService();
    const game={id:1,name:"Fixture",download_size_bytes:6*1024**3} as CatalogGame;
    vi.spyOn(service,"getDownloads").mockReturnValue([
      {game,snapshot:{gameId:1,phase:"completed",progress:100}},
      {game:{...game,id:2,name:"Pending"},snapshot:{gameId:2,phase:"queued",progress:0}},
    ]);
    const html=renderToStaticMarkup(<DigitalDownloadsScreen service={service} onClose={()=>{}}/>);
    expect(html.match(/class="ga-download-play"/g)).toHaveLength(1);
    expect(html).toContain(locale==="es"?">JUGAR</button>":">PLAY</button>");
    expect(html).toContain(locale==="es"?"Instalación completada":"Installation complete");
    expect(html).toContain(locale==="es"?"Tamaño de descarga":"Download size");
    expect(html).toContain("6 GB");
    expect(html).toContain(locale==="es"?"Pausar":"Pause");
  });
});

it.each(["es","en"] as const)("makes every download artwork a localized detail action (%s)", locale => {
  language.locale=locale;
  const service=new DigitalDownloadService();
  const game={id:1,app_id:1,name:"Fixture"} as CatalogGame;
  vi.spyOn(service,"getDownloads").mockReturnValue([
    {game,snapshot:{gameId:1,phase:"completed",progress:100}},
    {game:{...game,id:2,app_id:2,name:"Pending"},snapshot:{gameId:2,phase:"queued",progress:0}},
    {game:{...game,id:3,app_id:3,name:"Failed"},snapshot:{gameId:3,phase:"error",progress:0}},
  ]);
  const html=renderToStaticMarkup(<DigitalDownloadsScreen service={service} onClose={()=>{}} onOpenGame={()=>{}}/>);
  expect(html.match(/class="digital-download-art"/g)).toHaveLength(3);
  for(const name of ["Fixture","Pending","Failed"]) expect(html).toContain(`aria-label="${locale==="es"?"Ver ficha de":"View details for"} ${name}"`);
});
