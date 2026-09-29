"""Generate the PWA / home-screen icons into icons/. Run: python scripts/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'icons'
OUT.mkdir(exist_ok=True)
FONT = 'C:/Windows/Fonts/arialbd.ttf'


def gradient(size):
    # violet -> fuchsia -> pink diagonal, matching the site's accent
    stops = [(0.0, (124, 58, 237)), (0.55, (192, 38, 211)), (1.0, (236, 72, 153))]
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
                if t <= t1:
                    k = (t - t0) / (t1 - t0)
                    px[x, y] = tuple(round(a + (b - a) * k) for a, b in zip(c0, c1))
                    break
    return img


def icon(size, maskable=False, rounded=True):
    bg = gradient(size)
    # page glyph
    d = ImageDraw.Draw(bg)
    s = size * (0.62 if maskable else 0.8)   # maskable keeps content inside the 80% safe zone
    ox, oy = (size - s) / 2, (size - s) / 2
    pw, ph = s * 0.62, s * 0.8
    px, py = ox + (s - pw) / 2, oy + (s - ph) / 2
    fold = pw * 0.28
    d.polygon([(px, py), (px + pw - fold, py), (px + pw, py + fold), (px + pw, py + ph), (px, py + ph)], fill=(255, 255, 255))
    d.polygon([(px + pw - fold, py), (px + pw, py + fold), (px + pw - fold, py + fold)], fill=(233, 213, 255))
    font = ImageFont.truetype(FONT, round(pw * 0.34))
    text = 'PDF'
    tw = d.textlength(text, font=font)
    d.text((px + (pw - tw) / 2, py + ph * 0.52), text, font=font, fill=(162, 28, 175))
    for i, w in enumerate((0.6, 0.45)):
        y = py + ph * (0.3 + i * 0.1)
        d.rounded_rectangle([px + pw * 0.18, y, px + pw * (0.18 + w), y + ph * 0.045], radius=ph * 0.02, fill=(221, 214, 254))
    if rounded and not maskable:
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=size * 0.22, fill=255)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.paste(bg, (0, 0), mask)
        return out
    return bg


icon(192).save(OUT / 'icon-192.png')
icon(512).save(OUT / 'icon-512.png')
icon(512, maskable=True).save(OUT / 'icon-maskable-512.png')
icon(180, rounded=False).save(OUT / 'apple-touch-icon.png')   # iOS rounds corners itself
print('icons written to', OUT)
