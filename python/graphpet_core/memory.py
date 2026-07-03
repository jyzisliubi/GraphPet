"""GraphPet 记忆管理模块。

负责读取知识图谱状态（实体数 / 三元组数 / 已吃文件数），并提供文件
指纹计算与去重检查。

依赖：
  - graphpet_rag_bridge（Docling + LightRAG 全换方案）：图谱统计与三元组
    列表通过 bridge 的 get_kg_stats / get_triples_list 获取，读 LightRAG
    工作目录下的 graph_chunk_entity_relation.graphml（networkx）。
  - graphpet_state.json 的 state.fed_files（由 graphpet_core.state 管理）。

所有函数在 bridge 未安装 / 图谱文件缺失时返回安全的空结果，
不抛异常（保证 /memory/stats 端点始终可用）。
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from typing import Any, Dict, List, Optional

from . import state as _state


def _get_bridge():
    """延迟加载 graphpet_rag_bridge，避免在 import 时触发重型依赖。

    返回 None 表示 bridge 不可用，调用方应回退到空结果。
    """
    try:
        import sys as _sys

        _py_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if _py_dir not in _sys.path:
            _sys.path.insert(0, _py_dir)
        import graphpet_rag_bridge as _bridge  # noqa: F401

        return _bridge
    except Exception:
        return None


def _get_index_dir() -> str:
    """获取 LightRAG 工作目录路径（兼容旧 API 名称）。

    LightRAG 全换方案后，知识图谱数据存放在 graphpet_rag_bridge.WORKING_DIR，
    默认 d:\\GraphPet\\graphpet_kg\\。这里读 bridge 模块属性；bridge 未安装
    时兜底到默认路径。
    """
    bridge = _get_bridge()
    if bridge is not None:
        try:
            return getattr(bridge, "WORKING_DIR", r"d:\GraphPet\graphpet_kg")
        except Exception:
            pass
    return r"d:\GraphPet\graphpet_kg"


def _read_json(path: str, default: Any) -> Any:
    """安全读取 JSON 文件，失败返回 default。"""
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError, ValueError):
        return default


def get_memory_stats() -> Dict[str, Any]:
    """读取知识图谱统计（实体数 / 三元组数 / 关系数 / chunk 数）。

    LightRAG 全换方案后，通过 graphpet_rag_bridge.get_kg_stats() 读
    graph_chunk_entity_relation.graphml 统计节点数 / 边数 / 不同关系数；
    chunk 数读 kv_store_text_chunks.json。

    Returns:
        {
          "entity_count": int,      # 实体总数（graphml 节点数）
          "triple_count": int,      # 三元组总数（graphml 边数）
          "fed_file_count": int,    # 已吃文件数（graphpet_state.json）
          "chunk_count": int,       # chunk 总数（kv_store_text_chunks.json）
          "relation_count": int,    # 不同关系数（graphml 边 label 去重）
          "index_dir": str,         # LightRAG 工作目录
          "available": bool,        # 图谱是否已有数据
        }
    """
    index_dir = _get_index_dir()
    bridge = _get_bridge()

    entity_count = 0
    triple_count = 0
    relation_count = 0
    chunk_count = 0
    available = False

    if bridge is not None:
        try:
            stats = bridge.get_kg_stats()
            entity_count = int(stats.get("entity_count", 0))
            triple_count = int(stats.get("triple_count", 0))
            relation_count = int(stats.get("relation_count", 0))
            available = bool(stats.get("available", False))
        except Exception as e:
            print(
                f"[GraphPet] 读取图谱统计失败: {type(e).__name__}: {e}",
                file=sys.stderr,
                flush=True,
            )
        try:
            chunk_count = int(bridge.get_chunk_count())
        except Exception:
            pass

    fed_state = _state.load_state()
    fed_file_count = len(fed_state.fed_files)

    return {
        "entity_count": entity_count,
        "triple_count": triple_count,
        "fed_file_count": fed_file_count,
        "chunk_count": chunk_count,
        "relation_count": relation_count,
        "index_dir": index_dir,
        "available": available,
    }


def get_fed_files() -> List[Dict[str, Any]]:
    """获取已吃文件列表（来自 graphpet_state.json 的 state.fed_files）。

    Returns:
        [{ name, fingerprint, entity_count, fed_at }, ...]
    """
    fed_state = _state.load_state()
    return [f.to_dict() for f in fed_state.fed_files]


def get_fed_docs_from_rice_rag() -> Dict[str, List[str]]:
    """读取 LightRAG 的 file_sources.json（fingerprint -> filename 映射）。

    兼容旧 API 名称（rice_rag 时代的 docs_manifest.json 已废弃）。
    LightRAG 全换方案后，文件来源由 graphpet_rag_bridge 管理，
    这里返回 fingerprint -> [filename] 的映射供旧调用方使用。

    Returns:
        { fingerprint: [filename], ... }
    """
    bridge = _get_bridge()
    if bridge is None:
        return {}
    try:
        sources = bridge.load_file_sources()
        return {fp: [name] for fp, name in sources.items()}
    except Exception:
        return {}


def compute_file_fingerprint(file_path_or_url: str) -> str:
    """计算文件 / URL 的 MD5 指纹。

    - 文件路径（本地存在）：md5(文件字节内容)，稳定反映文件内容变化。
    - URL 或不存在的路径：md5(字符串本身)，避免抓取网络内容造成指纹漂移。

    Args:
        file_path_or_url: 文件绝对路径或 URL 字符串。

    Returns:
        32 位小写十六进制 MD5 摘要。
    """
    # URL 或本地不存在的路径：直接对字符串求 MD5
    if file_path_or_url.startswith(("http://", "https://")):
        return hashlib.md5(file_path_or_url.encode("utf-8")).hexdigest()

    if not os.path.exists(file_path_or_url):
        # 既不是 URL 也不是已存在文件：按字符串处理
        return hashlib.md5(file_path_or_url.encode("utf-8")).hexdigest()

    # 本地文件：分块读取求 MD5，避免大文件一次性占用内存
    md5 = hashlib.md5()
    try:
        with open(file_path_or_url, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                md5.update(chunk)
        return md5.hexdigest()
    except OSError:
        # 读取失败（权限等）：退化为字符串指纹
        return hashlib.md5(file_path_or_url.encode("utf-8")).hexdigest()


def is_file_fed(fingerprint: str) -> bool:
    """检查指定指纹的文件是否已经喂食过（用于去重）。

    Args:
        fingerprint: 文件 MD5 指纹。

    Returns:
        True 表示已吃过，应跳过重复喂食。
    """
    if not fingerprint:
        return False
    fed_state = _state.load_state()
    return any(f.fingerprint == fingerprint for f in fed_state.fed_files)


def record_fed_file(
    name: str,
    fingerprint: str,
    entity_count: int,
    event: str = "feed",
) -> None:
    """记录一次喂食到 graphpet_state.json 的 state.fed_files。

    同时追加一条 memory_timeline 事件。

    Args:
        name: 文件名或 URL。
        fingerprint: 文件 MD5 指纹。
        entity_count: 本次抽取到的实体数。
        event: 时间线事件标签，默认 "feed"。
    """
    _state.add_fed_file(
        name=name,
        fingerprint=fingerprint,
        entity_count=entity_count,
        event=event,
    )


# ========================
# 三元组列表 / 文件删除（Task 25 / 26 / 28）
# ========================


def get_triples_list(limit: int = 200) -> List[Dict[str, str]]:
    """从 LightRAG graphml 读取三元组列表（用于前端图谱可视化）。

    LightRAG 全换方案后，三元组来自 graph_chunk_entity_relation.graphml 的边，
    每条边解析为 {head, relation, tail}：
      - head = 源节点 id
      - tail = 目标节点 id
      - relation = 边的 label（LightRAG 中是关系描述）

    Args:
        limit: 最多返回的三元组数量，默认 200。

    Returns:
        [{"head": str, "relation": str, "tail": str}, ...]；图谱缺失时返回空列表。
    """
    bridge = _get_bridge()
    if bridge is None:
        return []
    try:
        return bridge.get_triples_list(limit=limit)
    except Exception as e:
        print(
            f"[GraphPet] 读取三元组列表失败: {type(e).__name__}: {e}",
            file=sys.stderr,
            flush=True,
        )
        return []


def remove_fed_file(fingerprint: str) -> Dict[str, Any]:
    """删除指定指纹的喂食记录（LightRAG 不支持文档级删除，仅清本地记录）。

    流程：
      1. 在 fed_files 中查找对应记录（取文件名与实体数用于返回）
      2. 从 fed_files 移除该记录，追加 timeline 事件
      3. 持久化 state
      4. 清理 file_triples 详情存储 + file_sources 映射

    注意：LightRAG 的 ainsert 是增量累加的，当前版本（1.5.x）不支持
    按文档 ID 删除已抽取的实体/关系。因此"吐掉"只会清理本地喂食记录，
    知识图谱中的内容仍保留（若需完全清除，需重置 graphpet_kg 目录）。

    Args:
        fingerprint: 文件 MD5 指纹。

    Returns:
        {"success": bool, "name": str, "entity_count": int, "message": str}
        找不到对应记录时 success=False。
    """
    state = _state.load_state()
    target = None
    remaining: list = []
    for f in state.fed_files:
        if f.fingerprint == fingerprint and target is None:
            target = f
        else:
            remaining.append(f)

    if target is None:
        return {
            "success": False,
            "name": "",
            "entity_count": 0,
            "message": "找不到对应文件的喂食记录",
        }

    # 更新 state：移除 fed_files 记录 + 追加 timeline 事件
    state.fed_files = remaining
    state.memory_timeline.append(
        _state.MemoryTimelineEvent(
            timestamp=_state._now_iso(),
            event="spit",
            file_name=target.name,
        )
    )
    # 重新同步智力等级（删除后实体数可能变化）
    stats = get_memory_stats()
    state.update_intelligence(int(stats.get("entity_count", 0)))
    state.update_personality()
    _state.save_state(state)

    # best-effort：清理文件级三元组详情存储 + file_sources 映射
    try:
        remove_file_triples(fingerprint)
    except Exception:
        pass
    try:
        bridge = _get_bridge()
        if bridge is not None:
            sources = bridge.load_file_sources()
            if fingerprint in sources:
                sources.pop(fingerprint, None)
                bridge.save_file_sources(sources)
    except Exception:
        pass

    return {
        "success": True,
        "name": target.name,
        "entity_count": target.entity_count,
        "message": f"已吐掉「{target.name}」（本地记录已清理）",
    }


def remove_last_fed_file() -> Dict[str, Any]:
    """删除最近吃的文件记忆（Task 28 快捷撤回）。

    从 fed_files 取最后一项，调用 remove_fed_file 删除。

    Returns:
        {"success": bool, "name": str, "entity_count": int, "message": str}
        没有喂食记录时 success=False。
    """
    state = _state.load_state()
    if not state.fed_files:
        return {
            "success": False,
            "name": "",
            "entity_count": 0,
            "message": "还没有吃过任何文件呢~",
        }
    last = state.fed_files[-1]
    return remove_fed_file(last.fingerprint)


# ========================
# 文件级三元组存储（文件清单详情查看）
# ========================


def _get_file_triples_dir() -> str:
    """获取文件三元组存储目录（与 state 文件同目录下的 file_triples 子目录）。

    目录结构：d:\\GraphPet\\file_triples\\file_triples_{fingerprint}.json
    每个文件存一份独立 JSON，避免改 dataclass 结构，删除时也方便清理。
    """
    base = os.path.dirname(_state.STATE_FILE)
    triples_dir = os.path.join(base, "file_triples")
    try:
        os.makedirs(triples_dir, exist_ok=True)
    except OSError:
        pass
    return triples_dir


def save_file_triples(fingerprint: str, triples: List[Dict[str, str]]) -> None:
    """保存某次喂食抽取的三元组，供文件清单展开查看。

    在 _feed_sync 抽取成功后调用。存储格式：
        {"fingerprint": str, "triples": [{head, relation, tail}], "count": int}

    Args:
        fingerprint: 文件 MD5 指纹。
        triples: 三元组列表，每项 {head, relation, tail}。
    """
    if not fingerprint:
        return
    path = os.path.join(_get_file_triples_dir(), f"file_triples_{fingerprint}.json")
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "fingerprint": fingerprint,
                    "triples": triples,
                    "count": len(triples),
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
    except OSError as e:
        print(f"[GraphPet] 保存文件三元组失败: {e}", file=sys.stderr, flush=True)


def get_file_triples(fingerprint: str) -> List[Dict[str, str]]:
    """读取指定文件的三元组列表（供 /memory/file/{fp}/triples 端点）。

    Args:
        fingerprint: 文件 MD5 指纹。

    Returns:
        [{head, relation, tail}, ...]；未存储时返回空列表。
    """
    if not fingerprint:
        return []
    path = os.path.join(_get_file_triples_dir(), f"file_triples_{fingerprint}.json")
    data = _read_json(path, {})
    if isinstance(data, dict):
        triples = data.get("triples", [])
        return triples if isinstance(triples, list) else []
    return []


def remove_file_triples(fingerprint: str) -> None:
    """删除指定文件的三元组存储（在 remove_fed_file 时一并清理）。

    Args:
        fingerprint: 文件 MD5 指纹。
    """
    if not fingerprint:
        return
    path = os.path.join(_get_file_triples_dir(), f"file_triples_{fingerprint}.json")
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError:
        pass
