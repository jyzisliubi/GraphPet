import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { KeyboardEvent, ReactNode, CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MessageCircle, Paperclip, X, Send, Plus, Trash2, ChevronLeft, ChevronRight, PanelLeft, Minus, Mic, Square } from 'lucide-react'
import { chatStream, type ChatSource, type ChatHistoryMessage } from '../services/chatService'
import { playMessageSound, playErrorSound } from '../services/soundService'
import { speakText, stopSpeaking, isSpeaking } from '../services/ttsService'
import { startListening, stopListening, isSTTSupported, getIsListening } from '../services/sttService'
import { useVAD } from '../hooks/useVAD'
import { useChatStore, type ChatMessage as StoreChatMessage, type Conversation } from '../stores/chatStore'
import { useSettings } from '../stores/settingsStore'
import { useT } from '../i18n'
import NitoIcon from './NitoIcon'

export interface ChatPanelProps {
  visible: boolean
  onClose: () => void
  onThinkingChange?: (thinking: boolean) => void
  onEmotionChange?: (emotion: string) => void
  searchMode?: string
  onFeedFile?: (filePath: string) => Promise<boolean> | boolean
  embedded?: boolean
  externalMessages?: Array<{ role: string; content: string }>
  onMessagesChange?: (msgs: Array<{ role: string; content: string }>) => void
  onNewChat?: () => void
}

