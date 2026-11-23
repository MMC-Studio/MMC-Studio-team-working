import { FilePen, Mail, Plug, SquareTerminal, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ACTION_LOG_KINDS, ACTION_LOG_PAGE, type ActionLogDecision, type ActionLogItem, type ActionLogKind } from '@shared/actionLog'
import { Button } from '@renderer/components/ui/button'
import { Input, Select } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { useSyncedState } from '@renderer/lib/sync'
import { cn } from '@renderer/lib/utils'
import { openRunConversation } from '@renderer/features/schedules/open'
import { SettingRow } from './rows'

const KIND_ICON: Record<ActionLogKind, LucideIcon> = { command: SquareTerminal, file_edit: FilePen, mcp: Plug, draft: Mail }

const DECISION_TONE: Record<ActionLogDecision, string> = {
  approved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  auto: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  rejected: 'bg-muted text-muted-foreground',
  timeout: 'bg-muted text-muted-foreground',
  stopped: 'bg-muted text-muted-foreground',
  blocked: 'bg-orange-500/10 text-orange-700 dark:text-orange-300'
}

/**
 * Nhật ký thao tác cần quyền (lệnh, sửa file, MCP, nháp): lọc theo loại / cuộc / chữ, bấm một dòng → mở cuộc đó.
 * Chỉ đọc; main báo mục `actionLog` mỗi lần ghi → danh sách tự cập nhật. "Xem thêm" tải thêm một trang.
 */
export function ActionLogSection() {
  const { t, i18n } = useTranslation('settings')
  const navigate = useNavigate()
  const [kind, setKind] = useState<ActionLogKind | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Ô tìm: hỏi lại sau khi ngừng gõ một chút (không hỏi theo từng phím).
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(ACTION_LOG_PAGE)
  const { data, refresh } = useSyncedState(['actionLog', 'conversations'], () =>
    api.actionLog.list({ kind, conversationId, search: query, limit, offset: 0 })
  )
  const time = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }), [i18n.language])

  useEffect(() => {
    const id = setTimeout(() => setQuery(search), 250)
    return () => clearTimeout(id)
  }, [search])
  // Bộ lọc / số dòng đổi → hỏi lại (lần đầu useSyncedState tự hỏi).
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    void refresh()
  }, [kind, conversationId, query, limit, refresh])

  // Đổi bộ lọc → về trang đầu.
  const filter = (apply: () => void): void => {
    apply()
    setLimit(ACTION_LOG_PAGE)
  }
  const filtered = !!kind || !!conversationId || !!search.trim()
  const items = data?.items ?? []
  const remaining = data ? data.total - items.length : 0

  return (
    <SettingRow id="actionLog">
      <div className="flex flex-wrap gap-2">
        <Select
          aria-label={t('actionLog.filterKind')}
          className="w-36"
          value={kind ?? ''}
          onChange={(e) => filter(() => setKind((e.target.value || null) as ActionLogKind | null))}
          data-testid="action-log-kind"
        >
          <option value="">{t('actionLog.allKinds')}</option>
          {ACTION_LOG_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`actionLog.kinds.${k}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('actionLog.filterConversation')}
          className="w-48"
          value={conversationId ?? ''}
          onChange={(e) => filter(() => setConversationId(e.target.value || null))}
          data-testid="action-log-conversation"
        >
          <option value="">{t('actionLog.allConversations')}</option>
          {data?.conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title || t('actionLog.untitled')}
            </option>
          ))}
        </Select>
        <Input
          type="search"
          className="min-w-40 flex-1"
          placeholder={t('actionLog.search')}
          aria-label={t('actionLog.search')}
          value={search}
          onChange={(e) => filter(() => setSearch(e.target.value))}
          data-testid="action-log-search"
        />
      </div>

      {data && items.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground" data-testid="action-log-empty">
          {filtered ? t('actionLog.noMatch') : t('actionLog.empty')}
        </p>
      ) : (
        <ul className="mt-3 divide-y rounded-lg border" data-testid="action-log-list">
          {items.map((item) => (
            <ActionLogRow
              key={item.id}
              item={item}
              at={time.format(item.at)}
              open={item.conversationId ? () => void openRunConversation(item.conversationId!, navigate) : undefined}
            />
          ))}
        </ul>
      )}
      {remaining > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => setLimit((n) => n + ACTION_LOG_PAGE)}
          data-testid="action-log-more"
        >
          {t('actionLog.more', { count: remaining })}
        </Button>
      )}
    </SettingRow>
  )
}

function ActionLogRow({ item, at, open }: { item: ActionLogItem; at: string; open?: () => void }) {
  const { t } = useTranslation('settings')
  const Icon = KIND_ICON[item.kind]
  const conversation =
    item.conversationId === null ? t('actionLog.deletedConversation') : item.conversationTitle || t('actionLog.untitled')
  const body = (
    <>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs" title={item.target} data-testid="action-log-target">
            {item.target}
          </span>
          <span
            className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', DECISION_TONE[item.decision])}
            data-testid="action-log-decision"
            data-decision={item.decision}
          >
            {t(`actionLog.decisions.${item.decision}`)}
          </span>
        </div>
        <div className="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">
          <span className="shrink-0">{at}</span>
          <span className="truncate">· {conversation}</span>
          {item.exitCode !== null && <span className="shrink-0">· {t('actionLog.exitCode', { code: item.exitCode })}</span>}
        </div>
      </div>
    </>
  )
  return (
    <li data-testid="action-log-row" data-kind={item.kind}>
      {open ? (
        <button
          type="button"
          className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
          onClick={open}
          title={t('actionLog.open')}
        >
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-3 px-3 py-2">{body}</div>
      )}
    </li>
  )
}
