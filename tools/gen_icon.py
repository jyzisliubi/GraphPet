from PIL import Image, ImageDraw
import os

# 创建256x256 RGBA图标
size = 256
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# 主体颜色 - 暖橙色（可爱宠物色）
body_color = (255, 154, 60, 255)
body_dark = (230, 120, 30, 255)
white = (255, 255, 255, 255)
black = (40, 40, 40, 255)
pink = (255, 182, 193, 255)

cx, cy = size // 2, size // 2 + 20

# 画身体（圆形）
body_r = 95
draw.ellipse([cx - body_r, cy - body_r, cx + body_r, cy + body_r], fill=body_color)

# 画耳朵（三角形）
ear_l = [(cx - 70, cy - 60), (cx - 40, cy - 120), (cx - 10, cy - 70)]
ear_r = [(cx + 70, cy - 60), (cx + 40, cy - 120), (cx + 10, cy - 70)]
draw.polygon(ear_l, fill=body_color)
draw.polygon(ear_r, fill=body_color)

# 耳朵内侧
ear_l_inner = [(cx - 60, cy - 65), (cx - 42, cy - 105), (cx - 22, cy - 72)]
ear_r_inner = [(cx + 60, cy - 65), (cx + 42, cy - 105), (cx + 22, cy - 72)]
draw.polygon(ear_l_inner, fill=pink)
draw.polygon(ear_r_inner, fill=pink)

# 画眼睛
eye_y = cy - 15
eye_r = 18
eye_l_x = cx - 35
eye_r_x = cx + 35

# 眼白
draw.ellipse([eye_l_x - eye_r, eye_y - eye_r, eye_l_x + eye_r, eye_y + eye_r], fill=white)
draw.ellipse([eye_r_x - eye_r, eye_y - eye_r, eye_r_x + eye_r, eye_y + eye_r], fill=white)

# 瞳孔
pupil_r = 11
draw.ellipse([eye_l_x - pupil_r + 3, eye_y - pupil_r, eye_l_x + pupil_r + 3, eye_y + pupil_r], fill=black)
draw.ellipse([eye_r_x - pupil_r + 3, eye_y - pupil_r, eye_r_x + pupil_r + 3, eye_y + pupil_r], fill=black)

# 眼睛高光
hl_r = 4
draw.ellipse([eye_l_x - hl_r + 5, eye_y - hl_r - 4, eye_l_x + hl_r + 5, eye_y + hl_r - 4], fill=white)
draw.ellipse([eye_r_x - hl_r + 5, eye_y - hl_r - 4, eye_r_x + hl_r + 5, eye_y + hl_r - 4], fill=white)

# 画腮红
blush_r = 14
draw.ellipse([cx - 60, eye_y + 15, cx - 60 + blush_r*2, eye_y + 15 + blush_r*2], fill=(255, 150, 150, 120))
draw.ellipse([cx + 60 - blush_r*2, eye_y + 15, cx + 60, eye_y + 15 + blush_r*2], fill=(255, 150, 150, 120))

# 画鼻子（小三角形）
nose_y = eye_y + 20
draw.polygon([(cx - 6, nose_y), (cx + 6, nose_y), (cx, nose_y + 10)], fill=pink)

# 画嘴巴（微笑弧线）
mouth_y = nose_y + 14
draw.arc([cx - 15, mouth_y - 8, cx, mouth_y + 8], start=0, end=180, fill=black, width=3)
draw.arc([cx, mouth_y - 8, cx + 15, mouth_y + 8], start=0, end=180, fill=black, width=3)

# 知识节点装饰（代表知识图谱）
# 右上角几个小圆点表示知识节点
node_color = (100, 200, 255, 220)
nodes = [(size-45, 45, 12), (size-75, 70, 8), (size-30, 80, 9), (size-60, 30, 7)]
for nx, ny, nr in nodes:
    draw.ellipse([nx-nr, ny-nr, nx+nr, ny+nr], fill=node_color)

# 节点连线
draw.line([(size-45, 45), (size-75, 70)], fill=node_color, width=2)
draw.line([(size-45, 45), (size-30, 80)], fill=node_color, width=2)
draw.line([(size-45, 45), (size-60, 30)], fill=node_color, width=2)

# 保存
out_path = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icon.png')
img.save(out_path, 'PNG')
print(f'Icon saved to: {out_path}')
print(f'Size: {img.size}')
