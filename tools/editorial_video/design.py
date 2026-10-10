"""GameAccess broadcast cards: transparent artwork over the real game footage."""
from pathlib import Path
import textwrap

from PIL import Image, ImageDraw, ImageFont


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
        alpha = int(145 * max(0, 1 - pos / 190))
        alpha = max(alpha, int(220 * max(0, (pos - 720) / 360)))
        if alpha:
            draw.line((0, y, width, y), fill=(12, 15, 17, alpha))
    orange = (255, 106, 0, 255)
    muted = (203, 211, 217, 255)
    box((54, 42, 60, 91), orange)
    text(78, 42, "game", 32, bold=True)
    text(160, 42, "/access", 32, orange, True)
    text(79, 83, "GUÍA DE JUEGO  /  PC" if episode["locale"] == "es" else "GAME GUIDE  /  PC", 18, muted)
    label = ({"es": "DEMO · ESPAÑOL", "en": "DEMO · ENGLISH"}[episode["locale"]]
             if episode.get("demo") else episode["locale"].upper())
    box((1610, 48, 1860, 91), (17, 20, 22, 200), 8)
    text(1630, 54, label, 21, muted, True)
    eyebrow = section.get("eyebrow", "EN PANTALLA" if extended else f"{index:02} / {len(episode['sections']):02}")
    title = section.get("title", section.get("id", ""))
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
        tags = section.get("tags", [])
        x = 82
        for tag in tags:
            length = draw.textlength(tag, font=font(23, True)) / scale + 40
            box((x, 734, x + length, 779), (17, 20, 22, 225), 9)
            text(x + 20, 740, tag, 23, bold=True)
            x += length + 12
    image.save(output)
