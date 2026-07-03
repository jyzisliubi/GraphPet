<div align="center">

# 🤝 GraphPet 贡献指南

感谢你对 GraphPet 的兴趣！这份指南帮助你快速参与项目共建。

</div>

---

## 📑 目录

- [🌱 开发环境搭建](#-开发环境搭建)
- [📁 项目结构](#-项目结构)
- [🎨 代码规范](#-代码规范)
- [🔀 提交 PR 流程](#-提交-pr-流程)
- [🐛 报告 Bug 格式](#-报告-bug-格式)

---

## 🌱 开发环境搭建

### 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | 18+ LTS | 推荐使用 nvm 管理 |
| npm | 9+ | 随 Node 一起安装 |
| Python | 3.10+ | 安装时勾选 "Add Python to PATH" |
| Git | 2.30+ | 版本控制 |

### 1. Fork & 克隆仓库

```bash
# 在 GitHub 上 Fork 本仓库后
git clone https://github.com/<你的用户名>/GraphPet.git
cd GraphPet

# 添加上游远程，方便同步主仓库更新
git remote add upstream https://github.com/jyzisliubi/GraphPet.git
```

### 2. 安装前端依赖

```bash
npm install
```

### 3. 安装 Python 后端依赖

```bash
cd python
pip install -r requirements.txt
cd ..
```

> 首次运行会从 HuggingFace 下载 BGE-small-zh-v1.5 嵌入模型（约 100MB），之后走本地缓存。

### 4. 启动开发服务

```bash
# 启动 Electron + Vite 热重载开发模式
npm run dev
```

启动后 Electron 窗口会自动弹出，后端 FastAPI 服务由主进程拉起。修改前端代码会即时热更新。

### 5. 验证构建

```bash
# 前端构建检查
npm run build

# 打包当前平台安装包（验证打包流程）
npm run pack
```

### 可用脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | 启动开发模式（热重载） |
| `npm run build` | 构建前端产物 |
| `npm run preview` | 预览构建结果 |
| `npm run pack` | 打包但不生成安装程序 |
| `npm run dist` | 打包并生成当前平台安装程序 |
| `npm run dist:win` | 仅打包 Windows |
| `npm run dist:mac` | 仅打包 macOS |
| `npm run dist:linux` | 仅打包 Linux |

---

## 📁 项目结构

```
GraphPet/
├── assets/                      # 静态资源
│   ├── live2d/nito4/            # Nito 五姐妹 Live2D 模型
│   │   ├── nito/ ni-j/ nico/ nietzsche/ nipsilon/
│   │   ├── motion/              # 21 组动作文件
│   │   └── *.model3.json
│   ├── icon.ico / icon.png
├── python/                      # Python 后端
│   ├── server.py               # FastAPI 入口（路由层）
│   ├── free_llm_router.py      # 免费 LLM 聚合路由器
│   ├── graphpet_rag_bridge.py  # Docling + LightRAG 桥接
│   ├── graphpet_core/          # 核心业务模块
│   │   ├── memory.py           # 记忆管理
│   │   ├── growth.py           # 成长系统
│   │   ├── personality.py      # 性格系统
│   │   ├── scheduler.py        # 定时调度
│   │   ├── state.py            # 状态持久化
│   │   └── knowledge_share.py  # 知识共享
│   └── requirements.txt
├── freellmapi-cn/              # 独立的国内免费 LLM 网关项目
├── src/
│   ├── main/index.ts           # Electron 主进程（窗口/托盘/IPC）
│   ├── preload/index.ts        # IPC 预加载（上下文隔离）
│   └── renderer/
│       ├── index.html
│       ├── public/             # 第三方 JS（live2d 等）
│       └── src/
│           ├── components/     # React 组件（Bubble/ChatPanel/...）
│           ├── panels/         # 管理面板（MemoryGraph/FileList/...）
│           ├── hooks/          # 自定义 Hooks
│           ├── services/       # API 调用层
│           ├── stores/         # 状态管理
│           ├── App.tsx
│           └── main.tsx
├── docs/                       # 文档
├── screenshots/                # 截图
├── .github/workflows/          # GitHub Actions CI/CD
├── electron.vite.config.ts     # electron-vite 配置
├── package.json
└── tsconfig.json
```

### 模块职责约定

- **主进程（main）**：仅处理窗口、托盘、文件系统、原生 API；不写业务逻辑。
- **预加载（preload）**：通过 `contextBridge` 暴露受控 API，保持上下文隔离。
- **渲染进程（renderer）**：所有 UI 与状态，通过 preload 暴露的接口与主进程通信，绝不直接 `require` Node 模块。
- **Python 后端**：所有 LLM 调用、文档解析、图谱操作集中在此；前端通过 HTTP 调用。

---

## 🎨 代码规范

### 通用约定

- 缩进：**2 个空格**（不使用 Tab）
- 换行符：**LF**
- 文件末尾保留一个空行
- 字符编码统一 **UTF-8**

### TypeScript / React（前端）

- 开启 **strict 严格模式**（已在 `tsconfig.json` 配置，提交前确保 `npm run build` 无报错）
- 使用函数组件 + Hooks，不写 class 组件
- 组件文件使用 **PascalCase**（如 `ChatPanel.tsx`）
- 变量/函数使用 **camelCase**，常量使用 **UPPER_SNAKE_CASE**，类型/接口使用 **PascalCase**
- 路径别名：使用 `@/` 指向 `src/renderer/`（已在 tsconfig 配置 `@/*`）
- 优先使用 TypeScript 类型推导，公共 API 必须显式标注返回类型
- 禁止使用 `any`，如确实无法避免需加注释说明原因
- IPC 调用统一通过 `services/` 层封装，组件不直接调用 `window.api`

### Python（后端）

- 遵循 PEP 8，行宽 **100** 字符
- 函数/变量使用 **snake_case**，类名使用 **PascalCase**
- 类型注解：所有公共函数必须标注参数与返回类型
- 异步优先：FastAPI 路由使用 `async def`，IO 密集操作避免阻塞事件循环
- 文档字符串：公共模块/类/函数使用 Google 风格 docstring
- 依赖管理：新增依赖需更新 `python/requirements.txt` 并说明用途

### Git 提交信息

采用 Conventional Commits 规范：

```
<type>(<scope>): <subject>

<body 可选>

<footer 可选>
```

**type 取值：**

| type | 含义 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `style` | 代码格式（不影响功能） |
| `refactor` | 重构（非新功能、非修 Bug） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建/工具/依赖变更 |
| `ci` | CI 配置 |

**示例：**

```
feat(live2d): 新增摸头后害羞表情
fix(rag): 修复大文件喂食后增量索引丢失的问题
docs(readme): 补充 FAQ 段落
```

---

## 🔀 提交 PR 流程

### 1. 创建分支

从最新的 main 创建特性分支，命名建议 feat/、fix/、docs/ 前缀：

```bash
# 同步上游
git checkout main
git pull upstream main

# 新建分支
git checkout -b feature/add-yawn-motion
```

### 2. 编写代码

- 控制改动范围，一个 PR 只做一件事
- 遵循上文代码规范
- 新增功能需补充必要说明

### 3. 本地验证

提交前务必通过以下检查：

```bash
# 前端类型检查 + 构建
npm run build

# 实际跑一遍开发模式，确认功能正常
npm run dev
```

### 4. 提交并推送

```bash
git add <相关文件>
git commit -m "feat(live2d): 新增摸头后害羞表情"
git push origin feature/add-yawn-motion
```

> 请勿使用 `git add .` 一次性暂存所有文件，避免误提交无关变更或本地配置文件。

### 5. 发起 Pull Request

在 GitHub 上发起 PR，目标分支 main，并在 PR 描述中包含：

- **改动说明**：做了什么、为什么
- **关联 Issue**：Closes #123（如有）
- **测试方式**：如何复现验证
- **截图/录屏**：UI 改动建议附图
- **影响范围**：是否影响现有功能

### 6. 代码评审

- 维护者会进行 Code Review，请耐心配合修改意见
- 每个 PR 至少需要一位维护者 approve 后方可合并
- 合并方式默认使用 **Squash Merge**，保持提交历史整洁

### PR 检查清单

- [ ] 本地 npm run build 通过
- [ ] 开发模式功能验证通过
- [ ] 提交信息符合 Conventional Commits 规范
- [ ] 没有提交无关文件、调试代码、`console.log`、本地配置
- [ ] PR 描述清晰，关联对应 Issue

---

## 🐛 报告 Bug 格式

提交 Bug 前请先在 Issues 列表中搜索是否已有相同问题，避免重复。确认无重复后，按以下模板新建 Issue：

### Bug 报告模板

```
**Bug 标题**：[简明描述问题，如：喂食 PDF 后记忆图谱不显示]

## 环境信息
- GraphPet 版本：v0.2.x（在「关于」中查看）
- 操作系统：Windows 11 / 10 / macOS xx / Linux xx
- 安装方式：安装版 / 便携版 / 源码运行
- Python 版本：（源码运行时填写，如 3.10.11）
- LLM 模式：国内免费 / 硅基流动 / DeepSeek / Ollama 等

## 复现步骤
1. 启动 GraphPet
2. 右键 Nito → 管理面板
3. 拖入一个 PDF 文件
4. ......

## 预期行为
喂食完成后，记忆图谱应显示新增的三元组节点。

## 实际行为
文件列表显示成功，但记忆图谱为空，控制台报错：
（在此粘贴关键报错日志）

## 截图 / 日志
（如有截图或完整日志请贴在这里，可使用代码块包裹）
```

### 报告要点

- 复现步骤要具体可操作：能让人按步骤重现问题
- 区分预期与实际：明确说明期望发生什么、实际发生了什么
- 提供环境信息：版本/系统/安装方式/LLM 模式会显著影响排查
- 附上日志：打开开发者工具（`Ctrl+Shift+I`）或查看后端控制台日志
- 不要只写「不能用」「报错了」等模糊描述

### 功能建议

功能建议同样欢迎，请用 `enhancement` 标签提交 Issue，说明：

- 场景：你希望在什么情况下使用这个功能
- 现状：当前 GraphPet 是怎么处理的（或完全缺失）
- 期望：你希望的行为

---

<div align="center">

再次感谢你的贡献！每一个 Issue、PR、Star 都让 Nito 更好 🐾

[⬆ 回到顶部](#-graphpet-贡献指南)

</div>
