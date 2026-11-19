import { BellRing } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { Button } from '@renderer/components/ui/button'
import { usePreferences } from '@renderer/stores/preferences'
import { useChat } from '../store'
import { useApprovals } from './store'

/**
 * Thẻ chờ duyệt nằm trong khung chat của đúng cuộc trò chuyện. Đang ở trang khác / cuộc khác → thanh nhỏ
 * góc dưới để không bỏ lỡ; bấm "Xem" → mở cuộc trò chuyện đó.
 */
export function ApprovalBanner() {
  const { t } = useTranslation('chat')
  const name = usePreferences((s) => s.assistant.name)
  const cards = useApprovals((s) => s.cards)
  const activeId = useChat((s) => s.activeId)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const onChat = pathname === '/'
  const hidden = cards.filter((c) => !onChat || c.conversationId !== activeId)
  if (hidden.length === 0) return null
  const target = hidden[0].conversationId

  const open = (): void => {
    if (!onChat) void navigate('/')
    void useChat.getState().select(target)
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5 text-sm shadow-lg"
      role="status"
      data-testid="approval-banner"
    >
      <BellRing className="size-4 text-primary" />
      <span>{t('approvals.banner', { name, count: hidden.length })}</span>
      <Button size="sm" onClick={open} data-testid="approval-banner-open">
        {t('approvals.open')}
      </Button>
    </div>
  )
}
