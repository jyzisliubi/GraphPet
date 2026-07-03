import express from 'express'
import cors from 'cors'
import { PROVIDERS, DEFAULT_STRATEGY, HEALTH_CHECK, DEFAULT_PORT } from './config.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const healthStatus = {}
Object.keys(PROVIDERS).forEach(key => {
  healthStatus[key] = {
    available: !PROVIDERS[key].requiresKey,
    failures: 0,
    successes: 0,
    lastCheck: null,
    avgResponseTime: 0,
    responseTimes: [],
    lastError: null
  }
})

function getAvailableProviders(strategy = DEFAULT_STRATEGY) {
  return Object.entries(PROVIDERS)
    .filter(([key, provider]) => {
      if (strategy === 'no-key' && provider.requiresKey) return false
      if (!healthStatus[key].available && provider.priority !== 99) return false
      if (provider.requiresKey && !process.env[provider.keyEnv]) return false
      return true
    })
    .sort((a, b) => a[1].priority - b[1].priority)
}

function buildHeaders(providerKey) {
  const provider = PROVIDERS[providerKey]
  const headers = {
    'Content-Type': 'application/json',
    ...provider.headers
  }
  if (provider.requiresKey) {
    const apiKey = process.env[provider.keyEnv]
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  }
  return headers
}

async function forwardToProvider(providerKey, body, stream = false) {
  const provider = PROVIDERS[providerKey]
  const url = `${provider.baseURL}${provider.endpoint}`
  const headers = buildHeaders(providerKey)
  const startTime = Date.now()

  const controller = new AbortController()
  const timeoutMs = stream ? 60000 : HEALTH_CHECK.timeoutMs
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, stream }),
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    const responseTime = Date.now() - startTime

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      recordFailure(providerKey, `HTTP ${response.status}: ${errorText.slice(0, 200)}`)
      throw new Error(`Provider ${providerKey} returned ${response.status}: ${errorText.slice(0, 200)}`)
    }

    recordSuccess(providerKey, responseTime)
    return { response, providerKey, responseTime }
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      recordFailure(providerKey, 'Timeout')
    } else if (!healthStatus[providerKey].failures) {
      recordFailure(providerKey, error.message)
    }
    throw error
  }
}

function recordSuccess(providerKey, responseTime) {
  const s = healthStatus[providerKey]
  s.failures = 0
  s.successes++
  s.lastCheck = Date.now()
  s.available = true
  s.lastError = null
  s.responseTimes.push(responseTime)
  if (s.responseTimes.length > 10) s.responseTimes.shift()
  s.avgResponseTime = Math.round(s.responseTimes.reduce((a, b) => a + b, 0) / s.responseTimes.length)
}

function recordFailure(providerKey, errorMsg) {
  const s = healthStatus[providerKey]
  s.failures++
  s.successes = 0
  s.lastCheck = Date.now()
  s.lastError = errorMsg
  if (s.failures >= HEALTH_CHECK.failureThreshold && PROVIDERS[providerKey].priority !== 99) {
    s.available = false
  }
}

async function healthCheckProvider(providerKey) {
  const provider = PROVIDERS[providerKey]
  if (provider.requiresKey && !process.env[provider.keyEnv]) return
  try {
    const testBody = {
      model: provider.model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5
    }
    await forwardToProvider(providerKey, testBody, false)
  } catch (e) {
    // recorded in forwardToProvider
  }
}

setInterval(() => {
  Object.keys(PROVIDERS).forEach(key => {
    const p = PROVIDERS[key]
    if (!p.requiresKey || process.env[p.keyEnv]) healthCheckProvider(key)
  })
}, HEALTH_CHECK.intervalMs)

setInterval(() => {
  Object.keys(healthStatus).forEach(key => {
    if (!healthStatus[key].available) healthCheckProvider(key)
  })
}, HEALTH_CHECK.intervalMs * 2)

function parseModelSelection(modelParam) {
  if (!modelParam || modelParam === 'auto') return { strategy: 'auto', provider: null, specificModel: null }
  if (modelParam === 'no-key') return { strategy: 'no-key', provider: null, specificModel: null }
  if (PROVIDERS[modelParam]) return { strategy: 'specific', provider: modelParam, specificModel: PROVIDERS[modelParam].model }
  if (modelParam.includes(':')) {
    const [pk, mn] = modelParam.split(':', 2)
    if (PROVIDERS[pk]) return { strategy: 'specific', provider: pk, specificModel: mn }
  }
  return { strategy: 'no-key', provider: null, specificModel: null }
}

