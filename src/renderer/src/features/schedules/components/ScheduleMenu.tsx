import { History, MoreHorizontal, Pencil, Play, SkipForward, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { Schedule } from '@shared/schedules'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@renderer/components/ui/dialog'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@renderer/components/ui/menu'
import { cn } from '@renderer/lib/utils'
import { scheduleActions } from '../actions'
import { useSchedules } from '../store'
import { SCHEDULES_ROUTE, schedulePath } from '../view'
import { ScheduleEditorDialog } from './ScheduleDialogs'

export function ScheduleMenu({ schedule, className, detail }: { schedule: Schedule; className?: string; detail?: boolean }) {
  const { t } = useTranslation('schedules')
  const navigate = useNavigate()
  const enabled = useSchedules((s) => !!s.status?.settings.enabled)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const actions = scheduleActions(schedule.id)
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(className)}
            title={t('menu.more')}
            aria-label={t('menu.moreFor', { name: schedule.name })}
            onClick={(e) => e.stopPropagation()}
            data-testid="schedule-menu"
          >
            <MoreHorizontal />
          </Button>
        </MenuTrigger>
        <MenuContent onClick={(e) => e.stopPropagation()}>
          <MenuItem icon={<Play />} disabled={!enabled || schedule.lastStatus === 'running'} onSelect={() => void actions.runNow()} data-testid="schedule-run-now">
            {t('menu.runNow')}
          </MenuItem>
          {schedule.enabled &&
            (schedule.skipNext ? (
              <MenuItem icon={<Undo2 />} onSelect={() => void actions.skipNext(false)} data-testid="schedule-unskip">
                {t('menu.unskip')}
              </MenuItem>
            ) : (
              <MenuItem icon={<SkipForward />} onSelect={() => void actions.skipNext(true)} data-testid="schedule-skip">
                {t('menu.skip')}
              </MenuItem>
            ))}
          <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)} data-testid="schedule-edit">
            {t('menu.edit')}
          </MenuItem>
          {!detail && (
            <MenuItem icon={<History />} onSelect={() => void navigate(schedulePath(schedule.id))} data-testid="schedule-history">
              {t('menu.history')}
            </MenuItem>
          )}
          <MenuItem icon={<Trash2 />} destructive onSelect={() => setDeleting(true)} data-testid="schedule-delete">
            {t('menu.delete')}
          </MenuItem>
        </MenuContent>
      </Menu>
      <ScheduleEditorDialog open={editing} schedule={schedule} onClose={() => setEditing(false)} />
      <Dialog open={deleting} onOpenChange={(o) => !o && setDeleting(false)}>
        <DialogContent title={t('delete.title', { name: schedule.name })} description={t('delete.description')}>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleting(false)
                void actions.remove()
                if (detail) void navigate(SCHEDULES_ROUTE)
              }}
              data-testid="schedule-delete-confirm"
            >
              {t('delete.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
