"""GraphPet 后端 FastAPI 启动入口。

负责提供 HTTP 接口供 Electron 主进程调用。
- /health, /             ：健康检查 / 根信息
- POST /feed             ：喂食 API（Task 13），用 Docling 解析文档 + LightRAG 增量插入知识图谱
- GET  /memory/stats     ：查询当前知识图谱统计（实体数 / 三元组数 / 已吃文件数）
- POST /chat             ：问答 API（Task 18），基于 LightRAG 知识图谱回答用户问题
- GET  /growth/summary   ：养成状态摘要（Task 20）
- GET  /proactive/message：主动对话评估（Task 21），含冷知识分享（Task 22）
- GET  /proactive/trivia ：冷知识分享（Task 22），从知识图谱抽三元组改写

Phase 2 的 /feed 采用同步处理；大文件分流在 Task 17 优化。
Phase 3 的 /chat 采用无状态问答，每次独立调用 LightRAG.aquery()。
"""

from __future__ import annotations

import os
# BUG-3 深度修复：禁用 CUDA。torch 2.7 + CUDA 在多线程下加载模型会触发
# 0xC0000005 segfault（Windows only）。必须在 import torch 之前设置。
# Embedding 用 CPU 已经够快（bge-small 512 维，单次 < 50ms）。
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import random
import sys as _sys
import concurrent.futures
import threading
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator, Field, AliasChoices
import uvicorn
import json as _json

_PYTHON_DIR = os.path.dirname(os.path.abspath(__file__))
if _PYTHON_DIR not in _sys.path:
    _sys.path.insert(0, _PYTHON_DIR)

