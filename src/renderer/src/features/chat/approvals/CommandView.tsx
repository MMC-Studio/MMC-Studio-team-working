import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommandApprovalRequest } from '@shared/commands'

/**
 * Thẻ "Chạy lệnh": lệnh dễ đọc (chữ to), thư mục, hạn, lý do; "Lệnh thật app chạy" = ĐÚNG đường dẫn chương trình +
 * mọi tham số (kể cả cờ an toàn app tự thêm) — người dùng thấy nguyên lệnh trước khi bấm Chạy.
 */
export function CommandView({ request, current }: { request: CommandApprovalRequest; current?: boolean }) {
  const { t } = useTranslation('chat')
  const [full, setFull] = useState(false)
  const Chevron = full ? ChevronDown : ChevronRight
  const tid = (id: string): string | undefined => (current ? id : undefined)
  return (
    <div className="space-y-2">
      <p className="rounded-md bg-muted/60 px-3 py-2">{request.reason}</p>
      <pre
        className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted px-3 py-2 font-mono text-sm font-semibold"
        data-testid={tid('command-display')}
      >
        {request.display}
      </pre>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <FolderOpen className="size-3.5 shrink-0" />
        <span>{t('command.cwd')}</span>
        <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5" title={request.cwd} data-testid={tid('command-cwd')}>
          {request.cwd}
        </code>
        <span className="shrink-0">· {t('command.timeout', { s: Math.round(request.timeoutMs / 1000) })}</span>
      </div>
      <p className="text-xs text-muted-foreground">{t('command.readOnly')}</p>
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-expanded={full}
        onClick={() => setFull((v) => !v)}
        data-testid={tid('command-full-toggle')}
      >
        <Chevron className="size-3.5" />
        {t('command.fullCommand')}
      </button>
      {full && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">{t('command.fullHint')}</p>
          <pre
            className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-[11px]"
            data-testid={tid('command-full')}
          >
            {[request.executable, ...request.argv].map((a) => (/[\s"]/.test(a) || a === '' ? JSON.stringify(a) : a)).join(' ')}
          </pre>
        </div>
      )}
    </div>
  )
}
