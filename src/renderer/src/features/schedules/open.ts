import { useChat } from '@renderer/features/chat/store'

/** Mở cuộc trò chuyện của một lần chạy (đánh dấu đã xem do chat làm khi cuộc được mở — xem setupSeen). */
export async function openRunConversation(conversationId: string, navigate: (to: string) => unknown): Promise<void> {
  await useChat.getState().select(conversationId)
  void navigate('/')
}
