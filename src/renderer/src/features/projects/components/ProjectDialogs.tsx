import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PROJECT_DESCRIPTION_MAX,
  PROJECT_INSTRUCTIONS_MAX,
  PROJECT_NAME_MAX,
  type Project,
  type ProjectDeleteInfo
} from '@shared/projects'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@renderer/components/ui/dialog'
import { Input, Label, Textarea } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { errorCode } from '@renderer/features/chat/store'

function ErrorLine({ code }: { code: string | null }) {
  const { t } = useTranslation('projects')
  if (!code) return null
  return (
    <p className="text-sm text-destructive" role="alert">
      {t(`errors.${code}`, { defaultValue: t('errors.generic') })}
    </p>
  )
}

/** Tạo dự án (project = null) hoặc đổi tên & mô tả. */
export function ProjectFormDialog({
  open,
  project,
  onClose,
  onSaved
}: {
  open: boolean
  project: Project | null
  onClose(): void
  onSaved?(project: Project): void
}) {
  const { t } = useTranslation('projects')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    const description = String(form.get('description') ?? '').trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      const saved = project
        ? await api.projects.update({ id: project.id, name, description })
        : await api.projects.create({ name, description })
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError(errorCode(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={project ? t('editDialog.title') : t('create.title')}>
        <form onSubmit={(e) => void submit(e)} className="space-y-4" data-testid="project-form">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">{t('create.name')}</Label>
            <Input
              id="project-name"
              name="name"
              defaultValue={project?.name}
              placeholder={t('create.namePlaceholder')}
              maxLength={PROJECT_NAME_MAX}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-description">{t('create.description')}</Label>
            <Textarea
              id="project-description"
              name="description"
              rows={3}
              defaultValue={project?.description}
              placeholder={t('create.descriptionPlaceholder')}
              maxLength={PROJECT_DESCRIPTION_MAX}
            />
          </div>
          <ErrorLine code={error} />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common:actions.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {project ? t('editDialog.submit') : t('create.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Sửa hướng dẫn (luôn gửi kèm trợ lý — có hiệu lực từ tin tiếp theo). */
export function InstructionsDialog({ project, open, onClose }: { project: Project; open: boolean; onClose(): void }) {
  const { t } = useTranslation('projects')
  const [text, setText] = useState(project.instructions)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.projects.update({ id: project.id, instructions: text })
      onClose()
    } catch (err) {
      setError(errorCode(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={t('instructionsDialog.title')} description={t('instructionsDialog.description')} className="max-w-xl">
        <div className="space-y-3">
          <Textarea
            rows={10}
            value={text}
            maxLength={PROJECT_INSTRUCTIONS_MAX}
            placeholder={t('instructionsDialog.placeholder')}
            onChange={(e) => setText(e.target.value)}
            aria-label={t('instructionsDialog.title')}
            autoFocus
            data-testid="instructions-input"
          />
          <p className="text-right text-xs text-muted-foreground tabular-nums">
            {t('instructionsDialog.counter', { count: text.length, max: PROJECT_INSTRUCTIONS_MAX })}
          </p>
          <ErrorLine code={error} />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common:actions.cancel')}
              </Button>
            </DialogClose>
            <Button onClick={() => void save()} disabled={busy || text === project.instructions} data-testid="instructions-save">
              {t('common:actions.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Xác nhận xoá: ghi rõ số file + trí nhớ sẽ mất, số cuộc trò chuyện được giữ. */
export function DeleteProjectDialog({
  project,
  open,
  onClose,
  onDeleted
}: {
  project: Project
  open: boolean
  onClose(): void
  onDeleted?(): void
}) {
  const { t } = useTranslation('projects')
  const [info, setInfo] = useState<ProjectDeleteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    let alive = true
    void api.projects.deleteInfo(project.id).then((r) => alive && setInfo(r))
    return () => {
      alive = false
    }
  }, [open, project.id])

  const remove = async (): Promise<void> => {
    try {
      await api.projects.remove(project.id)
      onClose()
      onDeleted?.()
    } catch (err) {
      setError(errorCode(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={t('deleteDialog.title', { name: project.name })}>
        <div className="space-y-3 text-sm" data-testid="project-delete-dialog">
          {info && (
            <>
              <p>{t('deleteDialog.lose')}</p>
              <ul className="list-disc space-y-0.5 pl-5" data-testid="project-delete-counts">
                <li>{t('deleteDialog.files', { count: info.files })}</li>
                <li>{t('deleteDialog.memories', { count: info.memories })}</li>
                {info.suggestions > 0 && <li>{t('deleteDialog.suggestions', { count: info.suggestions })}</li>}
              </ul>
              <p className="text-muted-foreground">{t('deleteDialog.keep', { count: info.conversations })}</p>
            </>
          )}
          <ErrorLine code={error} />
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common:actions.cancel')}
              </Button>
            </DialogClose>
            <Button variant="destructive" disabled={!info} onClick={() => void remove()} data-testid="project-delete-confirm">
              {t('deleteDialog.confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
