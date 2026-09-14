"""把 app-logo.jpg（白底 JPEG）转成四角透明的 PNG。纯 Pillow，无第三方依赖。

背景：`src/static/images/app-logo.jpg` 其实是 JPEG（无 alpha 通道），白底是烤进像素里的。
banner / 头像那几处靠容器上的 `border-radius: 50%` 把白方块裁掉了，所以看不出问题；
但订单页空态的 `.empty-emoji` 没有圆角，就直接暴露成一个白方块。

本脚本从四个角泛洪填充，只把「与角相连的浅色区域」变透明 ——
**不能用全局白色阈值**，那会把厨师帽和虚线圆一起打穿。
之后裁到内容包围盒（省掉多余透明边）、羽化 1px 抗锯齿、量化到调色板控制体积。

用法：
    python scripts/gen_transparent_logo.py
输出：
    src/static/images/app-logo.png
"""

import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "static" / "images" / "app-logo.jpg"
DST = ROOT / "src" / "static" / "images" / "app-logo.png"

# 泛洪容差：与角落颜色差多少仍算同一片（0-255）。JPEG 压缩噪声在 20 以内。
WHITE_TOL = 42
# 泛洪后掩码向外扩这么多像素，用来吃掉 JPEG 在边缘留下的白晕
FRINGE = 1
# 边缘羽化半径，做 1px 抗锯齿
FEATHER = 0.7
# 裁切后额外保留的透明边（占边长比例），防止抗锯齿边缘贴死画布
PAD_RATIO = 0.01
# 输出最长边（页面上按 200rpx 显示，2 倍图足够）
MAX_SIDE = 400
# 调色板色数。扁平卡通 128 色肉眼无差，体积从 160KB 掉到 24KB
COLORS = 128
# 泛洪填充用的临时色，只用于回读掩码，不会留在输出里
SENTINEL = (1, 254, 3)


def existing_alpha(img: Image.Image) -> Image.Image | None:
    """源文件本来就带透明通道时直接复用，不做泛洪。"""
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        a = img.convert("RGBA").split()[-1]
        if a.getextrema()[0] < 255:
            return a
    return None


def flood_alpha(rgb: Image.Image) -> Image.Image:
    """从四角泛洪得到 alpha 通道：与角相连的浅色区域 → 透明。"""
    w, h = rgb.size
    work = rgb.copy()
    for xy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        ImageDraw.floodfill(work, xy, SENTINEL, thresh=WHITE_TOL)

    diff = ImageChops.difference(work, Image.new("RGB", (w, h), SENTINEL)).convert("L")
    outer = diff.point(lambda v: 255 if v == 0 else 0)  # 255 = 被泛洪到

    ratio = outer.histogram()[255] / (w * h)
    print(f"外边被泛洪的面积 {ratio:.1%}（应为百分之几十；接近 0% 说明泛洪没走动，接近 100% 说明容差太大）")

    if FRINGE:
        outer = outer.filter(ImageFilter.MaxFilter(FRINGE * 2 + 1))
    return ImageChops.invert(outer)


def main() -> int:
    if not SRC.exists():
        print(f"找不到源文件：{SRC}", file=sys.stderr)
        return 1

    src = Image.open(SRC)
    print(f"源文件   {SRC.name}  format={src.format} mode={src.mode} size={src.size}")

    rgb = src.convert("RGB")
    alpha = existing_alpha(src)
    if alpha is None:
        alpha = flood_alpha(rgb)
    else:
        print("源文件已带 alpha 通道，跳过泛洪")

    box = alpha.getbbox()
    if box is None:
        print("整张图都是透明的，检查 WHITE_TOL", file=sys.stderr)
        return 2
    print(f"内容包围盒 {box}（画布 {rgb.size}），裁掉多余透明边")
    rgb, alpha = rgb.crop(box), alpha.crop(box)
    cw, ch = rgb.size

    pad = max(2, round(max(cw, ch) * PAD_RATIO)) if PAD_RATIO else 0
    out = Image.new("RGBA", (cw + pad * 2, ch + pad * 2), (0, 0, 0, 0))
    out.paste(rgb, (pad, pad))
    full_alpha = Image.new("L", out.size, 0)
    full_alpha.paste(alpha, (pad, pad))
    out.putalpha(full_alpha.filter(ImageFilter.GaussianBlur(FEATHER)))

    if max(out.size) > MAX_SIDE:
        scale = MAX_SIDE / max(out.size)
        out = out.resize((round(out.width * scale), round(out.height * scale)), Image.LANCZOS)

    out = out.quantize(colors=COLORS, method=Image.FASTOCTREE)
    out.save(DST, "PNG", optimize=True)
    print(f"已输出   {DST.name}  mode={out.mode} size={out.size}  {DST.stat().st_size / 1024:.1f} KB（源 jpg {SRC.stat().st_size / 1024:.1f} KB）")

    # 自检：四角必须透明，正中心必须不透明
    a = out.convert("RGBA").split()[-1]
    ow, oh = out.size
    corners = [a.getpixel(p) for p in ((0, 0), (ow - 1, 0), (0, oh - 1), (ow - 1, oh - 1))]
    center = a.getpixel((ow // 2, oh // 2))
    levels = len(set(a.get_flattened_data()))
    print(f"自检     四角 alpha={corners} 中心 alpha={center} 透明度 {levels} 档（>2 说明边缘抗锯齿保住了）")
    if any(c > 8 for c in corners):
        print("✗ 四角没有变透明", file=sys.stderr)
        return 3
    if center < 200:
        print("✗ 中心被误伤了", file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
