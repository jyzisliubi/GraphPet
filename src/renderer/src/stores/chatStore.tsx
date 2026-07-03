import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ChatSource } from '../services/chatService'

const STORAGE_KEY = 'graphpet_conversations_v2'
const MAX_CONVERSATIONS = 100

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  sources?: ChatSource[]
  isStreaming?: boolean
  isError?: boolean
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

interface ChatStoreState {
  conversations: Conversation[]
  activeConversationId: string | null
  createConversation: () => string
  deleteConversation: (id: string) => void
  switchConversation: (id: string) => void
  addMessage: (conversationId: string, message: ChatMessage) => void
  updateMessage: (conversationId: string, messageId: string, updates: Partial<ChatMessage>) => void
  setActiveConversation: (id: string) => void
}

const ChatStoreContext = createContext<ChatStoreState | null>(null)

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed as Conversation[]
      }
    }
  } catch {
  }
  return []
}

function saveConversations(conversations: Conversation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
  } catch {
  }
}

function createEmptyConversation(): Conversation {
  const now = Date.now()
  return {
    id: generateId(),
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    messages: []
  }
}

function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
}

function trimConversations(conversations: Conversation[]): Conversation[] {
  const sorted = sortConversations(conversations)
  if (sorted.length > MAX_CONVERSATIONS) {
    return sorted.slice(0, MAX_CONVERSATIONS)
  }
  return sorted
}

interface ChatStoreProviderProps {
  children: ReactNode
}

export function ChatStoreProvider({ children }: ChatStoreProviderProps): JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const loaded = loadConversations()
    if (loaded.length === 0) {
      return [createEmptyConversation()]
    }
    return trimConversations(loaded)
  })

  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    const loaded = loadConversations()
    if (loaded.length > 0) {
      const sorted = sortConversations(loaded)
      return sorted[0].id
    }
    return null
  })

  useEffect(() => {
    const trimmed = trimConversations(conversations)
    if (trimmed.length !== conversations.length) {
      setConversations(trimmed)
      if (activeConversationId && !trimmed.find(c => c.id === activeConversationId)) {
        setActiveConversationId(trimmed[0]?.id ?? null)
      }
    }
  }, [conversations, activeConversationId])

  useEffect(() => {
    saveConversations(conversations)
  }, [conversations])

  useEffect(() => {
    if (conversations.length === 0) {
      const newConv = createEmptyConversation()
      setConversations([newConv])
      setActiveConversationId(newConv.id)
    } else if (!activeConversationId || !conversations.find(c => c.id === activeConversationId)) {
      const sorted = sortConversations(conversations)
      setActiveConversationId(sorted[0].id)
    }
  }, [conversations, activeConversationId])

  const createConversation = useCallback((): string => {
    const newConv = createEmptyConversation()
    setConversations(prev => trimConversations([newConv, ...prev]))
    setActiveConversationId(newConv.id)
    return newConv.id
  }, [])

  const deleteConversation = useCallback((id: string): void => {
    setConversations(prev => {
      const remaining = prev.filter(c => c.id !== id)
      if (remaining.length === 0) {
        const newConv = createEmptyConversation()
        setActiveConversationId(newConv.id)
        return [newConv]
      }
      if (activeConversationId === id) {
        const sorted = sortConversations(remaining)
        setActiveConversationId(sorted[0].id)
      }
      return trimConversations(remaining)
    })
  }, [activeConversationId])

  const switchConversation = useCallback((id: string): void => {
    setActiveConversationId(id)
  }, [])

  const addMessage = useCallback((conversationId: string, message: ChatMessage): void => {
    setConversations(prev => prev.map(conv => {
      if (conv.id !== conversationId) return conv
      const newMessages = [...conv.messages, message]
      let newTitle = conv.title
      if (message.role === 'user' && conv.messages.length === 0) {
        newTitle = message.content.length > 20
          ? message.content.slice(0, 20) + '...'
          : message.content
      }
      return {
        ...conv,
        messages: newMessages,
        title: newTitle,
        updatedAt: Date.now()
      }
    }))
  }, [])

  const updateMessage = useCallback((conversationId: string, messageId: string, updates: Partial<ChatMessage>): void => {
    setConversations(prev => prev.map(conv => {
      if (conv.id !== conversationId) return conv
      return {
        ...conv,
        messages: conv.messages.map(msg =>
          msg.id === messageId ? { ...msg, ...updates } : msg
        ),
        updatedAt: Date.now()
      }
    }))
  }, [])

  const setActiveConversation = useCallback((id: string): void => {
    setActiveConversationId(id)
  }, [])

  const value = useMemo<ChatStoreState>(() => ({
    conversations,
    activeConversationId,
    createConversation,
    deleteConversation,
    switchConversation,
    addMessage,
    updateMessage,
    setActiveConversation
  }), [
    conversations,
    activeConversationId,
    createConversation,
    deleteConversation,
    switchConversation,
    addMessage,
    updateMessage,
    setActiveConversation
  ])

  return (
    <ChatStoreContext.Provider value={value}>
      {children}
    </ChatStoreContext.Provider>
  )
}

export function useChatStore(): ChatStoreState {
  const context = useContext(ChatStoreContext)
  if (!context) {
    throw new Error('useChatStore must be used within a ChatStoreProvider')
  }
  return context
}
