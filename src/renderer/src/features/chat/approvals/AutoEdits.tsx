import { ChevronDown, ChevronRight, FilePlus2, FileText, Undo2, Zap } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AUTO_EDIT_MAX_FILES, type AutoEditSession, type AutoEditUndoResult } from '@shared/autoEdits'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@renderer/components/ui/dialog'
import { api } from '@renderer/lib/api'
import { optimistic, useSyncedState } from '@renderer/lib/sync'
import { cn } from '@renderer/lib/utils'

/** Phút còn lại của phiên — chỉ là hiển thị; phiên hết hạn do main kết thúc rồi báo qua sync `autoEdits`. */
function Remaining({ until }: { until: number }) {
  const { t } = useTranslation('chat')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])
  const min = Math.max(0, Math.ceil((until - now) / 60_000))
  return <>{t('autoEdit.remaining', { h: Math.floor(min / 60), m: String(min % 60).padStart(2, '0') })}</>
}

/**
 * Hộp cảnh báo trước khi bật tự duyệt (bấm "Đồng ý, và không hỏi lại trong phiên này" trên thẻ sửa file). Bấm Bật =
 * đồng ý thay đổi trên thẻ + mở phiên.
 */
export function AutoEditStartDialog({
  open,
  onOpenChange,
  folder,
  onConfirm
}: {
  open: boolean
  onOpenChange(open: boolean): void
  folder: string
  onConfirm(): void
}) {
  const { t } = useTranslation('chat')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('autoEdit.startTitle')} description={t('autoEdit.startBody', { folder })} data-testid="auto-edit-start-dialog">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>{t('autoEdit.rule1', { max: AUTO_EDIT_MAX_FILES })}</li>
          <li>{t('autoEdit.rule2')}</li>
          <li>{t('autoEdit.rule3')}</li>
          <li>{t('autoEdit.rule4')}</li>
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">{t('common:actions.cancel')}</Button>
          </DialogClose>
          <Button onClick={onConfirm} data-testid="auto-edit-start-confirm">
            <Zap />
            {t('autoEdit.startConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Phiên tự duyệt của một cuộc (băng đầu khung chat): đang chạy + phiên đã kết thúc còn hoàn tác được. */
export function AutoEditSessions({ conversationId, className }: { conversationId: string; className?: string }) {
  const { data, setData } = useSyncedState(['autoEdits', 'conversations'], () => api.autoEdits.list(conversationId))
  if (!data?.length) return null
  return (
    <div className={cn('space-y-2', className)} data-testid="auto-edit-sessions">
      {data.map((s) => (
        <AutoEditSessionView key={s.id} session={s} all={data} setAll={setData} />
      ))}
    </div>
  )
}

/** Mọi phiên của tài khoản (Cài đặt → Quyền & riêng tư). */
export function AutoEditSessionList({ empty }: { empty: ReactNode }) {
  const { data, setData } = useSyncedState(['autoEdits', 'conversations'], () => api.autoEdits.list())
  if (!data) return null
  if (!data.length) return <>{empty}</>
  return (
    <div className="space-y-2" data-testid="grant-auto-edits">
      {data.map((s) => (
        <AutoEditSessionView key={s.id} session={s} all={data} setAll={setData} showTitle />
      ))}
    </div>
  )
}

function AutoEditSessionView({
  session: s,
  all,
  setAll,
  showTitle
}: {
  session: AutoEditSession
  all: AutoEditSession[]
  setAll(v: AutoEditSession[]): void
  showTitle?: boolean
}) {
  const { t, i18n } = useTranslation('chat')
  const [open, setOpen] = useState(false)
  const [confirmUndo, setConfirmUndo] = useState(false)
  const [result, setResult] = useState<AutoEditUndoResult | null>(null)
  const [busy, setBusy] = useState(false)
  const active = s.endedAt === null

  const patch = (next: AutoEditSession | null): void =>
    setAll(all.flatMap((x) => (x.id === s.id ? (next ? [next] : []) : [x])))
  const stop = (): void =>
    void optimistic({
      topic: 'autoEdits',
      apply: () => patch({ ...s, endedAt: Date.now(), endReason: 'stopped' }),
      rollback: () => setAll(all),
      save: () => api.autoEdits.stop(s.id)
    })
  const dismiss = (): void =>
    void optimistic({
      topic: 'autoEdits',
      apply: () => patch(null),
      rollback: () => setAll(all),
      save: () => api.autoEdits.dismiss(s.id)
    })
  const undo = async (overwrite: string[] = []): Promise<void> => {
    setBusy(true)
    try {
      const r = await api.autoEdits.undo({ sessionId: s.id, overwrite })
      setConfirmUndo(false)
      // Có xung đột / lỗi → giữ hộp kết quả để người dùng chọn ghi đè hoặc bỏ qua.
      setResult(r && (r.conflicts.length || r.failed.length) ? r : null)
    } finally {
      setBusy(false)
    }
  }
  const date = (ms: number): string =>
    new Date(ms).toLocaleString(i18n.language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-2.5 text-sm',
        active ? 'border-dashed border-violet-500/50 bg-violet-500/5' : 'bg-card'
      )}
      data-testid="auto-edit-session"
      data-state={active ? 'active' : 'ended'}
      data-conversation={s.conversationId}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Zap className={cn('size-4 shrink-0', active ? 'text-violet-600 dark:text-violet-300' : 'text-muted-foreground')} />
        <div className="min-w-0 flex-1">
          {showTitle && <p className="truncate font-medium">{s.title ?? t('autoEdit.deletedConversation')}</p>}
          <p className={cn(!showTitle && 'font-medium')} data-testid="auto-edit-status">
            {active ? t('autoEdit.active') : t(`autoEdit.ended.${s.endReason ?? 'stopped'}`)}
            {' · '}
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              data-testid="auto-edit-count"
            >
              {t('autoEdit.files', { count: s.files.length })}
              {open ? <ChevronDown className="ml-0.5 inline size-3.5" /> : <ChevronRight className="ml-0.5 inline size-3.5" />}
            </button>
            {active && (
              <span className="text-muted-foreground">
                {' · '}
                <Remaining until={s.endsAt} />
              </span>
            )}
          </p>
          {!active && s.undoUntil && (
            <p className="text-xs text-muted-foreground">{t('autoEdit.undoUntil', { date: date(s.undoUntil) })}</p>
          )}
          {showTitle && (
            <p className="truncate font-mono text-[11px] text-muted-foreground" title={s.root}>
              {s.root}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {s.files.length > 0 && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmUndo(true)} data-testid="auto-edit-undo">
              <Undo2 />
              {t('autoEdit.undoAll')}
            </Button>
          )}
          {active ? (
            <Button size="sm" variant="outline" onClick={stop} data-testid="auto-edit-stop">
              {t('autoEdit.stop')}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={dismiss} title={t('autoEdit.dismissHint')} data-testid="auto-edit-dismiss">
              {t('autoEdit.dismiss')}
            </Button>
          )}
        </div>
      </div>
      {open && (
        <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto border-t pt-2" data-testid="auto-edit-files">
          {s.files.map((f) => (
            <li key={f.path} className="flex min-w-0 items-center gap-1.5 text-xs">
              {f.isNewFile ? <FilePlus2 className="size-3.5 shrink-0 text-muted-foreground" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
              <code className="min-w-0 truncate" title={f.path}>
                {f.path}
              </code>
              {f.isNewFile && <span className="shrink-0 text-muted-foreground">{t('autoEdit.newFile')}</span>}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={confirmUndo} onOpenChange={setConfirmUndo}>
        <DialogContent title={t('autoEdit.undoTitle')} description={t('autoEdit.undoBody', { count: s.files.length })}>
          {active && <p className="text-sm text-orange-700 dark:text-orange-300">{t('autoEdit.undoStopsTurn')}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button disabled={busy} onClick={() => void undo()} data-testid="auto-edit-undo-confirm">
              <Undo2 />
              {t('autoEdit.undoAll')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent title={t('autoEdit.resultTitle')} description={t('autoEdit.resultBody', { count: result?.restored.length ?? 0 })} data-testid="auto-edit-result">
          {!!result?.conflicts.length && (
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('autoEdit.conflicts')}</p>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto" data-testid="auto-edit-conflicts">
                {result.conflicts.map((p) => (
                  <li key={p}>
                    <code className="text-xs">{p}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!result?.failed.length && (
            <div className="mt-3 space-y-1">
              <p className="text-sm font-medium">{t('autoEdit.failed')}</p>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto" data-testid="auto-edit-failed">
                {result.failed.map((f) => (
                  <li key={f.path} className="text-xs">
                    <code>{f.path}</code> — {t(`autoEdit.failReason.${f.reason}`)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline" data-testid="auto-edit-keep">
                {t('autoEdit.keep')}
              </Button>
            </DialogClose>
            {!!result?.conflicts.length && (
              <Button variant="destructive" disabled={busy} onClick={() => void undo(result.conflicts)} data-testid="auto-edit-overwrite">
                {t('autoEdit.overwrite')}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