// ========== ROUTES ==========

app.get('/', (req, res) => {
  const availableNoKey = Object.entries(PROVIDERS).filter(([k, p]) => !p.requiresKey && healthStatus[k].available).length
  res.json({
    name: 'FreeLLM API CN - 国内免费大模型聚合网关',
    version: '1.0.0',
    status: availableNoKey > 0 ? 'ready' : 'degraded',
    docs: '/v1/docs',
    models_endpoint: '/v1/models',
    chat_endpoint: '/v1/chat/completions',
    default_strategy: DEFAULT_STRATEGY,
    providers_count: Object.keys(PROVIDERS).length,
    available_providers: Object.values(healthStatus).filter(h => h.available).length
  })
})

app.get('/health', (req, res) => {
  const available = Object.values(healthStatus).filter(h => h.available).length
  res.json({
    status: available > 0 ? 'healthy' : 'degraded',
    available_providers: available,
    total_providers: Object.keys(PROVIDERS).length,
    timestamp: new Date().toISOString()
  })
})

app.get('/v1/providers', (req, res) => {
  const result = {}
  Object.entries(PROVIDERS).forEach(([key, p]) => {
    result[key] = {
      name: p.name,
      description: p.description,
      model: p.model,
      models: p.models || [p.model],
      requiresKey: p.requiresKey,
      freeLimit: p.freeLimit,
      speed: p.speed,
      priority: p.priority,
      health: healthStatus[key]
    }
  })
  res.json(result)
})

app.get('/v1/models', (req, res) => {
  const models = [
    { id: 'auto', object: 'model', owned_by: 'freellmapi-cn', name: '自动选择最优可用模型', type: 'router' },
    { id: 'no-key', object: 'model', owned_by: 'freellmapi-cn', name: '仅免Key模型（零配置开箱即用）', type: 'router' }
  ]
  Object.entries(PROVIDERS).forEach(([key, p]) => {
    const modelList = p.models || [p.model]
    modelList.forEach(m => {
      models.push({
        id: `${key}:${m}`, object: 'model', owned_by: p.name,
        name: `${p.name} - ${m}`, provider: key,
        requiresKey: p.requiresKey, available: healthStatus[key].available
      })
    })
    models.push({
      id: key, object: 'model', owned_by: p.name,
      name: `${p.name} (默认: ${p.model})`, provider: key,
      requiresKey: p.requiresKey, available: healthStatus[key].available
    })
  })
  res.json({ object: 'list', data: models })
})

