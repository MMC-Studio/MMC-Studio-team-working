import { Clock, Loader2, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@renderer/components/ui/button'
import { useSchedules } from '../store'
import { schedulePath } from '../view'
import { stopRunning } from '../actions'

/**
 * Đầu khung chat của cuộc do lịch hẹn tạo: nhãn "Từ lịch hẹn" (bấm → trang của lịch); lần chạy đang diễn ra trong
 * chính cuộc này → nút Dừng (cuộc này không do người dùng gửi nên ô nhập không có nút dừng).
 */
export function ScheduleChatBadge({ conversationId, scheduleId }: { conversationId: string; scheduleId: string | null }) {
  const { t } = useTranslation('schedules')
  const running = useSchedules((s) => s.status?.running?.conversationId === conversationId)
  if (!scheduleId && !running) return null
  return (
    <>
      {scheduleId && (
        <Link
          to={schedulePath(scheduleId)}
          className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          data-testid="chat-schedule-badge"
        >
          <Clock className="size-3.5" />
          {t('badge.fromSchedule')}
        </Link>
      )}
      {running && (
        <Button size="sm" variant="outline" className="h-7" onClick={() => void stopRunning()} data-testid="chat-schedule-stop">
          <Loader2 className="animate-spin" />
          <Square />
          {t('banner.stop')}
        </Button>
      )}
    </>
  )
}
