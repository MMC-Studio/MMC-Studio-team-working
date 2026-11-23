import { CircleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ChatMode } from '@shared/ai'
import { AssistantAvatar } from '@renderer/components/AssistantAvatar'
import { Button } from '@renderer/components/ui/button'
import { useCliStatus } from '@renderer/stores/cli'
import { usePreferences } from '@renderer/stores/preferences'
import { dragHasFiles, useComposeText } from '../draft'
import { newDraftKey, useDrafts } from '../drafts'
import { useChat } from '../store'
import { ChatHeader } from './ChatHeader'
import { CodeBar } from './CodeBar'
import { Composer } from './Composer'
import { ArtifactPanel } from '../artifacts/ArtifactPanel'
import { useArtifacts } from '../artifacts/store'
import { ChatLayout } from '../layout/ChatLayout'
import { GroupSuggestion } from './GroupSuggestion'
import { MessageItem } from './MessageItem'
import { PinnedBar, ReplyPreview } from './MessageActions'
import { AppRuns } from '../approvals/AppRuns'
import { ApprovalCards } from '../approvals/ApprovalCards'
import { DeferredCards } from '@renderer/features/schedules/components/DeferredCards'
import { cardsFor, useApprovals } from '../approvals/store'

const EMPTY: never[] = []

