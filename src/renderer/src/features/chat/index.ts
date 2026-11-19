import { MessagesSquare } from 'lucide-react'
import { api } from '@renderer/lib/api'
import { onSync } from '@renderer/lib/sync'
import type { FeatureDefinition } from '../types'
import { ChatPage } from './components/ChatPage'
import { ChatOverlays } from './components/ChatOverlays'
import { useChat } from './store'
import { setupVoice } from './voice/store'
import { setupRecent } from './expressive/recentStore'
import { setupApprovals } from './approvals/store'
import { setupSidebarShortcut } from './layout/sidebarStore'
import en from './i18n/en.json'
import vi from './i18n/vi.json'

export const chatFeature: FeatureDefinition = {
  id: 'chat',
  titleKey: 'title',
  icon: MessagesSquare,
  route: '/',
  roles: [],
  component: ChatPage,
  i18n: { vi, en },
  nav: 'top',
  // Nghe stream ở cấp app để không mất sự kiện khi người dùng sang trang khác.
  setup: () => {
    const offChat = api.chat.onEvent((payload) => useChat.getState().handleEvent(payload))
    // Thanh bên: tiêu đề AI đặt, gợi ý nhóm, thay đổi từ nơi khác → cập nhật ngay.
    const offSidebar = onSync('conversations', () => useChat.getState().refreshSidebar())
    // Ghim / thu hồi / sửa & gửi lại → tải lại tin của cuộc đang mở.
    const offMessages = onSync('messages', () => void useChat.getState().reloadMessages())
    const offVoice = setupVoice()
    // Emoji / GIF / sticker gần đây: nạp sẵn để bộ chọn mở đúng tab ngay lần đầu.
    const offRecent = setupRecent()
    // Thẻ chờ duyệt (sửa file, quyền thư mục, nháp) + câu trả lời "Hỏi lại" đang stream.
    const offApprovals = setupApprovals()
    // Ctrl+B: ẩn / hiện thanh bên chat.
    const offSidebarKey = setupSidebarShortcut()
    return () => {
      offChat()
      offSidebar()
      offMessages()
      offVoice()
      offRecent()
      offApprovals()
      offSidebarKey()
    }
  },
  overlay: ChatOverlays
}