const CHAT_PANEL_CSS = `.graphpet-chat-panel {
  position: fixed;
  top: 8px;
  right: 8px;
  width: 480px;
  max-width: calc(100vw - 16px);
  height: 600px;
  max-height: calc(100vh - 16px);
  z-index: 9998;
  display: flex;
  flex-direction: row;
  background: #111113;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  color: #e4e4e7;
  overflow: hidden;
  user-select: none;
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
  animation: graphpet-chat-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: auto;
}
.graphpet-chat-panel.graphpet-chat-panel--embedded {
  position: relative;
  top: 0; right: 0;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 0;
  border-radius: 0;
  box-shadow: none;
  animation: none;
  background: #0a0a0a;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border: none;
  flex: 1;
  overflow: hidden;
}
@keyframes graphpet-chat-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
/* 侧边栏 */
.graphpet-chat-sidebar {
  width: 180px;
  flex-shrink: 0;
  min-width: 0;
  min-height: 0;
  background: #111113;
  border-right: 1px solid #27272a;
  display: flex;
  flex-direction: column;
  transition: width 0.2s ease, opacity 0.2s ease;
  overflow: hidden;
}
.graphpet-chat-sidebar--collapsed {
  width: 0;
  opacity: 0;
  border-right: none;
}
.graphpet-chat-sidebar-header {
  padding: 10px 12px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}
.graphpet-chat-new-btn {
  flex: 1;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #6366f1;
  background: transparent;
  color: #6366f1;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.15s;
  font-family: inherit;
}
.graphpet-chat-new-btn:hover {
  background: #6366f1;
  color: #ffffff;
}
.graphpet-chat-collapse-btn {
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  color: #71717a;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  flex-shrink: 0;
}
.graphpet-chat-collapse-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #e4e4e7;
}
.graphpet-chat-conv-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 8px;
}
.graphpet-chat-conv-list::-webkit-scrollbar {
  width: 4px;
}
.graphpet-chat-conv-list::-webkit-scrollbar-thumb {
  background: #3f3f46;
  border-radius: 2px;
}
.graphpet-chat-conv-list::-webkit-scrollbar-track {
  background: transparent;
}
.graphpet-chat-conv-item {
  height: 52px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
  margin-bottom: 2px;
}
.graphpet-chat-conv-item:hover {
  background: #27272a;
}
.graphpet-chat-conv-item--active {
  background: rgba(99, 102, 241, 0.15) !important;
}
.graphpet-chat-conv-item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  background: #6366f1;
  border-radius: 0 2px 2px 0;
}
.graphpet-chat-conv-info {
  flex: 1;
  min-width: 0;
}
.graphpet-chat-conv-title {
  font-size: 13px;
  font-weight: 500;
  color: #e4e4e7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.graphpet-chat-conv-preview {
  font-size: 11px;
  color: #71717a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
.graphpet-chat-conv-delete {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #71717a;
  border-radius: 6px;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
  flex-shrink: 0;
}
.graphpet-chat-conv-item:hover .graphpet-chat-conv-delete {
  display: flex;
}
.graphpet-chat-conv-delete:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}
/* 展开按钮（侧边栏折叠时显示） */
.graphpet-chat-expand-btn {
  position: absolute;
  top: 52px;
  left: 12px;
  width: 40px;
  height: 40px;
  border: 1px solid #27272a;
  background: #18181b;
  color: #a1a1aa;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}
.graphpet-chat-expand-btn:hover {
  background: #27272a;
  color: #e4e4e7;
}
/* 主聊天区 */
.graphpet-chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
}
/* 标题栏 */
.graphpet-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: #111113;
  color: #fafafa;
  flex-shrink: 0;
  cursor: move;
  user-select: none;
  min-height: 44px;
  border-bottom: 1px solid #27272a;
}
.graphpet-chat-panel--embedded .graphpet-chat-header {
  cursor: move;
  padding: 8px 12px;
  background: #111113;
}
.graphpet-chat-title {
  font-size: 14.5px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.graphpet-chat-title-icon {
  font-size: 20px;
  color: #6366f1;
}
.graphpet-chat-header-actions {
  display: flex;
  gap: 6px;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
  align-items: center;
}
.graphpet-chat-icon-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #71717a;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  padding: 0;
}
.graphpet-chat-icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #e4e4e7;
}
.graphpet-chat-icon-btn--close:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}
.graphpet-chat-panel--embedded .graphpet-chat-icon-btn {
  width: 32px;
  height: 32px;
  font-size: 16px;
  border-radius: 8px;
  background: transparent;
}
.graphpet-chat-panel--embedded .graphpet-chat-icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
.graphpet-chat-tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #a1a1aa;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  -webkit-app-region: no-drag;
  white-space: nowrap;
  flex-shrink: 0;
}
.graphpet-chat-tool-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  color: #c7d2fe;
}
/* 错误提示条 */
.graphpet-chat-error-bar {
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #fca5a5;
  font-size: 12px;
  border-radius: 10px;
  margin: 8px 12px;
  flex-shrink: 0;
}
/* 成功 toast */
.graphpet-chat-toast {
  padding: 10px 14px;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #86efac;
  font-size: 12px;
  border-radius: 10px;
  margin: 8px 12px;
  flex-shrink: 0;
  animation: graphpet-toast-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes graphpet-toast-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
/* 消息列表 */
.graphpet-chat-messages {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  min-height: 0;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #0a0a0a;
}
.graphpet-chat-messages::-webkit-scrollbar {
  width: 6px;
}
.graphpet-chat-messages::-webkit-scrollbar-thumb {
  background: #3f3f46;
  border-radius: 3px;
}
.graphpet-chat-messages::-webkit-scrollbar-thumb:hover {
  background: #52525b;
}
.graphpet-chat-messages::-webkit-scrollbar-track {
  background: transparent;
}
/* 消息行 */
.graphpet-chat-row {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: flex-end;
  gap: 8px;
}
.graphpet-chat-row--user {
  justify-content: flex-end;
}
.graphpet-chat-row--nito {
  justify-content: flex-start;
}
/* Nito 头像 */
.graphpet-chat-avatar {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}
/* 气泡 */
.graphpet-chat-bubble {
  max-width: 78%;
  min-width: 0;
  padding: 10px 14px;
  font-size: 13.5px;
  line-height: 1.6;
  word-break: break-word;
  overflow-wrap: break-word;
}
.graphpet-chat-bubble--user {
  background: #6366f1;
  color: #ffffff;
  border-radius: 16px 16px 4px 16px;
  white-space: pre-wrap;
}
.graphpet-chat-bubble--nito {
  background: #18181b;
  color: #e4e4e7;
  border: 1px solid #27272a;
  border-radius: 16px 16px 16px 4px;
}
.graphpet-chat-bubble--error {
  background: rgba(239, 68, 68, 0.1);
  color: #fca5a5;
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 10px;
  white-space: pre-wrap;
}
/* 思考中三点跳动 */
.graphpet-chat-thinking {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 2px;
}
.graphpet-chat-thinking span {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6366f1;
  animation: graphpet-chat-bounce 1.2s infinite ease-in-out;
}
.graphpet-chat-thinking span:nth-child(2) {
  animation-delay: 0.2s;
}
.graphpet-chat-thinking span:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes graphpet-chat-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-5px); opacity: 1; }
}
/* 引用上标 */
.graphpet-chat-cite {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: super;
  font-size: 10.5px;
  line-height: 1;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  margin: 0 2px;
  border-radius: 4px;
  background: rgba(99, 102, 241, 0.15);
  color: #c7d2fe;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
  font-weight: 600;
}
.graphpet-chat-cite:hover {
  background: rgba(99, 102, 241, 0.25);
}
.graphpet-chat-cite--active {
  background: #6366f1;
  color: #ffffff;
}
/* Markdown 渲染样式 */
.graphpet-chat-md {
  font-size: 13.5px;
  line-height: 1.7;
}
.graphpet-chat-md p {
  margin: 0 0 8px 0;
}
.graphpet-chat-md p:last-child {
  margin-bottom: 0;
}
.graphpet-chat-md strong {
  color: #fafafa;
  font-weight: 600;
}
.graphpet-chat-md em {
  color: #c4b5fd;
  font-style: italic;
}
.graphpet-chat-md code {
  background: rgba(99, 102, 241, 0.15);
  color: #c7d2fe;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12.5px;
  font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace;
}
.graphpet-chat-md pre {
  background: #0f0f11;
  border: 1px solid #27272a;
  border-radius: 8px;
  padding: 12px;
  margin: 8px 0;
  overflow-x: auto;
}
.graphpet-chat-md pre code {
  background: transparent;
  color: #e4e4e7;
  padding: 0;
  border-radius: 0;
  font-size: 12px;
}
.graphpet-chat-md ul, .graphpet-chat-md ol {
  margin: 6px 0;
  padding-left: 20px;
}
.graphpet-chat-md li {
  margin: 3px 0;
}
.graphpet-chat-md h1, .graphpet-chat-md h2, .graphpet-chat-md h3, .graphpet-chat-md h4 {
  margin: 10px 0 6px 0;
  color: #fafafa;
  font-weight: 600;
}
.graphpet-chat-md h1 { font-size: 16px; }
.graphpet-chat-md h2 { font-size: 15px; }
.graphpet-chat-md h3 { font-size: 14px; }
.graphpet-chat-md blockquote {
  border-left: 3px solid #6366f1;
  margin: 8px 0;
  padding: 4px 12px;
  color: #a1a1aa;
  background: rgba(99, 102, 241, 0.05);
  border-radius: 0 6px 6px 0;
}
.graphpet-chat-md a {
  color: #818cf8;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.graphpet-chat-md a:hover {
  color: #a5b4fc;
}
.graphpet-chat-md table {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12.5px;
}
.graphpet-chat-md th, .graphpet-chat-md td {
  border: 1px solid #27272a;
  padding: 6px 10px;
  text-align: left;
}
.graphpet-chat-md th {
  background: #27272a;
  color: #fafafa;
}
.graphpet-chat-md hr {
  border: none;
  border-top: 1px solid #27272a;
  margin: 10px 0;
}
/* sources 折叠区 */
.graphpet-chat-sources {
  margin-top: 8px;
  border-top: 1px solid #27272a;
  padding-top: 8px;
}
.graphpet-chat-sources-toggle {
  font-size: 11.5px;
  color: #71717a;
  cursor: pointer;
  user-select: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.graphpet-chat-sources-toggle:hover {
  color: #a1a1aa;
}
.graphpet-chat-source-item {
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #0a0a0a;
  font-size: 11.5px;
  line-height: 1.5;
  color: #a1a1aa;
  border-left: 3px solid #3f3f46;
  transition: background 0.2s, border-left-color 0.2s;
}
.graphpet-chat-source-item--highlight {
  background: rgba(99, 102, 241, 0.08);
  border-left-color: #6366f1;
}
.graphpet-chat-source-id {
  font-weight: 700;
  color: #c7d2fe;
  margin-right: 4px;
}
.graphpet-chat-source-score {
  color: #71717a;
  font-size: 10.5px;
  margin-left: 4px;
}
.graphpet-chat-source-entity {
  color: #c7d2fe;
  font-weight: 600;
  margin-right: 6px;
}
.graphpet-chat-source-file {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  margin-right: 6px;
  background: rgba(99, 102, 241, 0.15);
  color: #c7d2fe;
  border-radius: 4px;
  font-size: 10.5px;
  font-weight: 500;
}
/* 流式输出光标 */
.graphpet-chat-cursor {
  display: inline-block;
  width: 2px;
  height: 15.5px;
  background: #6366f1;
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: graphpet-cursor-blink 0.8s infinite;
  border-radius: 1px;
}
@keyframes graphpet-cursor-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
/* 空状态 */
.graphpet-chat-empty {
  margin: auto;
  text-align: center;
  color: #71717a;
  font-size: 13.5px;
  line-height: 1.7;
  padding: 30px 20px;
}
.graphpet-chat-empty-subtitle {
  color: #52525b;
  font-size: 12.5px;
  margin-top: 4px;
}
.graphpet-chat-empty-emoji {
  font-size: 64px;
  display: block;
  margin-bottom: 12px;
  opacity: 0.9;
}
/* 快捷操作区（嵌入模式空状态） */
.graphpet-chat-quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 16px;
}
.graphpet-chat-quick-btn {
  padding: 8px 14px;
  border: 1px solid #27272a;
  border-radius: 10px;
  background: transparent;
  color: #a1a1aa;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.graphpet-chat-quick-btn:hover {
  border-color: #6366f1;
  color: #c7d2fe;
  background: rgba(99, 102, 241, 0.08);
}
/* 输入区 */
.graphpet-chat-input-area {
  flex-shrink: 0;
  padding: 12px;
  background: #18181b;
  border-top: 1px solid #27272a;
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.graphpet-chat-input {
  flex: 1;
  min-width: 0;
  resize: none;
  max-height: 120px;
  min-height: 44px;
  padding: 12px 16px;
  font-size: 13.5px;
  font-family: inherit;
  color: #e4e4e7;
  background: #27272a;
  border: 1px solid transparent;
  border-radius: 12px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
  box-sizing: border-box;
  line-height: 1.5;
}
.graphpet-chat-input:focus {
  border-color: #6366f1;
  background: #27272a;
}
.graphpet-chat-input::placeholder {
  color: #71717a;
}
.graphpet-chat-send {
  flex-shrink: 0;
  height: 44px;
  padding: 0 16px;
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
  background: #6366f1;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 6px;
}
.graphpet-chat-send:hover:not(:disabled) {
  background: #818cf8;
}
.graphpet-chat-send:active:not(:disabled) {
  background: #4f46e5;
}
.graphpet-chat-send:disabled {
  background: #3f3f46;
  cursor: not-allowed;
  color: #71717a;
}
/* 拖拽上传遮罩 */
.gp-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 9999;
  background: rgba(99, 102, 241, 0.15);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: 2px dashed #6366f1;
  border-radius: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  animation: graphpet-fade-in 0.15s ease-out forwards;
}
.gp-drop-overlay-inner {
  text-align: center;
}
.gp-drop-overlay-icon {
  margin-bottom: 12px;
  animation: graphpet-float 2s ease-in-out infinite;
  display: flex;
  justify-content: center;
}
.gp-drop-overlay-text {
  font-size: 16px;
  font-weight: 600;
  color: #c7d2fe;
}
@keyframes graphpet-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes graphpet-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
/* Feeding 进度提示 */
.graphpet-chat-feeding {
  margin: 8px 12px;
  padding: 10px 14px;
  background: #18181b;
  border: 1px solid #27272a;
  border-radius: 10px;
  font-size: 12px;
  color: #a1a1aa;
}
.graphpet-chat-feeding-progress {
  margin-top: 6px;
  height: 4px;
  background: #27272a;
  border-radius: 2px;
  overflow: hidden;
}
.graphpet-chat-feeding-progress-bar {
  height: 100%;
  background: #6366f1;
  border-radius: 2px;
  transition: width 0.3s;
}

`

