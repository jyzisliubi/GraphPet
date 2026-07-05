"""GraphPet RAG 桥接模块（Docling + LightRAG）。

替换原 rice_rag_bridge，提供统一的文档解析 + 知识图谱 + 问答能力：
  - 文档解析：Docling（PDF / Word / 网页 URL → Markdown），解决复杂文档
    （布局 / 表格 / 公式）解析不到内容的问题。
  - 知识图谱：LightRAG（港大 HKU，EMNLP 2025），原生增量插入 ainsert +
    图谱+向量双层检索 aquery，Ollama 作为 LLM / Embedding 后端。
  - 闲聊：直接调 Ollama 客户端，不走图谱。

设计要点：
  1. LightRAG 是异步库，本模块在后台 daemon 线程跑持久 event loop，
     通过 asyncio.run_coroutine_threadsafe 暴露同步接口供 FastAPI 调用，
     避免 server.py 同步函数里直接 await。
  2. LightRAG 实例 + Docling DocumentConverter 均为模块级单例，懒加载 + 锁，
     保证多线程下只初始化一次（LightRAG initialize_storages 只能调一次）。
  3. 知识图谱统计 / 三元组列表通过读 working_dir/graph_chunk_entity_relation.graphml
     （networkx）实现，无需 LightRAG 在线 API。
  4. 文件级三元组仍由 graphpet_core.memory.save_file_triples 管理；
     file_sources.json（fingerprint→filename）保留在本模块。

存储目录：
  WORKING_DIR 默认 d:\\GraphPet\\graphpet_kg\\，存放 LightRAG 的 7 个数据文件
  + graphpet 自己的 file_sources.json。
"""

from __future__ import annotations

import os
import sys
import json
import asyncio
import threading
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Union
from functools import partial

# ========================
# 全局配置（可通过 update_llm_config 热更新）
# ========================

WORKING_DIR = os.environ.get(
    "GRAPHPET_KG_DIR",
    r"d:\GraphPet\graphpet_kg"
)
os.makedirs(WORKING_DIR, exist_ok=True)

LLM_PROVIDER: str = "freellm"
LLM_API_BASE: str = "http://localhost:11434"
LLM_MODEL: str = "auto"
LLM_API_KEY: str = ""

EMBED_MODEL_NAME: str = "BAAI/bge-small-zh-v1.5"
EMBED_DIM: int = 512


def get_llm_config() -> Dict[str, str]:
    return {
        "provider": LLM_PROVIDER,
        "api_base": LLM_API_BASE,
        "model": LLM_MODEL,
        "api_key": LLM_API_KEY,
    }


def update_llm_config(
    provider=None,
    api_base=None,
    model=None,
    api_key=None,
):
    global LLM_PROVIDER, LLM_API_BASE, LLM_MODEL, LLM_API_KEY, _rag_instance
    if provider is not None:
        LLM_PROVIDER = provider.strip()
    if api_base is not None:
        LLM_API_BASE = api_base.strip()
    if model is not None:
        LLM_MODEL = model.strip()
    if api_key is not None:
        LLM_API_KEY = api_key.strip()
    _rag_instance = None


