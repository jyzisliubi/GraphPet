# Demo GIF 录制脚本（PowerShell）
#
# 用法：
#   1. 启动 GraphPet：在项目根目录运行 `npm run dev`
#   2. 打开 OBS Studio 或 Windows 自带的"截图工具→录屏"
#   3. 按下面脚本依次演示功能（每个场景 4~8 秒）
#   4. 录制完成后用 ffmpeg 转 GIF：
#      ffmpeg -i input.mp4 -vf "fps=12,scale=720:-1:flags=lanczos" -loop 0 demos/demo.gif
#
# 推荐场景（按顺序录制，总长 40~50s）：
# ==========================================
# 场景 1（4s）：开屏 + Nito 加载
#   - 启动应用，Nito 淡入动画，欢迎气泡（按心情选择欢迎语）
#
# 场景 2（6s）：换皮肤 + 自定义模型导入
#   - 右键 Nito → 换皮肤 → 切换 5 个姐妹皮肤（Nito/Ni-J/Nico/Nietzsche/Nipsilon）
#   - 展示"📁 导入自定义 Live2D 模型"按钮
#
# 场景 3（8s）：喂文件
#   - 拖一个 PDF 到 Nito 身上
#   - 显示喂食进度条 → 三元组预览卡片
#   - Nito："好吃！我学到了 37 个新知识~"
#
# 场景 4（6s）：截屏喂食
#   - 右键 → 截屏喂食
#   - Nito："我看到了你的屏幕~"
#
# 场景 5（6s）：智能问答
#   - 点击 Nito → 打开聊天面板
#   - 输入："Nito 你学到了什么？"
#   - 流式回答显示，引用编号 [1][2] 可点击溯源
#
# 场景 6（5s）：心情系统 + 内心想法
#   - 摸头 → Nito 开心表情 + 摸头反应
#   - 等待内心想法气泡自动弹出（云朵气泡）
#
# 场景 7（4s）：全局热键
#   - 切到其他应用（如浏览器）
#   - 按 Ctrl+Shift+G → Nito 一键显示/隐藏
#
# 场景 8（5s）：桌宠走动 + 多显示器
#   - 右键 → 开始走动（或托盘菜单"开始走动"）
#   - Nito 自动在当前显示器随机移动
#
# 场景 9（5s）：管理面板
#   - 右键 → 打开管理面板
#   - 切换 5 个子页面（深度聊天/记忆图谱/时间线/文件清单/智力展示）
#   - 展示心情/行为状态卡片
#
# 场景 10（4s）：主题切换
#   - 设置 → 外观 → 切换 亮色/暗色/跟随系统
#   - 展示 UI 主题切换动画
#
# 录制完成后转换 GIF：
# ==========================================
# PowerShell:
#   ffmpeg -i recording.mp4 -vf "fps=12,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 demos/demo.gif
#
# 或简化版（无调色板，体积大但兼容性好）：
#   ffmpeg -i recording.mp4 -vf "fps=10,scale=640:-1:flags=lanczos" -loop 0 demos/demo.gif
#
# 优化 GIF 体积（< 5MB 以便 GitHub 显示）：
#   gifsicle -O3 --lossy=80 --colors 128 demos/demo.gif -o demos/demo-opt.gif
#
# 推荐工具：
# - 录屏：OBS Studio（免费）/ Windows 截图工具 Win+G
# - GIF 转换：ffmpeg / gifski（质量更好）
# - GIF 优化：gifsicle
# - 在线工具：https://gifski.app/（在线版）

Write-Host "=== GraphPet Demo 录制指南 ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. 启动应用：在项目根目录运行 'npm run dev'"
Write-Host "2. 录制 10 个场景（总长 40~50s）："
Write-Host "   场景1 (4s): 启动 Nito 加载 + 心情欢迎气泡"
Write-Host "   场景2 (6s): 换皮肤 5 姐妹 + 自定义模型导入按钮"
Write-Host "   场景3 (8s): 喂 PDF 文件 + 三元组预览"
Write-Host "   场景4 (6s): 截屏喂食 - Nito 看得见屏幕"
Write-Host "   场景5 (6s): 智能问答 + 流式回答 + 引用溯源"
Write-Host "   场景6 (5s): 心情系统 + 摸头反应 + 内心想法气泡"
Write-Host "   场景7 (4s): 全局热键 Ctrl+Shift+G 一键切换"
Write-Host "   场景8 (5s): 桌宠走动（多显示器适配）"
Write-Host "   场景9 (5s): 管理面板 - 5 子页 + 心情状态卡片"
Write-Host "   场景10 (4s): 主题切换 亮/暗/跟随系统"
Write-Host ""
Write-Host "3. 转换为 GIF："
Write-Host "   ffmpeg -i recording.mp4 -vf 'fps=12,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse' -loop 0 demos/demo.gif"
Write-Host ""
Write-Host "4. 优化 GIF 体积："
Write-Host "   gifsicle -O3 --lossy=80 --colors 128 demos/demo.gif -o demos/demo-opt.gif"
Write-Host ""
Write-Host "5. 把 demos/demo.gif 嵌入到 README 顶部"
