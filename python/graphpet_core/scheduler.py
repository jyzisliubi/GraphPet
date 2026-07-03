"""GraphPet 主动对话调度器（Task 21）。

桌宠需要主动冒泡说话，触发方式分为两类：

- 定时触发：距上次互动超过 proactiveIntervalMin 分钟（默认 30 分钟）
- 事件触发：
  - long_no_feed：长时间未喂（>3 小时）
  - late_night：深夜问候（22:00-6:00）
  - clipboard_url：剪贴板检测到 URL（简化为前端检测，后端不读剪贴板）

调度逻辑由前端轮询驱动：渲染进程每 60 秒调用 GET /proactive/message，
后端通过 should_trigger() 评估是否该说话，并通过 get_trigger_type()
返回触发类型，generate_message() 生成对应文案。

本模块另提供 threading.Timer 机制（start/stop），供调度器在独立线程
场景下周期性触发回调（应用内主路径为前端轮询，通常无需启动定时器）。

安静模式（quietMode）下不触发任何主动对话。
"""

from __future__ import annotations

import threading
from datetime import datetime
from typing import Callable, Optional

from . import state as _state


class ProactiveScheduler:
    """主动对话调度器：判断是否该主动说话及触发类型。

    用法（轮询模式，推荐）::

        scheduler = ProactiveScheduler(interval_min=30, quiet_mode=False)
        if scheduler.should_trigger():
            trigger_type = scheduler.get_trigger_type()
            message = scheduler.generate_message(trigger_type)
            scheduler.mark_triggered()

    用法（定时器模式，独立线程）::

        scheduler = ProactiveScheduler()
        scheduler.start(lambda msg: print(msg))

    Args:
        interval_min: 主动对话间隔（分钟），>=1。
        quiet_mode: 安静模式，开启后永不触发。
    """

    # 长时间未喂阈值（小时）
    LONG_NO_FEED_HOURS: int = 3
    # 深夜时段起止（24 小时制）：22:00 - 次日 6:00
    LATE_NIGHT_START: int = 22
    LATE_NIGHT_END: int = 6

    def __init__(self, interval_min: int = 30, quiet_mode: bool = False) -> None:
        self.interval_min: int = max(1, int(interval_min))
        self.quiet_mode: bool = bool(quiet_mode)
        # 上次触发时间（仅内存，不持久化）：用于避免连续轮询重复触发。
        # 服务器重启后会丢失，但仅导致重启后多触发一次，可接受。
        self._last_triggered_at: Optional[datetime] = None
        # 定时器机制（独立线程场景用）
        self._timer: Optional[threading.Timer] = None
        self._callback: Optional[Callable[[str], None]] = None
        self._lock = threading.Lock()

    # ========================
    # 配置
    # ========================

    def update_config(self, interval_min: int, quiet_mode: bool) -> None:
        """更新调度配置（设置变更后调用）。

        Args:
            interval_min: 主动对话间隔（分钟）。
            quiet_mode: 是否安静模式。
        """
        self.interval_min = max(1, int(interval_min))
        self.quiet_mode = bool(quiet_mode)

    # ========================
    # 触发判断
    # ========================

    def should_trigger(self) -> bool:
        """是否该触发主动对话。

        条件：
          1. 非安静模式
          2. 距上次互动时间（或上次触发时间，取较晚者）超过 interval_min 分钟
             —— 从未互动且从未触发时视为应触发

        互动时间从 graphpet_state.json 的 state.last_interaction_at 读取
        （由 Task 20 的 record_interaction 维护）。

        Returns:
            True 表示应该主动说话。
        """
        if self.quiet_mode:
            return False

        now = datetime.now()
        last_interaction = self._get_last_interaction_time()
        # 基准时间取“最后互动时间”与“上次触发时间”的较晚者，
        # 避免刚触发完又因互动时间久远而立即再次触发。
        candidates = [
            t for t in (last_interaction, self._last_triggered_at) if t is not None
        ]
        if not candidates:
            # 从未互动且从未触发：触发一次初始问候
            return True
        baseline = max(candidates)
        elapsed_min = (now - baseline).total_seconds() / 60.0
        return elapsed_min >= self.interval_min

    def mark_triggered(self) -> None:
        """标记本次已触发，避免连续轮询重复触发。

        在端点返回 should_speak=True 后调用。
        """
        self._last_triggered_at = datetime.now()

    def get_trigger_type(self) -> str:
        """返回触发类型（不依赖 should_trigger 的结果，调用方自行判断）。

        优先级：
          1. 'late_night'：深夜问候（22:00-6:00）
          2. 'long_no_feed'：长时间未喂（>3 小时）
          3. 'scheduled'：定时触发（默认）

        'clipboard_url' 由前端检测剪贴板后单独上报，本方法不返回该类型。

        Returns:
            'scheduled' / 'long_no_feed' / 'late_night'
        """
        # 深夜问候优先（用服务器本地时间判断）
        hour = datetime.now().hour
        if hour >= self.LATE_NIGHT_START or hour < self.LATE_NIGHT_END:
            return "late_night"

        # 长时间未喂
        last_feed = self._get_last_feed_time()
        if last_feed is not None:
            elapsed_hours = (datetime.now() - last_feed).total_seconds() / 3600.0
            if elapsed_hours > self.LONG_NO_FEED_HOURS:
                return "long_no_feed"

        # 默认定时触发
        return "scheduled"

    def generate_message(self, trigger_type: Optional[str] = None) -> str:
        """根据触发类型生成主动消息文案。

        对于 'scheduled'（定时触发）类型，有 50% 概率调用
        knowledge_share.generate_knowledge_trivia() 返回冷知识，让桌宠
        主动"炫耀"学到的知识；另外 50% 或冷知识不可用（知识图谱为空等）
        时退化为通用问候。其他触发类型保持原有文案。

        这样主动对话更有趣：既会冒泡冷知识，也不会每次都"卖弄"。

        Args:
            trigger_type: 触发类型，None 时内部调用 get_trigger_type()。

        Returns:
            对应的气泡文案。
        """
        tt = trigger_type if trigger_type is not None else self.get_trigger_type()

        # 定时触发：50% 概率返回冷知识（GraphPet 创新点：主动炫耀学到的知识）
        if tt == "scheduled":
            import random as _random

            if _random.random() < 0.5:
                trivia = self._try_knowledge_trivia()
                if trivia:
                    return trivia

        messages = {
            "scheduled": "在呢~有什么想聊的吗？",
            "long_no_feed": "好久没吃文件了，饿...",
            "late_night": "这么晚了还没睡吗？注意休息哦",
            "clipboard_url": "检测到链接，要喂给我吗？",
        }
        return messages.get(tt, messages["scheduled"])

    def _try_knowledge_trivia(self) -> Optional[str]:
        """尝试生成冷知识文案，失败/无知识图谱时返回 None。

        延迟导入 knowledge_share 避免与 state 模块的潜在循环依赖，
        同时让本模块在 knowledge_share / rice_rag 不可用时仍能正常工作。
        """
        try:
            from . import knowledge_share as _ks

            return _ks.generate_knowledge_trivia()
        except Exception:
            # 冷知识是"锦上添花"，任何异常都不应阻断主动对话
            return None

    # ========================
    # 定时器机制（独立线程场景，可选）
    # ========================

    def start(self, callback: Callable[[str], None]) -> None:
        """启动定时器：每 interval_min 分钟评估一次，触发时调用 callback(消息)。

        注意：本应用采用前端轮询驱动主动对话，通常无需启动定时器；
        此方法仅供调度器在独立线程运行的场景使用。

        Args:
            callback: 触发回调，参数为生成的消息文案。
        """
        with self._lock:
            self._callback = callback
            self._stop_timer_locked()
            self._schedule_next_locked()

    def stop(self) -> None:
        """停止定时器。"""
        with self._lock:
            self._callback = None
            self._stop_timer_locked()

    def _schedule_next_locked(self) -> None:
        """安排下一次定时触发（调用前需持有 _lock）。"""
        interval_sec = self.interval_min * 60
        self._timer = threading.Timer(interval_sec, self._fire)
        self._timer.daemon = True
        self._timer.start()

    def _stop_timer_locked(self) -> None:
        """取消当前定时器（调用前需持有 _lock）。"""
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    def _fire(self) -> None:
        """定时器回调：评估是否触发并调用回调，随后安排下一次。"""
        try:
            if not self.quiet_mode and self.should_trigger():
                if self._callback is not None:
                    msg = self.generate_message()
                    self._callback(msg)
                    self.mark_triggered()
        except Exception:
            # 定时器内异常不应中断调度循环
            import sys

            print(
                "[GraphPet] 主动对话定时器触发异常",
                file=sys.stderr,
                flush=True,
            )

        # 继续安排下一次（若未 stop）
        with self._lock:
            if self._callback is not None:
                self._schedule_next_locked()

    # ========================
    # 状态读取
    # ========================

    def _get_last_interaction_time(self) -> Optional[datetime]:
        """从养成状态读取最后互动时间。

        Returns:
            最后互动时间（本地时区），无记录或解析失败返回 None。
        """
        try:
            st = _state.load_state()
            if not st.last_interaction_at:
                return None
            return datetime.fromisoformat(st.last_interaction_at)
        except (ValueError, OSError):
            return None

    def _get_last_feed_time(self) -> Optional[datetime]:
        """从养成状态读取最后喂食时间（fed_files 中最后一条的 fed_at）。

        fed_files 按喂食顺序追加，最后一条即最近一次喂食。

        Returns:
            最后喂食时间，无记录或解析失败返回 None。
        """
        try:
            st = _state.load_state()
            if not st.fed_files:
                return None
            last_fed = st.fed_files[-1].fed_at
            if not last_fed:
                return None
            return datetime.fromisoformat(last_fed)
        except (ValueError, OSError):
            return None