def _customize_lightrag_prompts():
    """覆盖 LightRAG 的 PROMPTS 字典，使用中文提示词以提升三元组抽取质量。

    针对 qwen2.5:7b 参数量身定制：
    - 要求关系关键词为 2-6 字简短中文谓词
    - 实体名使用原文原始表述，禁止缩写或篡改
    - 所有输出（实体名、关键词、描述）均为中文
    """
    from lightrag.prompt import PROMPTS

    PROMPTS["entity_extraction_json_system_prompt"] = """---角色---
你是一位知识图谱专家，负责从`---输入文本---`部分精确抽取实体和关系。

---指令---
1. **实体抽取**：
  - 仅从输入文本中识别明确、有意义的实体。
  - 每个实体抽取以下信息：
    - `name`：实体名称。使用文本中的原始表述，保持原名拼写和大小写，禁止缩写或改写（如不要把GraphPet写成GrPet，不要把Ollama写成ollaMA）。
    - `type`：从下面`---实体类型---`列表中选择最合适的类型；若无匹配则填`其他`。
    - `description`：基于文本内容，简洁全面地描述该实体的属性和活动，用第三人称。

2. **关系抽取（最重要）**：
  - 识别已抽取实体之间直接的、明确的、有意义的关系。
  - 每条关系抽取以下字段：
    - `source`：源实体名称，必须与 entities 列表中某个实体的 name 完全一致。
    - `target`：目标实体名称，必须与 entities 列表中某个实体的 name 完全一致。
    - `keywords`：**2-6个汉字的简短中文关系谓词**，概括关系本质。例如：使用、开发、位于、包含、属于、成立、发布、支持、生产、创立、任职于、毕业于、合作、提供、采用、基于、依赖、是、有、制作。**禁止**使用完整英文句子或长描述。词与词之间用英文逗号分隔。
    - `description`：一句话简要解释 source 和 target 之间关系的性质和依据。

3. **关系方向（极其重要！）**：
  - **source 必须是关系的主体（施动者/拥有者/起点），target 必须是关系的客体（受动者/被拥有者/终点）**。
  - 关系方向错误会严重破坏知识图谱质量，请务必仔细检查！
  - ✅ 正确示例：`source: "Python", target: "NumPy", keywords: "第三方库为"`（不对，应该是"Python"的第三方库是"NumPy" → source=Python, target=NumPy, keywords=包含/拥有第三方库）
  - ✅ 正确方向：`source: "李白", target: "《将进酒》", keywords: "创作"`（李白创作了将进酒）
  - ✅ 正确方向：`source: "莫扎特", target: "古典音乐", keywords: "属于" / "创作风格为"`（莫扎特属于/创作古典音乐）
  - ❌ 错误方向：`source: "古典音乐", target: "莫扎特", keywords: "属于"`（这是错的！不是古典音乐属于莫扎特，而是莫扎特属于古典音乐领域）
  - **判断标准：把 source 和 keywords 组合成一句话应该通顺**，如"李白 创作 《将进酒》"通顺，而"《将进酒》 创作 李白"不通顺。
  - keywords 必须是从 source 指向 target 的谓词，方向不能反。
  - 避免输出重复关系（source→target 同一关系只输出一次）。

4. **输出限制**：
  - 本次输出总共不超过 {max_total_records} 条记录（实体+关系）。
  - 本次输出实体不超过 {max_entity_records} 个。
  - 如果高质量条目较少，输出更少即可，不要凑数。
  - 只输出 source 和 target 都在本次 entities 列表中的关系。

5. **语言规范**：
  - 所有输出（实体名、关键词、描述）必须使用 {language}。
  - 专有名词（人名、地名、组织名、产品名、技术名等）保留原文不翻译。
  - 实体名中的英文保持原文正确拼写，**禁止单词连写**（如不要把 LightRAG is a framework 写成 LightRAGisaframework），单词之间必须有空格。
  - 禁止使用代词（如"本文"、"该公司"、"他"、"它"），必须明确写出主体名称。

6. **JSON格式要求**：
  - 返回一个合法的JSON对象，仅包含`entities`和`relationships`两个数组。
  - 所有字符串值必须正确转义。
  - 到达数量限制后立即停止添加新条目。

---实体类型---
{entity_types_guidance}

---输出格式模板（仅供参考，不是源文本）---
{examples}
"""

    PROMPTS["entity_extraction_json_user_prompt"] = """---任务---
从下面的`---输入文本---`部分抽取实体和关系。

---指令---
1. 输出必须是合法JSON，包含entities和relationships数组，JSON前后不要有任何其他文字、解释或markdown标记。
2. 本次输出不超过{max_total_records}条记录，实体不超过{max_entity_records}个。
3. 输出语言为{language}。专有名词保持原文。
4. **关系keywords必须是2-6字的简短中文谓词，禁止长句或英文句子**。

---实体类型---
{entity_types_guidance}

{heading_context_block}---输入文本---
```
{input_text}
```

---输出---
"""

    PROMPTS["entity_continue_extraction_json_user_prompt"] = """---任务---
基于上一次抽取，请识别并补充`---输入文本---`中**遗漏或描述不正确**的实体和关系。

---指令---
1. **不要重复输出**上次已正确抽取的实体和关系。
2. 遗漏的请补充，描述错误的请重新输出修正版。
3. 输出必须是合法JSON，包含entities和relationships数组，前后不要有其他文字。
4. 本次补充输出不超过{max_total_records}条，实体不超过{max_entity_records}个。
5. 输出语言为{language}。专有名词保持原文。
6. **关系keywords必须是2-6字的简短中文谓词**。
7. 如果没有遗漏或需要修正的内容，输出：{{"entities": [], "relationships": []}}

---输出---
"""

    PROMPTS["entity_extraction_json_examples"] = [
        """{{
  "entities": [
    {{"name": "GraphPet", "type": "作品", "description": "一款基于知识图谱的桌面宠物应用"}},
    {{"name": "Nito", "type": "人物", "description": "GraphPet的默认宠物角色，可爱的小精灵形象"}},
    {{"name": "Electron", "type": "技术", "description": "GraphPet使用的桌面应用开发框架"}},
    {{"name": "Python", "type": "技术", "description": "GraphPet后端使用的编程语言"}},
    {{"name": "LightRAG", "type": "技术", "description": "用于知识图谱构建和查询的框架"}}
  ],
  "relationships": [
    {{"source": "GraphPet", "target": "Nito", "keywords": "角色为", "description": "Nito是GraphPet的默认宠物角色"}},
    {{"source": "GraphPet", "target": "Electron", "keywords": "使用", "description": "GraphPet使用Electron作为桌面开发框架"}},
    {{"source": "GraphPet", "target": "Python", "keywords": "后端使用", "description": "GraphPet后端采用Python语言开发"}},
    {{"source": "GraphPet", "target": "LightRAG", "keywords": "采用", "description": "GraphPet使用LightRAG框架构建知识图谱"}}
  ]
}}""",
        """{{
  "entities": [
    {{"name": "李白", "type": "人物", "description": "唐代著名诗人，字太白，号青莲居士，被称为诗仙"}},
    {{"name": "杜甫", "type": "人物", "description": "唐代伟大诗人，字子美，号少陵野老，被称为诗圣"}},
    {{"name": "唐代", "type": "时间", "description": "中国历史上的一个朝代，公元618-907年"}},
    {{"name": "洛阳", "type": "地点", "description": "李白和杜甫相遇的城市"}},
    {{"name": "《将进酒》", "type": "作品", "description": "李白创作的经典诗作"}}
  ],
  "relationships": [
    {{"source": "李白", "target": "唐代", "keywords": "生活于", "description": "李白是唐代的诗人"}},
    {{"source": "李白", "target": "《将进酒》", "keywords": "创作", "description": "李白创作了《将进酒》这首诗"}},
    {{"source": "李白", "target": "杜甫", "keywords": "好友", "description": "李白和杜甫是好友，两人曾在洛阳相遇"}},
    {{"source": "杜甫", "target": "唐代", "keywords": "生活于", "description": "杜甫是唐代的诗人"}},
    {{"source": "李白", "target": "洛阳", "keywords": "相遇于", "description": "李白与杜甫在洛阳相遇"}}
  ]
}}""",
        """{{
  "entities": [
    {{"name": "莫扎特", "type": "人物", "description": "奥地利古典主义作曲家，维也纳古典乐派代表人物之一"}},
    {{"name": "古典音乐", "type": "概念", "description": "西方古典音乐艺术流派，18世纪形成于欧洲"}},
    {{"name": "《费加罗的婚礼》", "type": "作品", "description": "莫扎特创作的著名歌剧"}}
  ],
  "relationships": [
    {{"source": "莫扎特", "target": "古典音乐", "keywords": "创作风格为", "description": "莫扎特是古典音乐的重要作曲家"}},
    {{"source": "莫扎特", "target": "《费加罗的婚礼》", "keywords": "创作", "description": "莫扎特创作了歌剧《费加罗的婚礼》"}}
  ]
}}""",
    ]

    PROMPTS["default_entity_types_guidance"] = (
        "- 人物（Person）：人名、角色名\n"
        "- 组织（Organization）：公司、学校、团队、机构、乐队\n"
        "- 地点（Location）：地名、地址、地理位置、城市、国家\n"
        "- 时间（Time）：朝代、年份、日期、历史时期\n"
        "- 技术（Technology）：技术名词、框架、编程语言、工具、算法、产品型号\n"
        "- 概念（Concept）：抽象概念、方法论、术语、学科、艺术流派\n"
        "- 作品（Work）：书籍、文章、音乐、画作、论文、诗歌、产品\n"
        "- 其他（Other）：不属于以上类别的实体"
    )

class RagNotAvailableError(RuntimeError):
    pass


RiceRagNotAvailableError = RagNotAvailableError


_bg_loop = None
_bg_loop_lock = threading.Lock()


def _get_bg_loop():
    global _bg_loop
    if _bg_loop is not None and _bg_loop.is_running():
        return _bg_loop
    with _bg_loop_lock:
        if _bg_loop is not None and _bg_loop.is_running():
            return _bg_loop
        loop = asyncio.new_event_loop()
        def _run():
            asyncio.set_event_loop(loop)
            loop.run_forever()
        t = threading.Thread(target=_run, daemon=True, name="lightrag-loop")
        t.start()
        _bg_loop = loop
        return _bg_loop


def _run_async(coro, timeout=600):
    loop = _get_bg_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=timeout)


_rag_instance = None
_rag_lock = threading.Lock()
_st_model = None
_st_lock = threading.Lock()


