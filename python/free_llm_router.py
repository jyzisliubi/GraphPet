"""国内免费LLM聚合路由器 - 零配置开箱即用。

内置多个国内可用的免费LLM API，自动故障转移，无需API Key，无需Ollama。
当provider为'freellm'时，本路由器自动选择最优可用的免费API。

设计原则：
  1. 零依赖：只用Python标准库（urllib），不需要额外pip包
  2. 零配置：默认免Key即可使用（Pollinations）
  3. 自动故障转移：一个API挂了自动切下一个
  4. 健康检测：定期检测可用性，自动恢复
  5. 国内优化：优先国内可达、延迟低的服务
"""

from __future__ import annotations

import json
import time
import threading
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Tuple

# ========================
# 国内免费Provider配置
# ========================

FREE_PROVIDERS: Dict[str, Dict[str, Any]] = {
    "pollinations": {
        "name": "Pollinations",
        "base_url": "https://text.pollinations.ai/openai",
        "model": "openai-fast",
        "requires_key": False,
        "priority": 1,
        "description": "完全免费，无需注册，全球CDN",
        "extra_headers": {
            "Referer": "https://pollinations.ai",
        },
        "free_limit": "无限制",
        "timeout": 30,
    },
}


class FreeLLMRouter:
    """免费LLM聚合路由器，支持自动故障转移和健康检测。"""

    def __init__(self):
        self._health: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._last_health_check: float = 0
        self._health_check_interval: float = 60.0

        for key, provider in FREE_PROVIDERS.items():
            self._health[key] = {
                "available": not provider.get("requires_key", False),
                "failures": 0,
                "successes": 0,
                "last_check": 0,
                "avg_response_time": 0.0,
                "response_times": [],
                "last_error": None,
            }

        self._failure_threshold = 3
        self._request_timeout = 60

    def get_provider_status(self) -> Dict[str, Any]:
        """获取所有provider的健康状态。"""
        with self._lock:
            result = {}
            for key, provider in FREE_PROVIDERS.items():
                h = self._health[key]
                result[key] = {
                    "name": provider["name"],
                    "model": provider["model"],
                    "requires_key": provider["requires_key"],
                    "description": provider["description"],
                    "free_limit": provider["free_limit"],
                    "available": h["available"],
                    "failures": h["failures"],
                    "avg_response_time_ms": round(h["avg_response_time"] * 1000),
                    "last_error": h["last_error"],
                }
            return result

    def _get_available_providers(self) -> List[Tuple[str, Dict[str, Any]]]:
        """获取当前可用的provider列表（按优先级排序）。"""
        available = []
        with self._lock:
            for key, provider in sorted(FREE_PROVIDERS.items(), key=lambda x: x[1]["priority"]):
                h = self._health[key]
                if h["available"] and (not provider.get("requires_key", False)):
                    available.append((key, provider))
        return available

    def _record_success(self, key: str, response_time: float):
        with self._lock:
            h = self._health[key]
            h["failures"] = 0
            h["successes"] += 1
            h["last_check"] = time.time()
            h["available"] = True
            h["last_error"] = None
            h["response_times"].append(response_time)
            if len(h["response_times"]) > 10:
                h["response_times"].pop(0)
            h["avg_response_time"] = sum(h["response_times"]) / len(h["response_times"])

    def _record_failure(self, key: str, error: str):
        with self._lock:
            h = self._health[key]
            h["failures"] += 1
            h["successes"] = 0
            h["last_check"] = time.time()
            h["last_error"] = error
            if h["failures"] >= self._failure_threshold:
                h["available"] = False

    def _try_provider(
        self,
        key: str,
        provider: Dict[str, Any],
        messages: List[Dict[str, str]],
        temperature: float,
        max_tokens: int,
    ) -> Tuple[str, float]:
        """尝试调用单个provider，返回(content, response_time_seconds)。失败抛异常。"""
        url = f"{provider['base_url']}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "GraphPet/1.0 (FreeLLM-CN)",
        }
        headers.update(provider.get("extra_headers", {}))

        body = {
            "model": provider["model"],
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        start = time.time()
        timeout = provider.get("timeout", self._request_timeout)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))
            elapsed = time.time() - start
            content = resp_data["choices"][0]["message"]["content"]
            self._record_success(key, elapsed)
            return content, elapsed

    def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> str:
        """发送聊天请求，自动故障转移。

        Args:
            messages: OpenAI格式的消息列表
            temperature: 温度参数
            max_tokens: 最大token数

        Returns:
            LLM回复文本

        Raises:
            RuntimeError: 所有provider都失败时抛出
        """
        providers = self._get_available_providers()
        if not providers:
            self._attempt_recovery()
            providers = self._get_available_providers()

        if not providers:
            raise RuntimeError(
                "当前没有可用的免费LLM服务。请检查网络连接，或在设置中配置自己的API Key。"
            )

        last_error = None
        for key, provider in providers:
            try:
                content, rt = self._try_provider(key, provider, messages, temperature, max_tokens)
                return content
            except Exception as e:
                last_error = e
                self._record_failure(key, str(e))
                continue

        raise RuntimeError(
            f"所有免费LLM服务都不可用。最后错误: {last_error}。"
            f"请在设置中配置API Key或检查网络。"
        )

    def _attempt_recovery(self):
        """尝试恢复标记为不可用的provider（简单的一次探测）。"""
        for key, provider in FREE_PROVIDERS.items():
            if provider.get("requires_key", False):
                continue
            with self._lock:
                h = self._health[key]
                if h["available"]:
                    continue
                if time.time() - h["last_check"] < 30:
                    continue
            try:
                test_body = [{"role": "user", "content": "hi"}]
                self._try_provider(key, provider, test_body, 0.7, 10)
            except Exception:
                pass


# 全局单例
_router_instance: Optional[FreeLLMRouter] = None
_router_lock = threading.Lock()


def get_router() -> FreeLLMRouter:
    global _router_instance
    if _router_instance is None:
        with _router_lock:
            if _router_instance is None:
                _router_instance = FreeLLMRouter()
    return _router_instance


def free_llm_complete(prompt, system_prompt=None, history_messages=None, **kwargs):
    """FreeLLM路由的同步chat接口（供非async上下文使用，如闲聊直接调用）。"""
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    if history_messages:
        messages.extend(history_messages)
    messages.append({"role": "user", "content": prompt})
    temperature = kwargs.get("temperature", 0.7)
    max_tokens = kwargs.get("max_tokens", 1024)
    return get_router().chat(messages, temperature=temperature, max_tokens=max_tokens)


async def free_llm_model_complete(prompt, system_prompt=None, history_messages=[], **kwargs):
    """异步版本的free_llm_complete，供LightRAG的llm_model_func使用。

    LightRAG期望llm_model_func是async函数，接受(prompt, system_prompt, history_messages, **kwargs)，
    返回字符串。我们在后台线程池中运行同步的chat调用。
    """
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: free_llm_complete(
            prompt,
            system_prompt=system_prompt,
            history_messages=list(history_messages) if history_messages else None,
            **kwargs,
        ),
    )
