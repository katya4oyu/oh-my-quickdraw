# Shrinking and cutting images for the board where macOS's sips is not there:
# run by ./images.ts as `uv run --no-project --with pillow python image_tool.py …`.
#
#   shrink IN OUT MAX JPEG      fit within MAX px; JPEG (quality 85) when JPEG is 1
#   half IN OUT                 half the size, as WebP (a pet's sprite sheet: it keeps its grid)
#   split IN DIR COLS ROWS INSET MAX
#                               cut an even grid into DIR/cell-R-C.png, row by row,
#                               INSET (a share of each cell) off its edges, each
#                               within MAX px
import sys
from PIL import Image


def fit(img, side):
    img.thumbnail((side, side), Image.LANCZOS)
    return img


def shrink(src, out, side, jpeg):
    img = fit(Image.open(src), int(side))
    if jpeg == "1":
        img.convert("RGB").save(out, "JPEG", quality=85)
    else:
        img.save(out, "PNG", optimize=True)


def half(src, out):
    img = Image.open(src)
    img.resize((img.width // 2, img.height // 2), Image.LANCZOS).save(out, "WEBP", quality=85)


def split(src, out_dir, cols, rows, inset, side):
    img = Image.open(src)
    cols, rows = int(cols), int(rows)
    cw, ch = img.width // cols, img.height // rows
    i = round(min(0.2, max(0.0, float(inset))) * min(cw, ch))
    for r in range(rows):
        for c in range(cols):
            cell = img.crop((c * cw + i, r * ch + i, (c + 1) * cw - i, (r + 1) * ch - i))
            fit(cell, int(side)).save(f"{out_dir}/cell-{r}-{c}.png", "PNG", optimize=True)


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    {"shrink": shrink, "split": split, "half": half}[command](*args)