def _get_st_model():
    """获取 fastembed 模型（轻量级，纯 onnxruntime，无 torch 依赖）。

    BUG-3 终极修复：sentence-transformers + torch 2.7 + CUDA 在 uvicorn 多线程
    下加载会触发 0xC0000005 segfault（Windows only，进程级崩溃无法捕获）。
    fastembed 用纯 onnxruntime，加载快且稳定，模型自动从 HuggingFace 下载缓存。
    """
    global _st_model
    if _st_model is not None:
        return _st_model
    with _st_lock:
        if _st_model is not None:
            return _st_model
        try:
            from fastembed import TextEmbedding
        except ImportError as e:
            raise RagNotAvailableError(f"fastembed not installed: {e}") from e
        try:
            _st_model = TextEmbedding(EMBED_MODEL_NAME)
            # 触发模型加载 + 一次预热
            _ = list(_st_model.embed(["warmup"]))
            print(f"[GraphPet] fastembed model loaded: {EMBED_MODEL_NAME}", flush=True)
            return _st_model
        except Exception as e:
            raise RagNotAvailableError(f"Failed to load fastembed: {type(e).__name__}: {e}") from e


async def _st_embed_async(texts):
    import asyncio as _a
    import numpy as _np
    model = _get_st_model()
    loop = _a.get_event_loop()
    def _embed():
        # fastembed 返回 generator，转 numpy array
        return _np.array(list(model.embed(texts)))
    return await loop.run_in_executor(None, _embed)


def warmup_embedding():
    """预热 sentence-transformers 模型 + LightRAG 初始化。

    在后端启动时后台调用，避免首次 chat/feed 调用时 C 扩展加载导致 segfault。
    失败不抛异常，让实际调用时再尝试。
    """
    try:
        _get_st_model()
        # 主动 init_rag 触发 LightRAG 初始化（加载 graphml + KV store）
        init_rag()
        print("[GraphPet] warmup: ST 模型 + LightRAG 初始化完成", flush=True)
    except Exception as e:
        print(f"[GraphPet] warmup 跳过: {type(e).__name__}: {e}", file=sys.stderr, flush=True)


async def openai_compatible_model_complete(prompt, system_prompt=None, history_messages=[], **kwargs):
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    if history_messages:
        messages.extend(history_messages)
    messages.append({"role": "user", "content": prompt})
    temperature = kwargs.get("temperature", 0.7)
    max_tokens = kwargs.get("max_tokens", 1024)
    timeout = kwargs.get("timeout", 30)
    url = f"{LLM_API_BASE}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "GraphPet/1.0",
    }
    # 免Key的provider（如Pollinations）需要Referer头
    if "pollinations" in LLM_API_BASE.lower():
        headers["Referer"] = "https://pollinations.ai"
    if LLM_API_KEY:
        headers["Authorization"] = f"Bearer {LLM_API_KEY}"
    body = {"model": LLM_MODEL, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))["choices"][0]["message"]["content"]
    except Exception as e:
        raise RuntimeError(f"OpenAI API call failed: {type(e).__name__}: {e}") from e


def init_rag(force: bool = False):
    """初始化 LightRAG 实例（懒加载，线程安全）。

    在后台 loop 里创建 LightRAG 并调用 initialize_storages（1.5.x 必须调一次）。
    - LLM 根据 LLM_PROVIDER 选择：ollama 或 openai_compatible
    - Embedding 用 sentence-transformers（BGE-small-zh-v1.5，已缓存）

    失败抛 RagNotAvailableError，调用方捕获后返回友好错误。

    Returns:
        LightRAG 实例
    """
    global _rag_instance
    if _rag_instance is not None and not force:
        return _rag_instance
    with _rag_lock:
        if _rag_instance is not None and not force:
            return _rag_instance
        try:
            from lightrag import LightRAG  # noqa: F401
            from lightrag.utils import EmbeddingFunc
        except ImportError as e:
            raise RagNotAvailableError(
                f"LightRAG 未安装: {e}。请运行 pip install lightrag-hku"
            ) from e

        if LLM_PROVIDER == "ollama":
            try:
                from lightrag.llm.ollama import ollama_model_complete
            except ImportError as e:
                raise RagNotAvailableError(
                    f"Ollama 支持未安装: {e}。请运行 pip install ollama"
                ) from e
            llm_model_func = ollama_model_complete
            llm_model_kwargs = {
                "host": LLM_API_BASE,
                "options": {
                    "num_ctx": 8192,
                    "keep_alive": "30m",
                    "temperature": 0.3,
                    "repeat_penalty": 1.1,
                    "top_p": 0.9,
                },
                "timeout": 1200,
            }
        elif LLM_PROVIDER == "freellm":
            from free_llm_router import free_llm_model_complete
            llm_model_func = free_llm_model_complete
            llm_model_kwargs = {
                "temperature": 0.3,
                "max_tokens": 2048,
            }
        else:
            llm_model_func = openai_compatible_model_complete
            llm_model_kwargs = {
                "timeout": 120,
            }

        _get_st_model()

        embedding_func = EmbeddingFunc(
            embedding_dim=EMBED_DIM,
            max_token_size=512,
            func=_st_embed_async,
        )

        async def _init():
            _customize_lightrag_prompts()
            rag = LightRAG(
                working_dir=WORKING_DIR,
                llm_model_func=llm_model_func,
                llm_model_name=LLM_MODEL,
                llm_model_kwargs=llm_model_kwargs,
                embedding_func=embedding_func,
                chunk_token_size=800,
                entity_extract_max_gleaning=0,
                llm_model_max_async=1,
                default_llm_timeout=1200,
                max_parallel_insert=1,
                entity_extraction_use_json=True,
                addon_params={
                    "language": "Simplified Chinese",
                },
            )
            await rag.initialize_storages()
            return rag

        try:
            _rag_instance = _run_async(_init(), timeout=180)
            print(
                f"[GraphPet] LightRAG 初始化成功，working_dir={WORKING_DIR}",
                flush=True,
            )
            # P1-D：初始化后自动清理卡住的 doc_status（崩溃/超时残留的 processing 状态）
            try:
                cleaned = cleanup_stale_doc_status()
                if cleaned > 0:
                    print(f"[GraphPet] 自动清理 {cleaned} 个卡住的文档状态", flush=True)
            except Exception as e:
                print(f"[GraphPet] doc_status 清理失败（非致命）: {e}", file=sys.stderr, flush=True)
            return _rag_instance
        except Exception as e:
            raise RagNotAvailableError(
                f"LightRAG 初始化失败: {type(e).__name__}: {e}"
            ) from e


# 向后兼容：旧代码调 init_rice_rag
def init_rice_rag(force: bool = False):
    """Deprecated: 用 init_rag() 替代。保留别名向后兼容。"""
    return init_rag(force)


def is_available() -> bool:
    """快速检查 RAG 是否可用（不抛异常）。"""
    try:
        init_rag()
        return True
    except RagNotAvailableError:
        return False


# ========================
# 单例：Docling DocumentConverter
# ========================

_docling_converter = None
_docling_lock = threading.Lock()


