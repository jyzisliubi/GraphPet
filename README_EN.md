<div align="center">

# 🐾 GraphPet

> **Feed your pet knowledge, it becomes who you feed it.**
>
> An AI desktop pet that *learns from your files* — drag-and-drop PDFs, docs, code, URLs, and watch Nito build a knowledge graph she can reason over.

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

**English** | [简体中文](README.md)

</div>

---

## ✨ Why GraphPet?

Most desktop pets just sit there looking cute. **Nito eats your knowledge** — drop a PDF, Word doc, code file, or URL on her, and she'll parse it (Docling), build a knowledge graph (LightRAG), and answer questions based on what she learned. The graph is visualized in real-time so you can *see* what she knows.

| 🌟 Zero-config | 📚 Knowledge-graph feeding | 🎀 Live2D Nito family |
|:---:|:---:|:---:|
| Built-in free LLM aggregator | PDF / Word / URL / Code → graph | 5 sister skins |
| No API key, no Ollama needed | Docling + LightRAG (HKU) | 21 motion groups |
| Works out of the box | d3-force visualization | Pet / poke / feed |

---

## 🖼 Preview

### 🎀 Five sisters

<div align="center">

<img src="screenshots/nito-pet-only.png" width="130" style="border-radius: 12px; margin: 6px;" />
<img src="screenshots/ni-j.png" width="130" style="border-radius: 12px; margin: 6px;" />
<img src="screenshots/nico.png" width="130" style="border-radius: 12px; margin: 6px;" />
<img src="screenshots/nietzsche.png" width="130" style="border-radius: 12px; margin: 6px;" />
<img src="screenshots/nipsilon.png" width="130" style="border-radius: 12px; margin: 6px;" />

> Nito / Ni-J / Nico / Nietzsche / Nipsilon — one-click skin switch, each with unique Live2D motions and expressions ✨

</div>

### 😆 Expressions

<div align="center">

<img src="screenshots/nito-angry.png" width="170" style="border-radius: 12px; margin: 8px;" />
<img src="screenshots/nito-cry.png" width="170" style="border-radius: 12px; margin: 8px;" />
<img src="screenshots/nito-sleepy.png" width="170" style="border-radius: 12px; margin: 8px;" />

Pet her, poke her, feed her files... 21 motion groups to unlock!

</div>

---

## 🚀 Quick Start

### Option 1: Download installer (recommended ⭐)

