from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "apps" / "desktop" / "src"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise SystemExit(f"{label}: expected source not found")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, label: str) -> str:
    result, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, got {count}")
    return result


room_path = SRC / "LibraryRoom.tsx"
room = room_path.read_text(encoding="utf-8")
room = room.replace(
    '  useEffect(() => { setActionIndex(0); }, [selectedGameIdResolved, actions[0]?.kind]);\n',
    '',
)
room_path.write_text(room, encoding="utf-8")

panel_path = SRC / "LibraryDetailPanel.tsx"
panel = panel_path.read_text(encoding="utf-8")
panel = replace_once(
    panel,
    'import type { RefObject } from "react";',
    'import type { ReactNode, RefObject } from "react";',
    "ReactNode import",
)

safe_renderer = '''function renderSteamNodes(nodes: Node[], prefix = "steam"): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${prefix}-${index}`;
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof HTMLElement)) return null;
    const children = renderSteamNodes(Array.from(node.childNodes), key);
    switch (node.tagName) {
      case "BR": return <br key={key} />;
      case "P": return <p key={key}>{children}</p>;
      case "DIV": return <div key={key}>{children}</div>;
      case "UL": return <ul key={key}>{children}</ul>;
      case "OL": return <ol key={key}>{children}</ol>;
      case "LI": return <li key={key}>{children}</li>;
      case "STRONG":
      case "B": return <strong key={key}>{children}</strong>;
      case "EM":
      case "I": return <em key={key}>{children}</em>;
      case "H1": return <h1 key={key}>{children}</h1>;
      case "H2": return <h2 key={key}>{children}</h2>;
      case "H3": return <h3 key={key}>{children}</h3>;
      case "H4": return <h4 key={key}>{children}</h4>;
      case "A": {
        const href = node.getAttribute("href");
        return href?.startsWith("https://")
          ? <a key={key} href={href} target="_blank" rel="noreferrer">{children}</a>
          : <span key={key}>{children}</span>;
      }
      case "IMG": {
        const src = node.getAttribute("src");
        return src?.startsWith("https://")
          ? <img key={key} src={src} alt={node.getAttribute("alt") ?? ""} loading="lazy" />
          : null;
      }
      default: return <span key={key}>{children}</span>;
    }
  });
}

function SteamRichText({ html }: { html: string }) {
  if (typeof DOMParser === "undefined") return <div className="steam-rich-text">{plainText(html)}</div>;
  const document = new DOMParser().parseFromString(html, "text/html");
  return <div className="steam-rich-text">{renderSteamNodes(Array.from(document.body.childNodes))}</div>;
}
'''
panel = sub_once(
    panel,
    r'function sanitizeSteamRichHtml\(value\?: string \| null\) \{.*?\n\}\n\nfunction SteamRichText\(\{ html \}: \{ html: string \}\) \{.*?\n\}\n',
    safe_renderer,
    "safe Steam rich renderer",
)

panel = panel.replace(
    '  }, [game.id, videoSrc, images.join("|"), reducedMotion, displaySurface]);',
    '  }, [videoSrc, images, reducedMotion, displaySurface]);',
)
panel = panel.replace(
    '  }, [paused, reducedMotion, state.phase, state.imageIndex, state.images.length]);',
    '  }, [paused, reducedMotion, state.phase, state.images.length]);',
)
panel = panel.replace(
    '<div className="library-room-active-download" aria-label="Descarga activa">',
    '<div className="library-room-active-download" role="group" aria-label="Descarga activa">',
)
panel = panel.replace(
    '<div className="library-room-preferences" aria-label={`Preferencia para ${props.game.name}`}>',
    '<div className="library-room-preferences" role="group" aria-label={`Preferencia para ${props.game.name}`}>',
)
panel = panel.replace(
    '<div className="library-detail-extended" tabIndex={0} aria-label="Detalles extendidos del juego">',
    '<section className="library-detail-extended" aria-label="Detalles extendidos del juego">',
)
panel = panel.replace(
    '      </div> : null}\n    </aside>',
    '      </section> : null}\n    </aside>',
)
panel_path.write_text(panel, encoding="utf-8")
