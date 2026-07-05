# Changelog

本项目变更记录遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- 自定义 Live2D 模型导入：用户可导入任意 .model3.json/.model.json 模型，复制到 userData/imported-models 持久化
- 配置导入/导出：SettingsPanel 新增 📥导入/📤导出 按钮，支持 JSON 配置文件迁移
- 全局热键 Ctrl+Shift+G (macOS Cmd+Shift+G) 切换宠物窗口显示
- 心情/行为状态系统：mood 持久化 + 互动事件驱动 + 自动衰减 + 内心独白按心情分组
- Profile 面板新增心情/行为状态卡片（跨 window 同步）
- 启动时根据持久化 mood 选择欢迎动作 + 文案
- 点击反应按 7 种心情分组

### Fixed
- P0: `LlmProvider` 类型联合与 SettingsPanel 下拉选项对齐（扩展为 12 个值）
- P0: Live2DCanvas `window.PIXI` 改为赋值 PIXI 命名空间（原误赋 Application 类）
- P0: ChatPanel 历史消息 role 不再映射成 'nito'，直接传 'assistant' 给后端
- P1: preload 补齐 `petWalkTo` IPC 桥接
- P1: walkToTarget 多次调用导致多个 setInterval 并发驱动 setPosition 抖动
- P1: 单实例锁失败时静默忽略导致多实例抢占 Python 端口
- P1: 拖拽文件 `file.path` 废弃，改用 `webUtils.getPathForFile`
- P1: ttsService 每次说话 new AudioContext，复用单例避免 6 个上限泄漏
- P1: Python `_call_llm_chat._fail_cooldown` 用函数属性存储改为 threading.Lock 保护
- P2: chatStore 两个 useState 各自调用 loadConversations 重复读 localStorage

### Changed
- 单实例锁生产环境失败时 app.quit()，已获锁实例监听 second-instance 唤起主窗口
- SkinPicker 重构：新增「已导入模型」分区 + 删除按钮，UI 卡片从 260×320 扩展为 320×460

## [0.3.7] - 2026-07-05

### Added
- 配置导入/导出（SettingsPanel JSON 文件）
- 全局热键 Ctrl+Shift+G

## [0.3.6] - 2026-07-05

### Added
- 社区文件：ISSUE_TEMPLATE / PR_TEMPLATE / CODEOWNERS / FUNDING / CODE_OF_CONDUCT / CHANGELOG
- 修复 3 个 P0 + 6 个 P1 关键 bug（详见 Fixed 段落）

## [0.3.5] - 2026-07-05

### Added
- GitHub Actions 升级到 v5（checkout@v5, setup-node@v5, setup-python@v6）

## [0.3.4] - 2026-07-05

### Added
- 心情/行为状态系统（usePetState hook）
- useIdleThoughts 按 mood 分组
- Live2DCanvas mood-driven idle motion

## [0.3.3] - 2026-07-04

### Added
- Live2D 自动生命感（auto blink / look at / idle eye movement）
- 内心想法气泡（90-180s 随机云朵气泡）
- 截屏喂食（desktopCapturer → RAG 图谱）
- 情绪映射修复（LLM emotion 字段透传到 Live2D 表情）

## [0.3.2] - 2026-07-03

### Added
- 跨平台 CI（Windows / macOS / Linux 三平台 release）
- VAD 语音打断
- fastembed 替换 sentence-transformers + torch（解决 Windows segfault）
- 英文 README

## [0.3.1] - 2026-07-02

### Added
- d3-force 力导向图谱可视化
- 自由走动（8-20s 巡逻）

## [0.3.0] - 2026-07-01

### Added
- 首次发布：Live2D 五姐妹皮肤、知识图谱 RAG、喂文件学习、TTS、STT
- 零配置免费 LLM 聚合（8+ 服务商自动故障转移）
- 管理面板（记忆图谱 / 文件列表 / 成长记录 / 时间线 / 深度对话）