def _get_docling_converter():
    """懒加载 Docling DocumentConverter（CPU 轻量模式）。"""
    global _docling_converter
    if _docling_converter is not None:
        return _docling_converter
    with _docling_lock:
        if _docling_converter is not None:
            return _docling_converter
        try:
            from docling.document_converter import (
                DocumentConverter,
                PdfFormatOption,
                WordFormatOption,
                HTMLFormatOption,
                ImageFormatOption,
            )
            from docling.datamodel.base_models import InputFormat
            from docling.datamodel.accelerator_options import (
                AcceleratorDevice,
                AcceleratorOptions,
            )
            from docling.datamodel.pipeline_options import (
                PdfPipelineOptions,
            )
        except ImportError as e:
            raise RagNotAvailableError(
                f"Docling 未安装: {e}。请运行 pip install docling"
            ) from e

        # CPU 轻量配置：关闭 OCR / 图片描述 / 表格结构（表格识别依赖 cv2，多环境冲突时会报错）
        pipeline_options = PdfPipelineOptions()
        pipeline_options.accelerator_options = AcceleratorOptions(
            num_threads=4, device=AcceleratorDevice.CPU
        )
        pipeline_options.do_ocr = False
        pipeline_options.do_table_structure = False
        pipeline_options.generate_page_images = False
        pipeline_options.do_picture_classification = False
        pipeline_options.do_picture_description = False

        _docling_converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
                InputFormat.DOCX: WordFormatOption(),
                InputFormat.HTML: HTMLFormatOption(),
                InputFormat.IMAGE: ImageFormatOption(pipeline_options=pipeline_options),
            }
        )
        return _docling_converter


# ========================
# LLM 可用性检查 + 闲聊
# ========================


def has_llm() -> bool:
    """检查 LLM 服务是否可用。

    喂食（抽取三元组）和问答（生成回答）都依赖 LLM，启动检查用此函数。
    根据当前 LLM_PROVIDER 选择不同的检查方式。
    """
    if LLM_PROVIDER == "freellm":
        try:
            from free_llm_router import get_router
            router = get_router()
            providers = router._get_available_providers()
            return len(providers) > 0
        except Exception:
            return True
    if LLM_PROVIDER == "ollama":
        try:
            import ollama
            client = ollama.Client(host=LLM_API_BASE)
            client.list()
            return True
        except Exception:
            return False
    else:
        try:
            url = f"{LLM_API_BASE}/chat/completions"
            headers = {"Content-Type": "application/json"}
            if LLM_API_KEY:
                headers["Authorization"] = f"Bearer {LLM_API_KEY}"
            body = {
                "model": LLM_MODEL,
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 1,
            }
            data = json.dumps(body).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                json.loads(resp.read().decode("utf-8"))
            return True
        except Exception:
            return False


def get_llm_status() -> Dict[str, Any]:
    """获取当前 LLM 服务状态。

    Returns:
        {
          "provider": str,           # 当前 LLM 服务商
          "running": bool,           # 服务是否可用
          "api_base": str,           # API 地址
          "model": str,              # 当前配置的模型
          "error": Optional[str],    # 连接失败时的错误信息
          # ollama 模式额外字段：
          "models": List[str],       # 已安装的模型名列表
          "has_required_model": bool,# 是否已安装当前配置的模型
        }
    """
    base_status = {
        "provider": LLM_PROVIDER,
        "running": False,
        "api_base": LLM_API_BASE,
        "model": LLM_MODEL,
        "error": None,
    }

    if LLM_PROVIDER == "ollama":
        try:
            import ollama
            client = ollama.Client(host=LLM_API_BASE)
            resp = client.list()
            models: List[str] = []
            raw_models = []
            if hasattr(resp, "models"):
                raw_models = resp.models or []
            elif isinstance(resp, dict):
                raw_models = resp.get("models", [])
            for m in raw_models:
                name = ""
                if hasattr(m, "model"):
                    name = getattr(m, "model", "") or ""
                elif isinstance(m, dict):
                    name = m.get("model") or m.get("name") or ""
                elif isinstance(m, str):
                    name = m
                if name:
                    models.append(str(name))
            has_required = any(
                m == LLM_MODEL or m.startswith(LLM_MODEL + ":")
                for m in models
            )
            base_status.update({
                "running": True,
                "host": LLM_API_BASE,
                "models": models,
                "has_required_model": has_required,
                "required_model": LLM_MODEL,
            })
            return base_status
        except Exception as e:
            base_status.update({
                "host": LLM_API_BASE,
                "models": [],
                "has_required_model": False,
                "required_model": LLM_MODEL,
                "error": f"{type(e).__name__}: {e}",
            })
            return base_status
    else:
        try:
            import asyncio
            loop = _get_bg_loop()
            future = asyncio.run_coroutine_threadsafe(
                openai_compatible_model_complete(
                    "hi",
                    system_prompt="You are a helpful assistant.",
                    history_messages=[],
                    max_tokens=1,
                    timeout=10,
                ),
                loop,
            )
            future.result(timeout=15)
            base_status["running"] = True
            return base_status
        except Exception as e:
            base_status["error"] = f"{type(e).__name__}: {e}"
            return base_status


get_ollama_status = get_llm_status


def pull_model_stream(model_name: str, emit=None) -> bool:
    """拉取 Ollama 模型，流式推送进度（P0-D：一键 pull）。

    Ollama 的 pull 是同步迭代器，每次 yield 一个 {"status": "...", "completed": N, "total": M} dict。
    本函数在后台线程跑拉取，通过 emit 回调推送进度。

    Args:
        model_name: 模型名，如 "qwen2.5:7b"
        emit: 回调 (status:str, progress:int, message:str) -> None

    Returns:
        True 表示拉取成功，False 表示失败
    """
    import time as _time

    def _emit(status: str, progress: int, message: str):
        if emit is None:
            return
        try:
            emit(status, progress, message)
        except Exception as e:
            print(f"[GraphPet] pull 进度回调异常: {e}", file=sys.stderr, flush=True)

    try:
        import ollama
    except ImportError as e:
        _emit("error", 0, f"ollama 库未安装: {e}")
        return False

    _emit("pulling", 0, f"开始拉取模型 {model_name}...")
    t0 = _time.time()
    try:
        client = ollama.Client(host=LLM_API_BASE)
        stream = client.pull(model_name, stream=True)
        last_pct = -1
        for chunk in stream:
            if not isinstance(chunk, dict):
                continue
            status = str(chunk.get("status", ""))
            # 拉取进度：{"status":"pulling 5dcfac...","completed":1234567,"total":4567890}
            if "pulling" in status and "completed" in chunk and "total" in chunk:
                completed = int(chunk.get("completed", 0))
                total = int(chunk.get("total", 1))
                pct = int(completed * 100 / total) if total > 0 else 0
                if pct != last_pct:
                    last_pct = pct
                    # 限制在 0-95%，留 5% 给最后的"写入"阶段
                    display_pct = min(95, pct)
                    _emit("pulling", display_pct, f"下载中 {display_pct}%")
            elif status == "success":
                elapsed = int(_time.time() - t0)
                _emit("done", 100, f"模型 {model_name} 拉取完成（耗时 {elapsed}s）")
                return True
            elif "verifying" in status or "writing" in status:
                _emit("pulling", 96, status)
            elif status:
                _emit("pulling", last_pct if last_pct >= 0 else 50, status)
        # 流结束但没收到 success
        _emit("done", 100, f"模型 {model_name} 拉取完成")
        return True
    except Exception as e:
        _emit("error", 0, f"拉取失败: {type(e).__name__}: {e}")
        return False


