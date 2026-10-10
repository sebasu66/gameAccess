"""GameAccess broadcast cards: transparent artwork over the real game footage."""
from pathlib import Path
import textwrap

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]


def brand_text(output, height=1080, center=False):
    """Use the application's Audiowide GameAccess lockup, with its metallic fills."""
    scale = height / 1080
    image = Image.new("RGBA", (height * 16 // 9, height))
    size = 76 if center else 32
    font = ImageFont.truetype(str(ROOT / "apps/desktop/public/fonts/Audiowide-Regular.ttf"), round(size * scale))
    widths = [font.getlength(word) for word in ("Game", "Access")]
    x = (image.width - sum(widths)) / 2 if center else round(108 * scale)
    y = round((838 if center else 31) * scale)
    palettes = [((255, 255, 255), (145, 155, 171), (240, 242, 245)),
                ((255, 187, 88), (212, 88, 6), (255, 159, 59))]
    for word, width, colors in zip(("Game", "Access"), widths, palettes):
        ImageDraw.Draw(image).text((x + 2 * scale, y + 3 * scale), word, font=font,
                                  fill=(0, 0, 0, 210), stroke_width=max(1, round(scale)),
                                  stroke_fill=(0, 0, 0, 170))
        mask = Image.new("L", image.size)
        ImageDraw.Draw(mask).text((x, y), word, font=font, fill=255, stroke_width=0)
        paint = Image.new("RGBA", image.size)
        draw = ImageDraw.Draw(paint)
        for row in range(y, min(image.height, y + round(size * 1.5 * scale))):
            t = min(1, max(0, (row - y - .2 * size * scale) / (size * scale)))
            a, b, q = (colors[0], colors[1], t * 2) if t < .5 else (colors[1], colors[2], (t - .5) * 2)
            color = tuple(round(u + (v - u) * q) for u, v in zip(a, b))
            draw.line((0, row, image.width, row), fill=color + (255,))
        image.alpha_composite(Image.composite(paint, Image.new("RGBA", image.size), mask))
        x += width
    image.save(output)


def card(episode, section, index, output, height=1080, extended=False):
    scale = height / 1080
    width = height * 16 // 9
    image = Image.new("RGBA", (width, height))
    draw = ImageDraw.Draw(image)

    def box(bounds, fill, radius=0):
        coords = tuple(round(n * scale) for n in bounds)
        if radius:
            draw.rounded_rectangle(coords, round(radius * scale), fill=fill)
        else:
            draw.rectangle(coords, fill=fill)

    def font(size, bold=False):
        name = "segoeuib.ttf" if bold else "segoeui.ttf"
        windows = Path("C:/Windows/Fonts") / name
        return ImageFont.truetype(str(windows) if windows.exists() else "DejaVuSans.ttf", round(size * scale))

    def text(x, y, value, size=28, color=(255, 255, 255, 255), bold=False):
        draw.text((round(x * scale), round(y * scale)), value, font=font(size, bold), fill=color,
                  spacing=round(6 * scale))

    # Soft gradients leave the racing action readable instead of covering the image.
    for y in range(height):
        pos = y / scale
        alpha = int(220 * max(0, 1 - pos / 210))
        alpha = max(alpha, int(220 * max(0, (pos - 720) / 360)))
        if alpha:
            draw.line((0, y, width, y), fill=(12, 15, 17, alpha))
    orange = (255, 106, 0, 255)
    muted = (203, 211, 217, 255)
    text(110, 79, "GUÍA DE JUEGO  /  PC" if episode["locale"] == "es" else "GAME GUIDE  /  PC", 18, muted)
    label = ({"es": "DEMO · ESPAÑOL", "en": "DEMO · ENGLISH"}[episode["locale"]]
             if episode.get("demo") else episode["locale"].upper())
    box((1610, 48, 1860, 91), (17, 20, 22, 200), 8)
    text(1630, 54, label, 21, muted, True)
    eyebrow = section.get("eyebrow", "EN PANTALLA" if extended else f"{index:02} / {len(episode['sections']):02}")
    title = section.get("title", section.get("id", ""))
    if section.get("layout") == "closing":
        box((315, 340, 1605, 737), (17, 20, 22, 223), 22)
        text(380, 380, "TU OPINIÓN CUENTA", 24, orange, True)
        text(380, 430, "\n".join(textwrap.wrap(title, 35)), 57, bold=True)
        text(380, 585, section.get("summary", ""), 31, muted)
        box((380, 652, 1030, 703), orange, 9)
        text(403, 657, "SUSCRIBITE · MÁS JUEGOS Y LANZAMIENTOS", 24, bold=True)
        image.save(output)
        return
    if extended:
        box((54, 949, 60, 1022), orange)
        text(79, 949, title, 30, bold=True)
        text(79, 991, eyebrow, 20, muted)
    else:
        box((54, 798, 60, 1005), orange)
        text(82, 795, eyebrow.upper(), 21, orange, True)
        text(82, 834, "\n".join(line for paragraph in title.splitlines()
                                for line in textwrap.wrap(paragraph, 43)), 54, bold=True)
        text(85, 970, section.get("summary", ""), 27, muted)
        if section.get("stat"):
            box((54, 280, 490, 656), (17, 20, 22, 224), 16)
            text(84, 303, section.get("stat_label", "STEAM"), 23, muted, True)
            text(78, 341, section["stat"], 112, orange, True)
            text(84, 489, section.get("stat_detail", ""), 31, bold=True)
            text(84, 545, "\n".join(textwrap.wrap(section.get("stat_note", ""), 30)), 22, muted)
        if section.get("table"):
            rows = section["table"]
            box((54, 228, 1120, 285 + len(rows) * 59), (17, 20, 22, 235), 16)
            text(82, 245, section.get("table_heading", "FICHA DE JUEGO · PC"), 22, orange, True)
            for row, (key, value) in enumerate(rows):
                y = 291 + row * 59
                if row % 2 == 0:
                    box((69, y - 3, 1104, y + 48), (35, 40, 44, 240), 6)
                text(85, y, key, 25, muted)
                text(479, y, value, 25, bold=True)
        if section.get("scores"):
            for row, score in enumerate(section["scores"]):
                y = 283 + row * 182
                box((54, y, 670, y + 160), (17, 20, 22, 230), 16)
                text(83, y + 18, score["label"], 25, muted)
                text(80, y + 53, score["value"], 66, orange, True)
        tags = section.get("tags", [])
        x = 82
        for tag in tags:
            length = draw.textlength(tag, font=font(23, True)) / scale + 40
            box((x, 734, x + length, 779), (17, 20, 22, 225), 9)
            text(x + 20, 740, tag, 23, bold=True)
            x += length + 12
    image.save(output)
