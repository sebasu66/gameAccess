import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DigitalGameContextMenu from "./DigitalGameContextMenu";
import type { CatalogGame } from "./types";
import type { ManagedDownloadStatus } from "./downloadTypes";

describe("DigitalGameContextMenu", () => {
  const testGame: CatalogGame = {
    id: 100,
    slug: "test-game",
    name: "Test Game",
    app_id: 100,
    credit_cost_per_hour: 0,
    copies_total: 1,
    copies_available: 1,
    availability_state: "ready",
  };

  it("renders menu options matching the standard format", () => {
    const html = renderToStaticMarkup(
      <DigitalGameContextMenu
        request={{
          game: testGame,
          x: 100,
          y: 100,
          status: {
            app_id: 100,
            state: "installed",
            progress: 100,
            bytes_downloaded: null,
            bytes_total: null,
            installed: true,
          },
        }}
        onClose={() => {}}
      />
    );

    expect(html).toContain('role="menu"');
    expect(html).toContain("Instalar");
    expect(html).toContain("Jugar");
    expect(html).toContain("Abrir carpeta de instalación");
    expect(html).toContain("Desinstalar");
  });

  const installButton = (game: CatalogGame) => {
    const html = renderToStaticMarkup(<DigitalGameContextMenu request={{ game, x: 0, y: 0, status: {
      app_id: 100, state: "not-installed", progress: 0, bytes_downloaded: 0, bytes_total: null, installed: false,
    } as ManagedDownloadStatus }} onClose={() => {}} />);
    return html.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find(button => button.includes("Instalar")) ?? "";
  };

  it("keeps Instalar off when the game has no download source, like the Download button", () => {
    expect(installButton(testGame)).toContain('disabled=""');
    expect(installButton({ ...testGame, availableSourceCount: 0 })).toContain('disabled=""');
  });

  it("enables Instalar once a download source exists", () => {
    expect(installButton({ ...testGame, availableSourceCount: 2 })).not.toContain('disabled=""');
  });

  it.each(["not-installed","error","downloading","decompressing","paused","cancelling"] as const)(
    "keeps Desinstalar off when there is nothing installed or a transfer is active (%s)", state => {
      const html=renderToStaticMarkup(<DigitalGameContextMenu request={{game:testGame,x:0,y:0,status:{
        app_id:100,state,progress:0,bytes_downloaded:0,bytes_total:null,installed:false,
      } as ManagedDownloadStatus}} onClose={()=>{}} />);
      const uninstall=html.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find(button=>button.includes("Desinstalar"));
      expect(uninstall).toBeDefined();
      expect(uninstall).toContain('disabled=""');
    }
  );

  const uninstallButton = (state: string, installed = false, appId: number | undefined = 100) => {
    const html = renderToStaticMarkup(<DigitalGameContextMenu request={{ game: { ...testGame, app_id: appId, id: appId as number }, x: 0, y: 0, status: {
      app_id: appId, state, progress: 0, bytes_downloaded: 0, bytes_total: null, installed,
    } as ManagedDownloadStatus }} onClose={() => {}} />);
    return html.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find(button => button.includes("Desinstalar"));
  };

  it.each([["installed", true], ["prepared", false]] as const)(
    "enables Desinstalar only when there are installed files (%s)", (state, installed) => {
      expect(uninstallButton(state, installed)).not.toContain('disabled=""');
    }
  );

  it.each(["not-installed", "error", "cancelled", "unknown"] as const)(
    "disables Desinstalar when nothing is installed (%s)", state => {
      expect(uninstallButton(state)).toContain('disabled=""');
    }
  );

  it("still lets a not-installed game be removed from the library", () => {
    const html = renderToStaticMarkup(<DigitalGameContextMenu request={{ game: testGame, x: 0, y: 0, status: { app_id: 100, state: "not-installed", progress: 0, bytes_downloaded: 0, bytes_total: null, installed: false } as ManagedDownloadStatus }} onClose={() => {}} />);
    const add = html.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find(button => button.includes("Añadir a biblioteca") || button.includes("Quitar de biblioteca"));
    expect(add).not.toContain('disabled=""');
  });

  it.each(["requested", "preparing", "downloading", "decompressing", "extracting", "installing", "paused", "cancelling"] as const)(
    "disables Desinstalar while the game is transferring (%s), including the piece-by-piece download", state => {
      expect(uninstallButton(state)).toContain('disabled=""');
    }
  );

  it.each([["installed", true, false], ["prepared", false, false], ["not-installed", false, true], ["downloading", false, true]] as const)(
    "Idioma y ejecución follows the installed state (%s)", (state, installed, disabled) => {
      const html = renderToStaticMarkup(<DigitalGameContextMenu request={{ game: testGame, x: 0, y: 0, status: { app_id: 100, state, progress: 0, bytes_downloaded: 0, bytes_total: null, installed } as ManagedDownloadStatus }} onClose={() => {}} />);
      const options = html.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find(button => button.includes("Idioma y ejecución"));
      expect(options?.includes('disabled=""')).toBe(disabled);
    }
  );
});
