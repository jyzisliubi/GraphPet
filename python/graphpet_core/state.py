"""GraphPet 扩展层 - 状态管理。

负责读写 D:\\GraphPet\\graphpet_state.json 中的 state 字段
（settings 字段由 Electron 主进程管理，Python 端只读写 state 字段，
保留其他字段不破坏）。

state 字段 schema：
    {
      "intelligence_level": str,   # 智力等级：懵懂/入门/聪慧/博学/学神
      "intelligence_xp": int,      # 智力经验值（=实体数）
      "intimacy": int,             # 亲密度（0-100，由互动频次映射）
      "intimacy_xp": int,          # 亲密度经验值（互动次数）
      "personality": str,          # 性格倾向：好奇/活泼/稳重/博学
      "fed_files": [
        {"name": str, "fingerprint": str, "entity_count": int, "fed_at": str}
      ],
      "memory_timeline": [
        {"timestamp": str, "event": str, "file_name": str | None}
      ],
      "total_interactions": int,   # 总互动次数（喂食+对话+点击）
      "last_interaction_at": str   # 最后互动时间（ISO 8601）
    }
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

# personality 模块提供智力等级 / 亲密度等级映射，无反向依赖，可安全顶层导入
from . import personality as _personality

# graphpet_state.json 路径：D:\GraphPet\graphpet_state.json
# 默认从本文件向上回溯到项目根；可由环境变量 GRAPHPET_STATE_FILE 覆盖。
_DEFAULT_STATE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "graphpet_state.json",
)
STATE_FILE = os.environ.get("GRAPHPET_STATE_FILE", _DEFAULT_STATE_FILE)

# 写文件锁：避免多线程并发读-改-写时丢失数据
_file_lock = threading.Lock()


@dataclass
class FedFile:
    """已喂食文件记录。"""

    name: str  # 文件名或 URL
    fingerprint: str  # MD5 指纹（去重用）
    entity_count: int  # 本次喂食抽取到的实体数
    fed_at: str  # 喂食时间（ISO 8601 字符串）

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "fingerprint": self.fingerprint,
            "entity_count": self.entity_count,
            "fed_at": self.fed_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "FedFile":
        return cls(
            name=str(data.get("name", "")),
            fingerprint=str(data.get("fingerprint", "")),
            entity_count=int(data.get("entity_count", 0)),
            fed_at=str(data.get("fed_at", "")),
        )


@dataclass
class MemoryTimelineEvent:
    """记忆时间线事件。"""

    timestamp: str  # ISO 8601 时间戳
    event: str  # 事件描述（如 "feed" / "extract_failed" / "index_failed"）
    file_name: Optional[str] = None  # 关联文件名（可选）

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "event": self.event,
            "file_name": self.file_name,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "MemoryTimelineEvent":
        return cls(
            timestamp=str(data.get("timestamp", "")),
            event=str(data.get("event", "")),
            file_name=data.get("file_name"),
        )


@dataclass
class GraphPetState:
    """GraphPet 养成状态（持久化在 graphpet_state.json 的 state 字段）。

    养成状态包含三大维度：
    - 智力：intelligence_xp（=知识图谱实体数）映射到 intelligence_level 等级
    - 亲密度：intimacy_xp（互动次数）映射到 intimacy（0-100）与亲密度等级
    - 性格：personality 随喂养内容演化（好奇/活泼/稳重/博学）
    """

    # 智力维度
    intelligence_level: str = "懵懂"  # 智力等级名称：懵懂/入门/聪慧/博学/学神
    intelligence_xp: int = 0  # 智力经验值（=实体数）
    # 亲密度维度
    intimacy: int = 0  # 亲密度（0-100，由互动频次映射）
    intimacy_xp: int = 0  # 亲密度经验值（互动次数）
    # 性格维度
    personality: str = "好奇"  # 性格倾向：好奇/活泼/稳重/博学
    # 喂食记录
    fed_files: List[FedFile] = field(default_factory=list)
    memory_timeline: List[MemoryTimelineEvent] = field(default_factory=list)
    # 互动统计
    total_interactions: int = 0  # 总互动次数（喂食+对话+点击）
    last_interaction_at: str = ""  # 最后互动时间（ISO 8601）

    def update_intelligence(self, xp: int) -> None:
        """根据实体数更新智力等级。

        Args:
            xp: 智力经验值（即知识图谱实体数）。
        """
        self.intelligence_xp = max(0, int(xp))
        self.intelligence_level = _personality.get_intelligence_level(
            self.intelligence_xp
        )

    def add_interaction(self, type: str) -> None:
        """记录一次互动，增加互动次数并提升亲密度。

        亲密度经验值每次互动 +1；亲密度 = min(intimacy_xp, 100)。
        亲密度等级映射：0-10 陌生 / 10-30 熟悉 / 30-60 亲近 / 60-100 挚友。

        Args:
            type: 互动类型（'feed' / 'chat' / 'click' / 'skin_change'）。
        """
        self.total_interactions += 1
        self.intimacy_xp += 1
        # 亲密度由互动频次映射，上限 100
        self.intimacy = min(self.intimacy_xp, 100)
        self.last_interaction_at = _now_iso()

    def update_personality(self) -> None:
        """根据喂养内容演化性格倾向。

        简化规则：
        - 实体数 > 500：博学（知识储备丰富）
        - 喂食次数 > 10：活泼（互动频繁）
        - 默认：好奇
        """
        if self.intelligence_xp > 500:
            self.personality = "博学"
        elif len(self.fed_files) > 10:
            self.personality = "活泼"
        else:
            self.personality = "好奇"

    def to_dict(self) -> dict:
        return {
            "intelligence_level": self.intelligence_level,
            "intelligence_xp": self.intelligence_xp,
            "intimacy": self.intimacy,
            "intimacy_xp": self.intimacy_xp,
            "personality": self.personality,
            "fed_files": [f.to_dict() for f in self.fed_files],
            "memory_timeline": [e.to_dict() for e in self.memory_timeline],
            "total_interactions": self.total_interactions,
            "last_interaction_at": self.last_interaction_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "GraphPetState":
        data = data or {}
        fed_files = [FedFile.from_dict(f) for f in data.get("fed_files", [])]
        timeline = [
            MemoryTimelineEvent.from_dict(e)
            for e in data.get("memory_timeline", [])
        ]
        return cls(
            intelligence_level=str(data.get("intelligence_level", "懵懂")),
            intelligence_xp=int(data.get("intelligence_xp", 0)),
            intimacy=int(data.get("intimacy", 0)),
            intimacy_xp=int(data.get("intimacy_xp", 0)),
            personality=str(data.get("personality", "好奇")),
            fed_files=fed_files,
            memory_timeline=timeline,
            total_interactions=int(data.get("total_interactions", 0)),
            last_interaction_at=str(data.get("last_interaction_at", "")),
        )


def _now_iso() -> str:
    """当前时间的 ISO 8601 字符串（本地时区）。"""
    return datetime.now().isoformat(timespec="seconds")


def load_state() -> GraphPetState:
    """读取 graphpet_state.json 的 state 字段。

    文件不存在 / 损坏 / 缺 state 字段时返回空的 GraphPetState，
    不抛异常（保证喂食流程不被状态读取阻塞）。
    """
    try:
        if not os.path.exists(STATE_FILE):
            return GraphPetState()
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        state_dict = raw.get("state", {}) if isinstance(raw, dict) else {}
        return GraphPetState.from_dict(state_dict)
    except (json.JSONDecodeError, OSError, ValueError) as e:
        # 状态文件损坏不应阻断喂食；记录到 stderr 后返回空状态
        import sys

        print(f"[GraphPet] 读取 state 失败，使用空状态: {e}", file=sys.stderr)
        return GraphPetState()


def save_state(state: GraphPetState) -> None:
    """将 state 写入 graphpet_state.json 的 state 字段。

    采用读-改-写：先读取整个 JSON（保留 settings 等其他字段），
    只替换 state 字段后写回。加锁避免并发写丢失。
    """
    with _file_lock:
        raw: dict = {}
        try:
            if os.path.exists(STATE_FILE):
                with open(STATE_FILE, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                    if not isinstance(raw, dict):
                        raw = {}
        except (json.JSONDecodeError, OSError, ValueError) as e:
            # 文件损坏：以空 dict 起步，避免抛异常阻断喂食
            import sys

            print(f"[GraphPet] 读取旧 state 文件失败，将重写: {e}", file=sys.stderr)
            raw = {}

        raw["state"] = state.to_dict()

        # 确保父目录存在
        parent = os.path.dirname(STATE_FILE)
        if parent:
            os.makedirs(parent, exist_ok=True)

        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(raw, f, ensure_ascii=False, indent=2)


def add_fed_file(
    name: str,
    fingerprint: str,
    entity_count: int,
    event: str = "feed",
) -> None:
    """记录一次喂食：追加 fed_files 和 memory_timeline。

    Args:
        name: 文件名或 URL。
        fingerprint: 文件 MD5 指纹。
        entity_count: 本次抽取到的实体数。
        event: 时间线事件标签，默认 "feed"。
    """
    state = load_state()
    now = _now_iso()
    state.fed_files.append(
        FedFile(
            name=name,
            fingerprint=fingerprint,
            entity_count=entity_count,
            fed_at=now,
        )
    )
    state.memory_timeline.append(
        MemoryTimelineEvent(timestamp=now, event=event, file_name=name)
    )
    save_state(state)


def add_timeline_event(event: str, file_name: Optional[str] = None) -> None:
    """追加一条记忆时间线事件（不修改 fed_files）。

    用于记录抽取失败、索引失败等非成功喂食事件。
    """
    state = load_state()
    state.memory_timeline.append(
        MemoryTimelineEvent(timestamp=_now_iso(), event=event, file_name=file_name)
    )
    save_state(state)


# ========================
# 向后兼容占位（旧 API，Phase 4 会重构）
# ========================


def get_pet_state() -> dict:
    """获取桌宠状态（返回 state 字段的 dict 形式）。"""
    return load_state().to_dict()


def set_pet_state(state: dict) -> None:
    """设置桌宠状态（接收 dict 形式的 state）。"""
    if isinstance(state, dict):
        save_state(GraphPetState.from_dict(state))
