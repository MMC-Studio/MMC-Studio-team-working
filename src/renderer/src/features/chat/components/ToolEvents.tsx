import { ChevronRight, Loader2, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { appToolKey, countTools, toolActivity, toolDetail } from '../toolSummary'

/** Số loại công cụ ghi trên dòng tóm tắt; nhiều hơn thì thêm "…". */
const SUMMARY_KINDS = 3

function useToolName(): (name: string) => string {
  const { t } = useTranslation('chat')
  return (name) => {
    if (name.startsWith('mcp__mmc__')) return t(`tools.${appToolKey(name)}`, { defaultValue: appToolKey(name) })
    // MCP server người dùng thêm: mcp__<server>__<tool> → "<server> · <tool>".
    const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
    return mcp ? `${mcp[1]} · ${mcp[2]}` : name
  }
}

/**
 * Các lời gọi công cụ của một lượt gộp thành MỘT dòng, mặc định thu gọn ("Đã dùng 9 công cụ · Read ×5, Grep ×4").
 * Bấm → danh sách từng công cụ kèm file / từ khoá. Đang chạy → "Đang đọc file…".
 * Thẻ cần duyệt (diff, xin quyền thư mục, nháp…) không nằm ở đây nên không bao giờ bị gộp / ẩn.
 */
export function ToolEvents({ message }: { message: Message }) {
  const { t } = useTranslation('chat')
  const toolName = useToolName()
  const [open, setOpen] = useState(false)
  const events = message.toolEvents
  // Độ dài chữ lúc nhận công cụ mới nhất: chữ chưa dài thêm (và vẫn đang stream) = công cụ đó còn đang chạy.
  const [mark, setMark] = useState({ count: events.length, length: message.content.length })
  if (mark.count !== events.length) setMark({ count: events.length, length: message.content.length })

  if (events.length === 0) return null
  const last = events[events.length - 1]
  const running = message.status === 'streaming' && message.content.length === mark.length && mark.count === events.length

  let label: string
  if (running) {
    label = t(`toolActivity.${toolActivity(last.name)}`)
  } else if (events.length === 1) {
    label = t('toolUsed', { name: toolName(last.name) })
  } else {
    const counts = countTools(events)
    const kinds = counts
      .slice(0, SUMMARY_KINDS)
      .map((c) => (c.count > 1 ? `${toolName(c.name)} ×${c.count}` : toolName(c.name)))
      .join(', ')
    label = t('toolsUsed', { count: events.length, list: counts.length > SUMMARY_KINDS ? `${kinds}, …` : kinds })
  }
  const runningDetail = running ? toolDetail(last) : null

  return (
    <div className="text-xs text-muted-foreground" data-testid="tool-summary" data-running={running || undefined}>
      <button
        type="button"
        className="-mx-1.5 flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left hover:bg-muted hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid="tool-summary-toggle"
      >
        {running ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Wrench className="size-3.5 shrink-0" />}
        <span className="truncate">{label}</span>
        {runningDetail && <span className="min-w-0 truncate opacity-70">{runningDetail}</span>}
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <ol className="mt-1 ml-1.5 space-y-0.5 border-l pl-3" data-testid="tool-list">
          {events.map((e, i) => {
            const detail = toolDetail(e)
            return (
              <li key={i} className="flex min-w-0 items-baseline gap-2" data-testid="tool-item">
                <span className="shrink-0 font-medium text-foreground/80">{toolName(e.name)}</span>
                {detail && (
                  <span className="min-w-0 truncate font-mono text-[11px]" title={detail}>
                    {detail}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
