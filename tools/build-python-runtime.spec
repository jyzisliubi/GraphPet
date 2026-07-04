# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec：把 Python 后端 + 依赖打包成独立运行时。

构建命令：
    python -m PyInstaller tools/build-python-runtime.spec --noconfirm \
        --distpath resources/python-runtime --workpath build/pyinstaller

产物：resources/python-runtime/python-runtime/python.exe（一个目录，含所有依赖）
electron-builder 会把 resources/python-runtime 复制到安装包的 resources/python-runtime/
主进程 src/main/index.ts 检测到该目录后优先使用内嵌 Python。

注意：
- 不打包 server.py（它在 python/ 目录里，作为 extraResources 单独复制）
- 不打包 sentence-transformers 模型权重（用户首次运行时联网下载到 userData）
- 不打包 Docling 模型权重（同上）
"""
import sys
from pathlib import Path

block_cipher = None

# 收集所有运行时需要的隐藏导入（sentence-transformers/docling 有大量动态导入）
hiddenimports = [
    'uvicorn.logging',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'fastapi',
    'pydantic',
    # sentence-transformers 动态导入
    'sentence_transformers',
    'transformers',
    'torch',
    # docling 动态导入
    'docling',
    'docling.document_converter',
    'docling.backend',
    # LightRAG
    'lightrag',
    'lightrag.llm',
    'lightrag.embeddings',
    # 网络
    'httpx',
    'requests',
    'urllib3',
    # 工具
    'networkx',
    'PyPDF2',
    'PIL',
]

# 用 Python 自己的运行时（不指定 entry_script，做出纯依赖目录）
# 入口脚本是一个空文件（生成在 build/ 下），仅为 PyInstaller 收集依赖用
runtime_root = Path(SPECPATH).parent
entry_stub = Path('_runtime_entry_stub.py')
if not entry_stub.exists():
    entry_stub.write_text('# PyInstaller entry stub for python-runtime bundle\n')

a = Analysis(
    [str(entry_stub)],
    pathex=[
        str(runtime_root / 'python'),
        str(runtime_root / 'python' / 'vendor'),
    ],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'notebook',
        'IPython',
        'pytest',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='python',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='python-runtime',
)
