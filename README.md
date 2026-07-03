<div align="center">

# 🐾 GraphPet

> 你的 AI 知识桌宠 —— 喂文件、学知识、陪你聊天

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/jyzisliubi/GraphPet?style=social)](https://github.com/jyzisliubi/GraphPet/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/jyzisliubi/GraphPet?style=social)](https://github.com/jyzisliubi/GraphPet/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/jyzisliubi/GraphPet)](https://github.com/jyzisliubi/GraphPet/issues)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[![Electron](https://img.shields.io/badge/Electron-31+-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18+-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![LightRAG](https://img.shields.io/badge/LightRAG-1.5+-FF6B9D)](https://github.com/HKUDS/LightRAG)
[![Docling](https://img.shields.io/badge/Docling-2.0+-0078D4?logo=ibm&logoColor=white)](https://github.com/docling-project/docling)

**简体中文** | English (Coming Soon)

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
| 向量嵌入 | **sentence-transformers** | 2.7+ | BGE-small-zh 本地推理 |
| LLM 后端 | **FreeLLM Router** | — | 内置免费 API 聚合 |

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

## 🤝 贡献

欢迎贡献代码、提 Issue、发 PR！

1. Fork 本仓库
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个 Pull Request

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

---

<div align="center">

**如果觉得不错，点个 ⭐ Star 支持一下吧！**

Made with ❤️ by Jay Z

</div>
