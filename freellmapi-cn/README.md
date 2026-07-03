# 🚀 FreeLLM API CN — 国内免费大模型聚合网关

面向国内用户的免费 LLM API 聚合代理，零配置开箱即用。聚合国内所有可用的免费大模型 API 为统一的 OpenAI 兼容接口。

## 特性

- 🆓 **零配置启动** — 默认免Key即可使用（Pollinations）
- 🔄 **自动故障转移** — 一个服务挂了自动切换到下一个
- 🎯 **OpenAI 兼容** — 接口格式与OpenAI完全一致
- 🇨🇳 **国内优化** — 所有服务国内访问友好
- ⚡ **流式响应** — 支持SSE流式输出
- 📊 **健康检测** — 自动检测可用性，自动恢复

## 快速开始

```bash
npm install
npm start
```

服务默认运行在 `http://localhost:3001`，访问 `http://localhost:3001/v1/docs` 查看文档。

## 使用

兼容 OpenAI SDK：

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:3001/v1", api_key="not-needed")
response = client.chat.completions.create(
    model="no-key",
    messages=[{"role": "user", "content": "你好"}]
)
print(response.choices[0].message.content)
```

## 支持的服务商

| 服务商 | 免费额度 | 需要Key |
|--------|---------|---------|
| Pollinations | 无限制 | ❌ |
| 硅基流动 | Qwen2.5-7B永久免费 | ✅ 免费注册 |
| 智谱AI | GLM-4-Flash永久免费 | ✅ 免费注册 |
| 阿里通义 | qwen-turbo免费额度 | ✅ 免费注册 |
| 百度千帆 | ERNIE-Speed永久免费 | ✅ 免费注册 |
| 腾讯混元 | hunyuan-lite永久免费 | ✅ 免费注册 |
| Kimi | 新用户15元额度 | ✅ |
| DeepSeek | 新用户500万Token | ✅ |
| Ollama本地 | 完全免费 | ❌ 需本地安装 |

## License

MIT
