import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useSchedules } from '../store'
import { recurrenceText, schedulePath, scheduleState } from '../view'
import { EnableSchedulesDialog, ScheduleEditorDialog } from './ScheduleDialogs'

/** Nút "Thêm" ở cột phải trang dự án: tính năng tắt → hộp bật (cảnh báo); bật → hộp tạo lịch chọn sẵn dự án. */
export function ProjectScheduleAdd({ projectId, className }: { projectId: string; className?: string }) {
  const { t } = useTranslation('projects')
  const settings = useSchedules((s) => s.status?.settings)
  const [mode, setMode] = useState<'none' | 'enable' | 'create'>('none')
  return (
    <>
      <button
        className={className}
        onClick={() => setMode(settings?.enabled ? 'create' : settings?.acknowledged ? 'create' : 'enable')}
        data-testid="project-add-schedule"
      >
        {t('panel.addSchedule')}
      </button>
      <EnableSchedulesDialog open={mode === 'enable'} onClose={(on) => setMode(on ? 'create' : 'none')} />
      <ScheduleEditorDialog open={mode === 'create'} schedule={null} projectId={projectId} onClose={() => setMode('none')} />
    </>
  )
}

/** Lịch hẹn của một dự án (bấm → trang của lịch). */
export function ProjectSchedules({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation('schedules')
  const { t: tp } = useTranslation('projects')
  const navigate = useNavigate()
  // Chọn cả mảng rồi lọc ngoài selector: selector trả mảng mới mỗi lần → zustand render lặp vô hạn.
  const schedules = useSchedules((s) => s.schedules)
  const list = useMemo(() => schedules.filter((x) => x.projectId === projectId), [schedules, projectId])
  const paused = useSchedules((s) => !!s.status?.settings.pausedAll)
  if (list.length === 0) return <p className="text-xs text-muted-foreground">{tp('panel.noSchedules')}</p>
  return (
    <ul className="space-y-0.5" data-testid="project-schedules">
      {list.map((s) => (
        <li key={s.id}>
          <button
            className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
            onClick={() => void navigate(schedulePath(s.id))}
            data-testid="project-schedule"
          >
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="shrink-0 text-muted-foreground">
              {scheduleState(s, paused) === 'on' ? recurrenceText(s.recurrence, t, i18n.language) : t(`state.${scheduleState(s, paused)}`)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
