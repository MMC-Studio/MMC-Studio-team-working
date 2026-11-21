import { Clock, Loader2, Pause, Play, Square, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { SCHEDULE_MAX, type Schedule } from '@shared/schedules'
import { Button } from '@renderer/components/ui/button'
import { reportSaveError } from '@renderer/lib/sync'
import { cn } from '@renderer/lib/utils'
import { ChatLayout, SidebarToggle } from '@renderer/features/chat/layout/ChatLayout'
import { useProjects } from '@renderer/features/projects/store'
import { Switch } from '@renderer/features/settings/components/rows'
import { stopRunning } from '../actions'
import { openRunConversation } from '../open'
import { useSchedules } from '../store'
import { nextRunText, recurrenceText, schedulePath, scheduleState } from '../view'
import { EnableSchedulesDialog, ScheduleEditorDialog } from './ScheduleDialogs'
import { ScheduleMenu } from './ScheduleMenu'

/** Khung chung của trang Lịch hẹn / trang một lịch (thanh bên chat bên trái, nội dung cuộn riêng). */
export function SchedulesShell({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <ChatLayout>
      <section className="thin-scroll flex min-w-0 flex-1 flex-col overflow-y-auto" data-testid={testId}>
        <div className="flex min-h-11 items-center px-4 py-1.5">
          <SidebarToggle when="hidden" />
        </div>
        <div className="mx-auto w-full max-w-3xl px-6 pb-10 sm:px-10">{children}</div>
      </section>
    </ChatLayout>
  )
}

/** Băng trạng thái chung: tạm dừng tất cả / hết hạn mức / đang chạy (kèm nút Dừng). */
export function StatusBanner() {
  const { t } = useTranslation('schedules')
  const navigate = useNavigate()
  const status = useSchedules((s) => s.status)
  const schedules = useSchedules((s) => s.schedules)
  if (!status?.settings.enabled) return null
  const { settings, running } = status
  const runningName = running ? schedules.find((s) => s.id === running.scheduleId)?.name : null
  return (
    <div className="space-y-2 pb-4">
      {settings.pausedAll && (
        <p className="flex items-center gap-2 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-sm" data-testid="schedules-paused-banner">
          <Pause className="size-4 shrink-0" />
          {t(settings.pauseReason === 'hotkey' ? 'banner.pausedHotkey' : 'banner.paused')}
        </p>
      )}
      {!settings.pausedAll && settings.pausedUntil && (
        <p className="flex items-center gap-2 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-sm" data-testid="schedules-quota-banner">
          <TriangleAlert className="size-4 shrink-0" />
          {t('banner.quota')}
        </p>
      )}
      {running && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm" data-testid="schedules-running-banner">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          <span className="min-w-0 flex-1 truncate">{t('banner.running', { name: runningName ?? '…' })}</span>
          <Button size="sm" variant="ghost" onClick={() => void openRunConversation(running.conversationId, navigate)} data-testid="schedules-running-open">
            {t('banner.open')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void stopRunning()} data-testid="schedules-stop">
            <Square />
            {t('banner.stop')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Trang Lịch hẹn: tắt → giải thích + nút bật (qua cảnh báo); bật → danh sách, bật / tắt từng lịch, tạm dừng tất cả. */
export function SchedulesPage() {
  const { t, i18n } = useTranslation('schedules')
  const navigate = useNavigate()
  const schedules = useSchedules((s) => s.schedules)
  const status = useSchedules((s) => s.status)
  const loaded = useSchedules((s) => s.loaded)
  const toggle = useSchedules((s) => s.toggle)
  const pauseAll = useSchedules((s) => s.pauseAll)
  const projects = useProjects((s) => s.projects)
  const [creating, setCreating] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const enabled = !!status?.settings.enabled
  const paused = !!status?.settings.pausedAll
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const [now] = useState(Date.now)

  return (
    <SchedulesShell testId="schedules-page">
      <header className="flex flex-wrap items-center gap-2 pt-4 pb-2">
        <h1 className="mr-auto text-3xl font-semibold tracking-tight">{t('title')}</h1>
        {enabled && (
          <>
            <Button variant="ghost" onClick={() => void pauseAll(!paused)} data-testid={paused ? 'schedules-resume-all' : 'schedules-pause-all'}>
              {paused ? <Play /> : <Pause />}
              {paused ? t('resumeAll') : t('pauseAll')}
            </Button>
            <Button variant="outline" disabled={schedules.length >= SCHEDULE_MAX} onClick={() => setCreating(true)} data-testid="schedule-new">
              {t('new')}
            </Button>
          </>
        )}
      </header>
      <p className="pb-6 text-sm text-muted-foreground" data-testid="schedules-app-open-note">
        {t('appOpenNote')}
        {enabled && status && ` · ${t('today', { count: status.today, max: status.dailyLimit })}`}
      </p>

      {loaded && !enabled ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center" data-testid="schedules-disabled">
          <Clock className="size-9 text-muted-foreground" />
          <p className="font-medium">{t('disabled.title')}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t('disabled.body')}</p>
          <Button
            onClick={() => (status?.settings.acknowledged ? void useSchedules.getState().setFeature({ enabled: true }) : setEnabling(true))}
            data-testid="schedules-enable"
          >
            {t('disabled.enable')}
          </Button>
        </div>
      ) : (
        <>
          <StatusBanner />
          {loaded && schedules.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center" data-testid="schedules-empty">
              <Clock className="size-9 text-muted-foreground" />
              <p className="font-medium">{t('empty')}</p>
              <p className="max-w-md text-sm text-muted-foreground">{t('emptyHint')}</p>
              <Button onClick={() => setCreating(true)}>{t('new')}</Button>
            </div>
          ) : (
            <ul className="divide-y rounded-xl border" data-testid="schedules-list">
              {schedules.map((s) => (
                <ScheduleRow
                  key={s.id}
                  schedule={s}
                  paused={paused}
                  project={s.projectId ? (projectName.get(s.projectId) ?? null) : null}
                  now={now}
                  locale={i18n.language}
                  onOpen={() => void navigate(schedulePath(s.id))}
                  onToggle={(on) => void toggle(s.id, on, (code) => reportSaveError(t(`errors.${code}`, { defaultValue: code })))}
                />
              ))}
            </ul>
          )}
        </>
      )}
      <ScheduleEditorDialog open={creating} schedule={null} onClose={() => setCreating(false)} />
      <EnableSchedulesDialog open={enabling} onClose={() => setEnabling(false)} />
    </SchedulesShell>
  )
}

function ScheduleRow({
  schedule: s,
  paused,
  project,
  now,
  locale,
  onOpen,
  onToggle
}: {
  schedule: Schedule
  paused: boolean
  project: string | null
  now: number
  locale: string
  onOpen(): void
  onToggle(on: boolean): void
}) {
  const { t } = useTranslation('schedules')
  const state = scheduleState(s, paused)
  const next = s.enabled && !paused ? nextRunText(s.nextRunAt, now, t, locale) : null
  return (
    <li
      className="group flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/50"
      onClick={onOpen}
      data-testid="schedule-row"
      data-name={s.name}
      data-state={state}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        {state === 'running' ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <Clock className="size-4 text-muted-foreground" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{s.name}</span>
          {s.unseen > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground" data-testid="schedule-unseen">
              {s.unseen}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground" data-testid="schedule-summary">
          {recurrenceText(s.recurrence, t, locale)}
          {project && ` · ${project}`}
          {s.model === 'cheap' && ` · ${t('models.cheapShort')}`}
          {' · '}
          <span className={cn((state === 'failures' || state === 'project_deleted') && 'text-orange-700 dark:text-orange-300')} data-testid="schedule-state">
            {state === 'on' || state === 'paused' || state === 'running'
              ? s.skipNext
                ? t('state.skipNext')
                : next
                  ? t('state.next', { when: next })
                  : t(`state.${state}`)
              : t(`state.${state}`)}
          </span>
        </span>
      </span>
      <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
        <Switch checked={s.enabled} aria-label={t('toggleFor', { name: s.name })} onChange={(e) => onToggle(e.target.checked)} data-testid="schedule-toggle" />
        <ScheduleMenu schedule={s} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" />
      </span>
    </li>
  )
}
