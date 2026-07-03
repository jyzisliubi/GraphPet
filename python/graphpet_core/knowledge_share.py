"""GraphPet 冷知识分享模块（Task 22）。

GraphPet 的核心创新点之一：让桌宠主动"炫耀"从知识图谱中学到的知识，
把三元组改写成口语化的冷知识分享给主人，让养成感更强。

提供两个核心函数：
  - get_random_triple()：从知识图谱随机抽取一个三元组
  - generate_knowledge_trivia()：把三元组改写成可爱的冷知识文案

LightRAG 全换方案后，三元组来源统一为 graphpet_rag_bridge.get_triples_list()，
读 graph_chunk_entity_relation.graphml 的边。

知识图谱为空（没喂过文件）时返回 None，不抛异常——冷知识是"锦上添花"，
没喂食时桌宠照常通过 scheduler 的通用问候冒泡。

LLM 调用通过 graphpet_rag_bridge.call_llm() 完成改写；LLM 未配置时
退化为模板生成，保证功能可用。
"""

from __future__ import annotations

import os
import sys
import random
from typing import Dict, Optional

from . import personality as _personality
from . import state as _state


def _get_bridge():
    """延迟加载 graphpet_rag_bridge，失败返回 None。"""
    try:
        import sys as _sys

        _py_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if _py_dir not in _sys.path:
            _sys.path.insert(0, _py_dir)
        import graphpet_rag_bridge as _bridge  # noqa: F401

        return _bridge
    except Exception:
        return None


def get_random_triple() -> Optional[Dict[str, str]]:
    """从知识图谱中随机抽取一个三元组。

    LightRAG 全换方案后，通过 graphpet_rag_bridge.get_triples_list() 读
    graphml 的边列表，随机选一条返回。

    Returns:
        {"head": str, "relation": str, "tail": str}；
        知识图谱为空 / bridge 不可用 / 解析失败时返回 None。
    """
    bridge = _get_bridge()
    if bridge is None:
        return None
    try:
        # 拉 500 条够随机了，避免大图谱全量读取
        triples = bridge.get_triples_list(limit=500)
    except Exception as e:
        print(
            f"[GraphPet] 冷知识读取三元组失败: {type(e).__name__}: {e}",
            file=sys.stderr,
            flush=True,
        )
        return None
    if not triples:
        return None
    return random.choice(triples)


def _build_persona_prompt() -> str:
    """根据当前养成状态构建桌宠 system prompt（供冷知识改写用）。

    读取 graphpet_state.json 的智力/亲密度/性格，调用
    personality.build_system_prompt() 生成；状态缺失时用默认值兜底。
    """
    try:
        st = _state.load_state()
        intelligence_level = st.intelligence_level or "懵懂"
        # 亲密度等级需要从 intimacy_xp 推导
        intimacy_level = _personality.get_intimacy_level(st.intimacy_xp)
        personality = st.personality or "好奇"
        return _personality.build_system_prompt(
            intelligence_level, intimacy_level, personality
        )
    except Exception:
        # 状态读取失败不应阻断冷知识生成：用最小人设兜底
        return (
            "你是 Nito，一只可爱的小桌宠。"
            "回答要简短可爱，用口语化表达，可以用~和颜文字。"
        )


def generate_knowledge_trivia() -> Optional[str]:
    """生成一条冷知识文案：随机抽三元组 -> LLM 改写为口语化冷知识。

    流程：
      1. get_random_triple() 抽取三元组；为空返回 None
      2. 调用 rewrite_triple_to_trivia() 把三元组改写为冷知识
         （LLM 优先，未配置 / 失败时退化为模板）

    Returns:
        冷知识文案字符串；知识图谱为空时返回 None。
    """
    triple = get_random_triple()
    if triple is None:
        return None
    return rewrite_triple_to_trivia(triple)


def rewrite_triple_to_trivia(triple: Dict[str, str]) -> str:
    """把指定三元组改写为口语化冷知识文案。

    优先调用 LLM 改写（通过 graphpet_rag_bridge.call_llm() 直接调 Ollama）；
    LLM 未配置 / 调用失败 / 返回空时退化为模板 "你知道吗？{head}{relation}{tail}哦~"。

    本函数与 generate_knowledge_trivia() 分离，便于 /proactive/trivia 端点
    先抽三元组再改写，保证返回的 trivia 与 triple 字段对应同一条三元组。

    Args:
        triple: {"head": str, "relation": str, "tail": str}，由
            get_random_triple() 返回。

    Returns:
        冷知识文案字符串（始终非空，最差也是模板兜底）。
    """
    head = triple["head"]
    relation = triple["relation"]
    tail = triple["tail"]

    # 模板兜底文案（LLM 不可用时使用）
    template = f"你知道吗？{head}{relation}{tail}哦~"

    # 尝试 LLM 改写
    try:
        bridge = _get_bridge()
        if bridge is None:
            return template
        if not bridge.has_llm():
            # LLM 未配置：直接用模板
            return template

        system_prompt = _build_persona_prompt()
        user_prompt = (
            "把这个知识三元组改写成一句可爱的冷知识，"
            "像小宠物在炫耀学到的东西："
            f"{head} {relation} {tail}。"
            "要求：1句话，口语化，带'你知道吗'开头"
        )
        # temperature 稍高让改写更有变化；max_tokens 限制为短句
        result = bridge.call_llm(
            user_prompt, system_prompt=system_prompt, temperature=0.8, max_tokens=120
        )
        if result and isinstance(result, str) and result.strip():
            return result.strip()
    except Exception:
        # 任何异常都退化为模板，保证冷知识功能可用
        pass

    return template
