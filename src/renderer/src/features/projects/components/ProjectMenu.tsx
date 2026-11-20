import { Ellipsis, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project } from '@shared/projects'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@renderer/components/ui/menu'
import { cn } from '@renderer/lib/utils'
import { useProjects } from '../store'
import { DeleteProjectDialog, ProjectFormDialog } from './ProjectDialogs'

/** Menu ⋯ của dự án (thẻ ở trang Dự án, trang dự án, dòng "Đã ghim" ở thanh bên): đổi tên, ghim, xoá. */
export function ProjectMenu({
  project,
  onDeleted,
  className
}: {
  project: Project
  onDeleted?(): void
  className?: string
}) {
  const { t } = useTranslation('projects')
  const togglePin = useProjects((s) => s.togglePin)
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null)
  return (
    <>
      <Menu>
        <MenuTrigger
          className={cn('rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground', className)}
          aria-label={t('options')}
          title={t('options')}
          onClick={(e) => e.stopPropagation()}
          data-testid="project-menu"
        >
          <Ellipsis className="size-4" />
        </MenuTrigger>
        <MenuContent onClick={(e) => e.stopPropagation()}>
          <MenuItem icon={<Pencil />} onSelect={() => setDialog('edit')} data-testid="project-menu-edit">
            {t('edit')}
          </MenuItem>
          <MenuItem
            icon={project.pinned ? <PinOff /> : <Pin />}
            onSelect={() => void togglePin(project.id)}
            data-testid="project-menu-pin"
          >
            {project.pinned ? t('unpin') : t('pin')}
          </MenuItem>
          <MenuItem icon={<Trash2 />} destructive onSelect={() => setDialog('delete')} data-testid="project-menu-delete">
            {t('delete')}
          </MenuItem>
        </MenuContent>
      </Menu>
      <ProjectFormDialog open={dialog === 'edit'} project={project} onClose={() => setDialog(null)} />
      <DeleteProjectDialog project={project} open={dialog === 'delete'} onClose={() => setDialog(null)} onDeleted={onDeleted} />
    </>
  )
}