let styleInjected = false
function injectStyle(): void {
  if (styleInjected) return
  if (typeof document === 'undefined') return
  const el = document.createElement('style')
  el.textContent = CHAT_PANEL_CSS
  document.head.appendChild(el)
  styleInjected = true
}

type AnswerSegment =
  | { type: 'text'; value: string }
  | { type: 'cite'; id: number }

function parseAnswer(text: string): AnswerSegment[] {
  const segments: AnswerSegment[] = []
  const regex = /\[(\d+)\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'cite', id: Number(match[1]) })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return segments
}

function renderAnswerContent(
  message: StoreChatMessage,
  activeCiteId: number | null,
  onCiteClick: (id: number) => void
): ReactNode {
  const segments = parseAnswer(message.content)
  const nodes: ReactNode[] = []
  let textBuffer = ''
  let flushText = (key: string): void => {
    if (textBuffer.trim()) {
      nodes.push(
        <div key={key} className="graphpet-chat-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{textBuffer}</ReactMarkdown>
        </div>
      )
    }
    textBuffer = ''
  }
  segments.forEach((seg, idx) => {
    if (seg.type === 'text') {
      textBuffer += seg.value
    } else {
      flushText(`t-${idx}`)
      const hasSource =
        Array.isArray(message.sources) &&
        message.sources.some((s) => s.id === seg.id)
      const isActive = activeCiteId === seg.id
      nodes.push(
        <span
          key={`c-${idx}`}
          className={`graphpet-chat-cite${isActive ? ' graphpet-chat-cite--active' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onCiteClick(seg.id)
          }}
          role={hasSource ? 'button' : undefined}
          title={hasSource ? t('chat.show_sources') + ' ' + seg.id : undefined}
        >
          [{seg.id}]
        </span>
      )
    }
  })
  flushText('t-end')
  if (message.isStreaming) {
    nodes.push(<span key="cursor" className="graphpet-chat-cursor" />)
  }
  return <>{nodes}</>
}

function MessageItem({
  message,
  activeCiteId,
  onCiteClick,
  ttsVoice,
  ttsProvider,
  embedded: _embedded
}: {
  message: StoreChatMessage
  activeCiteId: number | null
  onCiteClick: (id: number) => void
  /** TTS 语音角色（仅在用户点击"朗读"按钮时使用） */
  ttsVoice?: string
  /** TTS provider：'edge' / 'piper' */
  ttsProvider?: 'edge' | 'piper'
  embedded?: boolean
}): JSX.Element {
  const t = useT()
  const [sourcesExpanded, setSourcesExpanded] = useState<boolean>(false)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)

  useEffect(() => {
    if (
      activeCiteId !== null &&
      Array.isArray(message.sources) &&
      message.sources.some((s) => s.id === activeCiteId)
    ) {
      setSourcesExpanded(true)
    }
  }, [activeCiteId, message.sources])

  const isUser = message.role === 'user'
  const rowClass = isUser
    ? 'graphpet-chat-row graphpet-chat-row--user'
    : 'graphpet-chat-row graphpet-chat-row--nito'

  let bubbleClass = 'graphpet-chat-bubble '
  if (isUser) {
    bubbleClass += 'graphpet-chat-bubble--user'
  } else if (message.isError) {
    bubbleClass += 'graphpet-chat-bubble--error'
  } else {
    bubbleClass += 'graphpet-chat-bubble--nito'
  }

  if (message.isStreaming && !message.content) {
    return (
      <div className={rowClass}>
        {!isUser && <div className="graphpet-chat-avatar"><NitoIcon size={28} /></div>}
        <div className={bubbleClass}>
          <span className="graphpet-chat-thinking">
            <span />
            <span />
            <span />
          </span>
        </div>
      </div>
    )
  }

  const hasSources =
    !isUser && !message.isError && Array.isArray(message.sources) && message.sources.length > 0
  // 仅在 Nito 完成（非 streaming、非错误、有内容）的回答气泡上显示朗读按钮
  const canSpeak =
    !isUser &&
    !message.isError &&
    !message.isStreaming &&
    !!message.content &&
    message.content.trim().length > 0

  const handleSpeakClick = (): void => {
    if (isPlaying) {
      stopSpeaking()
      return
    }
    setIsPlaying(true)
    void speakText(message.content, ttsVoice ?? 'zh-CN-XiaoyiNeural', () => {
      setIsPlaying(false)
    }, ttsProvider ?? 'edge')
  }

  return (
    <div className={rowClass}>
      {!isUser && <div className="graphpet-chat-avatar"><NitoIcon size={28} /></div>}
      <div className={bubbleClass}>
        {isUser ? message.content : renderAnswerContent(message, activeCiteId, onCiteClick)}
        {hasSources && (
          <div className="graphpet-chat-sources">
            <span
              className="graphpet-chat-sources-toggle"
              onClick={(e) => {
                e.stopPropagation()
                setSourcesExpanded((v) => !v)
              }}
              role="button"
            >
              {sourcesExpanded ? t('chat.hide_sources') : t('chat.show_sources')}
              <span style={{ marginLeft: 2 }}>({message.sources!.length})</span>
            </span>
            {sourcesExpanded && (
              <div>
                {message.sources!.map((src: ChatSource) => (
                  <div
                    key={src.id}
                    className={`graphpet-chat-source-item${
                      activeCiteId === src.id ? ' graphpet-chat-source-item--highlight' : ''
                    }`}
                  >
                    <span className="graphpet-chat-source-id">[{src.id}]</span>
                    {src.entity && (
                      <span className="graphpet-chat-source-entity">{src.entity}</span>
                    )}
                    {src.source_file && (
                      <span className="graphpet-chat-source-file" title={src.source_file}>
                        📄 {src.source_file.length > 20 ? src.source_file.slice(0, 17) + '...' : src.source_file}
                      </span>
                    )}
                    {src.text}
                    <span className="graphpet-chat-source-score">
                      {t('chat.source_relevance', { percent: Math.round(src.score * 100) })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {canSpeak && (
          <button
            type="button"
            className="graphpet-chat-tts-btn"
            onClick={(e) => {
              e.stopPropagation()
              handleSpeakClick()
            }}
            title={isPlaying ? t('chat.stop_speaking') : t('chat.speak_tooltip')}
            style={{
              marginTop: 6,
              padding: '2px 8px',
              fontSize: 11,
              lineHeight: 1.4,
              background: isPlaying ? '#6366f1' : 'transparent',
              color: isPlaying ? '#fff' : '#a1a1aa',
              border: '1px solid #27272a',
              borderRadius: 6,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            {isPlaying ? t('chat.stop') : t('chat.read')}
          </button>
        )}
      </div>
    </div>
  )
}

const QUICK_QUESTION_KEYS = ['chat.quick_q1', 'chat.quick_q2', 'chat.quick_q3', 'chat.quick_q4'] as const

function generateMsgId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function formatTime(timestamp: number, locale: 'zh' | 'en' = 'zh'): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const bcp47 = locale === 'en' ? 'en-US' : 'zh-CN'
  if (isToday) {
    return date.toLocaleTimeString(bcp47, { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString(bcp47, { month: 'short', day: 'numeric' })
}

export default function ChatPanel({
  visible,
  onClose,
  onThinkingChange,
  onEmotionChange,
  searchMode,
  onFeedFile,
  embedded = false,
  onNewChat
}: ChatPanelProps): JSX.Element | null {
  const {
    conversations,
    activeConversationId,
    createConversation,
    deleteConversation,
    switchConversation,
    addMessage,
    updateMessage
  } = useChatStore()
  const { settings } = useSettings()
  const t = useT()
  // 用 ref 持有 settings，避免 settings 变化时 handleSend 重建（保持原依赖列表稳定）
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // 用 ref 持有 t 函数，避免在 handleSend 闭包中捕获旧 t（locale 切换时立即生效）
  const tRef = useRef(t)
  tRef.current = t

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(true)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState<string>('')
  const [activeCiteId, setActiveCiteId] = useState<number | null>(null)
  const [isListeningSTT, setIsListeningSTT] = useState<boolean>(false)
  const [sttSupported] = useState<boolean>(() => isSTTSupported())
  const [isDragging, setIsDragging] = useState(false)

  // VAD 语音打断：用户说话时停止 TTS（仅当 settings.vadEnabled 开启时激活）
  const vadRef = useRef<boolean>(false)
  vadRef.current = settingsRef.current.vadEnabled
  const { start: startVAD, stop: stopVAD, active: vadActive } = useVAD({
    threshold: 0.06,
    startDebounceMs: 200,
    endDebounceMs: 800,
    onVoiceStart: () => {
      // 用户开始说话 → 立即停止 TTS
      if (isSpeaking()) {
        stopSpeaking()
      }
    },
  })
  // vadEnabled 切换时启动/停止 VAD
  useEffect(() => {
    if (settingsRef.current.vadEnabled && !vadActive) {
      void startVAD()
    } else if (!settingsRef.current.vadEnabled && vadActive) {
      stopVAD()
    }
  }, [settings.vadEnabled, vadActive, startVAD, stopVAD, settingsRef])

  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null)
  const dragRef = useRef<{
    dragging: boolean
    startX: number
    startY: number
    startTop: number
    startLeft: number
    startWinX?: number
    startWinY?: number
  } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const inputValueRef = useRef<string>(input)
  inputValueRef.current = input
  const loadingRef = useRef<boolean>(false)
  const activeConversationIdRef = useRef<string | null>(activeConversationId)
  // 用 ref 持有最新 messages，避免 handleSend 把 messages 列入 deps 导致每条消息都重建
  // 注意：messages 变量在下方声明，这里只创建 ref，赋值放在 messages 声明之后避免 TDZ
  const messagesDataRef = useRef<readonly StoreChatMessage[]>([])

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId
  }, [activeConversationId])

  useEffect(() => {
    loadingRef.current = loading
  }, [loading])

  // 卸载时清理 toast 定时器避免泄漏
  // P1-F 修复：同时停止 STT/TTS，避免组件卸载后仍持有麦克风/扬声器资源
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      try { stopListening() } catch { /* 静默 */ }
      try { stopSpeaking() } catch { /* 静默 */ }
    }
  }, [])

  const activeConversation = useMemo(() => {
    return conversations.find(c => c.id === activeConversationId) || null
  }, [conversations, activeConversationId])

  const messages = activeConversation?.messages || []
  // 在 messages 声明后同步到 ref，供 handleSend 读取最新值（避免 deps 重建）
  messagesDataRef.current = messages

  const showFeedToast = (msg: string): void => {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 2500)
  }

  useEffect(() => {
    injectStyle()
  }, [])

  useEffect(() => {
    if (!visible || embedded) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // P2-E 修复：textarea/input/contenteditable 聚焦时 Escape 应该是"取消输入"而非关闭面板
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'textarea' || tag === 'input' || target?.isContentEditable) {
        // 先尝试 blur 让焦点回到 body，再下次 Escape 才关闭
        try { target.blur() } catch { /* ignore */ }
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, onClose, embedded])

  // P2-C 修复：流式回答时只在用户未向上滚动时才自动滚到底部
  // 原代码每次 messages 变化都 scrollTop = scrollHeight，用户查看历史时被强制拉回
  const isUserScrolledUpRef = useRef<boolean>(false)
  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    const onScroll = (): void => {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      isUserScrolledUpRef.current = distanceToBottom > 80
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    // 切对话时强制滚到底；流式回答中只在用户没主动向上滚动时才跟滚
    requestAnimationFrame(() => {
      if (!isUserScrolledUpRef.current) {
        el.scrollTop = el.scrollHeight
      }
    })
  }, [messages, loading, activeConversationId])

  // 切对话时重置滚动状态（新对话默认滚到底，不被旧的 isUserScrolledUp 影响）
  useEffect(() => {
    isUserScrolledUpRef.current = false
  }, [activeConversationId])

  useEffect(() => {
    if (visible) {
      if (!embedded) setPanelPos(null)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    } else {
      setInput('')
      setActiveCiteId(null)
    }
  }, [visible, embedded])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      const drag = dragRef.current
      if (!drag || !drag.dragging) return
      if (embedded) {
        const dx = e.screenX - drag.startX
        const dy = e.screenY - drag.startY
        if (drag.startWinX !== undefined && drag.startWinY !== undefined) {
          window.api.windowMove(drag.startWinX + dx, drag.startWinY + dy)
        }
      } else {
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        setPanelPos({
          top: Math.max(0, drag.startTop + dy),
          left: Math.max(0, Math.min(window.innerWidth - 360, drag.startLeft + dx))
        })
      }
    }
    const handleMouseUp = (): void => {
      if (dragRef.current) dragRef.current.dragging = false
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [embedded])

  const handleHeaderMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.graphpet-chat-icon-btn, .graphpet-chat-tool-btn')) return
    if (embedded) {
      dragRef.current = {
        dragging: true,
        startX: e.screenX,
        startY: e.screenY,
        startTop: 0,
        startLeft: 0,
        startWinX: window.screenX,
        startWinY: window.screenY
      }
    } else {
      const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
      dragRef.current = {
        dragging: true,
        startX: e.clientX,
        startY: e.clientY,
        startTop: panelPos ? panelPos.top : rect.top,
        startLeft: panelPos ? panelPos.left : rect.left
      }
    }
    e.preventDefault()
  }

  const setThinking = useCallback((thinking: boolean): void => {
    try {
      onThinkingChange?.(thinking)
    } catch {
    }
  }, [onThinkingChange])

  const handleSend = useCallback(async (): Promise<void> => {
    const trimmed = inputValueRef.current.trim()
    if (!trimmed || loadingRef.current) return
    if (!activeConversationIdRef.current) {
      const newId = createConversation()
      activeConversationIdRef.current = newId
    }

    const convId = activeConversationIdRef.current
    if (!convId) return

    inputValueRef.current = ''
    setInput('')
    setError(null)
    setLoading(true)
    setThinking(true)

    const userMsgId = generateMsgId()
    const assistantMsgId = generateMsgId()

    const userMsg: StoreChatMessage = {
      id: userMsgId,
      role: 'user',
      content: trimmed,
      timestamp: Date.now()
    }

    const pendingMsg: StoreChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true
    }

    addMessage(convId, userMsg)

    const historyMessages = [...messagesDataRef.current, userMsg].filter(m => !m.isStreaming && !m.isError)

    const historyForApi: ChatHistoryMessage[] = historyMessages
      .slice(-20)
      .map(m => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as ChatHistoryMessage['role'],
        content: m.content
      }))

    addMessage(convId, pendingMsg)

    let accumulatedContent = ''
    let finalSources: ChatSource[] = []
    let finalSuccess = true
    let finalMessage = ''

    try {
      for await (const event of chatStream(trimmed, searchMode, historyForApi)) {
        if (activeConversationIdRef.current !== convId) {
          // 用户切到其他对话，收尾当前 pendingMsg 避免永久 isStreaming: true
          updateMessage(convId, assistantMsgId, {
            content: accumulatedContent || tRef.current('chat.switched_interrupt'),
            isStreaming: false,
            isError: false
          })
          break
        }
        switch (event.type) {
          case 'status':
            break
          case 'chunk':
            accumulatedContent += event.content
            updateMessage(convId, assistantMsgId, {
              content: accumulatedContent,
              isStreaming: true
            })
            break
          case 'sources':
            finalSources = event.sources
            updateMessage(convId, assistantMsgId, {
              sources: event.sources
            })
            break
          case 'error':
            finalSuccess = false
            finalMessage = event.message
            break
          case 'done':
            if (!accumulatedContent && event.answer) {
              accumulatedContent = event.answer
            }
            if (event.sources && event.sources.length > 0) {
              finalSources = event.sources
            }
            // P2 修复：仅在未收到 error 事件时才标记成功，避免先 error 后 done 覆盖错误状态
            if (finalSuccess !== false) {
              finalSuccess = true
            }
            // 驱动 Live2D 表情
            if (event.emotion) {
              try { onEmotionChange?.(event.emotion) } catch { /* ignore */ }
            }
            break
        }
      }

      if (activeConversationIdRef.current === convId) {
        if (finalSuccess && accumulatedContent) {
          updateMessage(convId, assistantMsgId, {
            content: accumulatedContent || (finalSuccess ? '' : finalMessage || tRef.current('chat.failed')),
            sources: finalSources.length > 0 ? finalSources : undefined,
            isError: !finalSuccess,
            isStreaming: false
          })
          playMessageSound()
          // TTS 语音播报（仅当用户开启时调用，不阻塞主流程）
          if (settingsRef.current.ttsEnabled && accumulatedContent) {
            void speakText(accumulatedContent, settingsRef.current.ttsVoice, undefined, settingsRef.current.ttsProvider)
          }
        } else if (!finalSuccess) {
          updateMessage(convId, assistantMsgId, {
            content: finalMessage || tRef.current('chat.failed'),
            isError: true,
            isStreaming: false
          })
          setError(finalMessage || tRef.current('chat.failed'))
          playErrorSound()
        } else {
          updateMessage(convId, assistantMsgId, {
            isStreaming: false
          })
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      if (activeConversationIdRef.current === convId) {
        // 保留已累积的部分回答，附加网络中断提示，避免用户丢失 LLM 已说一半的内容
        const partialContent = accumulatedContent
          ? `${accumulatedContent}\n\n---\n\n${tRef.current('chat.network_interrupt', { msg: errMsg })}`
          : tRef.current('chat.error_prefix', { msg: errMsg })
        updateMessage(convId, assistantMsgId, {
          content: partialContent,
          isError: true,
          isStreaming: false
        })
        setError(errMsg)
        playErrorSound()
      }
    } finally {
      // P1-A 修复：无条件重置 loading，避免流式回答中切对话/新建对话导致 loading 永久卡死
      // （原条件守卫在切对话后跳过 setLoading(false)，输入框永久 disabled）
      setLoading(false)
      setThinking(false)
    }
  }, [addMessage, updateMessage, createConversation, searchMode, setThinking])

  const handleQuickQuestion = (q: string): void => {
    if (loadingRef.current) return
    inputValueRef.current = q
    setInput(q)
    void handleSend()
  }

  /** 切换语音输入：未在听则启动，已在听则停止并把累积文本送出 */
  const toggleSTT = (): void => {
    if (!sttSupported) return
    if (getIsListening()) {
      stopListening()
      setIsListeningSTT(false)
      return
    }
    setIsListeningSTT(true)
    // STT 语言跟随 locale（英文 locale 用英文识别，否则中文）
    startListening(settings.locale === 'en' ? 'en-US' : 'zh-CN', {
      onInterim: (text) => {
        // P1-E 修复：中间结果用 \u200B 标记，下次 onInterim/onFinal 通过正则替换掉
        // （原代码注释声称用 \u200B 标记但从未插入，导致中间结果无限累积）
        setInput((prev) => {
          const base = prev.replace(/\s*\u200B.*$/, '')
          return base ? `${base} \u200B${text}` : `\u200B${text}`
        })
      },
      onFinal: (text) => {
        // 最终结果：清掉中间结果标记，把最终文本合并到 base
        setInput((prev) => {
          const base = prev.replace(/\s*\u200B.*$/, '')
          const merged = base ? `${base} ${text}` : text
          inputValueRef.current = merged
          return merged
        })
      },
      onError: (err) => {
        setIsListeningSTT(false)
        setError(tRef.current('chat.error_prefix', { msg: err }))
      },
      onEnd: () => {
        setIsListeningSTT(false)
      }
    })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleCiteClick = (id: number): void => {
    setActiveCiteId((prev) => (prev === id ? null : id))
  }

  const handleNewChat = (): void => {
    if (onNewChat) {
      onNewChat()
    } else {
      createConversation()
    }
    setActiveCiteId(null)
    inputValueRef.current = ''
    setInput('')
    setError(null)
  }

  const handleDeleteConversation = (e: React.MouseEvent, id: string): void => {
    e.stopPropagation()
    if (window.confirm(t('chat.confirm_delete'))) {
      deleteConversation(id)
    }
  }

  const handleSelectConversation = (id: string): void => {
    // P2-A 修复：允许 loading 中切换对话（P1-A 已让 loading 不会卡死）
    // 切换时旧流会被 handleSend 的 activeConversationIdRef 守卫自动收尾
    switchConversation(id)
    setActiveCiteId(null)
    setError(null)
  }

  const handleUploadClick = (): void => {
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = e.target.files
    if (!files || files.length === 0 || !onFeedFile) return
    const file = files[0]
    // Electron 31+ sandbox 下 file.path 已废弃，改用 webUtils.getPathForFile
    const filePath = window.api?.getPathForFile?.(file)
    if (filePath) {
      // P1-C 修复：基于 onFeedFile 返回值决定 toast 文案（原代码无论成败都显示"已喂给Nito"）
      try {
        const ok = await Promise.resolve(onFeedFile(filePath))
        showFeedToast(ok === false ? t('chat.feed_failed', { name: file.name }) : t('chat.feed_success', { name: file.name }))
      } catch (err) {
        showFeedToast(t('chat.feed_failed_reason', { reason: err instanceof Error ? err.message : String(err) }))
      }
    }
    e.target.value = ''
  }

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (!isDragging) setIsDragging(true)
  }
  const handleDragLeave = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === e.target) setIsDragging(false)
  }
  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (!onFeedFile) return
    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      const file = files[0]
      // Electron 31+ sandbox 下 file.path 已废弃，改用 webUtils.getPathForFile
      const filePath = window.api?.getPathForFile?.(file)
      if (filePath) {
        // P1-C 修复：基于返回值决定 toast 文案
        void Promise.resolve(onFeedFile(filePath)).then((ok) => {
          showFeedToast(ok === false ? t('chat.feed_failed', { name: file.name }) : t('chat.feed_success', { name: file.name }))
        }).catch((err) => {
          showFeedToast(t('chat.feed_failed_reason', { reason: err instanceof Error ? err.message : String(err) }))
        })
      }
    }
  }

  const toggleSidebar = (): void => {
    setSidebarCollapsed(v => !v)
  }

  const getConvPreview = (conv: Conversation): string => {
    const lastMsg = conv.messages[conv.messages.length - 1]
    if (!lastMsg) return formatTime(conv.updatedAt, settings.locale)
    const preview = lastMsg.content.slice(0, 20)
    return preview || formatTime(lastMsg.timestamp, settings.locale)
  }

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading])

  if (!visible && !embedded) return null
  if (!visible) return null

  const panelStyle: CSSProperties = panelPos && !embedded
    ? { top: panelPos.top, left: panelPos.left, right: 'auto', transform: 'none' }
    : {}

  const panelClassName = `graphpet-chat-panel${embedded ? ' graphpet-chat-panel--embedded' : ''}`

  return (
    <div
      className={panelClassName}
      style={panelStyle}
      role="dialog"
      aria-modal={embedded}
      aria-label={t('chat.title_default')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="gp-drop-overlay">
          <div className="gp-drop-overlay-inner">
            <div className="gp-drop-overlay-icon"><NitoIcon size={80} /></div>
            <div className="gp-drop-overlay-text">{t('chat.drop_to_feed')}</div>
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
        accept=".txt,.md,.pdf,.docx,.html,.htm,.csv,.json,.py,.js,.ts,.tsx,.jsx,.java,.c,.cpp,.go,.rs,.yml,.yaml,.xml,.log"
      />

      <aside className={`graphpet-chat-sidebar${sidebarCollapsed ? ' graphpet-chat-sidebar--collapsed' : ''}`}>
        <div className="graphpet-chat-sidebar-header">
          <button
            type="button"
            className="graphpet-chat-new-btn"
            onClick={handleNewChat}
            title={t('chat.new_conversation')}
          >
            <Plus size={16} /> {t('chat.new_conversation')}
          </button>
          <button
            type="button"
            className="graphpet-chat-collapse-btn"
            onClick={toggleSidebar}
            title={t('chat.collapse_sidebar')}
          >
            <ChevronLeft size={18} />
          </button>
        </div>
        <div className="graphpet-chat-conv-list">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`graphpet-chat-conv-item${conv.id === activeConversationId ? ' graphpet-chat-conv-item--active' : ''}`}
              onClick={() => handleSelectConversation(conv.id)}
            >
              <div className="graphpet-chat-conv-info">
                <div className="graphpet-chat-conv-title">{conv.title}</div>
                <div className="graphpet-chat-conv-preview">{getConvPreview(conv)}</div>
              </div>
              <button
                type="button"
                className="graphpet-chat-conv-delete"
                onClick={(e) => handleDeleteConversation(e, conv.id)}
                title={t('chat.delete_conversation')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="graphpet-chat-main">
        {sidebarCollapsed && (
          <button
            type="button"
            className="graphpet-chat-expand-btn"
            onClick={toggleSidebar}
            title={t('chat.expand_history')}
          >
            <ChevronRight size={18} />
          </button>
        )}

        <div className="graphpet-chat-header" onMouseDown={handleHeaderMouseDown}>
          <div className="graphpet-chat-title">
            <span className="graphpet-chat-title-icon"><MessageCircle size={18} /></span>
            <span>{activeConversation?.title || t('chat.title_default')}</span>
          </div>
          <div className="graphpet-chat-header-actions">
            <button
              type="button"
              className="graphpet-chat-icon-btn"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? t('chat.expand_history') : t('chat.collapse_history')}
            >
              <PanelLeft size={16} />
            </button>
            {embedded ? (
              <>
                <button
                  type="button"
                  className="graphpet-chat-tool-btn"
                  onClick={handleUploadClick}
                  title={t('chat.upload_tooltip')}
                >
                  <Paperclip size={14} /> {t('chat.feed_file')}
                </button>
                <button
                  type="button"
                  className="graphpet-chat-tool-btn"
                  onClick={handleNewChat}
                  title={t('chat.start_new_chat')}
                >
                  <Plus size={14} /> {t('chat.new_chat')}
                </button>
                <button
                  type="button"
                  className="graphpet-chat-icon-btn"
                  onClick={() => window.api.minimizeChat()}
                  aria-label={t('chat.minimize')}
                  title={t('chat.minimize')}
                >
                  <Minus size={14} />
                </button>
                <button
                  type="button"
                  className="graphpet-chat-icon-btn graphpet-chat-icon-btn--close"
                  onClick={onClose}
                  aria-label={t('common.close')}
                  title={t('common.close')}
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="graphpet-chat-icon-btn"
                  onClick={handleUploadClick}
                  aria-label={t('chat.feed_file')}
                  title={t('chat.upload_tooltip')}
                >
                  <Paperclip size={16} />
                </button>
                <button
                  type="button"
                  className="graphpet-chat-icon-btn"
                  onClick={handleNewChat}
                  aria-label={t('chat.new_conversation')}
                  title={t('chat.new_conversation')}
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  className="graphpet-chat-icon-btn graphpet-chat-icon-btn--close"
                  onClick={onClose}
                  aria-label={t('common.close')}
                  title={t('common.close')}
                >
                  <X size={16} />
                </button>
              </>
            )}
          </div>
        </div>

        {error && <div className="graphpet-chat-error-bar">{error}</div>}
        {toast && <div className="graphpet-chat-toast">{toast}</div>}

        <div className="graphpet-chat-messages" ref={messagesRef}>
          {messages.length === 0 ? (
            <div className="graphpet-chat-empty">
              <span className="graphpet-chat-empty-emoji"><NitoIcon size={64} /></span>
              {t('chat.empty_title')}
              <br />
              <span className="graphpet-chat-empty-subtitle">
                {embedded ? t('chat.empty_embedded') : t('chat.empty_default')}
              </span>
              {embedded && (
                <div className="graphpet-chat-quick-actions">
                  {QUICK_QUESTION_KEYS.map((key) => {
                    const q = t(key)
                    return (
                      <button
                        key={key}
                        type="button"
                        className="graphpet-chat-quick-btn"
                        onClick={() => handleQuickQuestion(q)}
                      >
                        {q}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            messages.map((m) => (
              <MessageItem
                key={m.id}
                message={m}
                activeCiteId={activeCiteId}
                onCiteClick={handleCiteClick}
                ttsVoice={settingsRef.current.ttsVoice}
                ttsProvider={settingsRef.current.ttsProvider}
                embedded={embedded}
              />
            ))
          )}
        </div>

        <div className="graphpet-chat-input-area">
          <textarea
            ref={inputRef}
            className="graphpet-chat-input"
            value={input}
            placeholder={isListeningSTT ? t('chat.listening') : t('chat.placeholder')}
            rows={1}
            disabled={loading}
            spellCheck={false}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {sttSupported && (
            <button
              type="button"
              className={`graphpet-chat-mic${isListeningSTT ? ' graphpet-chat-mic--listening' : ''}`}
              onClick={toggleSTT}
              title={isListeningSTT ? t('chat.stop_voice_input') : t('chat.voice_input')}
              disabled={loading}
              style={{
                padding: '6px 10px',
                background: isListeningSTT ? '#ef4444' : 'transparent',
                color: isListeningSTT ? '#fff' : '#a1a1aa',
                border: '1px solid #27272a',
                borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12
              }}
            >
              {isListeningSTT ? <Square size={14} /> : <Mic size={14} />}
            </button>
          )}
          <button
            type="button"
            className="graphpet-chat-send"
            onClick={() => void handleSend()}
            disabled={!canSend}
          >
            {loading ? t('chat.thinking_dots') : <><Send size={14} /> {t('common.send')}</>}
          </button>
        </div>
      </div>
    </div>
  )
}