def call_llm(
    prompt: str,
    system_prompt: str = "你是Nito，一个可爱的桌面宠物小精灵。",
    history_messages: Optional[List[Dict[str, str]]] = None,
    temperature: float = 0.7,
    max_tokens: int = 500,
) -> Optional[str]:
    """直接调用 LLM 进行闲聊 / 问候（不走知识图谱）。

    供 server.py 的 _check_llm_available 和 _call_llm_chat 使用。

    Args:
        prompt: 用户输入
        system_prompt: 系统提示词
        history_messages: 对话历史，格式 [{role, content}]
        temperature: 采样温度
        max_tokens: 最大生成 token 数

    Returns:
        LLM 回答文本，失败返回 None
    """
    try:
        if LLM_PROVIDER == "ollama":
            import ollama
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            if history_messages:
                messages.extend(history_messages)
            messages.append({"role": "user", "content": prompt})
            client = ollama.Client(host=LLM_API_BASE)
            response = client.chat(
                model=LLM_MODEL,
                messages=messages,
                options={
                    "temperature": temperature,
                    "num_ctx": 8192,
                    "num_predict": max_tokens,
                    "keep_alive": "30m",
                    "repeat_penalty": 1.1,
                    "top_p": 0.9,
                },
            )
            return response["message"]["content"]
        elif LLM_PROVIDER == "freellm":
            from free_llm_router import free_llm_complete
            return free_llm_complete(
                prompt,
                system_prompt=system_prompt,
                history_messages=history_messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        else:
            result = _run_async(
                openai_compatible_model_complete(
                    prompt,
                    system_prompt=system_prompt,
                    history_messages=history_messages or [],
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout=120,
                ),
                timeout=130,
            )
            return str(result) if result else None
    except Exception as e:
        print(
            f"[GraphPet] LLM 调用失败: {type(e).__name__}: {e}",
            file=sys.stderr,
            flush=True,
        )
        return None


# ========================
# 文档解析（Docling）
# ========================


def _is_image_file(source: str) -> bool:
    """判断是否为图片文件"""
    lower = source.lower()
    return any(lower.endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.tiff', '.webp'])


def _parse_image_with_ollama(source: str) -> Optional[str]:
    """用 Ollama 视觉模型解析图片，返回文本描述。

    依次尝试多个视觉模型（小到大）：moondream:1.8b（最小，1.1GB）、
    minicpm-v:8b（5GB）、llava:7b（4.7GB）、llava:13b（8GB）。
    无视觉模型时用 PIL 提取图片元信息作为 fallback，至少保留可索引的基础信息。
    """
    import os
    # 候选视觉模型（从小到大，优先用最轻量的）
    vision_models = ['moondream:1.8b', 'minicpm-v:8b', 'llava:7b', 'llava:13b']
    try:
        import ollama
        client = ollama.Client(host=LLM_API_BASE)
        resp = client.list()
        # ollama 0.6.x: resp.models 是 list[Model]，.model 是名字
        available = []
        if hasattr(resp, 'models'):
            for m in resp.models:
                if hasattr(m, 'model'):
                    available.append(m.model)
                elif hasattr(m, 'name'):
                    available.append(m.name)
        elif isinstance(resp, dict):
            available = [m.get('model') or m.get('name') for m in resp.get('models', [])]
        for model_name in vision_models:
            if model_name in available:
                try:
                    res = client.chat(
                        model=model_name,
                        messages=[{
                            'role': 'user',
                            'content': '请详细描述这张图片的内容，包括文字、场景、人物、物体等信息。',
                            'images': [source]
                        }],
                        options={'temperature': 0.3, 'num_ctx': 4096},
                    )
                    text = ''
                    if isinstance(res, dict):
                        text = res.get('message', {}).get('content', '')
                    else:
                        text = getattr(getattr(res, 'message', None), 'content', '') or ''
                    if text and text.strip():
                        return f"## 图片内容描述\n\n{text.strip()}\n\n---\n来源: {os.path.basename(source)}（视觉模型: {model_name}）"
                except Exception as e:
                    print(f"[GraphPet] 视觉模型 {model_name} 调用失败: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
                    continue
    except Exception as e:
        print(f"[GraphPet] 视觉模型检测失败: {type(e).__name__}: {e}", file=sys.stderr, flush=True)

    # Fallback：无视觉模型或调用失败 → 用 PIL 提取图片基础信息
    try:
        from PIL import Image
        img = Image.open(source)
        w, h = img.size
        fmt = (img.format or os.path.splitext(source)[1].lstrip('.')).upper()
        mode = img.mode
        file_size = os.path.getsize(source)
        size_str = f"{file_size/1024:.1f} KB" if file_size < 1024 * 1024 else f"{file_size/1024/1024:.2f} MB"
        return (
            f"## 图片元信息\n\n"
            f"- 文件名: {os.path.basename(source)}\n"
            f"- 格式: {fmt}\n"
            f"- 尺寸: {w}×{h}\n"
            f"- 色彩模式: {mode}\n"
            f"- 文件大小: {size_str}\n\n"
            f"> ⚠️ 未检测到视觉模型，无法识别图片内容。建议安装轻量视觉模型：\n"
            f"> `ollama pull moondream:1.8b`（约 1.1GB，最小）\n"
            f"> `ollama pull minicpm-v:8b`（约 5GB，效果更好）"
        )
    except Exception as e:
        print(f"[GraphPet] 图片元信息提取失败: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        return f"图片文件: {os.path.basename(source)}（无可用视觉模型，且元信息提取失败）"


def _parse_url(source: str) -> Optional[str]:
    """解析 URL 页面内容"""
    # 先用 requests 下载 HTML，再用 Docling 解析
    try:
        import urllib.request
        req = urllib.request.Request(source, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GraphPet/1.0'
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            html_content = resp.read().decode('utf-8', errors='replace')
        # 用 Docling 解析 HTML 字符串
        import tempfile
        import os
        with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False, encoding='utf-8') as f:
            f.write(html_content)
            temp_path = f.name
        try:
            converter = _get_docling_converter()
            from docling.document_converter import ConversionStatus
            result = converter.convert(temp_path, raises_on_error=False)
            if result.status in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
                md = result.document.export_to_markdown()
                return md if md and md.strip() else None
        finally:
            os.unlink(temp_path)
    except Exception as e:
        print(f"[GraphPet] URL解析失败: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
    # Fallback: 用 BeautifulSoup 直接提取文本
    try:
        from bs4 import BeautifulSoup
        import urllib.request
        req = urllib.request.Request(source, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GraphPet/1.0'
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode('utf-8', errors='replace')
        soup = BeautifulSoup(html, 'html.parser')
        # 移除 script 和 style 标签
        for tag in soup(['script', 'style', 'nav', 'footer', 'header']):
            tag.decompose()
        text = soup.get_text(separator='\n', strip=True)
        return text if text and text.strip() else None
    except Exception as e:
        print(f"[GraphPet] URL fallback解析失败: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        return None


def parse_document(source: str) -> Optional[str]:
    """解析本地文件或 URL，返回 Markdown/文本。

    PDF / Word 用 Docling，图片用 Ollama 视觉模型，URL 先下载再解析。
    解析失败返回 None（调用方据此返回"文档内容为空"错误）。
    """
    # 图片文件：用 Ollama 视觉模型
    if _is_image_file(source):
        return _parse_image_with_ollama(source)

    # URL：先下载 HTML 再解析
    if source.startswith('http://') or source.startswith('https://'):
        return _parse_url(source)

    # 其他文件（PDF/DOCX/HTML等）：用 Docling
    converter = _get_docling_converter()
    try:
        from docling.document_converter import ConversionStatus

        result = converter.convert(str(source), raises_on_error=False)
        if result.status in (
            ConversionStatus.SUCCESS,
            ConversionStatus.PARTIAL_SUCCESS,
        ):
            md = result.document.export_to_markdown()
            return md if md and md.strip() else None
        print(
            f"[GraphPet] Docling 解析状态={result.status} errors={result.errors}",
            file=sys.stderr,
            flush=True,
        )
        return None
    except Exception as e:
        print(
            f"[GraphPet] Docling 解析异常: {type(e).__name__}: {e}",
            file=sys.stderr,
            flush=True,
        )
        return None


# ========================
# 喂食（LightRAG 增量插入）
# ========================


def feed_document(
    text: str, file_path: Optional[str] = None
) -> Dict[str, Any]:
    """增量插入文档到 LightRAG 知识图谱。

    LightRAG 自动完成：分块 → LLM 实体抽取 → 三元组构建 → 向量化 → 入库。
    多次 ainsert 是增量累加的，相同实体会被合并。

    为支持"文件清单详情查看"，本函数会对比插入前后的 graphml 边集合，
    计算本次新增的三元组（diff）返回给调用方保存。

    Args:
        text: 文档文本（通常是 Docling 解析出的 Markdown）
        file_path: 文档标识（传 fingerprint），用于 LightRAG 文档级去重

    Returns:
        {
          "entity_count": int,       # 插入后图谱实体总数
          "triple_count": int,       # 插入后图谱三元组总数
          "relation_count": int,     # 插入后不同关系数
          "new_triples": List[Dict], # 本次新增的三元组 [{head, relation, tail}]
          "new_triple_count": int,   # 本次新增三元组数
        }
    """
    rag = init_rag()

    # 插入前快照：当前 graphml 边集合（用于 diff）
    prev_edges: set = set()
    try:
        G_prev = _read_kg_graph()
        if G_prev is not None:
            for u, v, _data in G_prev.edges(data=True):
                prev_edges.add((str(u), str(v)))
    except Exception:
        prev_edges = set()

    async def _feed():
        # LightRAG 1.5.x 参数名是 file_paths（接受 str 或 list[str]）
        await rag.ainsert(text, file_paths=file_path)

    _run_async(_feed(), timeout=900)

    # 插入后统计 + diff 新增边
    G_after = _read_kg_graph()
    new_triples: List[Dict[str, str]] = []
    if G_after is not None:
        nodes = G_after.number_of_nodes()
        edges = G_after.number_of_edges()
        relations = set()
        for u, v, data in G_after.edges(data=True):
            raw_rel = data.get("keywords") or data.get("label") or data.get("description") or "相关"
            label = str(raw_rel).split("<SEP>")[0].split(",")[0].split("，")[0].strip() or "相关"
            if label:
                relations.add(label)
            # 新增边 = 插入后存在但插入前不存在
            if (str(u), str(v)) not in prev_edges:
                new_triples.append(
                    {
                        "head": str(u),
                        "relation": label,
                        "tail": str(v),
                    }
                )
    else:
        nodes = 0
        edges = 0
        relations = set()

    return {
        "entity_count": nodes,
        "triple_count": edges,
        "relation_count": len(relations),
        "new_triples": new_triples,
        "new_triple_count": len(new_triples),
    }


def feed_document_with_progress(
    text: str,
    file_path: Optional[str] = None,
    emit=None,
) -> Dict[str, Any]:
    """带四阶段进度回调的增量插入（P0-C）。

    与 feed_document 等价，但在各阶段前后通过 emit(stage, progress, message)
    回调推送进度，供 server /feed/stream 端点转成 SSE 事件。

    阶段划分：
      1. preparing  (30%→40%)：init_rag + 快照插入前图谱边集
      2. extracting (40%→85%)：LightRAG ainsert（最耗时，配心跳）
      3. finalizing (85%→95%)：diff 图谱 + 统计新增三元组
      4. done       (100%)    ：返回统计

    Args:
        text: 文档 Markdown 文本
        file_path: 文档指纹（fingerprint），用于 LightRAG 文档级去重
        emit: 可选回调 (stage:str, progress:int, message:str) -> None

    Returns:
        与 feed_document 相同的统计 dict
    """
    import time as _time

    def _emit(stage: str, progress: int, message: str):
        if emit is None:
            return
        try:
            emit(stage, progress, message)
        except Exception as e:
            print(f"[GraphPet] 进度回调异常: {e}", file=sys.stderr, flush=True)

    _emit("preparing", 32, "准备知识图谱...")
    t0 = _time.time()
    rag = init_rag()

    # 插入前快照
    prev_edges: set = set()
    try:
        G_prev = _read_kg_graph()
        if G_prev is not None:
            for u, v, _data in G_prev.edges(data=True):
                prev_edges.add((str(u), str(v)))
    except Exception:
        prev_edges = set()

    _emit("extracting", 42, "正在抽取实体和三元组...")

    # 心跳线程：ainsert 是黑盒，期间每 6s 推送一次"仍在抽取"进度
    # 进度从 42% 线性逼近 82%（不会到 100%，留空间给 finalizing）
    heartbeat_stop = threading.Event()

    def _heartbeat():
        elapsed = 0
        while not heartbeat_stop.wait(6.0):
            elapsed += 6
            # 42 → 82 之间线性增长，每 6s +3%，封顶 82
            pct = min(82, 42 + elapsed // 6 * 3)
            _emit(
                "extracting",
                pct,
                f"仍在抽取知识...（已用时 {elapsed}s）",
            )

    hb = threading.Thread(target=_heartbeat, daemon=True, name="feed-heartbeat")
    hb.start()

    async def _feed():
        await rag.ainsert(text, file_paths=file_path)

    try:
        _run_async(_feed(), timeout=900)
    finally:
        heartbeat_stop.set()

    _emit("finalizing", 88, "正在入库与统计...")

    # 插入后统计 + diff 新增边
    G_after = _read_kg_graph()
    new_triples: List[Dict[str, str]] = []
    if G_after is not None:
        nodes = G_after.number_of_nodes()
        edges = G_after.number_of_edges()
        relations = set()
        for u, v, data in G_after.edges(data=True):
            raw_rel = data.get("keywords") or data.get("label") or data.get("description") or "相关"
            label = str(raw_rel).split("<SEP>")[0].split(",")[0].split("，")[0].strip() or "相关"
            if label:
                relations.add(label)
            if (str(u), str(v)) not in prev_edges:
                new_triples.append(
                    {
                        "head": str(u),
                        "relation": label,
                        "tail": str(v),
                    }
                )
    else:
        nodes = 0
        edges = 0
        relations = set()

    # 注意：不发 done 事件——server 层会在收到返回值后发自己的最终 done
    # （携带完整 FeedResponse 字段）。这里只发 finalizing 完成信号。
    elapsed_total = int(_time.time() - t0)
    _emit(
        "finalizing",
        95,
        f"入库完成，本次新增 {len(new_triples)} 条三元组，总耗时 {elapsed_total}s",
    )

    return {
        "entity_count": nodes,
        "triple_count": edges,
        "relation_count": len(relations),
        "new_triples": new_triples,
        "new_triple_count": len(new_triples),
    }


# ========================
# 问答（LightRAG 检索）
# ========================


def query(
    question: str,
    mode: str = "hybrid",
    history: Optional[List[Dict]] = None,
) -> Dict[str, Any]:
    """基于知识图谱问答。

    Args:
        question: 用户问题
        mode: 检索模式 local / global / hybrid / mix / naive
        history: 多轮对话历史 [{role, content}, ...]

    Returns:
        {"answer": str, "sources": []}
        LightRAG 1.5.x 的 aquery 直接返回答案字符串，sources 暂为空
        （图谱检索上下文已融入答案）。
    """
    rag = init_rag()
    from lightrag.base import QueryParam

    # 注意：conversation_history 必须是 list，不能是 None。
    # LightRAG 的 ollama 适配器会 messages.extend(history_messages)，
    # 传 None 会抛 'NoneType' object is not iterable。
    conv_history: list = []
    if history:
        conv_history = [
            {"role": m.get("role", "user"), "content": m.get("content", "")}
            for m in history
            if isinstance(m, dict) and m.get("content")
        ]

    async def _query():
        result = await rag.aquery(
            question,
            param=QueryParam(
                mode=mode, stream=False, conversation_history=conv_history
            ),
        )
        return result

    answer = _run_async(_query(), timeout=300)
    # LightRAG 1.5.x 可能返回字符串或 {"response": "..."} 形式（字符串/对象）。
    # 这里做兼容性拆包，确保最终 answer 是纯文本。
    answer_text = ""
    if answer:
        if isinstance(answer, str):
            s = answer.strip()
            # 形如 {"response":"..."} 的 JSON 字符串 → 解析取出 response 字段
            if s.startswith("{") and s.endswith("}") and '"response"' in s:
                try:
                    import json as _json
                    parsed = _json.loads(s)
                    if isinstance(parsed, dict) and "response" in parsed:
                        answer_text = str(parsed["response"] or "")
                    else:
                        answer_text = s
                except Exception:
                    answer_text = s
            else:
                answer_text = s
        elif isinstance(answer, dict):
            answer_text = str(answer.get("response") or answer.get("answer") or "")
        else:
            answer_text = str(answer)
    return {"answer": answer_text, "sources": []}


# 当前活跃的流式问答 future 句柄（用于客户端断连时取消后台协程，避免 LLM 浪费）
_active_query_future: Optional["concurrent.futures.Future"] = None
_active_query_lock = threading.Lock()


def cancel_active_query_stream():
    """取消当前正在进行的流式问答后台协程。

    P2-5 修复：客户端断开 SSE 连接后，前端不会再消费 chunk，但 LightRAG 的
    aquery 协程仍会在 _bg_loop 中跑到自然结束（最长 300s），浪费 LLM API 配额。
    本函数让调用方在 GeneratorExit 时主动取消后台 future。

    注意：concurrent.futures.Future.cancel() 只能在协程尚未被 loop 调度前生效；
    若协程已开始执行，loop 会在下一个 await 点检查 CancelledError 信号并中断。
    """
    global _active_query_future
    with _active_query_lock:
        fut = _active_query_future
        _active_query_future = None
    if fut is None:
        return
    try:
        fut.cancel()
    except Exception:
        pass


def query_stream(
    question: str,
    mode: str = "hybrid",
    history: Optional[List[Dict]] = None,
):
    """流式问答生成器。

    LightRAG stream 模式逐 token 返回。本函数在后台 loop 消费 async generator，
    通过 queue 把 token 传回主线程，yield 给 FastAPI 的 SSE 端点。

    P2-5 修复要点：
      1. queue 改为有界（maxsize=64），客户端停止消费时后台 put 会阻塞而非无限堆积
      2. 保存 run_coroutine_threadsafe 返回的 future 句柄，暴露 cancel_active_query_stream()
      3. _consume 协程捕获 CancelledError，正常终止 generator 而非抛异常
      4. 主循环检测 GeneratorExit（客户端断开），主动 cancel 后台 future

    Yields:
        {"type": "chunk", "content": str, "full_answer": str}
        或 {"type": "error", "message": str}
    """
    import queue as _queue

    rag = init_rag()
    from lightrag.base import QueryParam

    # conversation_history 必须是 list（同 query 函数，避免 None 崩溃）
    conv_history: list = []
    if history:
        conv_history = [
            {"role": m.get("role", "user"), "content": m.get("content", "")}
            for m in history
            if isinstance(m, dict) and m.get("content")
        ]

    # P2-5: maxsize=64 防止客户端断开后 token 无限堆积导致内存泄漏
    q: _queue.Queue = _queue.Queue(maxsize=64)
    SENTINEL = object()

    async def _consume():
        try:
            stream = await rag.aquery(
                question,
                param=QueryParam(
                    mode=mode, stream=True, conversation_history=conv_history
                ),
            )
            full = ""
            if hasattr(stream, "__aiter__"):
                async for chunk in stream:
                    full += str(chunk)
                    # maxsize 满时阻塞，等主线程消费；若主线程已断连取消，会抛 CancelledError
                    q.put(("chunk", str(chunk), full), timeout=120)
            else:
                full = str(stream) if stream is not None else ""
                if full:
                    q.put(("chunk", full, full), timeout=120)
        except asyncio.CancelledError:
            # 客户端断连触发的取消，正常终止即可，不打错误日志
            print("[GraphPet] query_stream 后台协程被取消（客户端断连）", flush=True)
        except Exception as e:
            import traceback
            traceback.print_exc()
            try:
                q.put(("error", str(e), ""), timeout=5)
            except _queue.Full:
                pass
        else:
            try:
                q.put(("done", "", ""), timeout=5)
            except _queue.Full:
                pass

    loop = _get_bg_loop()
    # P2-5: 保存 future 句柄，供 cancel_active_query_stream() 取消
    global _active_query_future
    fut = asyncio.run_coroutine_threadsafe(_consume(), loop)
    with _active_query_lock:
        _active_query_future = fut

    try:
        while True:
            # 阻塞读 queue；客户端断连会从 yield 处抛 GeneratorExit 跳出 while
            item = q.get()
            kind = item[0]
            if kind == "done":
                break
            if kind == "error":
                yield {"type": "error", "message": item[1]}
                break
            yield {
                "type": "chunk",
                "content": item[1],
                "full_answer": item[2],
            }
    except GeneratorExit:
        # 客户端断开 SSE 连接，主动取消后台 _consume 协程避免 LLM 浪费
        cancel_active_query_stream()
        raise


# ========================
# 知识图谱统计 + 三元组列表（读 graphml）
# ========================


def _get_graphml_path() -> str:
    """获取 LightRAG 图谱文件路径。"""
    return os.path.join(WORKING_DIR, "graph_chunk_entity_relation.graphml")


# P3-9: graphml 缓存（mtime + graph），避免每次 get_kg_stats/get_kg_triples 重复 IO
_kg_graph_cache: Optional[Any] = None
_kg_graph_mtime: float = -1.0
_kg_graph_lock = threading.Lock()


def _read_kg_graph():
    """读 graphml 返回 networkx 图；文件不存在返回 None。

    P3-9 修复：基于文件 mtime 缓存。MemoryGraph 面板每次刷新 / 三元组列表查询 /
    feed_document_with_progress 前后比对都会调用本函数，无缓存时每次都全量
    parse graphml（大图谱可达数 MB，parse 耗时数百 ms）。缓存 mtime 未变时直接复用。
    """
    global _kg_graph_cache, _kg_graph_mtime
    try:
        import networkx as nx

        path = _get_graphml_path()
        if not os.path.exists(path):
            with _kg_graph_lock:
                _kg_graph_cache = None
                _kg_graph_mtime = -1.0
            return None
        mtime = os.path.getmtime(path)
        # mtime 未变，直接复用缓存
        with _kg_graph_lock:
            if _kg_graph_cache is not None and mtime == _kg_graph_mtime:
                return _kg_graph_cache
        G = nx.read_graphml(path)
        with _kg_graph_lock:
            _kg_graph_cache = G
            _kg_graph_mtime = mtime
        return G
    except Exception as e:
        print(
            f"[GraphPet] 读取图谱失败: {type(e).__name__}: {e}",
            file=sys.stderr,
            flush=True,
        )
        return None


def get_kg_stats() -> Dict[str, Any]:
    """返回知识图谱统计（实体数 / 三元组数 / 是否可用）。

    供 memory.py 的 get_memory_stats 调用，替换原读 entity_names.json 的逻辑。
    """
    G = _read_kg_graph()
    if G is None:
        return {
            "entity_count": 0,
            "triple_count": 0,
            "relation_count": 0,
            "available": False,
        }
    nodes = G.number_of_nodes()
    edges = G.number_of_edges()
    relations = set()
    for _u, _v, data in G.edges(data=True):
        raw_rel = data.get("keywords") or data.get("label") or data.get("description") or "相关"
        label = str(raw_rel).split("<SEP>")[0].split(",")[0].split("，")[0].strip() or "相关"
        if label:
            relations.add(label)
    return {
        "entity_count": nodes,
        "triple_count": edges,
        "relation_count": len(relations),
        "available": nodes > 0 or edges > 0,
    }


def get_triples_list(limit: int = 200) -> List[Dict[str, str]]:
    """读 graphml 解析边为三元组列表，供前端图谱可视化 + 文件详情查看。

    每条边解析为 {head, relation, tail}：
      - head = 源节点 id
      - tail = 目标节点 id
      - relation = 边的 label（LightRAG 中是关系描述）

    Args:
        limit: 最多返回数量

    Returns:
        [{head, relation, tail}, ...]
    """
    G = _read_kg_graph()
    if G is None:
        return []
    triples: List[Dict[str, str]] = []
    for u, v, data in G.edges(data=True):
        raw_rel = data.get("keywords") or data.get("label") or data.get("description") or "相关"
        relation = str(raw_rel).split("<SEP>")[0].split(",")[0].split("，")[0].strip()
        if not relation:
            relation = "相关"
        triples.append(
            {
                "head": str(u),
                "relation": relation,
                "tail": str(v),
            }
        )
        if len(triples) >= limit:
            break
    return triples


def get_chunk_count() -> int:
    """读取 LightRAG 的 text_chunks 存储统计 chunk 数。"""
    path = os.path.join(WORKING_DIR, "kv_store_text_chunks.json")
    if not os.path.exists(path):
        return 0
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return len(data)
        if isinstance(data, list):
            return len(data)
    except (json.JSONDecodeError, OSError, ValueError):
        pass
    return 0


def cleanup_stale_doc_status() -> int:
    """清理 LightRAG doc_status 中卡在 "processing" 的文档状态（P1-D 容错）。

    问题场景：喂食过程中崩溃/超时，doc_status.json 里残留 "processing" 状态，
    导致同一文件无法重新喂食（LightRAG 认为还在处理中）。

    本函数在 init_rag 后调用，把所有 "processing" 状态改为 "failed"，
    允许用户重新喂食该文件。

    Returns:
        清理的文档数量
    """
    import json as _json

    status_path = os.path.join(WORKING_DIR, "kv_store_doc_status.json")
    if not os.path.exists(status_path):
        return 0
    try:
        with open(status_path, "r", encoding="utf-8") as f:
            data = _json.load(f)
        if not isinstance(data, dict):
            return 0
        cleaned = 0
        changed = False
        for doc_id, status in data.items():
            if isinstance(status, dict) and status.get("status") == "processing":
                status["status"] = "failed"
                status["error"] = "interrupted by GraphPet cleanup"
                cleaned += 1
                changed = True
            elif isinstance(status, str) and status == "processing":
                # 旧格式：直接是字符串
                data[doc_id] = "failed"
                cleaned += 1
                changed = True
        if changed:
            with open(status_path, "w", encoding="utf-8") as f:
                _json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"[GraphPet] 清理了 {cleaned} 个卡住的 doc_status", flush=True)
        return cleaned
    except (json.JSONDecodeError, OSError, ValueError) as e:
        print(f"[GraphPet] 清理 doc_status 失败: {e}", file=sys.stderr, flush=True)
        return 0


# ========================
# 文件来源映射管理（GraphPet 增强层）
# ========================

_FILE_SOURCES_FILENAME = "file_sources.json"


def _get_graphpet_data_dir() -> str:
    """GraphPet 扩展数据目录（与 LightRAG working_dir 相同）。"""
    os.makedirs(WORKING_DIR, exist_ok=True)
    return WORKING_DIR


def load_file_sources() -> dict:
    """加载 fingerprint→filename 映射。"""
    path = os.path.join(_get_graphpet_data_dir(), _FILE_SOURCES_FILENAME)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError, ValueError):
        return {}


def save_file_sources(sources: dict) -> None:
    """保存 fingerprint→filename 映射。"""
    path = os.path.join(_get_graphpet_data_dir(), _FILE_SOURCES_FILENAME)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(sources, f, ensure_ascii=False, indent=2)


def record_file_source(fingerprint: str, filename: str) -> None:
    """记录一个 fingerprint→filename 映射。"""
    if not fingerprint:
        return
    sources = load_file_sources()
    sources[fingerprint] = filename
    save_file_sources(sources)


def get_filename_for_doc_id(doc_id: str) -> Optional[str]:
    """根据 doc_id (fingerprint) 获取文件名。"""
    if not doc_id:
        return None
    return load_file_sources().get(doc_id)


def get_source_filename_from_meta(meta: dict) -> Optional[str]:
    """从 chunk metadata 获取来源文件名（LightRAG 方案下用 file_path 反查）。

    LightRAG 的 file_path 即 fingerprint，直接查 file_sources.json。
    """
    if not meta:
        return None
    doc_id = meta.get("doc_id") or meta.get("file_path")
    if doc_id:
        return get_filename_for_doc_id(doc_id)
    return None
