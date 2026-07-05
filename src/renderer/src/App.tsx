import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import DragRegion from './components/DragRegion'
import Live2DCanvas from './components/Live2DCanvas'
import type { Live2DCanvasAPI, ModelPosition } from './components/Live2DCanvas'
import Live2DPlaceholder from './components/Live2DPlaceholder'
import Bubble from './components/Bubble'
import SettingsPanel from './components/SettingsPanel'
import ChatPanel from './components/ChatPanel'
import ContextMenu from './components/ContextMenu'
import SkinPicker from './components/SkinPicker'
import OnboardingGuide from './components/OnboardingGuide'
import UrlFeedDialog from './components/UrlFeedDialog'
import FeedProgressDialog from './components/FeedProgressDialog'
import TriplePreviewCard from './components/TriplePreviewCard'
import ErrorBanner from './components/ErrorBanner'
import type { FeedFileItem } from './components/FeedProgressDialog'
import type { FeedResultPreview } from './hooks/useFeed'
import { useLive2DModel } from './hooks/useLive2DModel'
import { useBubble } from './hooks/useBubble'
import { useFeed } from './hooks/useFeed'
import { useProactive } from './hooks/useProactive'
import { useIdleThoughts } from './hooks/useIdleThoughts'
import { usePetState } from './hooks/usePetState'
import { BubbleProvider } from './stores/bubbleStore'
import { SettingsProvider, useSettings } from './stores/settingsStore'
import { ChatStoreProvider, useChatStore } from './stores/chatStore'
import type { AppSettings } from './stores/settingsStore'
import PanelApp from './panels/PanelApp'
import ChatWindowApp from './ChatWindowApp'
import { spitLast } from './services/memoryService'
import { playClickSound, playPopupSound } from './services/soundService'

const containerStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  background: 'transparent',
  overflow: 'hidden',
  userSelect: 'none',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none'
}

const ipcLoadingStyle: CSSProperties = {
  color: '#ffffff',
  fontSize: 14,
  textShadow: '0 1px 2px rgba(0,0,0,0.6)',
  pointerEvents: 'auto'
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
}

