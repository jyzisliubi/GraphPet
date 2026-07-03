"""国内免费LLM聚合路由器 - 零配置开箱即用。

内置多个国内可用的免费LLM API，自动故障转移，无需API Key，无需Ollama。
当provider为'freellm'时，本路由器自动选择最优可用的免费API。
"""

from __future__ import annotations

import json
import time
import threading
import urllib.request
import urllib.error
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

FREE_PROVIDERS: Dict[str, Dict[str, Any]] = {
    "pollinations_openai": {
        "name": "Pollinations (OpenAI)",
        "type": "simple_get",
        "url_template": "https://text.pollinations.ai/{prompt}",
        "model": "openai",
        "requires_key": False,
        "priority": 1,
        "description": "OpenAI GPT model",
        "extra_headers": {
            "Referer": "https://pollinations.ai/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        "timeout": 60,
    },
    "pollinations_mistral": {
        "name": "Pollinations (Mistral)",
        "type": "simple_get",
        "url_template": "https://text.pollinations.ai/{prompt}",
        "model": "mistral",
        "requires_key": False,
        "priority": 2,
        "description": "Mistral model, fast",
        "extra_headers": {
            "Referer": "https://pollinations.ai/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        "timeout": 60,
    },
    "pollinations_qwen": {
        "name": "Pollinations (Qwen)",
        "type": "simple_get",
        "url_template": "https://text.pollinations.ai/{prompt}",
        "model": "qwen",
        "requires_key": False,
        "priority": 3,
        "description": "Qwen, Chinese optimized",
        "extra_headers": {
            "Referer": "https://pollinations.ai/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        "timeout": 60,
    },
}
CHINESE_SYSTEM_PROMPT = "请始终使用简体中文回复。回答简短自然，口语化，不要使用markdown格式。"

_last_request_time = 0.0
_request_lock = threading.Lock()
MIN_REQUEST_INTERVAL = 1.5


class FreeLLMRouter:

    def __init__(self):
        self._health: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._last_health_check: float = 0
        self._health_check_interval: float = 90.0
        self._failure_threshold = 2
        self._max_retries = 2

        for key, provider in FREE_PROVIDERS.items():
            self._health[key] = {
                "available": True,
                "failures": 0,
                "successes": 0,
                "last_check": 0,
                "avg_response_time": 0.0,
                "response_times": [],
                "last_error": None,
            }

    def _throttle(self):
        global _last_request_time
        with _request_lock:
            now = time.time()
            elapsed = now - _last_request_time
            if elapsed < MIN_REQUEST_INTERVAL:
                time.sleep(MIN_REQUEST_INTERVAL - elapsed)
            _last_request_time = time.time()

    def _get_available_providers(self) -> List[Tuple[str, Dict[str, Any]]]:
        available = []
        with self._lock:
            for key, provider in sorted(FREE_PROVIDERS.items(), key=lambda x: x[1]["priority"]):
                if self._health[key]["available"]:
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
            h["last_check"] = time.time()
            h["last_error"] = error
            if h["failures"] >= self._failure_threshold:
                h["available"] = False

    def _build_simple_prompt(self, messages: List[Dict[str, str]]) -> str:
        parts = []
        for msg in messages:
            role = msg["role"]
            content = msg["content"].strip()
            if role == "system":
                parts.append(f"System: {content}")
            elif role == "user":
                parts.append(f"User: {content}")
            elif role == "assistant":
                parts.append(f"Assistant: {content}")
        parts.append("Assistant:")
        return "\n\n".join(parts)

    def _try_provider(
        self, key: str, provider: Dict[str, Any],
        messages: List[Dict[str, str]], temperature: float, max_tokens: int,
    ) -> Tuple[str, float]:
        self._throttle()
        provider_type = provider.get("type", "openai")
        start = time.time()
        timeout = provider.get("timeout", 60)
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
        headers.update(provider.get("extra_headers", {}))

        if provider_type == "simple_get":
            system_parts = [m["content"] for m in messages if m["role"] == "system"]
            system_prompt = "\n".join(system_parts) if system_parts else None
            user_parts = []
            for m in messages:
                if m["role"] == "user":
                    user_parts.append("User: " + m["content"])
                elif m["role"] == "assistant":
                    user_parts.append("Assistant: " + m["content"])
            user_parts.append("Assistant:")
            prompt_text = "\n\n".join(user_parts)
            encoded = urllib.parse.quote(prompt_text, safe="")
            url = provider["url_template"].format(prompt=encoded)
            params = {"model": provider.get("model", "openai")}
            if system_prompt:
                params["system"] = system_prompt
            if temperature is not None:
                params["temperature"] = str(temperature)
            url += "?" + urllib.parse.urlencode(params)
            req = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                content = resp.read().decode("utf-8").strip()
                elapsed = time.time() - start
                if content:
                    self._record_success(key, elapsed)
                    return content, elapsed
                raise RuntimeError("empty response")

        else:
            url = f"{provider['base_url']}/chat/completions"
            headers["Content-Type"] = "application/json"
            body = {
                "model": provider["model"],
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": False,
                "seed": int(time.time()) % 1000000,
            }
            data = json.dumps(body).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
                elapsed = time.time() - start
                content = resp_data["choices"][0]["message"]["content"]
                if content:
                    self._record_success(key, elapsed)
                    return content, elapsed
                raise RuntimeError("empty response")

    def _maybe_recover_one(self):
        now = time.time()
        if now - self._last_health_check < self._health_check_interval:
            return
        with self._lock:
            self._last_health_check = now
        for key, provider in FREE_PROVIDERS.items():
            with self._lock:
                if self._health[key]["available"]:
                    continue
            try:
                test = [
                    {"role": "system", "content": CHINESE_SYSTEM_PROMPT},
                    {"role": "user", "content": "请只回复：嗨"}
                ]
                self._try_provider(key, provider, test, 0.7, 20)
                break
            except Exception:
                pass

    def chat(self, messages, temperature=0.7, max_tokens=1024, force_post=False):
        self._maybe_recover_one()
        providers = self._get_available_providers()
        if force_post:
            providers = [(k, p) for k, p in providers if p.get("type") != "simple_get"]
        if not providers:
            self._attempt_recovery()
            providers = self._get_available_providers()
            if force_post:
                providers = [(k, p) for k, p in providers if p.get("type") != "simple_get"]
        if not providers:
            raise RuntimeError("没有可用的免费LLM服务，请检查网络或在设置中配置API Key。")

        last_error = None
        for key, provider in providers:
            for retry in range(self._max_retries + 1):
                try:
                    content, rt = self._try_provider(key, provider, messages, temperature, max_tokens)
                    return content
                except urllib.error.HTTPError as e:
                    last_error = e
                    if e.code == 429:
                        time.sleep((retry + 1) * 3)
                        continue
                    self._record_failure(key, f"HTTP {e.code}")
                    break
                except Exception as e:
                    last_error = e
                    if retry < self._max_retries:
                        time.sleep(1)
                        continue
                    self._record_failure(key, str(e)[:100])
                    break

        raise RuntimeError(f"所有免费LLM都不可用: {last_error}。请配置API Key。")

    def _attempt_recovery(self):
        for key, provider in FREE_PROVIDERS.items():
            with self._lock:
                h = self._health[key]
                if h["available"] or time.time() - h["last_check"] < 30:
                    continue
            try:
                test = [{"role": "user", "content": "hi"}]
                self._try_provider(key, provider, test, 0.7, 15)
            except Exception:
                pass


_router_instance = None
_router_lock = threading.Lock()


def get_router():
    global _router_instance
    if _router_instance is None:
        with _router_lock:
            if _router_instance is None:
                _router_instance = FreeLLMRouter()
    return _router_instance


def free_llm_complete(prompt, system_prompt=None, history_messages=None, **kwargs):
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt + "\n\n" + CHINESE_SYSTEM_PROMPT})
    else:
        messages.append({"role": "system", "content": CHINESE_SYSTEM_PROMPT})
    if history_messages:
        for msg in history_messages:
            role = msg.get("role", "user")
            if role == "nito":
                role = "assistant"
            messages.append({"role": role, "content": msg.get("content", "")})
    messages.append({"role": "user", "content": prompt})
    temperature = kwargs.get("temperature", 0.7)
    max_tokens = kwargs.get("max_tokens", 2048)
    return get_router().chat(messages, temperature=temperature, max_tokens=max_tokens)


async def free_llm_model_complete(prompt, system_prompt=None, history_messages=None, **kwargs):
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: free_llm_complete(prompt, system_prompt=system_prompt,
                                   history_messages=list(history_messages) if history_messages else None, **kwargs),
    )
