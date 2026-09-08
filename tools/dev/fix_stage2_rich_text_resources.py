from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PARTS = ROOT / "apps" / "desktop" / "src" / "LibraryRoomParts.tsx"

text = PARTS.read_text(encoding="utf-8")

old = '''    for (const attribute of Array.from(node.attributes)) node.removeAttribute(attribute.name);\n    if (node.tagName === "A") {\n      const original = value.match(/https?:\\/\\/[^\\s"'<>]+/i)?.[0];\n      if (original) {\n        node.setAttribute("href", original);\n        node.setAttribute("target", "_blank");\n        node.setAttribute("rel", "noreferrer");\n      }\n    }'''
new = '''    const href = node.getAttribute("href");\n    const src = node.getAttribute("src");\n    const alt = node.getAttribute("alt");\n    for (const attribute of Array.from(node.attributes)) node.removeAttribute(attribute.name);\n    if (node.tagName === "A" && href && /^https?:\\/\\//i.test(href)) {\n      node.setAttribute("href", href);\n      node.setAttribute("target", "_blank");\n      node.setAttribute("rel", "noreferrer");\n    }\n    if (node.tagName === "IMG" && src && /^https?:\\/\\//i.test(src)) {\n      node.setAttribute("src", src);\n      if (alt) node.setAttribute("alt", alt);\n      node.setAttribute("loading", "lazy");\n    }'''

if new not in text:
    if old not in text:
        raise SystemExit("Steam rich text sanitizer anchor not found")
    text = text.replace(old, new, 1)

text = text.replace(
    'src={shot.thumbnail ?? shot.full}',
    'src={shot.full ?? shot.thumbnail}',
)

PARTS.write_text(text, encoding="utf-8")
