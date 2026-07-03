from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

W, H = 1200, 630
OUTPUT = r'd:\GraphPet\screenshots\banner.png'

img = Image.new('RGBA', (W, H), '#0f0f1a')
draw = ImageDraw.Draw(img)

for y in range(H):
    t = y / H
    r = int(15 + 30 * t)
    g = int(15 + 20 * t)
    b = int(30 + 50 * t)
    draw.line([(0, y), (W, y)], fill=(r, g, b, 255))

overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
odraw = ImageDraw.Draw(overlay)
for i in range(60):
    import random
    random.seed(i * 7)
    x = random.randint(0, W)
    y = random.randint(0, H)
    s = random.randint(1, 3)
    alpha = random.randint(30, 120)
    odraw.ellipse([x - s, y - s, x + s, y + s], fill=(255, 200, 220, alpha))
img = Image.alpha_composite(img, overlay)

pet_path = r'd:\GraphPet\screenshots\nito-pet-only.png'
if os.path.exists(pet_path):
    pet = Image.open(pet_path).convert('RGBA')
    pet_w = int(H * 0.75)
    pet_h = int(pet.height * (pet_w / pet.width))
    pet = pet.resize((pet_w, pet_h), Image.LANCZOS)
    px = W - pet_w - 60
    py = (H - pet_h) // 2 + 20
    img.paste(pet, (px, py), pet)

draw = ImageDraw.Draw(img)

try:
    title_font = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 64)
    sub_font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 24)
    tag_font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 16)
except:
    title_font = ImageFont.load_default()
    sub_font = ImageFont.load_default()
    tag_font = ImageFont.load_default()

title = '🐾 GraphPet'
sub = '你的AI知识桌宠 — 喂文件、学知识、陪你聊天'

draw.text((60, 160), title, fill='#ffffff', font=title_font)
draw.text((60, 250), sub, fill='#b0b0d0', font=sub_font)

tags = ['零配置开箱即用', '知识图谱 RAG', 'Live2D 互动', '国内免费 LLM']
tx = 60
ty = 320
for tag in tags:
    bbox = draw.textbbox((0, 0), tag, font=tag_font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    pad_x, pad_y = 14, 6
    draw.rounded_rectangle(
        [tx, ty, tx + tw + pad_x * 2, ty + th + pad_y * 2],
        radius=16,
        fill=(255, 107, 157, 38),
        outline=(255, 107, 157, 102),
        width=1
    )
    draw.text((tx + pad_x, ty + pad_y), tag, fill='#ff6b9d', font=tag_font)
    tx += tw + pad_x * 2 + 12

img.convert('RGB').save(OUTPUT)
print(f'Banner saved to {OUTPUT}')