Grab the latest from [Releases](https://github.com/jyzisliubi/GraphPet/releases):

| Platform | File | Size |
|---|---|---|
| Windows | `GraphPet-Setup-x64.exe` | ~90MB |
| Windows | `GraphPet-portable.exe` | ~110MB |
| macOS | `GraphPet-x64.dmg` | ~100MB |
| Linux | `GraphPet-x86_64.AppImage` | ~95MB |

> On first launch, pick **"Free (zero-config)"** mode and you're ready to chat!

### Option 2: From source

```bash
git clone https://github.com/jyzisliubi/GraphPet.git
cd GraphPet

npm install

cd python && pip install -r requirements.txt && cd ..

npm run dev
```

### Option 3: Embedded Python full build (for release packagers)

Bundle Python runtime + all deps into the installer — **end users don't need Python installed**:

```bash
pip install pyinstaller
npm run build:python-runtime   # → resources/python-runtime/
npm run dist:full               # → release/GraphPet-Setup-x64.exe
```

---

## 💡 Features

### 🎀 Live2D Desktop Pet
- **Official Nito model** — Live2D Cubism 4, pink-haired mascot
- **5 sister skins** — Nito / Ni-J / Nico / Nietzsche / Nipsilon, one-click switch
- **21 motion groups** — happy, surprised, angry, yawning, sleeping...
- **Emotion-driven** — AI reply content auto-matches expressions
- **Interactive** — pet head, poke body, drag files to feed all trigger different reactions
- **Click-through** — never blocks your mouse, only responds when you interact

### 🚀 Zero-config LLM
- **Free mode** — built-in aggregator of free LLM APIs (Pollinations etc.), works out of the box
- **8+ providers** — DeepSeek / Zhipu / Kimi / SiliconFlow / OpenAI / Ollama / custom OpenAI-compatible
- **Auto-failover** — if one provider is down, switches to the next
- **Streaming SSE** — real-time token streaming, watch her think

### 📚 Knowledge-graph feeding (the killer feature)
- **Drag-and-drop** — drop files/URLs directly onto Nito
- **Docling parsing** — IBM Research's state-of-the-art for PDF/Word/HTML → Markdown
- **LightRAG graph** — HKU's EMNLP 2025 work for incremental entity/relation extraction
- **Incremental** — new files only insert new entities, no full rebuild
- **Per-file tracing** — every file's triples can be inspected or "spat out"
- **Multi-format** — PDF, Word, TXT, Markdown, code, webpages, images

### 💬 Smart Q&A
- **Casual chat** — even without files, Nito can chat normally
- **Knowledge Q&A** — answers grounded in your fed files with retrieval
- **Multi-turn** — context-aware, conversations don't reset
- **Hybrid retrieval** — Local / Global / Hybrid search strategies

### 📊 Management panel
Right-click Nito → "Management panel":
- **📊 Memory graph** — d3-force SVG visualization, drag/search/zoom
- **📁 File list** — every fed file with triple details
- **📈 Growth** — intelligence level / intimacy / personality attributes
- **⏰ Timeline** — complete interaction history
- **💬 Deep chat** — full chat interface

---

## 🛠 Tech Stack

| Layer | Tech | Version | Note |
|---|---|---|---|
| Desktop | **Electron** | 31+ | Cross-platform shell |
| UI | **React + TypeScript** | 18 / 5.5 | Type-safe components |
| 2D render | **PIXI.js + pixi-live2d-display** | 6.5 | Live2D Cubism 4 |
| Build | **electron-vite** | 2.3 | Fast HMR |
| Backend | **Python + FastAPI** | 3.10+ | Async API |
| Doc parse | **Docling** | 2.0+ | IBM Research |
| KG-RAG | **LightRAG** | 1.5+ | HKU EMNLP 2025 |
| Embedding | **fastembed** | 0.3+ | BGE-small-zh via ONNX (no torch) |
| LLM | **FreeLLM Router** | — | Built-in free aggregator |

---

## 🗺 Roadmap

### v0.3.x — v0.3.9 Current ✅
- ✅ Live2D pet (5 sisters, 21 motions, pet/poke/feed)
- ✅ Zero-config free LLM aggregator (8+ providers, auto-failover)
- ✅ Knowledge-graph feeding (Docling + LightRAG incremental)
- ✅ Smart Q&A (Local / Global / Hybrid retrieval)
- ✅ Management panel (graph / files / growth / timeline / chat)
- ✅ Multi-format files (PDF / Word / TXT / Markdown / code / URL / image)
- ✅ TTS voice + Live2D lip-sync (edge-tts)
- ✅ STT voice input (Web Speech API)
- ✅ Pet walks freely on desktop (auto-patrol every 8-20s)
- ✅ Cross-platform CI (Windows / macOS / Linux)
- ✅ Embedded Python packaging (PyInstaller + electron-builder)
- ✅ d3-force graph visualization (replaces hand-rolled layout)
- ✅ fastembed replaces sentence-transformers (no more Windows segfault)
- ✅ **Auto life-like** (v0.3.3) — auto blink / look at / idle eye movement
- ✅ **Inner thought bubbles** (v0.3.3) — 90-180s random cloud bubbles
- ✅ **Screenshot feeding** (v0.3.3) — Nito sees your screen via desktopCapturer
- ✅ **Mood/behavior state machine** (v0.3.4) — 7 moods drive motions, reactions, inner monologue
- ✅ **P0/P1 bug fixes** (v0.3.6) — type alignment / PIXI namespace / AudioContext singleton / single-instance lock
- ✅ **Community files** (v0.3.6) — Issue/PR templates / CODEOWNERS / CoC / CHANGELOG
- ✅ **Config import/export** (v0.3.7) — JSON one-click migration
- ✅ **Global hotkey Ctrl+Shift+G** (v0.3.7) — toggle pet from any app
- ✅ **Custom Live2D model import** (v0.3.8) — Cubism 2/4 dual format
- ✅ **Theme switching** (v0.3.9) — dark / light / auto (follow system)
- ✅ **Enhanced tray menu** (v0.3.9) — chat window / walk toggle / quiet mode / about
- ✅ **Multi-monitor** (v0.3.9) — pet remembers position, walks on current display

### v0.4.0 — TTS Matrix + Screen Awareness + i18n 🎉

- ✅ **Multi-TTS engine** — Edge TTS (online free) + Piper TTS (local offline, privacy-friendly)
- ✅ **Screen awareness** — auto-hide pet when fullscreen app (game/video) detected, restore on exit
- ✅ **i18n** — Chinese/English bilingual switching, lightweight zero-dependency i18n
- ✅ **14 P1 bug fixes** — drag failure / feed toast / STT leak / Cubism 4 expression / TTS node leak / path traversal / multi-monitor screenshot / ThreadPool shutdown / future cancel
- ✅ **5 P2 UX fixes** — scroll hijack / Escape in textarea / duplicate listener / duplicate welcome / restorePetTop race
- ✅ **5 P3 perf fixes** — ThreadPool split / SettingsPanel unsaved confirm / settingsStore race / graphml cache / MemoryGraph RAF

### v0.4.x — Planned 🚧
- 🚧 Whisper STT — replace Web Speech API for better Chinese
- 🚧 Live2D drag physics — body follows drag, inertia bounce
- 🚧 Plugin system foundation

### v0.5.x — Future 🔮
- 🔮 Multi-pet coexistence (raise several pets with different personalities)
- 🔮 Plugin system (third-party motions / skins / skills)
- 🔮 Knowledge-graph sharing (pets exchange graphs, community-curated)

---

## 🤝 Contributing

PRs and Issues welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

1. Fork → `git checkout -b feature/AmazingFeature`
2. Commit → `git commit -m 'Add AmazingFeature'`
3. Push → `git push origin feature/AmazingFeature`
4. Open a Pull Request

---

## ❓ FAQ

<details>
<summary><b>"Python not found" on startup?</b></summary>

GraphPet's backend needs Python 3.10+. Install from [python.org](https://www.python.org/downloads/) and check **"Add Python to PATH"**. Verify with `python --version`. For source builds, also run `pip install -r python/requirements.txt`.
</details>

<details>
<summary><b>Why is the free LLM slow or failing sometimes?</b></summary>

Free mode aggregates public free APIs (Pollinations etc.) — no QPS guarantee, peaks can be slow. For stable fast responses, switch to a provider with an API key (DeepSeek / Zhipu / SiliconFlow all have free tiers).
</details>

<details>
<summary><b>Which file formats are supported?</b></summary>

PDF, Word (.docx), TXT, Markdown, code, webpages (URL), images. Not supported: legacy .doc, scanned PDFs (need OCR), encrypted files.
</details>

<details>
<summary><b>Where is my data stored? Can I move it to another computer?</b></summary>

Data lives under the user data directory (Windows: `%APPDATA%/graphpet/`). Copy the whole folder to migrate. Or re-feed the original files to rebuild the graph.
</details>

<details>
<summary><b>How do I switch LLM provider?</b></summary>

Right-click Nito → "Management panel" → "Settings". Pick a provider and enter your API key. Local Ollama also works — just enter `http://localhost:11434`. Changes apply immediately, no restart needed.
</details>

---

## 📄 License

[MIT](LICENSE) — fork, modify, share.

---

## 🙏 Acknowledgements

- [Live2D](https://www.live2d.com/) — official Nito model
- [LightRAG](https://github.com/HKUDS/LightRAG) — HKU knowledge-graph RAG
- [Docling](https://github.com/docling-project/docling) — IBM document parsing
- [Ollama](https://ollama.com/) — local LLM runtime
- [Pollinations AI](https://pollinations.ai) — free AI API
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) — Live2D WebGL
- [fastembed](https://github.com/qdrant/fastembed) — lightweight ONNX embeddings
- [d3-force](https://github.com/d3/d3-force) — force-directed graph layout

---

<div align="center">

**If you like this project, please ⭐ Star it!**

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
