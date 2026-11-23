import { CircleCheck, CircleX, FileText, Loader2, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommandRun } from '@shared/commands'
import { Button } from '@renderer/components/ui/button'
import { api } from '@renderer/lib/api'
import { optimistic, useSyncedState } from '@renderer/lib/sync'
import { cn } from '@renderer/lib/utils'

const clock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Đồng hồ chạy (chỉ là hiển thị thời gian trôi — trạng thái lần chạy vẫn đến qua sync `commandRuns`). */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since)
  useEffect(() => {
    const tick = (): void => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [])
  return <>{clock(now - since)}</>
}

/**
 * Lần chạy Unity / Blender của cuộc (A2): đang chạy → đồng hồ + Dừng; xong → kết quả + Mở log (log đầy đủ trong thư
 * mục dữ liệu app) + Ẩn. Danh sách do main giữ, báo đổi qua sync `commandRuns`.
 */
export function AppRuns({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('chat')
  const { data, setData } = useSyncedState('commandRuns', () => api.commands.runs(conversationId))
  if (!data?.length) return null
  const patch = (id: string, change: (r: CommandRun) => CommandRun | null): void =>
    setData((prev) => prev.flatMap((r) => (r.id === id ? (change(r) ?? []) : [r])))
  const stop = (run: CommandRun): void =>
    void optimistic({
      topic: 'commandRuns',
      apply: () => patch(run.id, (r) => ({ ...r, state: 'stopped', endedAt: Date.now() })),
      rollback: () => patch(run.id, () => run),
      save: () => api.commands.stopRun(run.id)
    })
  const dismiss = (run: CommandRun): void =>
    void optimistic({
      topic: 'commandRuns',
      apply: () => patch(run.id, () => null),
      rollback: () => setData(data),
      save: () => api.commands.dismissRun(run.id)
    })
  return (
    <div className="space-y-2" data-testid="app-runs">
      {data.map((run) => {
        const running = run.state === 'running'
        const ok = run.state === 'done'
        return (
          <div
            key={run.id}
            className={cn(
              'flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm shadow-sm',
              !running && !ok && 'border-destructive/30'
            )}
            data-testid="app-run"
            data-state={run.state}
          >
            {running ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
            ) : ok ? (
              <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <CircleX className="size-4 shrink-0 text-destructive" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t(`command.titleApp.${run.program}`)}</p>
              <code className="block truncate text-xs text-muted-foreground" title={run.display}>
                {run.display}
              </code>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground" data-testid="app-run-status">
              {running ? (
                <>
                  {t('runs.running')} · <Elapsed since={run.startedAt} />
                </>
              ) : run.state === 'failed' ? (
                t('runs.failed', { code: run.exitCode ?? '?' })
              ) : (
                t(`runs.${run.state}`)
              )}
            </span>
            {running ? (
              <Button size="sm" variant="outline" onClick={() => stop(run)} data-testid="app-run-stop">
                <Square className="size-3.5" />
                {t('runs.stop')}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => void api.commands.openRunLog(run.id)} data-testid="app-run-log">
                  <FileText className="size-3.5" />
                  {t('runs.openLog')}
                </Button>
                <Button size="icon" variant="ghost" className="size-8" aria-label={t('runs.dismiss')} onClick={() => dismiss(run)} data-testid="app-run-dismiss">
                  <X className="size-4" />
                </Button>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