app.get('/v1/docs', (req, res) => {
  const providersHtml = Object.entries(PROVIDERS).map(([key, p]) => {
    const st = healthStatus[key]
    const badge = p.requiresKey
      ? '<span style="background:#fef7e0;color:#b06000;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:bold">需注册(免费额度)</span>'
      : '<span style="background:#e6f4ea;color:#137333;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:bold">完全免费用</span>'
    const statusColor = st.available ? '#137333' : '#c5221f'
    const statusText = st.available ? '✅ 可用' : '❌ 不可用'
    const signupLink = p.signupUrl ? `<br><small>注册地址: <a href="${p.signupUrl}" target="_blank" style="color:#1a73e8">${p.signupUrl}</a></small>` : ''
    return `<div style="border:1px solid #e8eaed;border-radius:8px;padding:15px;margin:10px 0">
      <div style="margin-bottom:6px"><strong style="font-size:16px;color:#1a73e8">${p.name}</strong> ${badge}</div>
      <div style="color:#5f6368;margin:4px 0">${p.description}</div>
      <div style="font-size:13px;color:#3c4043">
        默认模型: <code style="background:#f1f3f4;padding:2px 6px;border-radius:4px">${p.model}</code><br>
        免费额度: ${p.freeLimit}<br>
        状态: <span style="color:${statusColor}">${statusText}</span>${st.lastError ? ` (${st.lastError.slice(0,80)})` : ''}
        ${p.requiresKey ? `<br>环境变量: <code style="background:#f1f3f4;padding:2px 6px;border-radius:4px">${p.keyEnv}</code>` : ''}
        ${signupLink}
      </div>
    </div>`
  }).join('')

  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>FreeLLM API CN 文档</title>
<style>
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:960px;margin:0 auto;padding:24px;background:#f8f9fa;color:#202124;line-height:1.6}
.card{background:#fff;padding:28px 32px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.1);margin-bottom:20px}
h1{color:#1a73e8;margin:0 0 8px;font-size:28px}h2{color:#202124;border-bottom:2px solid #e8eaed;padding-bottom:8px;margin-top:28px;font-size:20px}
code{background:#f1f3f4;padding:2px 8px;border-radius:4px;font-family:'Consolas','Courier New',monospace;font-size:13px}
pre{background:#1e1e1e;color:#d4d4d4;padding:18px;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.5}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:bold;margin-right:6px}
.tag-free{background:#e6f4ea;color:#137333}.tag-key{background:#fef7e0;color:#b06000}.tag-cn{background:#e8f0fe;color:#1a73e8}
table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #e8eaed;padding:10px 12px;text-align:left;font-size:14px}th{background:#f8f9fa;font-weight:600}
.endpoint{background:#e8f0fe;padding:8px 14px;border-radius:6px;font-family:monospace;font-weight:bold;color:#1a73e8;margin:8px 0;display:inline-block}
</style></head><body>
<div class="card">
<h1>🚀 FreeLLM API CN</h1>
<p style="font-size:16px;color:#5f6368;margin:4px 0 16px">国内免费大模型聚合网关 · 零配置开箱即用 · OpenAI 兼容接口</p>
<div><span class="tag tag-free">免注册免Key</span><span class="tag tag-cn">国内优化</span><span class="tag tag-free">自动故障转移</span></div>
</div>

<div class="card">
<h2>📌 快速开始</h2>
<p>服务默认运行在 <code>http://localhost:${DEFAULT_PORT}</code>，API前缀 <code>/v1</code></p>
<div class="endpoint">POST /v1/chat/completions</div>
<pre>curl http://localhost:${DEFAULT_PORT}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"no-key","messages":[{"role":"user","content":"你好，请介绍自己"}]}'</pre>
</div>

<div class="card">
<h2>🐍 Python 使用示例 (OpenAI SDK)</h2>
<pre>from openai import OpenAI
client = OpenAI(
    base_url="http://localhost:${DEFAULT_PORT}/v1",
    api_key="not-needed"  # 免Key模式随便填
)
response = client.chat.completions.create(
    model="no-key",
    messages=[{"role": "user", "content": "你好"}]
)
print(response.choices[0].message.content)</pre>
</div>

<div class="card">
<h2>🔧 模型选择</h2>
<table>
<tr><th>model 参数</th><th>说明</th></tr>
<tr><td><code>auto</code></td><td>自动选择最优可用服务（默认）</td></tr>
<tr><td><code>no-key</code></td><td>仅用免注册免Key服务（零配置）</td></tr>
<tr><td><code>pollinations</code></td><td>指定 Pollinations（完全免费）</td></tr>
<tr><td><code>siliconflow</code></td><td>指定硅基流动</td></tr>
<tr><td><code>zhipu</code></td><td>指定智谱AI</td></tr>
<tr><td><code>provider:model</code></td><td>指定服务商和具体模型，如 <code>siliconflow:Qwen/Qwen2.5-72B-Instruct</code></td></tr>
</table>
</div>

<div class="card">
<h2>🤖 支持的服务商</h2>
${providersHtml}
</div>

<div class="card">
<h2>📡 API 接口列表</h2>
<table>
<tr><th>接口</th><th>方法</th><th>说明</th></tr>
<tr><td><code>/</code></td><td>GET</td><td>服务基本信息</td></tr>
<tr><td><code>/health</code></td><td>GET</td><td>健康检查</td></tr>
<tr><td><code>/v1/docs</code></td><td>GET</td><td>本文档页面</td></tr>
<tr><td><code>/v1/models</code></td><td>GET</td><td>模型列表（OpenAI格式）</td></tr>
<tr><td><code>/v1/providers</code></td><td>GET</td><td>服务商列表及健康状态</td></tr>
<tr><td><code>/v1/chat/completions</code></td><td>POST</td><td>聊天补全（OpenAI兼容）</td></tr>
</table>
</div>

<div class="card" style="text-align:center;color:#5f6368;font-size:13px">
FreeLLM API CN v1.0.0 · Made for Chinese users 🇨🇳 · MIT License
</div>
</body></html>`)
})

app.post('/v1/chat/completions', async (req, res) => {
  try {
    let { model, messages, stream = false, temperature = 0.7, max_tokens, ...otherParams } = req.body
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: 'messages is required', type: 'invalid_request_error' } })
    }

    const sel = parseModelSelection(model)
    let providersToTry = []

    if (sel.strategy === 'specific' && sel.provider) {
      const p = PROVIDERS[sel.provider]
      const st = healthStatus[sel.provider]
      const hasKey = !p.requiresKey || !!process.env[p.keyEnv]
      if (!st.available && p.priority !== 99) {
        return res.status(503).json({ error: { message: `Provider ${p.name} 暂时不可用: ${st.lastError || '未知错误'}`, type: 'provider_unavailable' } })
      }
      if (!hasKey) {
        return res.status(401).json({ error: { message: `Provider ${p.name} 需要设置环境变量 ${p.keyEnv}`, type: 'missing_api_key' } })
      }
      providersToTry = [[sel.provider, p]]
    } else {
      providersToTry = getAvailableProviders(sel.strategy)
    }

    if (providersToTry.length === 0) {
      return res.status(503).json({ error: { message: '当前没有可用的服务商，请检查网络连接或配置API Key', type: 'no_available_providers' } })
    }

    if (stream) {
      return handleStream(res, providersToTry, messages, sel.specificModel, temperature, max_tokens, otherParams)
    }

    let lastErr = null
    for (const [pk, p] of providersToTry) {
      try {
        const body = { model: sel.specificModel || p.model, messages, temperature, ...(max_tokens && { max_tokens }), ...otherParams }
        const { response, responseTime } = await forwardToProvider(pk, body, false)
        const data = await response.json()
        data._router = { provider: pk, provider_name: p.name, response_time_ms: responseTime }
        return res.json(data)
      } catch (e) { lastErr = e; continue }
    }
    res.status(502).json({ error: { message: `所有服务商均失败: ${lastErr?.message}`, type: 'all_providers_failed' } })
  } catch (e) {
    console.error('[freellmapi-cn] error:', e)
    res.status(500).json({ error: { message: e.message, type: 'server_error' } })
  }
})

async function handleStream(res, providersToTry, messages, specificModel, temperature, max_tokens, otherParams) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  let lastErr = null
  for (const [pk, p] of providersToTry) {
    try {
      const body = { model: specificModel || p.model, messages, temperature, ...(max_tokens && { max_tokens }), ...otherParams }
      const { response, responseTime } = await forwardToProvider(pk, body, true)

      res.write(`: connected to ${p.name} (${responseTime}ms)\n\n`)
      res.write(`data: ${JSON.stringify({ _router: { provider: pk, provider_name: p.name } })}\n\n`)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') { res.write('data: [DONE]\n\n'); res.end(); return }
          try {
            const parsed = JSON.parse(data)
            parsed._router = { provider: pk, provider_name: p.name }
            res.write(`data: ${JSON.stringify(parsed)}\n\n`)
          } catch { res.write(`${trimmed}\n\n`) }
        }
      }
      res.write('data: [DONE]\n\n')
      res.end()
      return
    } catch (e) { lastErr = e; continue }
  }
  res.write(`data: ${JSON.stringify({ error: { message: `所有服务商均失败: ${lastErr?.message}` } })}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

const PORT = process.env.PORT || DEFAULT_PORT
app.listen(PORT, () => {
  const noKeyCount = Object.entries(PROVIDERS).filter(([k, p]) => !p.requiresKey && healthStatus[k].available).length
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║         🚀 FreeLLM API CN — 国内免费大模型聚合网关               ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  ✅ 服务已启动！                                                 ║
║                                                                  ║
║  📍 服务地址:  http://localhost:${PORT}                             ║
║  📚 文档页面:  http://localhost:${PORT}/v1/docs                      ║
║  🤖 模型列表:  http://localhost:${PORT}/v1/models                    ║
║  💬 聊天接口:  POST http://localhost:${PORT}/v1/chat/completions     ║
║                                                                  ║
║  ⚡ 默认策略:  ${DEFAULT_STRATEGY.padEnd(50)}║
║  🆓 免Key可用:  ${String(noKeyCount).padEnd(49)}║
║                                                                  ║
║  💡 零配置即可使用！访问 /v1/docs 查看文档                        ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝`)
})
