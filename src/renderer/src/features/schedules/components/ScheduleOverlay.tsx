import { Clock, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { ScheduleNoticeEvent } from '@shared/schedules'
import { Button } from '@renderer/components/ui/button'
import { api } from '@renderer/lib/api'
import { useChat } from '@renderer/features/chat/store'
import { openRunConversation } from '../open'
import { noticeText, schedulePath } from '../view'

const SHOW_MS = 8_000

/**
 * Luôn gắn trong app: (1) thông báo trong app khi cửa sổ đang mở (cửa sổ ẩn / không được chọn → main bật thông báo
 * Windows); (2) bấm thông báo Windows → mở đúng cuộc của lần chạy; (3) mở cuộc từ lịch hẹn → đánh dấu đã xem.
 */
export function ScheduleOverlay() {
  const { t } = useTranslation('schedules')
  const navigate = useNavigate()
  const [notices, setNotices] = useState<(ScheduleNoticeEvent & { key: number })[]>([])

  useEffect(() => {
    let key = 0
    const offNotice = api.schedules.onNotice((e) => {
      // Đang xem đúng cuộc đó lúc lần chạy xong → coi như đã xem.
      const activeId = useChat.getState().activeId
      if (e.kind === 'finished' && e.conversationId && e.conversationId === activeId && document.hasFocus())
        void api.schedules.markSeen(e.conversationId)
      if (!e.inApp) return
      const item = { ...e, key: ++key }
      setNotices((list) => [...list.slice(-2), item])
      setTimeout(() => setNotices((list) => list.filter((n) => n.key !== item.key)), SHOW_MS)
    })
    const offOpen = api.schedules.onOpen((e) => {
      if (e.conversationId) void openRunConversation(e.conversationId, navigate)
      else if (e.scheduleId) void navigate(schedulePath(e.scheduleId))
    })
    return () => {
      offNotice()
      offOpen()
    }
  }, [navigate])

  // Mở một cuộc do lịch hẹn tạo → đã xem (số trên thanh bên giảm).
  const activeId = useChat((s) => s.activeId)
  const activeSchedule = useChat((s) => s.conversations.find((c) => c.id === s.activeId)?.scheduleId ?? null)
  useEffect(() => {
    if (activeId && activeSchedule) void api.schedules.markSeen(activeId)
  }, [activeId, activeSchedule])

  if (notices.length === 0) return null
  return (
    <div className="fixed right-4 bottom-16 z-50 flex w-80 flex-col gap-2" data-testid="schedule-notices">
      {notices.map((n) => (
        <div key={n.key} role="status" className="flex items-start gap-2 rounded-lg border bg-background p-3 text-sm shadow-lg" data-testid="schedule-notice" data-kind={n.kind}>
          <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">{noticeText(n, t)}</span>
          {n.conversationId && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2"
              onClick={() => {
                setNotices((list) => list.filter((x) => x.key !== n.key))
                void openRunConversation(n.conversationId!, navigate)
              }}
              data-testid="schedule-notice-open"
            >
              {t('notice.open')}
            </Button>
          )}
          <button type="button" className="text-muted-foreground" aria-label={t('notice.close')} onClick={() => setNotices((list) => list.filter((x) => x.key !== n.key))}>
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
