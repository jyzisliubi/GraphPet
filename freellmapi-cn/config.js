// 国内免费 LLM Provider 配置
export const PROVIDERS = {
  // ====== 完全免注册免Key（最高优先级，零配置开箱即用） ======
  pollinations: {
    name: 'Pollinations',
    baseURL: 'https://text.pollinations.ai/openai',
    model: 'openai-fast',
    requiresKey: false,
    priority: 1,
    description: '完全免费，无需注册，无需Key，全球CDN加速',
    headers: { 'Referer': 'https://pollinations.ai', 'User-Agent': 'FreeLLM-API-CN/1.0' },
    endpoint: '/chat/completions',
    freeLimit: '无限制',
    speed: 'fast',
    stability: 'medium',
    cnFriendly: true
  },

  // ====== 注册即送免费额度（国内服务，速度快稳定性高） ======
  siliconflow: {
    name: '硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V2.5', 'THUDM/glm-4-9b-chat'],
    requiresKey: true,
    keyEnv: 'SILICONFLOW_API_KEY',
    priority: 2,
    description: '注册即送2000万Token，Qwen2.5-7B永久免费',
    signupUrl: 'https://cloud.siliconflow.cn',
    headers: {},
    endpoint: '/chat/completions',
    freeLimit: 'Qwen2.5-7B永久免费，注册送2000万Token',
    speed: 'fast',
    stability: 'high',
    cnFriendly: true
  },

  zhipu: {
    name: '智谱AI',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4-long'],
    requiresKey: true,
    keyEnv: 'ZHIPU_API_KEY',
    priority: 3,
    description: 'GLM-4-Flash永久免费，新用户送额度',
    signupUrl: 'https://open.bigmodel.cn',
    headers: {},
    endpoint: '/chat/completions',
    freeLimit: 'GLM-4-Flash永久免费',
    speed: 'medium',
    stability: 'high',
    cnFriendly: true
  },

  aliyun: {
    name: '阿里通义',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen2.5-7b-instruct'],
    requiresKey: true,
    keyEnv: 'DASHSCOPE_API_KEY',
    priority: 4,
    description: 'qwen-turbo有免费额度，新用户送100万Token',
    signupUrl: 'https://dashscope.console.aliyun.com',
    headers: {},
    endpoint: '/chat/completions',
    freeLimit: 'qwen-turbo免费额度，新用户100万Token',
    speed: 'fast',
    stability: 'high',
    cnFriendly: true
  },

  baidu: {
    name: '百度千帆',
    baseURL: 'https://qianfan.baidubce.com/v2',
    model: 'ernie-speed-8k',
    models: ['ernie-speed-8k', 'ernie-lite-8k', 'ernie-4.0-8k'],
    requiresKey: true,
    keyEnv: 'QIANFAN_API_KEY',
    priority: 5,
    description: 'ERNIE-Speed/Lite永久免费',
    signupUrl: 'https://qianfan.cloud.baidu.com',
    headers: {},
    endpoint: '/chat/completions',
    freeLimit: 'ERNIE-Speed/Lite永久免费',
    speed: 'medium',
    stability: 'high',
    cnFriendly: true
  },

  tencent: {
    name: '腾讯混元',
    baseURL: 'https://api.hunyuan.cloud.tencent.com/v1',
    model: 'hunyuan-lite',
    models: ['hunyuan-lite', 'hunyuan-standard', 'hunyuan-pro'],
    requiresKey: true,
    keyEnv: 'HUNYUAN_API_KEY',
    priority: 6,
    description: 'hunyuan-lite永久免费',
    signupUrl: 'https://cloud.tencent.com/product/hunyuan',
    headers: {},
    endpoint: '/chat/completions',
    freeLimit: 'hunyuan-lite永久免费',
    speed: 'medium',
    stability: 'high',
    cnFriendly: true
  },

  moonshot: {
    name: 'Kimi(月之暗面)',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    requiresKey: true,
    keyEnv: 'MOONSHOT_API_KEY',
    priority: 7,
    description: '新用户送15元额度',
    signupUrl: 'https://platform.moonshot.cn',
    headers: {},
    endpoint: '/chat/completions',
    freeLimit: '新用户15元额度',
    speed: 'medium',
    stability: 'high',
    cnFriendly: true
  },

  deepseek: {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    requiresKey: true,
    keyEnv: 'DEEPSEEK_API_KEY',
    priority: 8,
    description: '新用户送500万Token，深度思考能力强',
    signupUrl: 'https://platform.deepseek.com',
    headers: {},
    endpoint: '/chat/completions',
    freeLimit: '新用户500万Token',
    speed: 'medium',
    stability: 'high',
    cnFriendly: true
  },

  // ====== 本地兜底 ======
  ollama: {
    name: 'Ollama本地',
    baseURL: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    requiresKey: false,
    priority: 99,
    description: '本地运行，需安装Ollama并拉取模型',
    headers: {},
    endpoint: '/chat/completions',
    freeLimit: '完全免费（需本地硬件）',
    speed: 'slow',
    stability: 'high',
    cnFriendly: true
  }
}

export const DEFAULT_STRATEGY = 'no-key'

export const HEALTH_CHECK = {
  intervalMs: 30000,
  timeoutMs: 10000,
  failureThreshold: 3,
  recoveryThreshold: 1
}

export const DEFAULT_PORT = 3001