import graphpet_rag_bridge as _bridge  # noqa: E402
from graphpet_rag_bridge import RiceRagNotAvailableError  # noqa: E402
from graphpet_core import memory as _memory  # noqa: E402
from graphpet_core import state as _state  # noqa: E402
from graphpet_core import growth as _growth  # noqa: E402
from graphpet_core import scheduler as _scheduler  # noqa: E402
from graphpet_core import knowledge_share as _knowledge_share  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时同步预热 ST 模型 + 同步智力等级 + 预检查 LLM。

    BUG-3 深度修复：之前用 daemon 线程后台预热 ST，但 Windows 下
    sentence-transformers/onnxruntime C 扩展在多线程并发下会触发 0xC0000005
    segfault（进程级崩溃，try/except 无法捕获）。

    现改为在 lifespan 内 await asyncio.to_thread 同步执行预热：
      - uvicorn 启动后到 lifespan yield 之前不接收业务请求
      - ST 加载在主进程的主线程（通过 to_thread 跑在 worker thread，
        但不会与 uvicorn 事件循环并发）
      - 加载失败不抛异常（保持向后兼容）
    """
    import asyncio as _asyncio

    print("[GraphPet] 后端服务启动中（warmup disabled - 移到首次调用）...", flush=True)

    # BUG-3 最终修复：不在 uvicorn 进程内预热 ST（onnxruntime/torch 在 uvicorn
    # 事件循环 + worker 线程并发下会 segfault 0xC0000005，进程级崩溃无法捕获）。
    # ST 改为首次 chat/feed 调用时通过子进程预热（见 _ensure_st_in_subprocess）。
    # 这里只跑同步智力等级 + LLM 预检查，不碰 ST。

    # 同步智力等级
    try:
        synced = await _asyncio.to_thread(_growth.sync_intelligence_from_memory)
        print(f"[GraphPet] 智力等级同步: {synced}", flush=True)
    except Exception as e:
        print(f"[GraphPet] 智力等级同步失败: {e}", file=_sys.stderr, flush=True)

    # 预检查 LLM 连通性
    try:
        await _asyncio.to_thread(_check_llm_available)
    except Exception as e:
        print(f"[GraphPet] LLM 预检查失败: {e}", file=_sys.stderr, flush=True)

    # 后台子进程预热 ST（失败不影响主进程）
    # 注意：spawn 子进程会重新 import server.py，但子进程不会进 lifespan
    # （只有主进程的 uvicorn 会触发 lifespan），所以不会递归。
    threading.Thread(target=_warmup_st_in_subprocess, daemon=True).start()

    yield


# 创建 FastAPI 应用实例
app = FastAPI(title="GraphPet Backend", version="0.3.0", lifespan=lifespan)


def _safe_record_interaction(type: str) -> None:
    """安全记录一次互动：失败仅记录到 stderr，不阻断业务流程。

    Args:
        type: 互动类型（'feed' / 'chat' / 'click' / 'skin_change'）。
    """
    try:
        _growth.record_interaction(type)
    except Exception as e:
        print(f"[GraphPet] 记录互动失败({type}): {e}", file=_sys.stderr, flush=True)


def _warmup_st_worker() -> None:
    """子进程预热 worker（必须在模块顶层，spawn 模式才能 pickle）。

    BUG-3 最终修复：onnxruntime/torch 在 uvicorn 进程内加载会触发 0xC0000005
    segfault（进程级崩溃，无法 try/except 捕获）。改用 multiprocessing.spawn 在
    独立子进程加载 ST，子进程崩溃不影响主进程。
    """
    try:
        os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
        from sentence_transformers import SentenceTransformer
        m = SentenceTransformer("BAAI/bge-small-zh-v1.5", local_files_only=True, device="cpu")
        m.encode(["warmup"], normalize_embeddings=True, show_progress_bar=False)
        print("[GraphPet] subprocess warmup: ST OK", flush=True)
    except Exception as e:
        print(f"[GraphPet] subprocess warmup failed: {type(e).__name__}: {e}", flush=True)


def _warmup_st_in_subprocess() -> None:
    """在 spawn 子进程中预热 ST（失败不影响主进程）。"""
    import multiprocessing as _mp

    try:
        ctx = _mp.get_context("spawn")
        p = ctx.Process(target=_warmup_st_worker)
        p.start()
        p.join(timeout=120)
        if p.exitcode == 0:
            print("[GraphPet] ST 子进程预热成功", flush=True)
        elif p.exitcode is None:
            print("[GraphPet] ST 子进程预热超时(120s)", file=_sys.stderr, flush=True)
            p.terminate()
        else:
            print(f"[GraphPet] ST 子进程预热崩溃(主进程安全): exitcode={p.exitcode}", file=_sys.stderr, flush=True)
    except Exception as e:
        print(f"[GraphPet] ST 子进程预热启动失败: {e}", file=_sys.stderr, flush=True)


def _load_settings_field() -> dict:
    """从 graphpet_state.json 读取 settings 字段。

    settings 由 Electron 主进程管理（settingsStore.ts / main/index.ts），
    Python 端只读不写。读取失败返回空 dict（用调度器默认值兜底）。

    Returns:
        settings 字段的 dict 形式，可能包含 proactiveIntervalMin / quietMode 等。
    """
    try:
        import json as _json

        if not os.path.exists(_state.STATE_FILE):
            return {}
        with open(_state.STATE_FILE, "r", encoding="utf-8") as f:
            raw = _json.load(f)
        return raw.get("settings", {}) if isinstance(raw, dict) else {}
    except (ValueError, OSError):
        # JSONDecodeError 是 ValueError 子类；文件损坏 / 读取失败时用空 dict 兜底
        return {}


# 主动对话调度器全局实例（按当前设置评估触发，前端每分钟轮询）
_proactive_scheduler = _scheduler.ProactiveScheduler()

# LLM可用性全局标志：None=未检查，True=可用，False=上次检查失败（但仍可重试
_llm_available: Optional[bool] = None
_llm_check_lock = threading.Lock()
# LLM 失败冷却期（线程安全读写）：失败后 30 秒内不再尝试，避免雪崩
_llm_fail_cooldown_until: float = 0.0
_llm_fail_cooldown_lock = threading.Lock()
_llm_last_fail_time = 0  # 上次失败时间戳，用于控制重试间隔
# 单例线程池（避免每次调用创建/销毁线程池导致资源泄漏和锁问题）。
# max_workers=4：允许喂食（KG抽取+索引）与聊天 LLM 调用并发，避免互相阻塞。
_llm_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="llm-worker")


def _check_llm_available() -> bool:
    """探测LLM是否可用（最多15秒，本地7B模型启动较慢）。
    失败后不永久标记为不可用，仅记录失败时间，让实际调用时仍可尝试。
    """
    global _llm_available, _llm_last_fail_time
    if _llm_available is True:
        return True
    with _llm_check_lock:
        if _llm_available is True:
            return _llm_available
        try:
            def _probe():
                return _bridge.call_llm("hi", system_prompt="你是一个助手", temperature=0.1, max_tokens=5)
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as p:
                f = p.submit(_probe)
                probe_result = f.result(timeout=15)
            if not probe_result:
                raise RuntimeError("call_llm 返回空结果（LLM 未响应或参数错误）")
            _llm_available = True
            print("[GraphPet] LLM连通性检查通过", flush=True)
        except Exception as e:
            _llm_available = False
            _llm_last_fail_time = __import__("time").time()
            print(f"[GraphPet] LLM启动检查失败({type(e).__name__})，首次调用时将再试", file=_sys.stderr, flush=True)
        return _llm_available or False


# ========================
# 请求 / 响应模型
# ========================


class FeedRequest(BaseModel):
    """喂食请求体。

    file_path 与 url 二选一：url 非空时优先按 URL 处理。
    """

    file_path: Optional[str] = None
    url: Optional[str] = None

    @field_validator("url", "file_path")
    @classmethod
    def _strip(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None


class FeedResponse(BaseModel):
    """喂食响应体。"""

    success: bool
    file_name: str
    entity_count: int
    chunk_count: int
    file_fingerprint: str
    message: str
    # 预估页数（后端基于文件大小/类型估算，用于前端分流提示）
    estimated_pages: int = 0
    # 文件大小分类：small(<5页) / medium(5~50页) / large(>50页)
    size_category: str = "small"
    error: Optional[str] = None
    # P1-C：本次喂食新增的三元组列表（供前端预览卡片展示）
    new_triples: Optional[list] = None


class ChatRequest(BaseModel):
    """问答请求体（Task 18）。

    search_mode 为 None 时使用 LightRAG 默认 hybrid 检索模式；可选值：
    "local" / "global" / "hybrid" / "mix" / "naive" / "chat"（chat=闲聊不走 RAG）。
    history / history_messages 为最近对话历史，格式 [{role: 'user'|'assistant', content: str}]，
    用于多轮对话上下文。
    """

    question: str
    search_mode: Optional[str] = None
    history: Optional[list] = None
    history_messages: Optional[list] = None

    @field_validator("question")
    @classmethod
    def _strip_question(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("question 不能为空")
        return v

    @field_validator("search_mode")
    @classmethod
    def _strip_mode(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None


class ChatResponse(BaseModel):
    """问答响应体（Task 18）。

    LightRAG 全换方案后，aquery 直接返回答案字符串，sources 为空
    （图谱检索上下文已融入答案）；pipeline_info 仅记录检索模式。
    """

    success: bool
    answer: str
    sources: list
    pipeline_info: dict
    message: str
    error: Optional[str] = None
    emotion: Optional[str] = None  # 情感标签：happy/sad/angry/surprised/thinking/neutral


def _estimate_pages(file_path: Optional[str], url: Optional[str]) -> int:
    """预估文件/URL 的页数，用于前端分流提示（秒过 / 进度条 / 后台）。

    估算规则：
      - PDF：优先用 PyPDF2 / pdfplumber 读取真实页数；不可用时按文件大小估算（1MB≈10页）
      - Word(.docx/.doc)：按文件大小估算（1MB≈10页）
      - TXT/MD：按行数估算（行数/50）
      - URL：无法在不抓取的情况下预估，返回 0（前端对 URL 用默认提示）
      - 其他格式：按文件大小估算

    Args:
        file_path: 本地文件路径（可能为 None）
        url: URL 字符串（可能为 None）

    Returns:
        预估页数（≥0）。无法估算时返回 0。
    """
    if url:
        # URL 需要抓取后才能知道内容长度，这里返回 0，前端对 URL 用默认提示
        return 0

    if not file_path or not os.path.exists(file_path):
        return 0

    ext = os.path.splitext(file_path)[1].lower()
    try:
        file_size = os.path.getsize(file_path)
    except OSError:
        return 0

    if ext == ".pdf":
        # 尝试用 PyPDF2 读取真实页数
        try:
            import PyPDF2  # type: ignore

            with open(file_path, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                return len(reader.pages)
        except Exception:
            pass
        # 尝试用 pdfplumber 读取真实页数
        try:
            import pdfplumber  # type: ignore

            with pdfplumber.open(file_path) as pdf:
                return len(pdf.pages)
        except Exception:
            pass
        # 兜底：1MB ≈ 10 页
        return max(1, file_size // (100 * 1024))

    if ext in (".docx", ".doc"):
        # Word：1MB ≈ 10 页
        return max(1, file_size // (100 * 1024))

    if ext in (".txt", ".md"):
        # TXT/MD：行数 / 50
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                line_count = sum(1 for _ in f)
            return max(1, line_count // 50)
        except OSError:
            return 0

    # 其他格式：按文件大小估算
    return max(1, file_size // (100 * 1024))


def _categorize_size(estimated_pages: int) -> str:
    """按预估页数分类文件大小。

    Args:
        estimated_pages: 预估页数

    Returns:
        'small'(<5页) / 'medium'(5~50页) / 'large'(>50页)
    """
    if estimated_pages < 5:
        return "small"
    if estimated_pages <= 50:
        return "medium"
    return "large"


# 单条 source 文本最大保留字符数（超出截断，避免响应体过大）
_SOURCE_TEXT_MAX_LEN = 200

# 闲聊/问候关键词（用于判断是否需要走RAG检索）
_CHAT_PATTERNS = [
    "你好", "您好", "嗨", "hi", "hello", "hey", "哈喽", "嗨喽",
    "早上好", "中午好", "下午好", "晚上好", "晚安", "早安", "午安",
    "谢谢", "感谢", "多谢", "thank", "thanks",
    "再见", "拜拜", "bye", "goodbye", "回头见",
    "你是谁", "你叫什么", "自我介绍", "你能做什么",
    "我叫", "我是", "记住我", "我的名字",
    "在吗", "在不在", "听得到吗",
    "没事", "没什么", "随便聊聊", "聊聊天", "闲聊",
    "哈哈哈", "哈哈", "嘿嘿", "呵呵", "嘻嘻",
    "好的", "嗯", "哦", "行", "ok", "okay",
    "你喜欢什么", "你讨厌什么",
    "几岁", "多大了", "生日",
    "抱抱", "亲亲", "摸摸头", "摸头",
    "生气", "开心", "难过", "伤心",
    "厉害", "真棒", "牛逼", "太强了",
]


def _detect_emotion(text: str) -> str:
    """基于关键词的简单情感检测，用于驱动 Live2D 表情。
    
    返回: happy / sad / angry / surprised / thinking / neutral
    """
    if not text:
        return "neutral"
    # 优先级：开心 > 惊讶 > 难过 > 生气 > 思考
    happy_kw = ["开心", "高兴", "哈哈", "嘻嘻", "太好了", "棒", "厉害", "喜欢", "爱", "有趣", "好耶", "谢谢", "可爱", "好的", "没问题", "当然", "一定", "加油", "太棒了", "不错", "好哦", "好吃", "好吃！", "饱了", "消化", "学到"]
    surprised_kw = ["哇", "不会吧", "真的吗", "天哪", "什么？", "？！", "竟然", "居然", "没想到"]
    sad_kw = ["难过", "伤心", "呜呜", "对不起", "抱歉", "遗憾", "可惜", "没", "不知道", "不理解", "忘了"]
    angry_kw = ["生气", "讨厌", "烦", "哼", "不理", "走开"]
    think_kw = ["让我想想", "嗯...", "这个嘛", "思考", "分析", "根据", "看起来", "可能是", "应该是"]
    
    for kw in happy_kw:
        if kw in text:
            return "happy"
    for kw in surprised_kw:
        if kw in text:
            return "surprised"
    for kw in think_kw:
        if kw in text:
            return "thinking"
    for kw in sad_kw:
        if kw in text:
            return "sad"
    for kw in angry_kw:
        if kw in text:
            return "angry"
    return "neutral"


def _is_casual_chat(question: str) -> bool:
    """判断是否是闲聊/问候类问题（不需要RAG检索，直接LLM聊天）。
    
    使用简单的关键词匹配 + 长度判断：
    - 短问题（<=10字）且包含闲聊关键词 -> 闲聊
    - 纯表情/语气词 -> 闲聊
    
    Args:
        question: 用户问题（已strip）
    
    Returns:
        True 表示是闲聊，不需要RAG检索
    """
    q = question.strip().lower()
    if not q:
        return True
    # 纯语气词/短回复
    if len(q) <= 4:
        return True
    # 关键词匹配
    for pattern in _CHAT_PATTERNS:
        if pattern in q:
            # 如果包含知识检索特征词（"什么是"、"为什么"、"怎么"、"如何"等），即使有问候词也走RAG
            knowledge_words = ["什么是", "为什么", "怎么", "如何", "在哪", "哪里", "哪些", "多少", "几个", "解释", "介绍", "分析", "区别", "原理"]
            if any(kw in q for kw in knowledge_words) and len(q) > 8:
                continue
            return True
    return False


def _call_llm_chat(system_prompt: str, user_prompt: str, temperature: float = 0.7, timeout: int = 90, history_messages: Optional[list] = None) -> Optional[str]:
    """直接调用LLM进行闲聊/对话，不走RAG检索。

    关键设计：
    1. 使用单例线程池_llm_executor（避免每次创建/销毁线程池导致锁问题）
    2. 90秒超时（免费API网络调用较慢，给足够时间）
    3. 失败后30秒冷却期（避免频繁重试）

    Args:
        system_prompt: 系统提示词
        user_prompt: 用户提示词
        temperature: 采样温度
        timeout: 超时秒数
        history_messages: 对话历史 [{role, content}]

    Returns:
        LLM回答文本，失败/超时/不可用返回None
    """
    global _llm_available, _llm_fail_cooldown_until
    import time
    # 线程安全读取冷却截止时间
    with _llm_fail_cooldown_lock:
        cooldown = _llm_fail_cooldown_until
    now = time.time()
    if now < cooldown:
        return None

    def _do_call():
        return _bridge.call_llm(
            user_prompt,
            system_prompt=system_prompt,
            history_messages=history_messages,
            temperature=temperature,
            max_tokens=800,
        )

    try:
        future = _llm_executor.submit(_do_call)
        result = future.result(timeout=timeout)
        # 成功：清空冷却期
        with _llm_fail_cooldown_lock:
            _llm_fail_cooldown_until = 0.0
        if _llm_available is not True:
            _llm_available = True
            print("[GraphPet] LLM已恢复可用", flush=True)
        return result
    except concurrent.futures.TimeoutError:
        print(f"[GraphPet] LLM调用超时({timeout}s)，进入冷却期", file=_sys.stderr, flush=True)
        with _llm_fail_cooldown_lock:
            _llm_fail_cooldown_until = now + 30
        _llm_available = False
        return None
    except Exception as e:
        print(f"[GraphPet] LLM闲聊调用失败: {type(e).__name__}: {e}，进入冷却期", file=_sys.stderr, flush=True)
        with _llm_fail_cooldown_lock:
            _llm_fail_cooldown_until = now + 30
        _llm_available = False
        return None


def _normalize_sources(raw_sources: list) -> list:
    """将 sources 统一转为 [{id, text, score, entity, source_file, source_type}] 格式。

    LightRAG 全换方案后，aquery 不返回独立 sources，本函数主要作为
    兼容兜底（若未来 LightRAG 返回 sources 列表则按原逻辑标准化）。

    兼容兜底处理：
      - dict 列表：取 text / entity 字段 + score
      - (text, score) 元组列表：按位置取
      - 纯文本 str 列表：score 记 0.0

    Args:
        raw_sources: 原始 sources 列表（LightRAG 通常为空）。

    Returns:
        标准化后的 [{id, text, score, entity, source_file, source_type}, ...] 列表。
    """
    if not raw_sources:
        return []

    normalized = []
    for idx, src in enumerate(raw_sources):
        text = ""
        score = 0.0
        entity = ""
        source_type = ""
        source_file = None
        doc_id = None
        meta = {}
        try:
            if isinstance(src, dict):
                text = str(src.get("text", src.get("entity", "")))
                score = float(src.get("score", 0.0))
                entity = str(src.get("entity", ""))
                source_type = str(src.get("source_type", ""))
                source_file = src.get("source_file")
                doc_id = src.get("doc_id")
            elif isinstance(src, (tuple, list)) and len(src) >= 2:
                text = str(src[0])
                score = float(src[1])
                if len(src) >= 3 and isinstance(src[2], dict):
                    meta = src[2]
                    entity = str(meta.get("entity", ""))
                    source_type = str(meta.get("source_type", ""))
                    doc_id = meta.get("doc_id")
            elif isinstance(src, str):
                text = src
                score = 0.0
            else:
                text = str(src)
        except (TypeError, ValueError):
            score = 0.0

        if len(text) > _SOURCE_TEXT_MAX_LEN:
            text = text[:_SOURCE_TEXT_MAX_LEN] + "..."

        if not source_file:
            lookup_meta = meta if meta else (src if isinstance(src, dict) else {})
            source_file = _bridge.get_source_filename_from_meta(lookup_meta)

        normalized.append({
            "id": idx,
            "text": text,
            "score": score,
            "entity": entity,
            "source_file": source_file,
            "doc_id": doc_id,
            "source_type": source_type,
        })
    return normalized


# ========================
# 基础端点
# ========================


@app.get("/health")
def health() -> dict:
    """健康检查端点，供 Electron 主进程轮询就绪状态。

    P1-D：返回 LLM 可用性状态，前端据此显示/隐藏 Ollama 断线提示。
    """
    return {
        "status": "ok",
        "service": "graphpet-backend",
        "version": "0.3.1",
        # P1-D：LLM 可用性（None=未检查/True=可用/False=上次失败）
        # 显式转 bool 避免 None 被序列化成空字符串导致前端无法判断
        "llm_available": bool(_llm_available) if _llm_available is not None else False,
        # 当前 LLM provider（前端据此判断是否需要 Ollama）
        "provider": _bridge.get_llm_config().get("provider", "ollama"),
    }


@app.get("/")
def root() -> dict:
    """根端点，返回简单的欢迎信息与文档地址。"""
    return {
        "name": "GraphPet Backend",
        "docs": "/docs",
        "endpoints": [
            "/health",
            "/feed",
            "/memory/stats",
            "/memory/graph",
            "/memory/files",
            "/memory/export",
            "/memory/spit-last",
            "/chat",
            "/chat/stream",
            "/growth/summary",
            "/proactive/message",
            "/proactive/trivia",
            "/config/llm",
        ],
    }


# ========================
# LLM 配置 API（设置面板接线后端）
# ========================


class LlmConfigRequest(BaseModel):
    """LLM 配置更新请求体（由 Electron 主进程保存设置时 POST）。"""

    llm_provider: str = "ollama"
    llm_api_base: str = Field(
        default="http://localhost:11434",
        validation_alias=AliasChoices("llm_api_base", "ollama_host"),
    )
    llm_model: str = "qwen2.5:7b"
    llm_api_key: str = ""

    model_config = {"populate_by_name": True}

    @field_validator("llm_api_base", "llm_provider", "llm_model", "llm_api_key")
    @classmethod
    def _strip_fields(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v


@app.get("/config/llm")
def get_llm_config() -> dict:
    """获取当前后端 LLM 配置。"""
    return _bridge.get_llm_config()


@app.post("/config/llm")
def set_llm_config(req: LlmConfigRequest) -> dict:
    """更新后端 LLM 配置（由设置面板通过 IPC → main → HTTP 调用）。

    更新后 bridge 会重置 RAG 实例，下次喂食/问答时用新配置重建。
    同时重置 LLM 可用性标志，下次调用时重新探测。
    """
    global _llm_available
    _bridge.update_llm_config(
        provider=req.llm_provider,
        api_base=req.llm_api_base,
        model=req.llm_model,
        api_key=req.llm_api_key,
    )
    _llm_available = None
    return {"success": True, **_bridge.get_llm_config()}


# ========================
# Ollama 检测与模型拉取（P0-D：首启检测引导）
# ========================


class PullRequest(BaseModel):
    """模型拉取请求体。"""

    model: str

    @field_validator("model")
    @classmethod
    def _strip_model(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("model 不能为空")
        return v


@app.get("/ollama/status")
def ollama_status() -> dict:
    """获取 Ollama 服务状态（P0-D：首启检测）。

    返回 {running, host, models, has_required_model, required_model, error}。
    前端据此判断是否需要弹出引导窗。
    """
    return _bridge.get_ollama_status()


async def _ollama_pull_generator(req: PullRequest):
    """SSE 事件生成器：在线程池跑 pull_model_stream，推送拉取进度。

    事件格式：
      event: stage\ndata: {"status":"pulling","progress":42,"message":"下载中 42%"}\n\n
      event: done\ndata: {"status":"done","progress":100,"message":"拉取完成"}\n\n
      event: error\ndata: {"status":"error","progress":0,"message":"拉取失败..."}\n\n
    """
    import queue as _queue

    ev_q: _queue.Queue = _queue.Queue()
    _SENTINEL = object()

    def _emit(status: str, progress: int, message: str):
        ev_q.put({"status": status, "progress": progress, "message": message})

    def _worker():
        try:
            _bridge.pull_model_stream(req.model, emit=_emit)
        except Exception as e:
            ev_q.put({
                "status": "error",
                "progress": 0,
                "message": f"内部错误: {type(e).__name__}: {e}",
            })
        finally:
            ev_q.put(_SENTINEL)

    _llm_executor.submit(_worker)

    try:
        while True:
            try:
                loop = __import__("asyncio").get_event_loop()
                item = await loop.run_in_executor(None, ev_q.get, True, 1.0)
            except Exception:
                continue
            if item is _SENTINEL:
                break
            status = item["status"]
            progress = item["progress"]
            message = item["message"]
            data = {"status": status, "progress": progress, "message": message}
            if status == "done":
                yield f"event: done\ndata: {_json.dumps(data, ensure_ascii=False)}\n\n"
            elif status == "error":
                yield f"event: error\ndata: {_json.dumps(data, ensure_ascii=False)}\n\n"
            else:
                yield f"event: stage\ndata: {_json.dumps(data, ensure_ascii=False)}\n\n"
    except Exception as e:
        print(f"[GraphPet] /ollama/pull 中断: {type(e).__name__}: {e}", file=_sys.stderr, flush=True)


@app.post("/ollama/pull")
async def ollama_pull(req: PullRequest):
    """拉取 Ollama 模型（P0-D：一键 pull），SSE 流式推送下载进度。

    前端用 fetch + ReadableStream 解析 SSE（与 /feed/stream 同模式）。
    """
    return StreamingResponse(
        _ollama_pull_generator(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ========================
# 喂食 API（Task 13）
# ========================


def _feed_sync(req: FeedRequest) -> FeedResponse:
    """喂食 API 的同步核心逻辑，放入线程池执行以避免阻塞事件循环。

    新流程（Docling + LightRAG 全换方案）：
      1. 校验输入 + 文件存在性
      2. 检查 bridge 可用性 + LLM 可用性
      3. 计算指纹 + 去重
      4. Docling 解析文档 → Markdown 文本
      5. LightRAG ainsert 增量插入（自动分块/抽取/向量化/入库）
      6. 记录喂食历史 + 保存本次新增三元组（供文件清单详情查看）
    """
    # ---- 1. 校验输入 ----
    if not req.url and not req.file_path:
        return FeedResponse(
            success=False,
            file_name="",
            entity_count=0,
            chunk_count=0,
            file_fingerprint="",
            message="参数错误",
            error="file_path 和 url 至少需要提供一个",
        )

    # url 优先
    source = req.url or req.file_path
    is_url = bool(req.url)
    file_name = req.url if is_url else os.path.basename(req.file_path)

    # 预估文件大小（用于前端分流提示：small 秒过 / medium 进度条 / large 后台）
    estimated_pages = _estimate_pages(req.file_path, req.url)
    size_category = _categorize_size(estimated_pages)

    # ---- 2. 检查 bridge 可用性 ----
    try:
        _bridge.init_rag()
    except RiceRagNotAvailableError as e:
        return FeedResponse(
            success=False,
            file_name=file_name,
            entity_count=0,
            chunk_count=0,
            file_fingerprint="",
            message="知识图谱系统不可用",
            estimated_pages=estimated_pages,
            size_category=size_category,
            error=str(e),
        )

    # 检查 LLM 可用性（LightRAG 抽取三元组依赖 LLM）
    if not _bridge.has_llm():
        llm_cfg = _bridge.get_llm_config()
        provider = llm_cfg.get("provider", "ollama")
        if provider == "ollama":
            error_msg = "LightRAG 需要 Ollama 才能抽取三元组，请启动 Ollama 服务并确保已拉取配置的模型。"
            message = "Ollama 未运行"
        else:
            error_msg = "LightRAG 需要 LLM 服务才能抽取三元组，请检查 API 配置是否正确。"
            message = "LLM 服务不可用"
        return FeedResponse(
            success=False,
            file_name=file_name,
            entity_count=0,
            chunk_count=0,
            file_fingerprint="",
            message=message,
            estimated_pages=estimated_pages,
            size_category=size_category,
            error=error_msg,
        )

    # ---- 3. 文件存在性检查（本地文件）----
    if not is_url and not os.path.exists(req.file_path):
        return FeedResponse(
            success=False,
            file_name=file_name,
            entity_count=0,
            chunk_count=0,
            file_fingerprint="",
            message="文件不存在",
            estimated_pages=estimated_pages,
            size_category=size_category,
            error=f"找不到文件: {req.file_path}",
        )

    # ---- 4. 计算文件指纹 + 去重检查 ----
    fingerprint = _memory.compute_file_fingerprint(source)
    if _memory.is_file_fed(fingerprint):
        # 已喂食过：从历史记录取 entity_count 返回，跳过重复索引
        fed_files = _memory.get_fed_files()
        prev_count = 0
        for f in fed_files:
            if f.get("fingerprint") == fingerprint:
                prev_count = int(f.get("entity_count", 0))
                break
        _safe_record_interaction("feed")
        return FeedResponse(
            success=True,
            file_name=file_name,
            entity_count=prev_count,
            chunk_count=_memory.get_memory_stats().get("chunk_count", 0),
            file_fingerprint=fingerprint,
            estimated_pages=estimated_pages,
            size_category=size_category,
            message="上次吃过啦，要不要再消化一次？",
            error="already_fed",
        )

    # ---- 5. Docling 解析文档 ----
    try:
        doc_text = _bridge.parse_document(source)
    except Exception as e:
        _state.add_timeline_event("import_failed", file_name)
        return FeedResponse(
            success=False,
            file_name=file_name,
            entity_count=0,
            chunk_count=0,
            file_fingerprint=fingerprint,
            message="文档解析失败",
            estimated_pages=estimated_pages,
            size_category=size_category,
            error=f"{type(e).__name__}: {e}",
        )

    if not doc_text or not doc_text.strip():
        _state.add_timeline_event("import_empty", file_name)
        return FeedResponse(
            success=False,
            file_name=file_name,
            entity_count=0,
            chunk_count=0,
            file_fingerprint=fingerprint,
            message="文档内容为空",
            estimated_pages=estimated_pages,
            size_category=size_category,
            error="Docling 解析后无可用文本内容（可能是空文件、扫描件未开 OCR 或不支持的格式）",
        )

    # ---- 6. LightRAG 增量插入（分块 + LLM 抽取 + 向量化 + 入库）----
    try:
        feed_stats = _bridge.feed_document(doc_text, file_path=fingerprint)
    except RiceRagNotAvailableError as e:
        _state.add_timeline_event("index_failed", file_name)
        return FeedResponse(
            success=False,
            file_name=file_name,
            entity_count=0,
            chunk_count=0,
            file_fingerprint=fingerprint,
            message="知识图谱插入失败",
            estimated_pages=estimated_pages,
            size_category=size_category,
            error=str(e),
        )
    except Exception as e:
        _state.add_timeline_event("index_failed", file_name)
        return FeedResponse(
            success=False,
            file_name=file_name,
            entity_count=0,
            chunk_count=0,
            file_fingerprint=fingerprint,
            message="知识图谱插入失败",
            estimated_pages=estimated_pages,
            size_category=size_category,
            error=f"{type(e).__name__}: {e}",
        )

    entity_count = int(feed_stats.get("entity_count", 0))
    triple_count = int(feed_stats.get("triple_count", 0))
    new_triple_count = int(feed_stats.get("new_triple_count", 0))
    new_triples = feed_stats.get("new_triples", []) or []
    chunk_count = _memory.get_memory_stats().get("chunk_count", 0)

    message = (
        f"喂食成功：本次新增 {new_triple_count} 条三元组，"
        f"图谱共 {entity_count} 个实体、{triple_count} 条三元组。"
    )

    # 记录 fingerprint→filename 映射
    try:
        _bridge.record_file_source(fingerprint, file_name)
    except Exception as e:
        print(f"[GraphPet] 记录文件来源映射失败: {e}", file=_sys.stderr, flush=True)

    # ---- 7. 记录喂食历史 ----
    try:
        _memory.record_fed_file(
            name=file_name,
            fingerprint=fingerprint,
            entity_count=entity_count,
            event="feed",
        )
    except Exception:
        pass

    # 保存本次新增的三元组，供文件清单详情查看
    if new_triples:
        try:
            _memory.save_file_triples(fingerprint, new_triples)
        except Exception as e:
            print(f"[GraphPet] 保存文件三元组失败: {e}", file=_sys.stderr, flush=True)

    # 喂食成功：记录一次互动并提升亲密度
    _safe_record_interaction("feed")

    return FeedResponse(
        success=True,
        file_name=file_name,
        entity_count=entity_count,
        chunk_count=chunk_count,
        file_fingerprint=fingerprint,
        message=message,
        estimated_pages=estimated_pages,
        size_category=size_category,
        error=None,
        # P1-C：返回本次新增的三元组（截断前 50 条避免响应过大）
        new_triples=new_triples[:50] if new_triples else None,
    )


@app.post("/feed", response_model=FeedResponse)
async def feed(req: FeedRequest) -> FeedResponse:
    """喂食 API：导入文件或 URL，抽取三元组并增量索引到知识图谱（异步入口）。

    将 CPU/IO 密集型的同步逻辑整体放入线程池，避免阻塞 FastAPI 事件循环，
    使 /health 轮询、聊天等接口在喂食过程中仍可响应。
    """
    loop = __import__("asyncio").get_event_loop()
    return await loop.run_in_executor(_llm_executor, _feed_sync, req)


# ========================
# 喂食 SSE 流式端点（P0-C：四阶段进度反馈）
# ========================


def _feed_stream_sync(req: FeedRequest, emit) -> None:
    """喂食流式核心逻辑：与 _feed_sync 等价，但通过 emit 推送四阶段进度。

    emit(stage:str, progress:int, message:str, extra:dict|None=None) -> None
    - stage: parsing / preparing / extracting / finalizing / done / error
    - progress: 0-100
    - message: 友好提示
    - extra: 附加数据（done 时带 FeedResponse 字段，error 时带 error 字段）

    任何异常都通过 emit("error", ...) 推送，不再抛出。
    """
    import queue as _queue

    # ---- 1. 校验输入 ----
    if not req.url and not req.file_path:
        emit("error", 0, "参数错误", {"error": "file_path 和 url 至少需要提供一个"})
        return

    source = req.url or req.file_path
    is_url = bool(req.url)
    file_name = req.url if is_url else os.path.basename(req.file_path)
    estimated_pages = _estimate_pages(req.file_path, req.url)
    size_category = _categorize_size(estimated_pages)

    def _base_extra() -> dict:
        return {
            "file_name": file_name,
            "estimated_pages": estimated_pages,
            "size_category": size_category,
        }

    # ---- 2. 检查 bridge 可用性 ----
    try:
        _bridge.init_rag()
    except RiceRagNotAvailableError as e:
        emit("error", 0, "知识图谱系统不可用", {**_base_extra(), "error": str(e)})
        return

    if not _bridge.has_llm():
        llm_cfg = _bridge.get_llm_config()
        provider = llm_cfg.get("provider", "ollama")
        if provider == "ollama":
            error_msg = "LightRAG 需要 Ollama 才能抽取三元组，请启动 Ollama 服务并确保已拉取配置的模型。"
            message = "Ollama 未运行"
        else:
            error_msg = "LightRAG 需要 LLM 服务才能抽取三元组，请检查 API 配置是否正确。"
            message = "LLM 服务不可用"
        emit(
            "error",
            0,
            message,
            {
                **_base_extra(),
                "error": error_msg,
            },
        )
        return

    # ---- 3. 文件存在性检查 ----
    if not is_url and not os.path.exists(req.file_path):
        emit("error", 0, "文件不存在", {**_base_extra(), "error": f"找不到文件: {req.file_path}"})
        return

    # ---- 4. 指纹 + 去重 ----
    fingerprint = _memory.compute_file_fingerprint(source)
    if _memory.is_file_fed(fingerprint):
        fed_files = _memory.get_fed_files()
        prev_count = 0
        for f in fed_files:
            if f.get("fingerprint") == fingerprint:
                prev_count = int(f.get("entity_count", 0))
                break
        _safe_record_interaction("feed")
        emit(
            "done",
            100,
            "上次吃过啦，要不要再消化一次？",
            {
                **_base_extra(),
                "success": True,
                "entity_count": prev_count,
                "chunk_count": _memory.get_memory_stats().get("chunk_count", 0),
                "file_fingerprint": fingerprint,
                "error": "already_fed",
            },
        )
        return

    # ---- 5. 阶段1：Docling 解析文档 ----
    emit("parsing", 8, f"正在解析{'网页' if is_url else '文档'}...")
    try:
        doc_text = _bridge.parse_document(source)
    except Exception as e:
        _state.add_timeline_event("import_failed", file_name)
        emit("error", 0, "文档解析失败", {**_base_extra(), "error": f"{type(e).__name__}: {e}"})
        return

    if not doc_text or not doc_text.strip():
        _state.add_timeline_event("import_empty", file_name)
        emit(
            "error",
            0,
            "文档内容为空",
            {
                **_base_extra(),
                "error": "Docling 解析后无可用文本内容（可能是空文件、扫描件未开 OCR 或不支持的格式）",
            },
        )
        return

    char_count = len(doc_text)
    emit("parsing", 25, f"文档解析完成，共 {char_count} 字")

    # ---- 6. 阶段2-4：bridge 带进度回调的增量插入 ----
    try:
        feed_stats = _bridge.feed_document_with_progress(
            doc_text, file_path=fingerprint, emit=emit
        )
    except RiceRagNotAvailableError as e:
        _state.add_timeline_event("index_failed", file_name)
        emit("error", 0, "知识图谱插入失败", {**_base_extra(), "error": str(e)})
        return
    except Exception as e:
        _state.add_timeline_event("index_failed", file_name)
        emit("error", 0, "知识图谱插入失败", {**_base_extra(), "error": f"{type(e).__name__}: {e}"})
        return

    entity_count = int(feed_stats.get("entity_count", 0))
    triple_count = int(feed_stats.get("triple_count", 0))
    new_triple_count = int(feed_stats.get("new_triple_count", 0))
    new_triples = feed_stats.get("new_triples", []) or []
    chunk_count = _memory.get_memory_stats().get("chunk_count", 0)

    message = (
        f"喂食成功：本次新增 {new_triple_count} 条三元组，"
        f"图谱共 {entity_count} 个实体、{triple_count} 条三元组。"
    )

    try:
        _bridge.record_file_source(fingerprint, file_name)
    except Exception as e:
        print(f"[GraphPet] 记录文件来源映射失败: {e}", file=_sys.stderr, flush=True)

    try:
        _memory.record_fed_file(
            name=file_name,
            fingerprint=fingerprint,
            entity_count=entity_count,
            event="feed",
        )
    except Exception:
        pass

    if new_triples:
        try:
            _memory.save_file_triples(fingerprint, new_triples)
        except Exception as e:
            print(f"[GraphPet] 保存文件三元组失败: {e}", file=_sys.stderr, flush=True)

    _safe_record_interaction("feed")

    # ---- 7. 推送最终 done 事件（携带完整 FeedResponse 字段）----
    emit(
        "done",
        100,
        message,
        {
            **_base_extra(),
            "success": True,
            "entity_count": entity_count,
            "chunk_count": chunk_count,
            "file_fingerprint": fingerprint,
            "error": None,
            # P1-C：返回本次新增的三元组（截断前 50 条避免响应过大）
            "new_triples": new_triples[:50] if new_triples else None,
        },
    )


async def _feed_stream_generator(req: FeedRequest):
    """SSE 事件生成器：在线程池跑 _feed_stream_sync，从队列读取事件转 SSE。

    事件格式：
      event: stage\ndata: {"stage":"parsing","progress":8,"message":"..."}\n\n
      event: done\ndata: {FeedResponse字段...}\n\n
      event: error\ndata: {"error":"...","file_name":"..."}\n\n
    """
    import queue as _queue

    ev_q: _queue.Queue = _queue.Queue()
    _SENTINEL = object()

    def _emit(stage: str, progress: int, message: str, extra: dict | None = None):
        ev_q.put({"stage": stage, "progress": progress, "message": message, "extra": extra or {}})

    def _worker():
        try:
            _feed_stream_sync(req, _emit)
        except Exception as e:
            ev_q.put({
                "stage": "error",
                "progress": 0,
                "message": f"内部错误: {type(e).__name__}: {e}",
                "extra": {"error": str(e)},
            })
        finally:
            ev_q.put(_SENTINEL)

    # 在单例线程池里跑同步喂食逻辑，避免阻塞 FastAPI 事件循环
    _llm_executor.submit(_worker)

    try:
        while True:
            try:
                # 用 yield from asyncio.wait_for 配合 run_in_executor 阻塞读队列
                loop = __import__("asyncio").get_event_loop()
                item = await loop.run_in_executor(None, ev_q.get, True, 1.0)
            except Exception:
                # 队列 get 超时（1s），继续循环以便客户端断开时能抛 CancelledError
                continue
            if item is _SENTINEL:
                break
            stage = item["stage"]
            progress = item["progress"]
            message = item["message"]
            extra = item["extra"] or {}
            # 合并 data：基础字段 + extra
            data = {"stage": stage, "progress": progress, "message": message, **extra}
            # done 事件携带完整 FeedResponse 字段，前端据此构造 FeedResponse
            if stage == "done":
                yield f"event: done\ndata: {_json.dumps(data, ensure_ascii=False)}\n\n"
            elif stage == "error":
                yield f"event: error\ndata: {_json.dumps(data, ensure_ascii=False)}\n\n"
            else:
                yield f"event: stage\ndata: {_json.dumps(data, ensure_ascii=False)}\n\n"
    except Exception as e:
        # 客户端断开或其他异常：记录日志，不抛
        print(f"[GraphPet] /feed/stream 中断: {type(e).__name__}: {e}", file=_sys.stderr, flush=True)


@app.post("/feed/stream")
async def feed_stream(req: FeedRequest):
    """喂食 SSE 流式端点（P0-C）：推送四阶段进度 + 最终结果。

    阶段：parsing(0-25%) → preparing(30-40%) → extracting(40-85%) → finalizing(85-95%) → done(100%)
    错误：event: error，data 含 error 字段
    完成：event: done，data 含完整 FeedResponse 字段

    前端用 fetch + ReadableStream 解析 SSE（EventSource 不支持 POST）。
    """
    return StreamingResponse(
        _feed_stream_generator(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # 禁用 nginx 缓冲（虽然本地无 nginx）
            "Connection": "keep-alive",
        },
    )


# ========================
# 记忆统计 API
# ========================


@app.get("/memory/stats")
def memory_stats() -> dict:
    """返回当前知识图谱统计。

    通过 graphpet_rag_bridge.get_kg_stats() 读 graph_chunk_entity_relation.graphml
    统计实体数、三元组数、关系数；chunk 数读 kv_store_text_chunks.json；
    以及 graphpet_state.json 中已吃文件数。同时返回已吃文件列表。

    即使 bridge 未安装或图谱未建好，本端点也返回安全的空统计（available=False）。
    """
    stats = _memory.get_memory_stats()
    stats["fed_files"] = _memory.get_fed_files()
    return stats


# ========================
# 记忆图谱 / 文件管理 API（Task 25 / 26 / 28）
# ========================


@app.get("/memory/graph")
def memory_graph() -> dict:
    """返回知识图谱三元组列表，供前端力导向图可视化（Task 25）。

    通过 graphpet_rag_bridge.get_triples_list() 读 graphml 的边，
    解析为 [{head, relation, tail}]，限制返回 200 条避免前端卡顿。
    图谱缺失时返回空列表。
    """
    triples = _memory.get_triples_list(limit=200)
    return {"triples": triples, "count": len(triples)}


@app.get("/memory/files")
def memory_files() -> dict:
    """返回已吃文件列表（Task 26 文件清单页）。

    Returns:
        {"files": [{name, fingerprint, entity_count, triples_count, fed_at}, ...]}
    """
    files = _memory.get_fed_files()
    for f in files:
        fp = f.get("fingerprint", "")
        triples = _memory.get_file_triples(fp) if fp else []
        f["triples_count"] = len(triples)
    return {"files": files}


@app.delete("/memory/file/{fingerprint}")
def delete_memory_file(fingerprint: str) -> dict:
    """删除指定文件的记忆（Task 26 文件清单删除按钮）。

    删除 fed_files 中对应记录。LightRAG 不支持按文档删除已抽取的实体/关系，
    仅清理本地喂食记录 + file_triples 详情 + file_sources 映射。
    """
    return _memory.remove_fed_file(fingerprint)


@app.get("/memory/file/{fingerprint}/triples")
def memory_file_triples(fingerprint: str) -> dict:
    """返回指定文件抽取的三元组列表（文件清单详情展开）。

    读取 file_triples/file_triples_{fingerprint}.json，返回该文件喂食时
    抽取到的三元组，供前端文件清单点击展开查看。

    Returns:
        {"fingerprint": str, "triples": [{head, relation, tail}], "count": int}
    """
    triples = _memory.get_file_triples(fingerprint)
    return {
        "fingerprint": fingerprint,
        "triples": triples,
        "count": len(triples),
    }


@app.get("/memory/export")
def memory_export() -> dict:
    """导出记忆为 JSON（Task 26 导出按钮）。

    汇总知识图谱统计、三元组列表、已吃文件列表、时间线事件，
    便于用户备份或迁移。
    """
    stats = _memory.get_memory_stats()
    triples = _memory.get_triples_list(limit=10000)
    state = _state.load_state()
    return {
        "stats": stats,
        "triples": triples,
        "fed_files": [f.to_dict() for f in state.fed_files],
        "memory_timeline": [e.to_dict() for e in state.memory_timeline],
        "growth": _growth.get_growth_summary(),
    }


@app.post("/memory/spit-last")
def spit_last() -> dict:
    """吐掉最近吃的文件记忆（Task 28 快捷撤回）。

    从 fed_files 取最后一项删除，返回删除结果。
    """
    return _memory.remove_last_fed_file()


# ========================
# 养成状态 API（Task 20）
# ========================


@app.get("/growth/summary")
def growth_summary() -> dict:
    """返回当前养成状态摘要（智力 / 亲密度 / 性格 / 喂食 / 互动）。

    供前端养成面板与桌宠气泡展示。智力等级直接映射知识图谱实体规模，
    亲密度由互动频次映射，性格随喂养内容演化。
    """
    return _growth.get_growth_summary()


# ========================
# 问答 API（Task 18）
# ========================


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    """问答 API：调用 LightRAG.aquery() 基于知识图谱回答用户问题。

    流程：
      0. 判断是否是闲聊/问候（关键词匹配），是则直接 LLM 聊天不走 RAG
      1. 检查 LLM 配置（生成回答依赖 Ollama）
      2. 检查 bridge 可用性 + 索引非空（没喂过文件则无法知识问答，可闲聊）
      3. 调用 _bridge.query(question, mode=search_mode, history=...)
      4. 标准化 sources 格式并返回
    """
    # Nito 的人设提示词（用于闲聊模式）
    NITO_SYSTEM_PROMPT = """你是Nito（尼托），一个可爱的桌面宠物小精灵。