export function ChatPage() {
  const { t } = useTranslation('chat')
  const assistant = usePreferences((s) => s.assistant)
  const cliOk = useCliStatus((s) => s.status?.state === 'ok')
  const {
    activeId,
    conversations,
    streaming,
    error,
    loadConversations,
    send,
    stop,
    setMode,
    clearError
  } = useChat()
  const messages = useChat((s) => (activeId ? (s.messages[activeId] ?? EMPTY) : EMPTY))
  const active = conversations.find((c) => c.id === activeId)
  const [draftMode, setDraftMode] = useState<ChatMode>('free')
  // Cửa sổ tìm kiếm → "Cuộc trò chuyện Code mới": cuộc mới (chưa tạo) ở chế độ Code.
  useEffect(() => {
    const take = (): void => {
      const m = useComposeText.getState().takeMode()
      if (m) setDraftMode(m)
    }
    take()
    return useComposeText.subscribe((s) => {
      if (s.mode !== null) take()
    })
  }, [])
  const mode = active?.mode ?? draftMode
  const isStreaming = !!(activeId && streaming[activeId])
  const bottomRef = useRef<HTMLDivElement>(null)
  // Nháp theo cuộc: cuộc đang mở, hoặc "new" khi chưa tạo cuộc.
  const draftKey = activeId ?? newDraftKey()
  const addFiles = (files: File[]): Promise<void> => useDrafts.getState().addFiles(draftKey, files)
  // Panel artifact mở → bố cục chừa chỗ cho khung chat (thanh bên tự ẩn nếu cửa sổ hẹp).
  const artifactsOpen = useArtifacts((s) => s.open)
  // Thẻ chờ duyệt của cuộc đang mở: hiện trong khung chat; ô chat bên dưới hỏi về thẻ đầu tiên.
  const allCards = useApprovals((s) => s.cards)
  const askCard = useApprovals((s) => s.ask)
  const cards = cardsFor(allCards, activeId)
  // Ô chat hỏi về bản mới nhất của thẻ đầu tiên còn duyệt được (thẻ đang chờ bản tiếp theo thì không).
  const target = cards.find((c) => c.revising === null)
  // Chỉ cuộn khi có THẺ MỚI. Hỏi đáp trên thẻ (kể cả từng đoạn đang stream) không kéo khung chat — nếu kéo xuống
  // đáy mỗi lần, phần đầu thẻ / diff / các câu hỏi trước bị đẩy khỏi màn hình, nhìn như thẻ nháy và mất câu cũ.
  // Theo chuỗi: Bản 2 thay Bản 1 trong cùng thẻ cũng không kéo khung chat.
  const cardIds = cards.map((c) => c.chainId).join('|')

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  const lastContent = messages.at(-1)?.content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [activeId, messages.length, lastContent, cardIds])

  const onModeChange = (m: ChatMode): void => {
    if (active) void setMode(active.id, m)
    else setDraftMode(m)
  }

  // Kéo thả ảnh / file vào bất kỳ đâu trong khung chat.
  const [dragging, setDragging] = useState(false)
  const onDragOver = (e: DragEvent): void => {
    if (!dragHasFiles(e.dataTransfer.types)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!dragging) setDragging(true)
  }
  const onDragLeave = (e: DragEvent): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
  }
  const onDrop = (e: DragEvent): void => {
    if (!dragHasFiles(e.dataTransfer.types)) return
    e.preventDefault()
    setDragging(false)
    void addFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <ChatLayout panel={<ArtifactPanel conversationId={active?.id ?? null} />} panelOpen={artifactsOpen}>
      <section
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        data-testid="chat-drop-zone"
      >
        {dragging && (
          <div
            className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5 text-sm font-medium text-primary"
            data-testid="drop-overlay"
          >
            {t('attach.drop')}
          </div>
        )}
        <ChatHeader
          key={active?.id ?? 'new'}
          conversation={active}
          canSuggest={messages.length > 0}
          busy={isStreaming}
        />
        <PinnedBar messages={messages} />
        <div className="thin-scroll flex-1 overflow-y-auto">
          <div className="@container/msgs mx-auto max-w-3xl space-y-6 px-6 py-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center gap-3 pt-24 text-center">
                <AssistantAvatar avatar={assistant.avatar} className="size-14 text-3xl" />
                <h1 className="text-xl font-semibold">{t('welcome', { name: assistant.name })}</h1>
                <p className="max-w-md text-sm text-muted-foreground">{t('welcomeHint')}</p>
              </div>
            ) : (
              messages.map((m) => <MessageItem key={m.id} message={m} />)
            )}
            <ApprovalCards cards={cards} />
            {/* Unity / Blender đang chạy / vừa xong (A2) — key: đổi cuộc là dựng lại. */}
            {activeId && <AppRuns key={activeId} conversationId={activeId} />}
            {/* Đề xuất hoãn duyệt của lần chạy theo lịch (sửa file / nháp) — key: đổi cuộc là dựng lại. */}
            {activeId && <DeferredCards key={activeId} conversationId={activeId} />}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl space-y-2 px-6 pb-4">
          {!cliOk && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
              <span className="flex items-center gap-2 text-destructive">
                <CircleAlert className="size-4" />
                {t('cliMissing')}
              </span>
              <Button asChild size="sm" variant="outline">
                <Link to="/claude">{t('cliFix')}</Link>
              </Button>
            </div>
          )}
          {error && (
            <div className="flex items-center justify-between rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t(`errors.${error}`, {
                defaultValue: t('common:errors.generic', { message: error })
              })}
              <Button variant="ghost" size="icon-sm" onClick={clearError}>
                <X />
              </Button>
            </div>
          )}
          {active && <GroupSuggestion conversation={active} />}
          {/* Thư mục gắn với cuộc trò chuyện: chế độ Code luôn hiện; chế độ khác hiện khi đã có thư mục (vd trợ lý xin quyền). */}
          {(mode === 'code' || active?.cwd) && <CodeBar conversation={active} busy={isStreaming} />}
          <ReplyPreview conversationId={activeId} />
          <Composer
            draftKey={draftKey}
            mode={mode}
            onModeChange={onModeChange}
            streaming={isStreaming}
            disabled={!cliOk}
            onSend={(text, attachmentIds, voice) =>
              void send(text, mode, attachmentIds, undefined, voice)
            }
            onSendMedia={(m) =>
              void send('', mode, [], { kind: m.kind, source: m.source, id: m.id })
            }
            onStop={() => void stop()}
            ask={
              target
                ? {
                    onAsk: (q) => void askCard(target.id, q),
                    disabled: target.qa.some((q) => q.status === 'answering')
                  }
                : undefined
            }
          />
          <p className="text-center text-[11px] text-muted-foreground">{t('usageNote')}</p>
        </div>
      </section>
    </ChatLayout>
  )
}