function AppInner(): JSX.Element {
  const { modelPath: defaultModelPath, modelFormat: defaultModelFormat, loading, error } = useLive2DModel()
  const [activeModelPath, setActiveModelPath] = useState<string | null>(null)
  const [activeModelFormat, setActiveModelFormat] = useState<'cubism2' | 'cubism4' | null>(null)
  const live2dApiRef = useRef<Live2DCanvasAPI | null>(null)
  const [modelHeadY, setModelHeadY] = useState<number>(0)
  const { bubbleProps, showMessage, showInnerThought } = useBubble()
  const { settings, saveSettings, updateSettings } = useSettings()
  const { createConversation } = useChatStore()
  const petState = usePetState()
  const { recordInteraction } = petState

  const { feeding, feedFile, feedUrl, feedFileBatch, cancelCurrentFeed } = useFeed({
    onFeedStart: () => {
      try { live2dApiRef.current?.triggerMotion('eat') } catch { /* ignore */ }
      recordInteraction('feed-start')
    },
    onFeedEnd: (success: boolean) => {
      if (success) {
        try { live2dApiRef.current?.triggerMotion('tap_body') } catch { /* ignore */ }
        recordInteraction('feed-success')
      } else {
        try { live2dApiRef.current?.triggerMotion('shake') } catch { /* ignore */ }
        recordInteraction('feed-fail')
      }
      setTimeout(() => {
        try { live2dApiRef.current?.setExpression(0) } catch { /* ignore */ }
      }, 2000)
    }
  })

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 })
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [skinPickerVisible, setSkinPickerVisible] = useState(false)
  const [onboardingVisible, setOnboardingVisible] = useState(false)
  const [urlFeedDialogVisible, setUrlFeedDialogVisible] = useState(false)
  const [chatPanelVisible, setChatPanelVisible] = useState(false)
  const [walking, setWalking] = useState<boolean>(false)
  const [triplePreview, setTriplePreview] = useState<FeedResultPreview | null>(null)
  const [feedProgress, setFeedProgress] = useState<{ visible: boolean; files: FeedFileItem[] }>({ visible: false, files: [] })
  const [chatThinking, setChatThinking] = useState<boolean>(false)

  const isDraggingRef = useRef(false)
  const isFileDraggingRef = useRef(false)
  const clickCooldownRef = useRef(false)
  const feedProgressRef = useRef(feedProgress)
  const feedCancelRef = useRef(false)
  const prevFeedingRef = useRef(false)

  useEffect(() => {
    feedProgressRef.current = feedProgress
  }, [feedProgress])

  useEffect(() => {
    if (defaultModelPath && !activeModelPath) {
      setActiveModelPath(defaultModelPath)
    }
    if (defaultModelFormat && !activeModelFormat) {
      setActiveModelFormat(defaultModelFormat)
    }
  }, [defaultModelPath, defaultModelFormat, activeModelPath, activeModelFormat])

  useEffect(() => {
    const hasOnboarded = settings.llmApiBase && settings.llmModel
    if (!loading && defaultModelPath && !hasOnboarded) {
      setOnboardingVisible(true)
    }
  }, [loading, defaultModelPath, settings.llmApiBase, settings.llmModel])

  const anyOverlayVisible =
    contextMenu.visible ||
    settingsVisible ||
    skinPickerVisible ||
    onboardingVisible ||
    urlFeedDialogVisible ||
    chatPanelVisible ||
    feedProgress.visible ||
    triplePreview !== null

  useEffect(() => {
    try {
      window.api.forceInteractive(anyOverlayVisible || isFileDraggingRef.current)
    } catch { /* ignore */ }
  }, [anyOverlayVisible])

  useEffect(() => {
    const onDragEnter = (): void => {
      if (!anyOverlayVisible && !isDraggingRef.current) {
        isFileDraggingRef.current = true
        window.api.forceInteractive(true)
      }
    }
    const onDragOver = (e: DragEvent): void => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
        if (!isFileDraggingRef.current) {
          isFileDraggingRef.current = true
          window.api.forceInteractive(true)
        }
      }
    }
    const onDragLeave = (e: DragEvent): void => {
      if ((e.relatedTarget as Node | null) === null) {
        isFileDraggingRef.current = false
        if (!anyOverlayVisible && !isDraggingRef.current) {
          setTimeout(() => window.api.forceInteractive(anyOverlayVisible), 100)
        }
      }
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      isFileDraggingRef.current = false
      const files = e.dataTransfer?.files
      if (files && files.length > 0 && !anyOverlayVisible && !isDraggingRef.current) {
        const file = files[0]
        const filePath = (file as File & { path?: string }).path
        if (filePath) {
          void handleFeedFile(filePath, file.size)
        }
      }
      if (!anyOverlayVisible && !isDraggingRef.current) {
        setTimeout(() => window.api.forceInteractive(anyOverlayVisible), 100)
      }
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
    }
  }, [anyOverlayVisible])

  const effectiveContainerStyle: CSSProperties = {
    ...containerStyle,
    pointerEvents: 'auto'
  }

  const handleModelReady = useCallback(
    (api: Live2DCanvasAPI, position: ModelPosition): void => {
      live2dApiRef.current = api
      setModelHeadY(position.headY)
      setTimeout(() => {
        try { api.triggerMotion('tap_body') } catch { /* ignore */ }
        showMessage('你好呀主人~我是Nito！右键可以喂我吃东西哦🥰', 5000)
      }, 600)
    },
    [showMessage]
  )

  const handleModelError = useCallback((err: string): void => {
    console.error('[App] Live2D 模型加载失败:', err)
  }, [])

  useEffect(() => {
    const cleanup = window.api.onContextMenu((params) => {
      setContextMenu({ visible: true, x: params.x, y: params.y })
      playPopupSound()
    })
    return cleanup
  }, [])

  const closeContextMenu = useCallback((): void => {
    setContextMenu((prev) => ({ ...prev, visible: false }))
  }, [])

  const handleFeedProgressDialogClose = useCallback((): void => {
    feedCancelRef.current = true
    cancelCurrentFeed()
    setFeedProgress({ visible: false, files: [] })
  }, [cancelCurrentFeed])

  const handleBatchFeed = useCallback(async (): Promise<void> => {
    feedCancelRef.current = false
    let filePaths: string[]
    try {
      filePaths = await window.api.openFileDialog()
    } catch (err) {
      console.error('[App] 打开文件对话框失败:', err)
      showMessage('打开文件对话框失败', 6000)
      return
    }
    if (filePaths.length === 0) return

    const initialFiles: FeedFileItem[] = filePaths.map((p) => {
      const sep = p.includes('\\') ? '\\' : '/'
      const name = p.split(sep).pop() ?? p
      return { name, status: 'pending' }
    })
    setFeedProgress({ visible: true, files: initialFiles })
    feedProgressRef.current = { visible: true, files: initialFiles }

    const onProgress = (progress: {
      index: number
      status: 'feeding' | 'success' | 'failed'
      message?: string
      stage?: string
      progress?: number
      stageMessage?: string
    }): void => {
      const current = feedProgressRef.current
      const nextFiles = current.files.map((f, i) =>
        i === progress.index
          ? {
              ...f,
              status: progress.status,
              message: progress.message,
              stage: progress.stage,
              progress: progress.progress,
              stageMessage: progress.stageMessage
            }
          : f
      )
      const next = { visible: true, files: nextFiles }
      feedProgressRef.current = next
      setFeedProgress(next)
    }

    const isCancelled = (): boolean => feedCancelRef.current
    const summary = await feedFileBatch(filePaths, onProgress, isCancelled)

    if (isCancelled()) {
      showMessage('已取消喂食：成功 ' + summary.success + ' 个，失败 ' + summary.failed + ' 个')
    } else if (summary.failed === 0) {
      showMessage('吃饱了！成功消化 ' + summary.success + ' 个文件~')
    } else {
      showMessage('喂食完成：成功 ' + summary.success + ' 个，失败 ' + summary.failed + ' 个')
    }
  }, [feedFileBatch, showMessage])

  const handleSpitLast = useCallback(async (): Promise<void> => {
    showMessage('呕...')
    recordInteraction('spit')
    try {
      try { live2dApiRef.current?.triggerMotion('sad') } catch { /* ignore */ }
      const res = await spitLast()
      if (res.success) {
        showMessage(res.message)
      } else {
        showMessage(res.message || '没有可吐的文件~')
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      showMessage('吐掉失败：' + errMsg, 6000)
    } finally {
      setTimeout(() => {
        try { live2dApiRef.current?.setExpression(0) } catch { /* ignore */ }
      }, 2000)
    }
  }, [showMessage, recordInteraction])

  // 截屏喂食：截取主屏幕 → 走现有 feedFile 管道（后端 _parse_image_with_ollama 处理图片）
  const handleFeedScreenshot = useCallback(async (): Promise<void> => {
    showMessage('咔嚓！截屏中...', 2500)
    recordInteraction('screenshot')
    try {
      const result = await window.api.captureScreenshot()
      if (!result.success || !result.filePath) {
        showMessage('截屏失败：' + (result.error || '未知错误'), 5000)
        return
      }
      showMessage('正在消化截屏内容...', 3000)
      try { live2dApiRef.current?.triggerMotion('eat') } catch { /* ignore */ }
      await feedFile(result.filePath)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      showMessage('截屏喂食失败：' + errMsg, 6000)
    }
  }, [showMessage, feedFile, recordInteraction])

  const handleContextMenuAction = useCallback((action: string): void => {
    closeContextMenu()
    switch (action) {
      case 'chat':
        window.api.openChat()
        break
      case 'new-chat':
        createConversation()
        setChatPanelVisible(true)
        break
      case 'feed-file':
        void handleBatchFeed()
        break
      case 'feed-url':
        setUrlFeedDialogVisible(true)
        break
      case 'feed-screenshot':
        void handleFeedScreenshot()
        break
      case 'settings':
        setSettingsVisible(true)
        break
      case 'skin':
        setSkinPickerVisible(true)
        break
      case 'panel':
      case 'web':
        window.api.openPanel()
        break
      case 'memory':
        window.api.openPanel('memory')
        break
      case 'spit-last':
        void handleSpitLast()
        break
      case 'quiet':
        void updateSettings({ quietMode: !settings.quietMode })
        showMessage(settings.quietMode ? 'Nito 恢复说话啦~' : 'Nito 先安静一会儿...')
        break
      case 'walk-start':
        if (walking) {
          window.api.petWalkStop()
          setWalking(false)
          showMessage('Nito 停下啦~')
        } else {
          window.api.petWalkStart()
          setWalking(true)
          showMessage('Nito 开始在桌面自由走动啦~ 再点一次停止')
        }
        break
      case 'walk-stop':
        window.api.petWalkStop()
        setWalking(false)
        showMessage('Nito 停下啦~')
        break
      case 'exit':
        window.api.quit()
        break
    }
  }, [closeContextMenu, handleBatchFeed, handleFeedScreenshot, handleSpitLast, settings.quietMode, updateSettings, showMessage, createConversation, walking])

  const handleSkinSelect = useCallback(
    (skinPath: string, skinFormat?: 'cubism2' | 'cubism4'): void => {
      setActiveModelPath(skinPath)
      if (skinFormat) setActiveModelFormat(skinFormat)
      setSkinPickerVisible(false)
      showMessage('换装成功~')
    },
    [showMessage]
  )

  const handleOnboardingComplete = useCallback(
    async (partial: Partial<AppSettings>): Promise<void> => {
      try {
        await updateSettings(partial)
        setOnboardingVisible(false)
        showMessage('配置完成，开始玩耍吧~')
      } catch (err) {
        console.error('[App] 保存引导配置失败:', err)
        showMessage('配置保存失败，可在设置中重试', 6000)
      }
    },
    [updateSettings, showMessage]
  )

  const handleSettingsSave = useCallback(
    async (newSettings: AppSettings): Promise<void> => {
      try {
        await saveSettings(newSettings)
        setSettingsVisible(false)
        showMessage('设置已保存')
      } catch (err) {
        console.error('[App] 保存设置失败:', err)
        showMessage('设置保存失败', 6000)
      }
    },
    [saveSettings, showMessage]
  )

  const closeUrlFeedDialog = useCallback((): void => {
    if (feeding) return
    setUrlFeedDialogVisible(false)
  }, [feeding])

  const handleUrlSubmit = useCallback(
    (url: string): void => {
      void feedUrl(url)
    },
    [feedUrl]
  )

  useEffect(() => {
    if (!feeding && prevFeedingRef.current) {
      setUrlFeedDialogVisible(false)
    }
    prevFeedingRef.current = feeding
  }, [feeding])

  const handleFeedFile = useCallback(
    async (filePath: string, fileSize?: number): Promise<void> => {
      const result = await feedFile(filePath, fileSize)
      if (result) {
        setTriplePreview(result)
      }
    },
    [feedFile]
  )

  const handleChatThinkingChange = useCallback((thinking: boolean): void => {
    setChatThinking(thinking)
    try {
      if (thinking) {
        live2dApiRef.current?.setExpression('2')
        live2dApiRef.current?.triggerMotion('thinking')
        recordInteraction('chat-ask')
      } else {
        live2dApiRef.current?.setExpression(0)
        recordInteraction('chat-reply')
      }
    } catch { /* ignore */ }
  }, [recordInteraction])

  const handleEmotionChange = useCallback((emotion: string): void => {
    try {
      // 映射后端emotion到Live2D表情名/动作组
      const emotionMap: Record<string, string> = {
        happy: 'tap_body',
        sad: 'sad',
        angry: 'shake',
        surprised: 'flick',
        thinking: 'thinking',
        neutral: 'idle'
      }
      const motion = emotionMap[emotion] || 'idle'
      live2dApiRef.current?.triggerMotion(motion)
      // 同步更新 petState mood
      if (emotion === 'happy' || emotion === 'surprised') {
        recordInteraction('chat-reply')
      } else if (emotion === 'sad' || emotion === 'angry') {
        recordInteraction('chat-error')
      }
      // 3秒后恢复默认表情
      setTimeout(() => {
        try { live2dApiRef.current?.setExpression(0) } catch { /* ignore */ }
      }, 3000)
    } catch { /* ignore */ }
  }, [recordInteraction])

  // 监听来自独立聊天窗口的emotion事件
  useEffect(() => {
    const cleanup = window.api.onEmotion((emotion) => {
      handleEmotionChange(emotion)
    })
    return cleanup
  }, [handleEmotionChange])

  const handlePetClick = useCallback((_x: number, y: number): void => {
    if (clickCooldownRef.current) return
    clickCooldownRef.current = true
    setTimeout(() => { clickCooldownRef.current = false }, 1500)

    playClickSound()

    const isHead = y < 280
    const headReactions = ['摸摸头~好舒服！', '嘻嘻，别摸我头啦~', '嗯~最喜欢被摸头了！', '头发都乱了啦~', '哇！被摸头好开心~']
    const bodyReactions = ['嗯？干嘛戳我？', '在呢在呢~', '别戳我呀~', '有事吗？主人~', '哼哼，我在听哦~', '好痒好痒~']
    const reaction = isHead
      ? headReactions[Math.floor(Math.random() * headReactions.length)]
      : bodyReactions[Math.floor(Math.random() * bodyReactions.length)]

    try {
      if (isHead) {
        live2dApiRef.current?.triggerMotion('tap_head')
        recordInteraction('pet-head')
      } else {
        live2dApiRef.current?.triggerMotion('tap_body')
        recordInteraction('tap-body')
      }
      setTimeout(() => {
        try { live2dApiRef.current?.setExpression(0) } catch { /* ignore */ }
      }, 2500)
    } catch { /* ignore */ }
    showMessage(reaction, 3000)
  }, [showMessage, recordInteraction])

  useProactive(showMessage, settings.quietMode)

  // 内心想法气泡：偶尔显示云朵风格的内心独白（参考 Open-LLM-VTuber 的 inner thoughts）
  // v0.3.4：按当前 mood 选择对应心情的独白库
  useIdleThoughts(showInnerThought, petState.mood, { enabled: !settings.quietMode })

  const handleDragStart = useCallback((): void => {
    isDraggingRef.current = true
  }, [])

  const handleDragEnd = useCallback((): void => {
    isDraggingRef.current = false
    setTimeout(() => {
      if (!isFileDraggingRef.current) {
        window.api.forceInteractive(anyOverlayVisible)
      }
    }, 100)
  }, [anyOverlayVisible])

  const handleGlobalDrop = useCallback((e: ReactDragEvent): void => {
    e.preventDefault()
    isFileDraggingRef.current = false
  }, [])

  const handleChatClose = useCallback((): void => {
    setChatPanelVisible(false)
  }, [])

  const handleChatNewChat = useCallback((): void => {
    createConversation()
  }, [createConversation])

  const renderContent = (): JSX.Element => {
    if (loading) {
      return <div style={ipcLoadingStyle}>正在加载 Nito...</div>
    }
    if (!activeModelPath) {
      return <Live2DPlaceholder error={error} />
    }
    return (
      <Live2DCanvas
        modelPath={activeModelPath}
        modelFormat={activeModelFormat || 'cubism2'}
        onModelReady={handleModelReady}
        onError={handleModelError}
        mood={petState.mood}
      />
    )
  }

  return (
    <div
      style={effectiveContainerStyle}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault()
        }
      }}
      onDrop={handleGlobalDrop}
    >
      <DragRegion
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onFeedFile={handleFeedFile}
        onPetClick={handlePetClick}
      >
        {renderContent()}
      </DragRegion>

      <Bubble {...bubbleProps} anchorTop={modelHeadY} isThinking={chatThinking} />

      <ErrorBanner />

      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={closeContextMenu}
        onAction={handleContextMenuAction}
      />

      {settingsVisible && (
        <SettingsPanel
          visible={settingsVisible}
          onClose={() => setSettingsVisible(false)}
          onSave={handleSettingsSave}
        />
      )}

      {skinPickerVisible && (
        <SkinPicker
          visible={skinPickerVisible}
          onClose={() => setSkinPickerVisible(false)}
          onSelect={handleSkinSelect}
        />
      )}

      {onboardingVisible && (
        <OnboardingGuide
          visible={onboardingVisible}
          onComplete={handleOnboardingComplete}
        />
      )}

      {urlFeedDialogVisible && (
        <UrlFeedDialog
          visible={urlFeedDialogVisible}
          submitting={feeding}
          onClose={closeUrlFeedDialog}
          onSubmit={handleUrlSubmit}
        />
      )}

      <FeedProgressDialog
        visible={feedProgress.visible}
        files={feedProgress.files}
        onClose={handleFeedProgressDialogClose}
      />

      {triplePreview && (
        <TriplePreviewCard
          visible={true}
          fileName={triplePreview.fileName}
          triples={triplePreview.triples}
          entityCount={triplePreview.entityCount}
          tripleCount={triplePreview.tripleCount}
          onClose={() => setTriplePreview(null)}
          onViewGraph={() => { window.api.openPanel(); setTriplePreview(null); }}
        />
      )}

      <ChatPanel
        visible={chatPanelVisible}
        onClose={handleChatClose}
        onThinkingChange={handleChatThinkingChange}
        onEmotionChange={handleEmotionChange}
        searchMode={settings.llmProvider}
        onFeedFile={handleFeedFile}
        onNewChat={handleChatNewChat}
      />
    </div>
  )
}

export default function App(): JSX.Element {
  if (
    typeof window !== 'undefined' &&
    window.location.hash.startsWith('#/chat-window')
  ) {
    return <ChatWindowApp />
  }

  if (
    typeof window !== 'undefined' &&
    window.location.hash.startsWith('#/panel')
  ) {
    return <PanelApp />
  }

  return (
    <BubbleProvider>
      <SettingsProvider>
        <ChatStoreProvider>
          <AppInner />
        </ChatStoreProvider>
      </SettingsProvider>
    </BubbleProvider>
  )
}
