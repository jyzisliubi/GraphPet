/**
 * 轻量 i18n 国际化方案
 *
 * 设计目标：
 * - 零依赖（不引入 i18next 全家桶，避免包体积膨胀）
 * - 中英双语，默认中文
 * - 支持 localStorage 持久化 + 跨窗口同步
 * - 支持 React hook 用法
 *
 * 用法：
 *   import { useT, setLocale, getLocale } from '../i18n'
 *   const t = useT()
 *   <button>{t('settings.title')}</button>
 *
 * 翻译 key 用点分命名空间：namespace.key
 * 缺失 key 返回 key 本身（便于发现漏译）。
 */

import { useState, useEffect, useCallback } from 'react'

export type Locale = 'zh' | 'en'

/** localStorage key */
const LOCALE_STORAGE_KEY = 'graphpet_locale'

/** 全局 locale 状态（模块级单例，跨组件共享） */
let currentLocale: Locale = loadLocale()

/** 订阅者列表（locale 变化时通知所有 hook 实例） */
const subscribers = new Set<(locale: Locale) => void>()

/** 加载 locale（localStorage 优先，否则取系统语言） */
function loadLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch { /* localStorage 不可用时静默 */ }
  // 跟随系统语言
  if (typeof navigator !== 'undefined') {
    const lang = navigator.language?.toLowerCase() || ''
    if (lang.startsWith('en')) return 'en'
  }
  return 'zh'
}

/** 持久化 locale */
function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch { /* ignore */ }
}

/** 获取当前 locale */
export function getLocale(): Locale {
  return currentLocale
}

/** 设置 locale（持久化 + 通知订阅者） */
export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return
  currentLocale = locale
  persistLocale(locale)
  subscribers.forEach(cb => {
    try { cb(locale) } catch { /* ignore */ }
  })
}

/** 订阅 locale 变化（用于非 React 场景） */
export function onLocaleChange(cb: (locale: Locale) => void): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

/**
 * React hook：返回 t() 翻译函数
 * - 组件挂载时订阅 locale 变化，locale 改变自动重渲染
 * - t(key, params) 支持参数插值 {name}
 */
export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const [, forceUpdate] = useState({})

  useEffect(() => {
    const unsubscribe = onLocaleChange(() => forceUpdate({}))
    return unsubscribe
  }, [])

  return useCallback((key: string, params?: Record<string, string | number>) => {
    const dict = currentLocale === 'en' ? enDict : zhDict
    let str = dict[key]
    if (str === undefined) {
      // fallback：先查 zh 兜底，再返回 key 本身
      str = zhDict[key] ?? key
    }
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      }
    }
    return str
  }, [])
}

// ======================== 翻译字典 ========================

