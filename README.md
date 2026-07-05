<div align="center">

# 🐾 GraphPet

> 你的 AI 知识桌宠 —— 喂文件、学知识、陪你聊天

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/jyzisliubi/GraphPet?style=social)](https://github.com/jyzisliubi/GraphPet/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/jyzisliubi/GraphPet?style=social)](https://github.com/jyzisliubi/GraphPet/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/jyzisliubi/GraphPet)](https://github.com/jyzisliubi/GraphPet/issues)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Build](https://github.com/jyzisliubi/GraphPet/actions/workflows/release.yml/badge.svg)](https://github.com/jyzisliubi/GraphPet/actions)
[![Release](https://img.shields.io/github/v/release/jyzisliubi/GraphPet?color=blue)](https://github.com/jyzisliubi/GraphPet/releases)

[![Electron](https://img.shields.io/badge/Electron-31+-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18+-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![LightRAG](https://img.shields.io/badge/LightRAG-1.5+-FF6B9D)](https://github.com/HKUDS/LightRAG)
[![Docling](https://img.shields.io/badge/Docling-2.0+-0078D4?logo=ibm&logoColor=white)](https://github.com/docling-project/docling)

**简体中文** | [English](README_EN.md)

</div>

</div>

---

## ✨ 为什么选 GraphPet？

> 别人的桌宠只会卖萌，**Nito 还能学习你的知识**。

把论文、文档、笔记丢给她，她会用知识图谱记住一切，变成专属于你的 AI 助手。

| 🌟 零配置开箱即用 | 📚 知识图谱喂食 | 🎀 Live2D 互动 |
|:---:|:---:|:---:|
| 内置免费 LLM 聚合 | PDF/Word/网页/代码 | 五姐妹皮肤切换 |
| 不用注册不用装 Ollama | LightRAG + Docling | 21 组表情动作 |
| 打开就能聊 | 图谱可视化 + 溯源 | 摸头/戳戳/喂食 |

---

## 🖼 预览

### 🎀 五姐妹家族

<div align="center">

<img src="screenshots/nito-pet-only.png" width="130" style="border-radius: 12px; margin: 6px;" />
<img src="screenshots/ni-j.png" width="130" style="border-radius: 12px; margin: 6px;" />
<img src="screenshots/nico.png" width="130" style="border-radius: 12px; margin: 6px;" />
<img src="screenshots/nietzsche.png" width="130" style="border-radius: 12px; margin: 6px;" />
<img src="screenshots/nipsilon.png" width="130" style="border-radius: 12px; margin: 6px;" />

> Nito / Ni-J / Nico / Nietzsche / Nipsilon — 一键切换皮肤，每个角色都有独特的 Live2D 动作和表情 ✨

</div>

### 😆 互动表情包

<div align="center">

<img src="screenshots/nito-angry.png" width="170" style="border-radius: 12px; margin: 8px;" />
<img src="screenshots/nito-cry.png" width="170" style="border-radius: 12px; margin: 8px;" />
<img src="screenshots/nito-sleepy.png" width="170" style="border-radius: 12px; margin: 8px;" />

摸头、戳戳、喂食... 21 组动作表情等你解锁！

</div>

---

## 🚀 快速开始

### 方式一：下载安装包（推荐 ⭐）

前往 [Releases](https://github.com/jyzisliubi/GraphPet/releases) 下载最新版：

| 版本 | 说明 | 大小 |
|------|------|------|
| `GraphPet-setup.exe` | 安装版（推荐） | ~80MB |
| `GraphPet-portable.exe` | 免安装便携版 | ~100MB |

> 安装后启动，首启引导选择 **"国内免费（零配置）"**，一键开玩！

### 方式二：从源码运行

```bash
# 克隆项目
git clone https://github.com/jyzisliubi/GraphPet.git
cd GraphPet

# 安装前端依赖
npm install

# 安装 Python 依赖
cd python
pip install -r requirements.txt
cd ..

# 启动！
npm run dev
```

### 方式三：内嵌 Python 完整打包（开发者构建发布版）

把 Python 运行时和所有依赖打进安装包，**用户无需自己装 Python**：

```bash
# 1. 安装 PyInstaller
pip install pyinstaller

# 2. 构建内嵌 Python 运行时（产物到 resources/python-runtime/）
npm run build:python-runtime

# 3. 构建包含内嵌 Python 的安装包
npm run dist:full
```

> 该模式生成的 `GraphPet-setup.exe` 包含 Python 解释器、FastAPI、Docling、LightRAG、sentence-transformers 等所有依赖，用户下载安装后即可直接运行，无需任何额外环境配置。

---

## 💡 核心功能

### 🎀 Live2D 桌宠
- **Nito 官方模型** — Live2D 官模，粉发少女萌力十足
- **五姐妹皮肤** — Nito / Ni-J / Nico / Nietzsche / Nipsilon 一键切换
- **21 组动作** — 开心、惊讶、生气、打哈欠、睡觉...
- **表情驱动** — AI 回复内容自动匹配表情
- **智能互动** — 摸头、戳身体、拖文件喂食都有不同反应
- **窗口穿透** — 平时不挡鼠标，互动自动响应

### 🚀 零配置 LLM
- **国内免费模式** — 内置免费 API 聚合，开箱即用
- **8+ 服务商** — 硅基流动 / 智谱 / 通义 / DeepSeek / Kimi / Ollama...
- **自动故障转移** — 一个挂了自动切下一个
- **流式输出** — SSE 实时响应，边想边说

### 📚 知识图谱喂食
- **拖放即喂** — 文件/URL 直接拖到 Nito 身上
- **Docling 解析** — IBM 开源，PDF/Word/网页 → Markdown
- **LightRAG 图谱** — 港大 HKU EMNLP 2025 方案
- **增量更新** — 新文件只增量插入，不重建
- **文件级溯源** — 每个文件可查看详情、可"吐掉"删除
- **多格式支持** — PDF、Word、TXT、Markdown、代码、网页、图片

### 💬 智能问答
- **闲聊模式** — 没喂文件也能日常唠嗑
- **知识问答** — 基于你喂的文件精准回答
- **多轮对话** — 上下文记忆，聊天不中断
- **双模式检索** — Local / Global / Hybrid 三种检索策略

### 📊 管理面板
右键 Nito → "管理面板" 打开：
- **📊 记忆图谱** — SVG 力导向图，支持缩放拖拽
- **📁 文件列表** — 所有喂食记录，三元组详情
- **📈 成长记录** — 智力/亲密度/性格属性
- **⏰ 时间线** — 完整互动历史
- **💬 深度对话** — 完整聊天界面

---

## 🛠 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 桌面框架 | **Electron** | 31+ | 跨平台桌面应用 |
| 前端 UI | **React + TypeScript** | 18 / 5.5 | 类型安全组件化 |
| 2D 渲染 | **PIXI.js + pixi-live2d-display** | 6.5 | Live2D Cubism 4 渲染 |
| 构建工具 | **electron-vite** | 2.3 | 快速构建热重载 |
| 后端服务 | **Python + FastAPI** | 3.10+ | 异步高性能 API |
| 文档解析 | **Docling** | 2.0+ | IBM Research 开源 |
| 知识图谱 | **LightRAG** | 1.5+ | 港大 HKU EMNLP 2025 |
| 向量嵌入 | **fastembed** | 0.3+ | 纯 ONNX 推理（无 torch 依赖，避免 Windows segfault） |
| LLM 后端 | **FreeLLM Router** | — | 内置免费 API 聚合 |

### 🏗 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Electron 桌面应用                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  主进程 (main/index.ts)        预加载 (preload/index.ts)    │  │
│  │  · 窗口管理 / 系统托盘          · IPC 桥接                  │  │
│  │  · 文件拖放 / 截屏              · 上下文隔离                │  │
│  └─────────────────────────┬─────────────────────────────────┘  │
│                            │ IPC                                 │
│  ┌─────────────────────────▼─────────────────────────────────┐  │
│  │            渲染进程 (React + TypeScript)                   │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │  │
│  │  │ Live2D Canvas│  │  Bubble/Chat │  │  管理面板    │     │  │
│  │  │  PIXI.js     │  │  对话气泡    │  │  记忆图谱    │     │  │
│  │  │  21 组动作    │  │  流式 SSE    │  │  文件列表    │     │  │
│  │  └──────────────┘  └──────┬───────┘  └──────┬───────┘     │  │
│  └──────────────────────────┼─────────────────┼──────────────┘  │
└─────────────────────────────┼─────────────────┼────────────────┘
                              │ HTTP            │ HTTP
                              ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Python FastAPI 后端 (server.py)                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  聊天 / 闲聊  │  │  喂食 / 解析 │  │  知识检索 / 溯源     │   │
│  │  chatService │  │  feedService │  │  memoryService       │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                     │               │
│         ▼                 ▼                     ▼               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ FreeLLM      │  │ Docling      │  │ LightRAG 图谱       │   │
│  │ Router       │  │ PDF/Word/HTML│  │ + sentence-transformers│  │
│  │ 多服务商聚合  │  │   → Markdown │  │  BGE-small-zh 向量   │   │
│  │ 自动故障转移  │  │              │  │  Local/Global/Hybrid │   │
│  └──────┬───────┘  └──────────────┘  └──────────────────────┘   │
└─────────┼───────────────────────────────────────────────────────┘
          │
          ▼
   ┌──────────────────────────────────────────┐
   │  外部 LLM 服务商                          │
   │  硅基流动 / 智谱 / 通义 / DeepSeek /     │
   │  Kimi / Ollama / 免费 API 聚合            │
   └──────────────────────────────────────────┘
```

> 数据流：用户拖文件 → Docling 解析 → LightRAG 增量插入图谱；用户提问 → LightRAG 检索 → LLM 生成 → 表情驱动 → Live2D 播放

---

## 📁 项目结构

```
GraphPet/
├── assets/live2d/nito4/     # Nito 五姐妹 Live2D 模型
├── python/                   # Python 后端
│   ├── server.py             # FastAPI 入口
│   ├── free_llm_router.py    # 免费 LLM 聚合路由器
│   ├── graphpet_rag_bridge.py # Docling + LightRAG 桥接
│   └── graphpet_core/        # 核心业务（记忆/成长/性格...）
├── freellmapi-cn/            # 独立的国内免费 LLM 网关项目
├── src/
│   ├── main/index.ts         # Electron 主进程
│   ├── preload/index.ts      # IPC 预加载
│   └── renderer/src/         # React 渲染进程
│       ├── components/       # UI 组件
│       ├── panels/           # 管理面板
│       ├── services/         # API 服务
│       └── stores/           # 状态管理
├── screenshots/              # 截图
├── .github/workflows/        # GitHub Actions CI/CD
└── README.md
```

---

## 🗺 Roadmap

> 用版本号标记功能成熟度，跟着 Nito 一起成长 ✨

### v0.2.x — 当前版本（已完成） 🎉

- ✅ Live2D 桌宠互动（五姐妹皮肤 / 21 组动作 / 摸头戳戳喂食）
- ✅ 零配置免费 LLM 聚合（8+ 服务商自动故障转移）
- ✅ 知识图谱喂食（Docling 解析 + LightRAG 增量）
- ✅ 智能问答（Local / Global / Hybrid 三模式检索）
- ✅ 管理面板（记忆图谱 / 文件列表 / 成长记录 / 时间线 / 深度对话）
- ✅ 多格式支持（PDF / Word / TXT / Markdown / 代码 / 网页 / 图片）
- ✅ TTS 语音播报 + Live2D 口型同步（edge-tts，设置面板可开关）
- ✅ STT 语音输入（Web Speech API，麦克风按钮在输入框旁）
- ✅ 桌宠自由走动（右键菜单"开始走动"，每 8~20s 自动巡逻桌面）
- ✅ 内嵌 Python 打包（PyInstaller + electron-builder，免安装运行时）
- ✅ WebUI 美化（Linear/Stripe 风格，渐变品牌色、状态指示灯、动画过渡）
- ✅ 英文 README（[README_EN.md](README_EN.md)）

### v0.3.x — v0.3.3 已完成 ✅

- ✅ d3-force 力导向图谱可视化（替换手写 SVG 布局，支持节点拖拽/搜索/缩放）
- ✅ fastembed 替换 sentence-transformers + torch（解决 Windows uvicorn 多线程 segfault）
- ✅ 跨平台 CI（Windows / macOS / Linux 三平台 release）
- ✅ **Live2D 自动生命感**（v0.3.3）— auto blink / look at / idle eye movement 三大特性，参考 AIRI
- ✅ **内心想法气泡**（v0.3.3）— 90-180s 随机云朵气泡，参考 Open-LLM-VTuber
- ✅ **截屏喂食**（v0.3.3）— desktopCapturer 截屏后送入 RAG 图谱，Nito "看得见"你的屏幕
- ✅ **情绪映射修复**（v0.3.3）— LLM 返回 emotion 字段透传到 Live2D 表情

### v0.4.x — 计划中 🚧

- 🚧 心情/行为状态系统 — 状态机驱动情绪持久化、动作选择、内心独白
- 🚧 自定义模型 — 支持导入第三方 Live2D 模型
- 🚧 Whisper STT — 替换 Web Speech API，提升中文识别质量

### v0.5.x — 未来规划 🔮

- 🔮 多宠物共存 — 喂养多只桌宠，性格各异互相影响
- 🔮 插件系统 — 第三方扩展动作 / 皮肤 / 技能
- 🔮 知识共享 — 桌宠之间交换知识图谱，社区共建

---

## 🤝 贡献

欢迎贡献代码、提 Issue、发 PR！

1. Fork 本仓库
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个 Pull Request

详细的开发指南请参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## ❓ FAQ

<details>
<summary><b>启动时提示"找不到 Python"或"python 不是内部命令"？</b></summary>

GraphPet 后端依赖 Python 3.10+。请到 [python.org](https://www.python.org/downloads/) 下载安装，安装时务必勾选 **"Add Python to PATH"**。安装完成后重启终端，运行 `python --version` 验证。从源码运行还需进入 `python/` 目录执行 `pip install -r requirements.txt`。
</details>

<details>
<summary><b>免费 LLM 为什么这么慢，有时候还会失败？</b></summary>

免费模式聚合的是公共免费 API（如 Pollinations），无 QPS 保证、高峰期易拥堵，属于体验用。若需稳定快速回复，建议在设置中切换到带 API Key 的服务商（硅基流动 / 智谱 / DeepSeek 等），多数都有免费额度可用。
</details>

<details>
<summary><b>支持哪些文件格式？喂不进去怎么办？</b></summary>

支持 PDF、Word(.docx)、TXT、Markdown、代码、网页(URL)、图片。暂不支持 .doc（旧版二进制 Word）、扫描版 PDF（需 OCR）、加密文件。建议先用其他工具转为受支持格式，或把内容复制为 TXT 后再喂。
</details>

<details>
<summary><b>我喂的文件存在哪里？能换电脑吗？</b></summary>

数据默认存储在用户目录下（Windows：`%APPDATA%/graphpet/` 或项目相关目录），包含 LightRAG 知识库与本地缓存。换电脑时把对应数据目录整体打包迁移即可，或重新喂食原始文件重建图谱。
</details>

<details>
<summary><b>怎么换 LLM 模型 / 服务商？</b></summary>

右键 Nito → "管理面板" → "设置"，在 LLM 配置区切换服务商并填入 API Key。也支持本地 Ollama，填入本地地址（如 `http://localhost:11434`）即可。切换后立即生效，无需重启。
</details>

---

## 📄 许可证

[MIT License](LICENSE) — 随便用，欢迎二次创作

---

## 🙏 致谢

- [Live2D](https://www.live2d.com/) — Nito 官方模型
- [LightRAG](https://github.com/HKUDS/LightRAG) — 港大 HKU 知识图谱 RAG
- [Docling](https://github.com/docling-project/docling) — IBM Research 文档解析
- [Ollama](https://ollama.com/) — 本地大模型运行时
- [Pollinations AI](https://pollinations.ai) — 免费 AI API
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) — Live2D WebGL 渲染
- [fastembed](https://github.com/qdrant/fastembed) — 轻量 ONNX 向量嵌入
- [d3-force](https://github.com/d3/d3-force) — 力导向图谱布局

---

<div align="center">

**如果觉得不错，点个 ⭐ Star 支持一下吧！**

Made with ❤️ by Jay Z

</div>

---

## ⭐ Star History

<a href="https://star-history.com/#jyzisliubi/GraphPet&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://star-history.com/jyzisliubi/GraphPet.svg?theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://star-history.com/jyzisliubi/GraphPet.svg" />
    <img alt="Star History Chart" src="https://star-history.com/jyzisliubi/GraphPet.svg" width="720" />
  </picture>
</a>