你的性格：活泼可爱、有点小傲娇、对主人忠心耿耿、喜欢吃东西（知识就是你的食物）、会撒娇。
说话风格：简短自然，用口语化的中文，像可爱的小动物一样说话。不要使用markdown格式，不要长篇大论。
你的能力：主人喂给你文件/网页，你会把知识消化到知识图谱里，然后可以回答主人关于这些知识的问题。
记住：你住在主人的电脑桌面上，是主人专属的桌面宠物。请用简短可爱的语气回复主人，每次回复控制在1-3句话以内。"""

    # ---- 0. 检查 LLM 配置（闲聊也需要 LLM）----
    if not _bridge.has_llm():
        return ChatResponse(
            success=False,
            answer="",
            sources=[],
            pipeline_info={},
            message="LLM 未配置",
            error="LLM 服务未运行或配置错误，无法生成回答",
        )

    # ---- 0.5 处理多轮对话历史 ----
    history_context = ""
    llm_history_messages = []
    raw_history = req.history_messages or req.history
    if raw_history and isinstance(raw_history, list) and len(raw_history) > 0:
        max_history_turns = 6
        recent_history = raw_history[-max_history_turns:]
        for msg in recent_history:
            if not isinstance(msg, dict):
                continue
            role = msg.get("role", "")
            content = msg.get("content", "")
            if not content:
                continue
            normalized_role = "user" if role == "user" else "assistant"
            llm_history_messages.append({"role": normalized_role, "content": content})
            if role == "user":
                history_context += f"主人：{content}\n"
            elif role == "assistant" or role == "nito":
                history_context += f"Nito：{content}\n"

    # ---- 0.6 判断是否闲聊：关键词匹配或search_mode显式指定为'chat' ----
    is_casual = (req.search_mode == "chat") or _is_casual_chat(req.question)

    # ---- 闲聊模式：直接调用LLM，不走RAG ----
    if is_casual:
        answer_text = _call_llm_chat(
            NITO_SYSTEM_PROMPT,
            req.question,
            temperature=0.8,
            history_messages=llm_history_messages,
        )
        if answer_text is None:
            fallback_replies = [
                "嗯...我好像有点困了，让我休息一下~",
                "呜呜，脑子转不动了，等会儿再聊好不好？",
                "我在呢！但是现在有点走神了...",
            ]
            answer_text = random.choice(fallback_replies)
        _safe_record_interaction("chat")
        return ChatResponse(
            success=True,
            answer=answer_text.strip(),
            sources=[],
            pipeline_info={
                "mode": "casual_chat",
                "question_type": "casual",
            },
            message="闲聊完成",
            error=None,
            emotion=_detect_emotion(answer_text),
        )

    # ---- 1. 检查 bridge 可用性 ----
    try:
        _bridge.init_rag()
    except RiceRagNotAvailableError:
        return ChatResponse(
            success=False,
            answer="",
            sources=[],
            pipeline_info={},
            message="知识图谱系统不可用",
            error="LightRAG 未安装或初始化失败",
        )

    # ---- 2. 检查索引非空（知识问答需要先喂文件）----
    stats = _memory.get_memory_stats()
    if not stats.get("available", False):
        no_knowledge_prompt = NITO_SYSTEM_PROMPT + "\n注意：你还没有吃过任何文件，所以你没有知识储备来回答知识类问题。请告诉主人你还没有学习过相关内容，请主人先喂你一些文件/网页。"
        answer_text = _call_llm_chat(
            no_knowledge_prompt,
            req.question,
            temperature=0.7,
            history_messages=llm_history_messages,
        )
        if answer_text is None:
            answer_text = "我还没吃过任何文件呢，肚子空空的~先喂我一些文件吧，这样我就能回答你的问题啦！"
        _safe_record_interaction("chat")
        return ChatResponse(
            success=True,
            answer=answer_text.strip(),
            sources=[],
            pipeline_info={
                "mode": "no_knowledge_chat",
                "question_type": "casual",
            },
            message="没有知识，用闲聊兜底",
            error=None,
            emotion=_detect_emotion(answer_text),
        )

    # ---- 3. 调用 LightRAG aquery（检索 + LLM 生成），加 60 秒超时保护 ----
    # LightRAG 检索 + LLM 生成可能较慢，给 60s（流式版会更友好）
    mode = req.search_mode or "hybrid"
    # LightRAG 支持的 mode：local / global / hybrid / mix / naive
    if mode not in ("local", "global", "hybrid", "mix", "naive"):
        mode = "hybrid"

    # 把对话历史转为 LightRAG 的 conversation_history 格式
    conv_history = []
    if raw_history:
        for msg in raw_history[-6:]:
            if isinstance(msg, dict) and msg.get("content"):
                conv_history.append({
                    "role": msg.get("role", "user"),
                    "content": msg.get("content", ""),
                })

    try:
        def _do_rag():
            return _bridge.query(req.question, mode=mode, history=conv_history or None)
        future = _llm_executor.submit(_do_rag)
        result = future.result(timeout=60)
    except concurrent.futures.TimeoutError:
        fallback_replies = [
            "这个问题我想了好久还是没想明白...换个简单点的问题吧~",
            "我脑子转得有点慢，等会儿再问好不好？喵~",
            "知识太多啦，我找了半天没找到...要不喂我点相关的文件？"
        ]
        fallback_text = random.choice(fallback_replies)
        return ChatResponse(
            success=True,
            answer=fallback_text,
            sources=[],
            pipeline_info={"mode": "rag_timeout", "question_type": "qa"},
            message="问答超时，已使用兜底回复",
            error=None,
            emotion=_detect_emotion(fallback_text),
        )
    except Exception as e:
        err_text = f"{type(e).__name__}: {e}"
        return ChatResponse(
            success=False,
            answer="",
            sources=[],
            pipeline_info={},
            message="问答失败",
            error=err_text,
            emotion="sad",
        )

    # ---- 4. 标准化输出 ----
    answer_text = str(result.get("answer", "") or "")
    raw_sources = result.get("sources", []) or []
    sources = _normalize_sources(raw_sources)
    pipeline_info = {"mode": "rag_qa", "lightrag_mode": mode}

    _safe_record_interaction("chat")

    return ChatResponse(
        success=True,
        answer=answer_text,
        sources=sources,
        pipeline_info=pipeline_info,
        message="问答完成",
        error=None,
        emotion=_detect_emotion(answer_text),
    )


# ========================
# 流式问答 API（SSE）
# ========================


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """流式问答 API：使用 SSE (Server-Sent Events) 实时返回回答。

    与 /chat 逻辑一致，但通过 StreamingResponse 以 text/event-stream 格式
    实时推送状态更新和文本片段。客户端应使用 EventSource 或 fetch + ReadableStream 消费。

    SSE 事件格式：
      data: {"type": "status", "message": "正在检索知识库..."}
      data: {"type": "chunk", "content": "部分文本...", "full_answer": "累积的完整回答..."}
      data: {"type": "sources", "sources": [...]}
      data: {"type": "done", "answer": "...", "sources": [...], "pipeline_info": {...}}
      data: {"type": "error", "message": "..."}
    """
    NITO_SYSTEM_PROMPT = """你是Nito（尼托），一个可爱的桌面宠物小精灵。