const zhDict: Record<string, string> = {
  // 通用
  'app.name': 'GraphPet',
  'common.ok': '确定',
  'common.cancel': '取消',
  'common.save': '保存',
  'common.close': '关闭',
  'common.delete': '删除',
  'common.error': '错误',
  'common.loading': '加载中...',
  'common.retry': '重试',

  // 右键菜单
  'menu.chat': '聊天',
  'menu.feed_file': '喂文件',
  'menu.feed_screenshot': '喂截屏',
  'menu.feed_url': '喂网址',
  'menu.new_chat': '新对话',
  'menu.change_skin': '换皮肤',
  'menu.settings': '设置',
  'menu.walk': '走动',
  'menu.stop_walk': '停止走动',
  'menu.quiet_mode': '安静模式',
  'menu.hide_pet': '隐藏宠物',
  'menu.quit': '退出',
  'menu.memory': '我的记忆',
  'menu.spit_last': '吐掉最近吃的',
  'menu.open_panel': '打开网页面板',
  'menu.coming_soon': '敬请期待',

  // 设置面板
  'settings.title': '设置',
  'settings.llm_provider': 'LLM 提供商',
  'settings.llm_model': '模型',
  'settings.llm_api_base': 'API Base',
  'settings.llm_api_key': 'API Key',
  'settings.proactive_interval': '主动对话间隔（分钟）',
  'settings.quiet_mode': '安静模式',
  'settings.auto_start': '开机自启',
  'settings.pet_scale': '宠物缩放',
  'settings.tts_enabled': '语音播报（Nito 回答时朗读）',
  'settings.tts_provider': 'TTS 引擎',
  'settings.tts_voice': '语音角色',
  'settings.vad_enabled': '语音打断（你说话时停止朗读，需麦克风）',
  'settings.theme': '主题模式',
  'settings.theme.dark': '🌙 暗色（默认）',
  'settings.theme.light': '☀️ 亮色',
  'settings.theme.auto': '🖥 跟随系统',
  'settings.import': '📥 导入',
  'settings.export': '📤 导出',
  'settings.unsaved_warning': '当前设置尚未保存，确定要放弃改动并关闭吗？',

  // 聊天面板
  'chat.title': 'Nito 对话',
  'chat.title_default': '和 Nito 聊天',
  'chat.new_chat': '新对话',
  'chat.new_conversation': '新建对话',
  'chat.placeholder': '输入问题，Enter 发送，Shift+Enter 换行',
  'chat.placeholder_alt': '输入消息，Enter 发送，Shift+Enter 换行...',
  'chat.listening': '正在聆听... 说话即可输入',
  'chat.feed_file': '喂文件',
  'chat.feed_screenshot': '截屏',
  'chat.upload_tooltip': '上传文件喂给Nito',
  'chat.start_new_chat': '开始新对话',
  'chat.thinking': '思考中',
  'chat.thinking_dots': '思考中...',
  'chat.voice_input': '语音输入',
  'chat.stop_voice_input': '停止语音输入',
  'chat.stop_speaking': '停止朗读',
  'chat.speak': '朗读',
  'chat.read': '🔊 朗读',
  'chat.stop': '⏹ 停止',
  'chat.speak_tooltip': '朗读这条回答',
  'chat.show_sources': '▸ 查看来源',
  'chat.hide_sources': '▾ 收起来源',
  'chat.source_relevance': '相关度 {percent}%',
  'chat.copy': '复制',
  'chat.copied': '已复制',
  'chat.feed_success': '已喂给Nito：{name}',
  'chat.feed_failed': '喂食失败：{name}',
  'chat.feed_failed_reason': '喂食失败：{reason}',
  'chat.digesting': '正在消化中，请稍等~',
  'chat.switched_interrupt': '（已切换对话，回答中断）',
  'chat.failed': '回答失败',
  'chat.network_interrupt': '⚠️ 网络中断：{msg}',
  'chat.error_prefix': '出错了：{msg}',
  'chat.confirm_delete': '确定要删除这个对话吗？',
  'chat.drop_to_feed': '松开喂给 Nito',
  'chat.collapse_sidebar': '收起侧边栏',
  'chat.expand_history': '展开对话历史',
  'chat.collapse_history': '收起对话历史',
  'chat.delete_conversation': '删除对话',
  'chat.empty_title': '嗨～我是 Nito，你的知识小宠物！',
  'chat.empty_embedded': '和我聊聊天，或者喂我吃点文件吧~',
  'chat.empty_default': '有什么想问我的吗？',
  'chat.minimize': '最小化',
  'chat.quick_q1': '你好呀！',
  'chat.quick_q2': '你能做什么？',
  'chat.quick_q3': '讲个冷知识',
  'chat.quick_q4': '今天心情如何？',
  'common.send': '发送',
  // 面板导航
  'panel.brand_sub': '知识图谱桌宠',
  'panel.online': '在线',
  'panel.nav.chat': '深度聊天',
  'panel.nav.chat_desc': '完整对话与引用溯源',
  'panel.nav.memory': '记忆图谱',
  'panel.nav.memory_desc': '知识三元组可视化',
  'panel.nav.timeline': '时间线',
  'panel.nav.timeline_desc': '喂食与互动历史',
  'panel.nav.files': '文件清单',
  'panel.nav.files_desc': '已吃文件管理',
  'panel.nav.profile': '智力展示',
  'panel.nav.profile_desc': '成长状态总览',

  // 系统托盘
  'tray.show_hide': '显示/隐藏宠物\tCtrl+Shift+G',
  'tray.open_chat': '打开聊天窗口',
  'tray.open_panel': '打开管理面板',
  'tray.start_walk': '开始走动',
  'tray.stop_walk': '停止走动',
  'tray.quiet_mode': '安静模式',
  'tray.quit': '退出',

  // 管理面板
  'panel.deepchat': '深度对话',
  'panel.memory_graph': '记忆图谱',
  'panel.timeline': '时间线',
  'panel.file_list': '已吃文件',
  'panel.profile': '资料卡',

  // 错误
  'error.llm_unavailable': 'LLM 服务暂时不可用，请检查配置',
  'error.network': '网络错误，请稍后重试',
  'error.feed_failed': '喂食失败：{reason}',
  'error.freellm_offline': '免费网络服务暂时不可用，请检查网络'
}

