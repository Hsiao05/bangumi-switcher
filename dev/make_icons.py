"""生成扩展图标：把 dev/icon-source.jpg 切成圆角，并输出各尺寸 PNG。

用法：
    python dev/make_icons.py

源图：dev/icon-source.jpg（220×220，用户提供的切换箭头插画）。
处理：先放大到 1024px 作为母版，用圆角矩形蒙版切出透明圆角，
     再用 LANCZOS 缩到 16/32/48/128，保证小尺寸干净。
同时生成一张放大的尺寸对照图，方便检查 16px 下的辨识度。
"""

from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, "extension", "icons")
PREVIEW_DIR = os.path.join(ROOT, "dev", "screenshots")

SOURCE_CANDIDATES = [
    os.path.join(ROOT, "dev", "icon-source.jpg"),
    os.path.join(ROOT, "dev", "icon-source.png"),
    os.path.join(ROOT, "dev", "icon-source.jpeg"),
]

MASTER_SIZE = 1024
RADIUS_RATIO = 0.23
ICON_SIZES = (16, 32, 48, 128)


def find_source() -> str:
    for path in SOURCE_CANDIDATES:
        if os.path.exists(path):
            return path
    raise FileNotFoundError(
        "找不到图标源图，请把源图保存为 dev/icon-source.jpg 后重试。"
    )


def build_master(source_path: str) -> Image.Image:
    source = Image.open(source_path).convert("RGB")

    # 源图不一定是正方形：居中裁成正方形，避免拉伸变形。
    width, height = source.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    source = source.crop((left, top, left + side, top + side))
    source = source.resize((MASTER_SIZE, MASTER_SIZE), Image.LANCZOS)

    # 圆角蒙版（4× 超采样，边缘更平滑）。
    mask_size = MASTER_SIZE * 2
    mask = Image.new("L", (mask_size, mask_size), 0)
    radius = round(mask_size * RADIUS_RATIO)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, mask_size - 1, mask_size - 1), radius=radius, fill=255
    )
    mask = mask.resize((MASTER_SIZE, MASTER_SIZE), Image.LANCZOS)

    icon = source.convert("RGBA")
    icon.putalpha(mask)
    return icon


def build_contact_sheet(master: Image.Image) -> Image.Image:
    """把 16/32/48/128 按整数倍放大后并排展示，方便人工检查清晰度。"""
    scales = {16: 8, 32: 4, 48: 4, 128: 2}
    images = []
    for size in ICON_SIZES:
        icon = master.resize((size, size), Image.LANCZOS)
        images.append(icon.resize((size * scales[size], size * scales[size]), Image.NEAREST))

    pad = 18
    width = sum(image.width for image in images) + pad * (len(images) + 1)
    height = max(image.height for image in images) + pad * 2
    sheet = Image.new("RGB", (width, height), (238, 238, 238))

    x = pad
    for image in images:
        y = pad + (height - pad * 2 - image.height) // 2
        sheet.paste(image, (x, y), image)
        x += image.width + pad

    return sheet


def main() -> int:
    os.makedirs(ICON_DIR, exist_ok=True)
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    source_path = find_source()
    master = build_master(source_path)
    print(f"source: {source_path}")
    print(f"master: {master.size[0]}x{master.size[1]}, radius ratio {RADIUS_RATIO}")

    for size in ICON_SIZES:
        path = os.path.join(ICON_DIR, f"icon{size}.png")
        master.resize((size, size), Image.LANCZOS).save(path, "PNG")
        print(f"wrote {path}")

    preview = os.path.join(PREVIEW_DIR, "icon-128.png")
    master.resize((128, 128), Image.LANCZOS).save(preview, "PNG")
    print(f"wrote {preview}")

    sheet = os.path.join(PREVIEW_DIR, "icons-contact.png")
    build_contact_sheet(master).save(sheet, "PNG")
    print(f"wrote {sheet}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
