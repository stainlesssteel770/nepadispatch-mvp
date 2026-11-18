#!/usr/bin/env python3
"""Generate Dispatch MVP PWA icons (navy rounded square, white pin + check).
Writes icons/icon-512.png, icons/icon-512-maskable.png (mark inside the
central 80% safe zone), icons/icon-192.png, icons/apple-touch-icon.png
(180), icons/favicon-32.png. Verifies dimensions on write."""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "icons")
os.makedirs(OUT, exist_ok=True)

NAVY = (22, 35, 63, 255)
WHITE = (255, 255, 255, 255)

def draw_mark(d, s):
    """White location pin with a navy check, centred. s = canvas size."""
    # Pin: circle + triangle, all white; check cut in navy on top.
    cx, cy = s / 2, s * 0.47
    r = s * 0.20
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    d.polygon([(cx - r * 0.62, cy + r * 0.72), (cx + r * 0.62, cy + r * 0.72),
               (cx, cy + r * 1.95)], fill=WHITE)
    # Navy check inside the circle.
    w = max(6, int(s * 0.055))
    pts = [(cx - r * 0.52, cy + r * 0.02), (cx - r * 0.10, cy + r * 0.44),
           (cx + r * 0.58, cy - r * 0.42)]
    d.line(pts, fill=NAVY, width=w, joint="curve")
    # Round the check joints: PIL line joints are mitered; add dots.
    for (x, y) in pts:
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=NAVY)

def make(size, maskable=False, radius_frac=0.22):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        # Full-bleed navy (maskable crops to a circle/rounded square);
        # keep the mark inside the central 80% safe zone.
        d.rectangle([0, 0, size, size], fill=NAVY)
        # Scale the mark down so it sits inside the safe zone.
        sub = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ds = ImageDraw.Draw(sub)
        # Draw mark at 80% scale by drawing on a smaller canvas and pasting.
        small = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw_mark(ImageDraw.Draw(small), size)
        small = small.resize((int(size * 0.8), int(size * 0.8)), Image.LANCZOS)
        img.paste(small, (int(size * 0.1), int(size * 0.1)), small)
    else:
        d.rounded_rectangle([0, 0, size - 1, size - 1],
                            radius=int(size * radius_frac), fill=NAVY)
        draw_mark(d, size)
    return img

targets = [
    ("icon-512.png", 512, False),
    ("icon-512-maskable.png", 512, True),
    ("icon-192.png", 192, False),
    ("apple-touch-icon.png", 180, False),
    ("favicon-32.png", 32, False),
]
for name, size, maskable in targets:
    img = make(size, maskable)
    path = os.path.join(OUT, name)
    img.save(path, "PNG")
    check = Image.open(path)
    assert check.size == (size, size), f"{name}: got {check.size}"
    print(f"wrote {path} {check.size} mode={check.mode}")
print("all icons OK")
