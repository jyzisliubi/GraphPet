import { useCallback, useEffect } from 'react'
import type { CSSProperties } from 'react'
import ChatPanel from './components/ChatPanel'
import { useBubble } from './hooks/useBubble'
import { useFeed } from './hooks/useFeed'
import { BubbleProvider } from './stores/bubbleStore'
import { SettingsProvider } from './stores/settingsStore'
import { ChatStoreProvider, useChatStore } from './stores/chatStore'
import Bubble from './components/Bubble'

const rootStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  background: '#0a0a0a',
  overflow: 'hidden',
  boxSizing: 'border-box',
  margin: 0,
  padding: 0,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  WebkitFontSmoothing: 'antialiased'
}

function ChatWindowInner(): JSX.Element {
  const { bubbleProps, showMessage } = useBubble()
  const { feedFile } = useFeed({
    onFeedStart: () => showMessage('吃东西啦...', 1500),
    onFeedEnd: (ok) => showMessage(ok ? '吃饱了！记住知识点了~' : '吃不下这个...', 2500)
  })
  const { createConversation } = useChatStore()

  useEffect(() => {
    const splash = document.getElementById('graphpet-splash')
    if (splash) splash.remove()
  }, [])

  const handleFeedFile = useCallback(
    (filePath: string) => {
      void feedFile(filePath)
    },
    [feedFile]
  )

  const handleClose = useCallback((): void => {
    window.api.closeChat()
  }, [])

  const handleNewChat = useCallback((): void => {
    createConversation()
  }, [createConversation])

  const handleEmotionChange = useCallback((emotion: string): void => {
    try { window.api.sendEmotion(emotion) } catch { /* ignore */ }
  }, [])

  return (
    <div style={rootStyle}>
      <ChatPanel
        visible={true}
        embedded={true}
        onClose={handleClose}
        onNewChat={handleNewChat}
        onFeedFile={handleFeedFile}
        onEmotionChange={handleEmotionChange}
      />
      {bubbleProps.visible && (
        <Bubble {...bubbleProps} />
      )}
    </div>
  )
}

export default function ChatWindowApp(): JSX.Element {
  return (
    <BubbleProvider>
      <SettingsProvider>
        <ChatStoreProvider>
          <ChatWindowInner />
        </ChatStoreProvider>
      </SettingsProvider>
    </BubbleProvider>
  )
}
