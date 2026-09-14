# -*- coding: utf-8 -*-
"""生成小程序 tabBar 图标与占位图"""
from PIL import Image, ImageDraw
import os

OUT = r"C:\Users\15596\WorkBuddy\2026-09-07-10-22-49\diancan-miniprogram\miniprogram\images"
os.makedirs(OUT, exist_ok=True)

SIZE = 81
SCALE = 4
S = SIZE * SCALE


def canvas():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def save(img, name, size=SIZE):
    img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(OUT, name))
    print("generated", name)


def draw_food(color):
    img, d = canvas()
    # 碗身（下半圆）
    d.pieslice([60, 96, 264, 344], 180, 360, fill=color)
    # 碗沿
    d.ellipse([60, 84, 264, 108], outline=color, width=10)
    # 蒸汽（两条弧线）
    d.arc([118, 26, 152, 66], 200, 340, fill=color, width=9)
    d.arc([196, 26, 230, 66], 200, 340, fill=color, width=9)
    return img


def draw_order(color):
    img, d = canvas()
    d.rounded_rectangle([84, 40, 240, 284], radius=16, outline=color, width=12)
    d.line([118, 104, 206, 104], fill=color, width=11)
    d.line([118, 156, 206, 156], fill=color, width=11)
    d.line([118, 208, 168, 208], fill=color, width=11)
    return img


def draw_mine(color):
    img, d = canvas()
    d.ellipse([112, 40, 212, 140], fill=color)          # 头
    d.pieslice([72, 160, 252, 344], 0, 180, fill=color)  # 身体
    return img


for name, color in [("tab-food", "#999999"), ("tab-food-active", "#F5A623")]:
    save(draw_food(color), name + ".png")
for name, color in [("tab-order", "#999999"), ("tab-order-active", "#F5A623")]:
    save(draw_order(color), name + ".png")
for name, color in [("tab-mine", "#999999"), ("tab-mine-active", "#F5A623")]:
    save(draw_mine(color), name + ".png")


# 菜品占位图 300x300
def placeholder():
    img, d = canvas()
    img = Image.new("RGBA", (300, 300), (242, 242, 242, 255))
    d = ImageDraw.Draw(img)
    # 简单盘子+碗
    d.ellipse([60, 120, 240, 300], fill=(230, 230, 230, 255))
    d.ellipse([95, 150, 205, 260], fill=(210, 210, 210, 255))
    return img


save(placeholder(), "placeholder.png", size=300)


# 默认头像 200x200
def avatar():
    img = Image.new("RGBA", (200, 200), (242, 242, 242, 255))
    d = ImageDraw.Draw(img)
    d.ellipse([70, 40, 130, 100], fill=(200, 200, 200, 255))
    d.pieslice([40, 110, 160, 230], 0, 180, fill=(200, 200, 200, 255))
    return img


save(avatar(), "avatar-default.png", size=200)

print("ALL DONE")
