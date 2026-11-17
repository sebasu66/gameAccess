import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DownloadActions from "./DownloadActions";

describe("download actions", () => {
  it("draws the main action first in the primary style, then the others, the folder last", () => {
    const run = () => undefined;
    const html = renderToStaticMarkup(<DownloadActions main={{ id: "pause", label: "Pausar", icon: null, run }}
      others={[{ id: "cancel", label: "Cancelar", icon: null, run }]} folder={{ id: "folder", label: "Abrir carpeta", icon: null, run }} />);
    const buttons = [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*><span>([^<]*)<\/span><\/button>/g)].map(match => [match[2], match[1]]);
    expect(buttons).toEqual([["Pausar", "ga-btn-primary"], ["Cancelar", "ga-btn-secondary"], ["Abrir carpeta", "ga-btn-secondary ga-wz-minor"]]);
  });
});
