"""Generate PWA icons for the PM5 Dashboard.

Produces:
  icon-192.png   — required for Android install
  icon-512.png   — required for splash screen & high-density displays
  icon-180.png   — iOS "Add to Home Screen"
  icon-32.png    — favicon
  icon-maskable-192.png  — Android adaptive icon (extra safe-zone padding)
  icon-maskable-512.png
"""
from PIL import Image, ImageDraw, ImageFont
import os
import math

OUT = os.path.dirname(os.path.abspath(__file__))

# Theme colours (match the app)
BG = (11, 13, 18)              # --bg-base
PANEL = (19, 23, 34)            # --bg-panel
ACCENT = (76, 194, 255)         # --accent (cyan)
ACCENT_3 = (86, 249, 179)       # --accent-3 (mint)
ACCENT_2 = (255, 143, 60)       # --accent-2 (amber)
TEXT = (232, 236, 243)          # --text


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    """Draw the PM5 dashboard icon at `size`x`size`.

    Design: dark rounded-square background, a stylised force-curve arc
    in cyan/mint gradient, the letters "PM5" stacked underneath in
    bold white.

    When `maskable` is True, the artwork is inset by 10% so Android's
    adaptive-icon masks (circle, squircle, etc.) don't clip anything
    important.
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")

    # Inset for safe zone if maskable, else fill the whole canvas.
    inset = int(size * 0.10) if maskable else 0
    box = (inset, inset, size - inset, size - inset)
    inner = size - 2 * inset
    cx, cy = size // 2, size // 2

    # Rounded-square background.
    radius = int(inner * 0.22)
    draw.rounded_rectangle(box, radius=radius, fill=BG)

    # Inner subtle panel ring for depth.
    pad = int(inner * 0.06)
    draw.rounded_rectangle(
        (box[0] + pad, box[1] + pad, box[2] - pad, box[3] - pad),
        radius=max(1, radius - pad),
        outline=PANEL, width=max(1, int(inner * 0.015)),
    )

    # Force-curve arc — a bell shape rising and falling.
    curve_w = int(inner * 0.66)
    curve_h = int(inner * 0.28)
    cx_start = cx - curve_w // 2
    cy_base = cy - int(inner * 0.04)
    points = []
    n = 64
    for i in range(n + 1):
        t = i / n
        x = cx_start + int(curve_w * t)
        # Asymmetric bell: peak slightly past the middle (~55%).
        peak_t = 0.55
        if t <= peak_t:
            f = math.sin((t / peak_t) * (math.pi / 2))
        else:
            f = math.sin(((1 - t) / (1 - peak_t)) * (math.pi / 2))
        y = cy_base - int(curve_h * f)
        points.append((x, y))

    # Fill under the curve with a soft semi-transparent cyan.
    fill_poly = points + [(cx_start + curve_w, cy_base), (cx_start, cy_base)]
    draw.polygon(fill_poly, fill=(*ACCENT, 60))

    # Draw the curve itself.
    line_width = max(2, int(inner * 0.035))
    draw.line(points, fill=ACCENT, width=line_width, joint="curve")

    # Drop a baseline tick.
    draw.line(
        [(cx_start, cy_base + line_width // 2),
         (cx_start + curve_w, cy_base + line_width // 2)],
        fill=PANEL, width=max(1, int(inner * 0.012)),
    )

    # "PM5" text below the curve.
    text = "PM5"
    font = None
    for candidate in (
        "C:/Windows/Fonts/seguibl.ttf",
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ):
        if os.path.exists(candidate):
            try:
                # Big and bold so it reads at small sizes.
                font = ImageFont.truetype(candidate, int(inner * 0.30))
                break
            except OSError:
                continue
    if font is None:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = cx - tw // 2 - bbox[0]
    ty = cy_base + int(inner * 0.04) - bbox[1]
    draw.text((tx, ty), text, font=font, fill=TEXT)

    return img


def main():
    targets = [
        ("icon-32.png",            32,  False),
        ("icon-180.png",          180,  False),
        ("icon-192.png",          192,  False),
        ("icon-512.png",          512,  False),
        ("icon-maskable-192.png", 192,  True),
        ("icon-maskable-512.png", 512,  True),
    ]
    for name, sz, maskable in targets:
        img = draw_icon(sz, maskable=maskable)
        path = os.path.join(OUT, name)
        img.save(path, "PNG", optimize=True)
        print(f"wrote {name}  ({sz}x{sz}{'  maskable' if maskable else ''})")


if __name__ == "__main__":
    main()
