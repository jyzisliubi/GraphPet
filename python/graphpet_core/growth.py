"""GraphPet 成长系统协调器（Task 20）。

协调 memory（知识图谱统计）、state（养成状态持久化）与 personality
（智力 / 亲密度 / 性格映射）三个模块，对外提供：

- sync_intelligence_from_memory()：从知识图谱实体数同步智力等级
- record_interaction(type)：记录一次互动并提升亲密度
- get_growth_summary()：返回养成状态摘要供前端展示

养成状态持久化在 graphpet_state.json 的 state 字段（由 state 模块读写）。
智力等级直接映射知识图谱规模（实体数），是 GraphPet 的核心创新点。
"""

from __future__ import annotations

from typing import Any, Dict

from . import memory as _memory
from . import personality as _personality
from . import state as _state


def sync_intelligence_from_memory() -> Dict[str, Any]:
    """从知识图谱统计同步智力等级到养成状态。

    调用 memory.get_memory_stats() 获取实体数，更新 state.intelligence_xp
    与 intelligence_level，并同步演化 personality，最后持久化到
    graphpet_state.json。

    在应用启动时调用一次，保证智力等级与知识图谱规模一致。

    Returns:
        同步后的智力摘要：
        {"intelligence_level": str, "intelligence_xp": int}
    """
    stats = _memory.get_memory_stats()
    entity_count = int(stats.get("entity_count", 0))

    state = _state.load_state()
    state.update_intelligence(entity_count)
    # 智力变化可能影响性格演化（实体数 > 500 -> 博学）
    state.update_personality()
    _state.save_state(state)

    return {
        "intelligence_level": state.intelligence_level,
        "intelligence_xp": state.intelligence_xp,
    }


def record_interaction(type: str) -> Dict[str, Any]:
    """记录一次互动并提升亲密度。

    Args:
        type: 互动类型（'feed' / 'chat' / 'click' / 'skin_change'）。

    流程：
      1. 读取当前养成状态
      2. state.add_interaction(type)：总互动次数 +1，亲密度经验值 +1，
         亲密度 = min(intimacy_xp, 100)，更新 last_interaction_at
      3. state.update_personality()：喂食会改变 fed_files，刷新性格
      4. 持久化到 graphpet_state.json

    Returns:
        更新后的互动摘要：
        {"intimacy": int, "intimacy_xp": int, "total_interactions": int}
    """
    state = _state.load_state()
    state.add_interaction(type)
    # 互动后刷新性格（喂食会改变 fed_files，影响性格演化）
    state.update_personality()
    _state.save_state(state)

    return {
        "intimacy": state.intimacy,
        "intimacy_xp": state.intimacy_xp,
        "total_interactions": state.total_interactions,
    }


def get_growth_summary() -> Dict[str, Any]:
    """返回当前养成状态摘要供前端展示。

    包含智力等级、亲密度（数值与等级）、性格、已吃文件数、互动次数、
    最后互动时间。供渲染进程的养成面板 / 桌宠气泡展示。

    Returns:
        {
          "intelligence_level": str,   # 智力等级名称
          "intelligence_xp": int,      # 智力经验值（实体数）
          "intimacy": int,             # 亲密度（0-100）
          "intimacy_level": str,       # 亲密度等级名称
          "personality": str,          # 性格倾向
          "fed_file_count": int,       # 已吃文件数
          "total_interactions": int,   # 总互动次数
          "last_interaction_at": str,  # 最后互动时间
        }
    """
    state = _state.load_state()
    intimacy_level = _personality.get_intimacy_level(state.intimacy_xp)

    return {
        "intelligence_level": state.intelligence_level,
        "intelligence_xp": state.intelligence_xp,
        "intimacy": state.intimacy,
        "intimacy_level": intimacy_level,
        "personality": state.personality,
        "fed_file_count": len(state.fed_files),
        "total_interactions": state.total_interactions,
        "last_interaction_at": state.last_interaction_at,
    }
