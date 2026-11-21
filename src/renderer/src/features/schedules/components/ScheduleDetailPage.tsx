import { ArrowLeft, Folder, Mail, MessageCircle, MessagesSquare, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import type { ScheduleRun } from '@shared/schedules'
import { Button } from '@renderer/components/ui/button'
import { api } from '@renderer/lib/api'
import { useSyncedState } from '@renderer/lib/sync'
import { cn } from '@renderer/lib/utils'
import { useConnectors } from '@renderer/features/connectors/store'
import { useProjects } from '@renderer/features/projects/store'
import { projectPath } from '@renderer/features/projects/view'
import { Switch } from '@renderer/features/settings/components/rows'
import { openRunConversation } from '../open'
import { useSchedules } from '../store'
import { hasGrants, nextRunText, recurrenceText, runText, SCHEDULES_ROUTE } from '../view'
import { scheduleActions } from '../actions'
import { ScheduleMenu } from './ScheduleMenu'
import { SchedulesShell, StatusBanner } from './SchedulesPage'

const STATUS_TONE: Partial<Record<ScheduleRun['status'], string>> = {
  error: 'text-destructive',
  timeout: 'text-orange-700 dark:text-orange-300',
  missed: 'text-muted-foreground',
  skipped: 'text-muted-foreground'
}

/** Trang một lịch: lời nhắn, giờ hẹn, quyền (chỉ đọc), nhật ký các lần chạy (bấm → mở cuộc trò chuyện). */
export function ScheduleDetailPage({ id }: { id: string }) {
  const { t, i18n } = useTranslation('schedules')
  const navigate = useNavigate()
  const schedule = useSchedules((s) => s.schedules.find((x) => x.id === id))
  const loaded = useSchedules((s) => s.loaded)
  const status = useSchedules((s) => s.status)
  const toggle = useSchedules((s) => s.toggle)
  const projects = useProjects((s) => s.projects)
  const gmail = useConnectors((s) => s.gmail)
  const { data: runs } = useSyncedState(['schedules', 'conversations'], () => api.schedules.runs(id, 100))
  const [now] = useState(Date.now)
  const time = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }), [i18n.language])

  if (loaded && !schedule)
    return (
      <SchedulesShell testId="schedule-page">
        <p className="py-16 text-center text-sm text-muted-foreground" data-testid="schedule-not-found">
          {t('notFound')} <Link className="underline" to={SCHEDULES_ROUTE}>{t('backToList')}</Link>
        </p>
      </SchedulesShell>
    )
  if (!schedule) return <SchedulesShell testId="schedule-page">{null}</SchedulesShell>

  const project = schedule.projectId ? projects.find((p) => p.id === schedule.projectId) : null
  const paused = !!status?.settings.pausedAll
  const running = schedule.lastStatus === 'running'
  const accountLabel = (accountId: string): string => gmail?.accounts.find((a) => a.id === accountId)?.label ?? accountId

  return (
    <SchedulesShell testId="schedule-page">
      <Link to={SCHEDULES_ROUTE} className="inline-flex items-center gap-1 pt-2 text-sm text-muted-foreground hover:text-foreground" data-testid="schedule-back">
        <ArrowLeft className="size-4" />
        {t('title')}
      </Link>
      <header className="flex flex-wrap items-center gap-2 pt-3 pb-1">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight" data-testid="schedule-name">
          {schedule.name}
        </h1>
        <Switch checked={schedule.enabled} aria-label={t('toggleFor', { name: schedule.name })} onChange={(e) => void toggle(schedule.id, e.target.checked)} data-testid="schedule-toggle" />
        <Button variant="outline" size="sm" disabled={!status?.settings.enabled || running} onClick={() => void scheduleActions(schedule.id).runNow()} data-testid="schedule-run-now-button">
          <Play />
          {t('menu.runNow')}
        </Button>
        <ScheduleMenu schedule={schedule} detail />
      </header>
      <p className="pb-4 text-sm text-muted-foreground" data-testid="schedule-when">
        {recurrenceText(schedule.recurrence, t, i18n.language)}
        {schedule.enabled && !paused && schedule.nextRunAt && ` · ${t('state.next', { when: nextRunText(schedule.nextRunAt, now, t, i18n.language) })}`}
        {!schedule.enabled && ` · ${t(`state.${schedule.pausedReason ?? 'off'}`)}`}
      </p>
      <StatusBanner />

      <dl className="space-y-3 rounded-xl border p-4 text-sm">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('detail.prompt')}</dt>
          <dd className="mt-1 whitespace-pre-wrap" data-testid="schedule-prompt">
            {schedule.prompt}
          </dd>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t('form.project')}</dt>
            <dd className="mt-1">{project ? <Link className="underline" to={projectPath(project.id)}>{project.name}</Link> : t('form.noProject')}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t('form.model')}</dt>
            <dd className="mt-1">{t(`models.${schedule.model}`)}</dd>
          </div>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('detail.grants')}</dt>
          <dd className="mt-1 space-y-1" data-testid="schedule-grants-view">
            {!hasGrants(schedule.grants) && <p className="text-muted-foreground">{t('detail.noGrants')}</p>}
            {schedule.grants.folder && (
              <p className="flex items-center gap-2">
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 text-xs" title={schedule.grants.folder}>
                  {schedule.grants.folder}
                </code>
                <span className="text-xs text-muted-foreground">{t('detail.readOnly')}</span>
              </p>
            )}
            {schedule.grants.gmailAccounts.map((a) => (
              <p key={a} className="flex items-center gap-2">
                <Mail className="size-4 shrink-0 text-muted-foreground" />
                {t('detail.gmail', { label: accountLabel(a) })}
              </p>
            ))}
            {schedule.grants.telegram && (
              <p className="flex items-center gap-2">
                <MessageCircle className="size-4 shrink-0 text-muted-foreground" />
                {t('detail.telegram')}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('detail.never')}</p>
          </dd>
        </div>
      </dl>

      <h2 className="pt-8 pb-2 text-sm font-semibold">{t('detail.history')}</h2>
      {runs && runs.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground" data-testid="schedule-runs-empty">
          {t('detail.noRuns')}
        </p>
      ) : (
        <ul className="divide-y rounded-xl border" data-testid="schedule-runs">
          {(runs ?? []).map((run) => (
            <li key={run.id} className="flex items-center gap-3 px-4 py-2.5 text-sm" data-testid="schedule-run" data-status={run.status} data-reason={run.reason ?? ''}>
              <span className="w-32 shrink-0 text-xs text-muted-foreground tabular-nums">{time.format(run.startedAt ?? run.scheduledFor)}</span>
              <span className={cn('min-w-0 flex-1 truncate', STATUS_TONE[run.status])} title={runText(run, t)} data-testid="schedule-run-text">
                {runText(run, t)}
                {run.conversationId && !run.seenAt && run.status !== 'running' && (
                  <span className="ml-2 inline-block size-1.5 rounded-full bg-primary align-middle" aria-label={t('unseen')} />
                )}
              </span>
              {run.conversationId && (
                <Button size="sm" variant="ghost" onClick={() => void openRunConversation(run.conversationId!, navigate)} data-testid="schedule-run-open">
                  <MessagesSquare />
                  {t('detail.open')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SchedulesShell>
  )
}