你的性格：活泼可爱、有点小傲娇、对主人忠心耿耿、喜欢吃东西（知识就是你的食物）、会撒娇。
说话风格：简短自然，用口语化的中文，像可爱的小动物一样说话。不要使用markdown格式，不要长篇大论。
你的能力：主人喂给你文件/网页，你会把知识消化到知识图谱里，然后可以回答主人关于这些知识的问题。
记住：你住在主人的电脑桌面上，是主人专属的桌面宠物。请用简短可爱的语气回复主人，每次回复控制在1-3句话以内。"""

    def _sse_event(data: dict) -> str:
        return f"data: {_json.dumps(data, ensure_ascii=False)}\n\n"

    def _generate():
        try:
            # 检查 LLM 配置
            if not _bridge.has_llm():
                yield _sse_event({"type": "error", "message": "LLM 未配置，无法生成回答"})
                return

            # 处理多轮对话历史
            history_context = ""
            llm_history_messages = []
            raw_history = req.history_messages or req.history
            if raw_history and isinstance(raw_history, list) and len(raw_history) > 0:
                max_history_turns = 6
                recent_history = raw_history[-max_history_turns:]
                for msg in recent_history:
                    if not isinstance(msg, dict):
                        continue
                    role = msg.get("role", "")
                    content = msg.get("content", "")
                    if not content:
                        continue
                    normalized_role = "user" if role == "user" else "assistant"
                    llm_history_messages.append({"role": normalized_role, "content": content})
                    if role == "user":
                        history_context += f"主人：{content}\n"
                    elif role == "assistant" or role == "nito":
                        history_context += f"Nito：{content}\n"

            is_casual = (req.search_mode == "chat") or _is_casual_chat(req.question)

            # 闲聊模式
            if is_casual:
                yield _sse_event({"type": "status", "message": "正在思考..."})
                answer_text = _call_llm_chat(
                    NITO_SYSTEM_PROMPT,
                    req.question,
                    temperature=0.8,
                    history_messages=llm_history_messages,
                )
                if answer_text is None:
                    import random as _rnd
                    fallback_replies = [
                        "嗯...我好像有点困了，让我休息一下~",
                        "呜呜，脑子转不动了，等会儿再聊好不好？",
                        "我在呢！但是现在有点走神了...",
                    ]
                    answer_text = _rnd.choice(fallback_replies)
                answer_text = answer_text.strip()
                yield _sse_event({"type": "chunk", "content": answer_text, "full_answer": answer_text})
                yield _sse_event({
                    "type": "done",
                    "answer": answer_text,
                    "sources": [],
                    "pipeline_info": {"mode": "casual_chat", "question_type": "casual"},
                    "emotion": _detect_emotion(answer_text),
                })
                _safe_record_interaction("chat")
                return

            # 检查 bridge 可用性
            try:
                _bridge.init_rag()
            except RiceRagNotAvailableError:
                yield _sse_event({"type": "error", "message": "LightRAG 未安装或初始化失败"})
                return

            # 检查索引非空
            stats = _memory.get_memory_stats()
            if not stats.get("available", False):
                yield _sse_event({"type": "status", "message": "我还没吃过任何文件呢..."})
                no_knowledge_prompt = NITO_SYSTEM_PROMPT + "\n注意：你还没有吃过任何文件，所以你没有知识储备来回答知识类问题。请告诉主人你还没有学习过相关内容，请主人先喂你一些文件/网页。"
                answer_text = _call_llm_chat(
                    no_knowledge_prompt,
                    req.question,
                    temperature=0.7,
                    history_messages=llm_history_messages,
                )
                if answer_text is None:
                    answer_text = "我还没吃过任何文件呢，肚子空空的~先喂我一些文件吧，这样我就能回答你的问题啦！"
                answer_text = answer_text.strip()
                yield _sse_event({"type": "chunk", "content": answer_text, "full_answer": answer_text})
                yield _sse_event({
                    "type": "done",
                    "answer": answer_text,
                    "sources": [],
                    "pipeline_info": {"mode": "no_knowledge_chat", "question_type": "casual"},
                    "emotion": _detect_emotion(answer_text),
                })
                _safe_record_interaction("chat")
                return

            # 把对话历史转为 LightRAG 的 conversation_history 格式
            conv_history = []
            if raw_history:
                for msg in raw_history[-6:]:
                    if isinstance(msg, dict) and msg.get("content"):
                        conv_history.append({
                            "role": msg.get("role", "user"),
                            "content": msg.get("content", ""),
                        })

            # LightRAG 支持的 mode
            mode = req.search_mode or "hybrid"
            if mode not in ("local", "global", "hybrid", "mix", "naive"):
                mode = "hybrid"

            yield _sse_event({"type": "status", "message": "正在检索知识图谱..."})

            # 调用 _bridge.query_stream（真正的流式输出）
            full_answer = ""

            try:
                for event in _bridge.query_stream(req.question, mode=mode, history=conv_history or None):
                    if not isinstance(event, dict):
                        continue
                    etype = event.get("type")
                    if etype == "chunk":
                        chunk_text = event.get("content", "")
                        fa = event.get("full_answer", "")
                        if fa:
                            full_answer = fa
                        else:
                            full_answer += chunk_text
                        yield _sse_event({
                            "type": "chunk",
                            "content": chunk_text,
                            "full_answer": full_answer,
                        })
                    elif etype == "error":
                        yield _sse_event({"type": "error", "message": event.get("message", "未知错误")})
                        return

            except Exception as e:
                err_msg = f"{type(e).__name__}: {e}"
                if "timeout" in str(e).lower() or "timed out" in str(e).lower():
                    import random as _rnd
                    fallback_replies = [
                        "这个问题我想了好久还是没想明白...换个简单点的问题吧~",
                        "我脑子转得有点慢，等会儿再问好不好？喵~",
                        "知识太多啦，我找了半天没找到...要不喂我点相关的文件？"
                    ]
                    answer_text = _rnd.choice(fallback_replies)
                    yield _sse_event({"type": "chunk", "content": answer_text, "full_answer": answer_text})
                    yield _sse_event({
                        "type": "done",
                        "answer": answer_text,
                        "sources": [],
                        "pipeline_info": {"mode": "rag_timeout", "question_type": "qa"},
                        "emotion": _detect_emotion(answer_text),
                    })
                    _safe_record_interaction("chat")
                    return
                yield _sse_event({"type": "error", "message": f"问答失败: {err_msg}"})
                return

            final_pipeline = {"mode": "rag_qa", "lightrag_mode": mode}

            yield _sse_event({
                "type": "done",
                "answer": full_answer,
                "sources": [],
                "pipeline_info": final_pipeline,
                "emotion": _detect_emotion(full_answer),
            })
            _safe_record_interaction("chat")

        except Exception as e:
            yield _sse_event({"type": "error", "message": f"服务器错误: {type(e).__name__}: {e}"})

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ========================
# 主动对话 API（Task 21）
# ========================


def _call_with_timeout(func, timeout_sec=10, default=None):
    """在线程池中调用函数，超时返回default值。用于保护所有LLM调用不阻塞服务器。
    使用单例线程池_llm_executor避免资源泄漏。"""
    try:
        future = _llm_executor.submit(func)
        return future.result(timeout=timeout_sec)
    except Exception:
        return default


@app.get("/proactive/message")
def proactive_message() -> dict:
    """主动对话端点（Task 21）：供前端轮询。所有LLM调用加3秒超时保护，避免阻塞服务器。"""
    settings = _load_settings_field()
    try:
        interval_min = int(settings.get("proactiveIntervalMin", 30))
    except (TypeError, ValueError):
        interval_min = 30
    quiet_mode = bool(settings.get("quietMode", False))

    _proactive_scheduler.update_config(interval_min, quiet_mode)

    if not _proactive_scheduler.should_trigger():
        return {"should_speak": False, "message": "", "trigger_type": ""}

    trigger_type = _proactive_scheduler.get_trigger_type()
    # generate_message内部可能调用LLM生成冷知识，加10秒超时保护
    message = _call_with_timeout(
        lambda: _proactive_scheduler.generate_message(trigger_type),
        timeout_sec=10,
        default="在呢~有什么想聊的吗？"
    )
    _proactive_scheduler.mark_triggered()

    return {"should_speak": True, "message": message or "在呢~", "trigger_type": trigger_type}


# ========================
# 冷知识分享 API（Task 22）
# ========================


@app.get("/proactive/trivia")
def proactive_trivia() -> dict:
    """冷知识分享端点（Task 22）：从知识图谱抽三元组改写为口语化冷知识。

    GraphPet 的创新点：让桌宠主动"炫耀"学到的知识。前端可在用户点击
    "炫耀一下"按钮、或桌宠达到新智力等级时调用本端点。

    流程：
      1. get_random_triple() 从 triples_manifest.json 随机抽一个三元组
      2. rewrite_triple_to_trivia() 调用 LLM 改写为冷知识
         （LLM 未配置 / 失败时退化为模板 "你知道吗？{h}{r}{t}哦~"）
      3. 知识图谱为空（没喂过文件）时返回 success=False, trivia=None

    响应：
      { "success": bool, "trivia": str | None, "triple": dict | None,
        "error": str | None }
      - 成功：success=True, trivia=冷知识文案, triple=对应三元组, error=None
      - 知识图谱为空：success=False, trivia=None, triple=None,
        error="知识图谱为空，先喂我一些文件吧~"
    """
    try:
        triple = _knowledge_share.get_random_triple()
    except Exception as e:
        return {
            "success": False,
            "trivia": None,
            "triple": None,
            "error": f"读取三元组失败: {type(e).__name__}: {e}",
        }

    if triple is None:
        return {
            "success": False,
            "trivia": None,
            "triple": None,
            "error": "知识图谱为空，先喂我一些文件吧~",
        }

    # rewrite_triple_to_trivia 会调用LLM，加5秒超时保护
    trivia = _call_with_timeout(
        lambda: _knowledge_share.rewrite_triple_to_trivia(triple),
        timeout_sec=5,
        default=f"你知道吗？{triple['head']}{triple['relation']}{triple['tail']}哦~"
    )

    return {
        "success": True,
        "trivia": trivia or f"你知道吗？{triple['head']}{triple['relation']}{triple['tail']}哦~",
        "triple": triple,
        "error": None,
    }


# ========================
# TTS 语音合成 API（edge-tts 集成）
# ========================


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500, description="要合成的文本")
    voice: str = Field("zh-CN-XiaoyiNeural", description="edge-tts 语音角色")


@app.post("/tts")
async def text_to_speech(req: TTSRequest):
    """TTS 语音合成端点：用 edge-tts（微软免费TTS）将文本转为 mp3 音频流。

    无需 API Key，中文质量好，延迟约 1-2 秒。
    默认语音 zh-CN-XiaoyiNeural（晓伊，年轻女声，适合桌宠角色）。

    返回 audio/mpeg 流，前端可直接用 <audio> 或 Audio API 播放。
    失败时返回 JSON + HTTP 500，前端按 content-type 判断错误。
    """
    try:
        import edge_tts
        from io import BytesIO

        communicate = edge_tts.Communicate(req.text, req.voice)
        audio_buffer = BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_buffer.write(chunk["data"])
        audio_buffer.seek(0)
        return StreamingResponse(audio_buffer, media_type="audio/mpeg")
    except ImportError:
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": "edge-tts 未安装，请运行 pip install edge-tts"}
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": f"TTS 合成失败: {type(e).__name__}: {e}"}
        )


@app.get("/tts/voices")
async def list_tts_voices():
    """列出可用的 edge-tts 中文语音角色。"""
    try:
        import edge_tts
        voices = await edge_tts.list_voices()
        zh_voices = [
            {"name": v["ShortName"], "gender": v["Gender"], "friendly_name": v["FriendlyName"]}
            for v in voices
            if v["ShortName"].startswith("zh-CN")
        ]
        return {"voices": zh_voices, "count": len(zh_voices)}
    except Exception as e:
        return {"voices": [], "error": str(e)}


# ========================
# 启动入口
# ========================


if __name__ == "__main__":
    # 端口固定 8765
    # 使用单 worker + 限流并发，避免 LLM 慢请求拖垮服务
    uvicorn.run(app, host="127.0.0.1", port=8765, loop="asyncio", workers=1, limit_concurrency=20)
