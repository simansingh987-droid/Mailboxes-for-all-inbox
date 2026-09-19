"""Generates the AskCruz brand icon set in public/ from public/logo.webp.

The mark is navy, so it sits on a light silver tile (same look as the in-app logo badge).
Run: python scripts/make-icons.py   (requires Pillow)
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / 'public'
MARK = Image.open(PUBLIC / 'logo.webp').convert('RGBA')
MARK = MARK.crop(MARK.getbbox())

TOP, BOTTOM = (255, 255, 255), (199, 204, 212)  # white -> silver-300


def gradient(size):
    g = Image.new('RGBA', (size, size))
    d = ImageDraw.Draw(g)
    for y in range(size):
        t = y / max(1, size - 1)
        d.line([(0, y), (size, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)) + (255,))
    return g


def tile(size, *, radius=0.22, mark_scale=0.72, rounded=True):
    """Brand tile: silver gradient square (optionally rounded) with the mark centred."""
    s = size * 4  # supersample for smooth edges
    base = gradient(s)
    if rounded:
        mask = Image.new('L', (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius), fill=255)
        base.putalpha(mask)
    w = int(s * mark_scale)
    h = int(MARK.height * w / MARK.width)
    mark = MARK.resize((w, h), Image.LANCZOS)
    base.alpha_composite(mark, ((s - w) // 2, (s - h) // 2))
    return base.resize((size, size), Image.LANCZOS)


tile(512).save(PUBLIC / 'icon-512.png')
tile(192).save(PUBLIC / 'icon-192.png')
tile(64).save(PUBLIC / 'favicon.png')
tile(32).save(PUBLIC / 'favicon-32.png')
tile(128).save(PUBLIC / 'mcp-icon.png')
# Full-bleed variants: iOS and Android masks apply their own rounding.
tile(180, rounded=False, mark_scale=0.66).save(PUBLIC / 'apple-touch-icon.png')
tile(512, rounded=False, mark_scale=0.56).save(PUBLIC / 'icon-maskable-512.png')
tile(256).save(PUBLIC / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
(PUBLIC / 'logo-square.png').unlink(missing_ok=True)
print('icons written to', PUBLIC)