const enDict: Record<string, string> = {
  // Common
  'app.name': 'GraphPet',
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.close': 'Close',
  'common.delete': 'Delete',
  'common.error': 'Error',
  'common.loading': 'Loading...',
  'common.retry': 'Retry',

  // Context menu
  'menu.chat': 'Chat',
  'menu.feed_file': 'Feed File',
  'menu.feed_screenshot': 'Feed Screenshot',
  'menu.feed_url': 'Feed URL',
  'menu.new_chat': 'New Chat',
  'menu.change_skin': 'Change Skin',
  'menu.settings': 'Settings',
  'menu.walk': 'Walk',
  'menu.stop_walk': 'Stop Walking',
  'menu.quiet_mode': 'Quiet Mode',
  'menu.hide_pet': 'Hide Pet',
  'menu.quit': 'Quit',
  'menu.memory': 'My Memory',
  'menu.spit_last': 'Spit Out Last',
  'menu.open_panel': 'Open Web Panel',
  'menu.coming_soon': 'Coming Soon',

  // Settings
  'settings.title': 'Settings',
  'settings.llm_provider': 'LLM Provider',
  'settings.llm_model': 'Model',
  'settings.llm_api_base': 'API Base',
  'settings.llm_api_key': 'API Key',
  'settings.proactive_interval': 'Proactive Chat Interval (min)',
  'settings.quiet_mode': 'Quiet Mode',
  'settings.auto_start': 'Launch at Startup',
  'settings.pet_scale': 'Pet Scale',
  'settings.tts_enabled': 'Voice (Nito reads answers aloud)',
  'settings.tts_provider': 'TTS Engine',
  'settings.tts_voice': 'Voice',
  'settings.vad_enabled': 'Voice Interruption (stops TTS when you speak)',
  'settings.theme': 'Theme',
  'settings.theme.dark': '🌙 Dark (default)',
  'settings.theme.light': '☀️ Light',
  'settings.theme.auto': '🖥 System',
  'settings.import': '📥 Import',
  'settings.export': '📤 Export',
  'settings.unsaved_warning': 'You have unsaved changes. Discard and close?',

  // Chat panel
  'chat.title': 'Nito Chat',
  'chat.title_default': 'Chat with Nito',
  'chat.new_chat': 'New Chat',
  'chat.new_conversation': 'New Conversation',
  'chat.placeholder': 'Type a question. Enter to send, Shift+Enter for newline',
  'chat.placeholder_alt': 'Type a message. Enter to send, Shift+Enter for newline...',
  'chat.listening': 'Listening... just speak',
  'chat.feed_file': 'Feed File',
  'chat.feed_screenshot': 'Screenshot',
  'chat.upload_tooltip': 'Upload file to feed Nito',
  'chat.start_new_chat': 'Start new chat',
  'chat.thinking': 'Thinking',
  'chat.thinking_dots': 'Thinking...',
  'chat.voice_input': 'Voice Input',
  'chat.stop_voice_input': 'Stop voice input',
  'chat.stop_speaking': 'Stop',
  'chat.speak': 'Speak',
  'chat.read': '🔊 Speak',
  'chat.stop': '⏹ Stop',
  'chat.speak_tooltip': 'Read this answer aloud',
  'chat.show_sources': '▸ Show sources',
  'chat.hide_sources': '▾ Hide sources',
  'chat.source_relevance': 'Relevance {percent}%',
  'chat.copy': 'Copy',
  'chat.copied': 'Copied',
  'chat.feed_success': 'Fed to Nito: {name}',
  'chat.feed_failed': 'Feed failed: {name}',
  'chat.feed_failed_reason': 'Feed failed: {reason}',
  'chat.digesting': 'Digesting, please wait...',
  'chat.switched_interrupt': '(switched conversation, answer interrupted)',
  'chat.failed': 'Answer failed',
  'chat.network_interrupt': '⚠️ Network interrupted: {msg}',
  'chat.error_prefix': 'Error: {msg}',
  'chat.confirm_delete': 'Delete this conversation?',
  'chat.drop_to_feed': 'Release to feed Nito',
  'chat.collapse_sidebar': 'Collapse sidebar',
  'chat.expand_history': 'Expand chat history',
  'chat.collapse_history': 'Collapse chat history',
  'chat.delete_conversation': 'Delete conversation',
  'chat.empty_title': 'Hi~ I\'m Nito, your knowledge pet!',
  'chat.empty_embedded': 'Chat with me, or feed me some files~',
  'chat.empty_default': 'What would you like to ask?',
  'chat.minimize': 'Minimize',
  'chat.quick_q1': 'Hello!',
  'chat.quick_q2': 'What can you do?',
  'chat.quick_q3': 'Tell me a fun fact',
  'chat.quick_q4': 'How are you today?',
  'common.send': 'Send',
  // Panel navigation
  'panel.brand_sub': 'Knowledge Graph Pet',
  'panel.online': 'online',
  'panel.nav.chat': 'Deep Chat',
  'panel.nav.chat_desc': 'Full conversation with source tracing',
  'panel.nav.memory': 'Memory Graph',
  'panel.nav.memory_desc': 'Knowledge triple visualization',
  'panel.nav.timeline': 'Timeline',
  'panel.nav.timeline_desc': 'Feeding & interaction history',
  'panel.nav.files': 'File List',
  'panel.nav.files_desc': 'Fed files management',
  'panel.nav.profile': 'Profile',
  'panel.nav.profile_desc': 'Growth status overview',

  // System tray
  'tray.show_hide': 'Show/Hide Pet\tCtrl+Shift+G',
  'tray.open_chat': 'Open Chat Window',
  'tray.open_panel': 'Open Panel',
  'tray.start_walk': 'Start Walking',
  'tray.stop_walk': 'Stop Walking',
  'tray.quiet_mode': 'Quiet Mode',
  'tray.quit': 'Quit',

  // Panel
  'panel.deepchat': 'Deep Chat',
  'panel.memory_graph': 'Memory Graph',
  'panel.timeline': 'Timeline',
  'panel.file_list': 'Fed Files',
  'panel.profile': 'Profile',

  // Errors
  'error.llm_unavailable': 'LLM service is unavailable. Please check your configuration.',
  'error.network': 'Network error. Please try again later.',
  'error.feed_failed': 'Feed failed: {reason}',
  'error.freellm_offline': 'Free network service is temporarily unavailable. Please check your network.'
}
