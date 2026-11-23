import { ChevronDown, ChevronRight, FileText, FolderOpen, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommandApprovalRequest } from '@shared/commands'

/**
 * Thẻ "Chạy lệnh": lệnh dễ đọc (chữ to), thư mục, hạn, lý do; "Lệnh thật app chạy" = ĐÚNG đường dẫn chương trình +
 * mọi tham số (kể cả cờ an toàn app tự thêm) — người dùng thấy nguyên lệnh trước khi bấm Chạy.
 *
 * Unity / Blender (A2): băng cảnh báo to "chạy code tuỳ ý", file C# / Python trợ lý vừa sửa trong cuộc, Blender hiện
 * TRỌN script (app từ chối script > 64 KB nên không bao giờ phải cắt).
 */
export function CommandView({ request, current }: { request: CommandApprovalRequest; current?: boolean }) {
  const { t } = useTranslation('chat')
  const [full, setFull] = useState(false)
  const Chevron = full ? ChevronDown : ChevronRight
  const tid = (id: string): string | undefined => (current ? id : undefined)
  const app = request.program === 'git' ? null : request.program
  return (
    <div className="space-y-2">
      {app && (
        <div
          className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive"
          role="alert"
          data-testid={tid('command-danger')}
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0" />
          <div className="space-y-1">
            <p className="text-base font-semibold">{t('command.dangerTitle')}</p>
            <p className="text-xs leading-relaxed">{t(`command.danger.${app}`)}</p>
          </div>
        </div>
      )}
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
        <span className="shrink-0">
          ·{' '}
          {app
            ? t('command.timeoutMin', { m: Math.round(request.timeoutMs / 60_000) })
            : t('command.timeout', { s: Math.round(request.timeoutMs / 1000) })}
        </span>
      </div>
      {app && request.app ? (
        <>
          {request.app.version && (
            <p className="text-xs text-muted-foreground" data-testid={tid('command-version')}>
              {t('command.version', { version: request.app.version })}
            </p>
          )}
          <div className="space-y-1" data-testid={tid('command-edited')}>
            <p className="text-xs font-medium">{t(`command.edited.${app}`)}</p>
            {request.app.editedFiles.length ? (
              <ul className="space-y-0.5">
                {request.app.editedFiles.map((f) => (
                  <li key={f} className="flex min-w-0 items-center gap-1.5 text-xs">
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <code className="min-w-0 truncate" title={f}>
                      {f}
                    </code>
                    {request.app?.autoEdited?.includes(f) && (
                      <span
                        className="shrink-0 rounded border border-dashed border-violet-500/50 bg-violet-500/10 px-1 text-[10px] font-medium text-violet-700 dark:text-violet-300"
                        title={t('command.autoEditedHint')}
                        data-testid={tid('command-auto-edited')}
                      >
                        {t('command.autoEdited')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">{t(`command.editedNone.${app}`)}</p>
            )}
            <p className="text-[11px] text-muted-foreground">{t('command.recheck')}</p>
          </div>
          {request.app.script && (
            <div className="space-y-1">
              <p className="text-xs font-medium">{t('command.script', { path: request.app.script.path })}</p>
              <p className="text-[11px] text-orange-700 dark:text-orange-300" data-testid={tid('command-imports')}>
                {t('command.scriptImports')}
              </p>
              <pre
                className="thin-scroll max-h-96 overflow-auto whitespace-pre rounded-md border bg-muted/40 px-3 py-2 font-mono text-[11px]"
                data-testid={tid('command-script')}
              >
                {request.app.script.content}
              </pre>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {t('command.logAt')}{' '}
            <code className="break-all" data-testid={tid('command-log-path')}>
              {request.app.logPath}
            </code>
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t('command.readOnly')}</p>
      )}
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
          <p className="text-[11px] text-muted-foreground">{app ? t('command.fullHintApp') : t('command.fullHint')}</p>
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
