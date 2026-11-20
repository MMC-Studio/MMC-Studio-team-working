import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkillPreview, SkillTheme } from '@shared/skills'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@renderer/components/ui/dialog'
import { api } from '@renderer/lib/api'

// Phần dùng chung cho skill trên trang Plugin (chuyển từ Cài đặt › Khả năng). Chữ vẫn ở namespace `settings` (skills.*).
const kb = (n: number): string => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`)

export function ThemeSwatches({ themes }: { themes: SkillTheme[] }) {
  if (!themes.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {themes.map((th) => (
        <span
          key={th.id}
          className="flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs"
          style={{ background: th.colors.background, color: th.colors.text }}
        >
          <span className="size-2.5 rounded-full" style={{ background: th.colors.accent }} />
          {th.name} <code className="opacity-70">{th.id}</code>
        </span>
      ))}
    </div>
  )
}

export function SkillBody({ body }: { body: string }) {
  return (
    <pre
      className="max-h-72 overflow-auto rounded border bg-muted/40 p-3 text-xs whitespace-pre-wrap"
      data-testid="skill-body"
    >
      {body}
    </pre>
  )
}

/** Xem trước gói skill: nguồn, nội dung SKILL.md, file kèm, file bị bỏ — người dùng đọc rồi mới cài. */
export function PreviewDialog({
  preview,
  onClose,
  onInstalled
}: {
  preview: SkillPreview
  onClose(): void
  onInstalled(): void
}) {
  const { t } = useTranslation('settings')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          void api.skills.cancelPreview(preview.token)
          onClose()
        }
      }}
    >
      <DialogContent
        className="max-w-2xl"
        title={t('skills.preview.title', { name: preview.name })}
        description={preview.description}
        data-testid="skill-preview"
      >
        <div className="space-y-3 text-sm">
          <p className="break-all text-muted-foreground">
            {t('skills.preview.origin')}: <code>{preview.origin}</code>
          </p>
          {preview.replaces && (
            <p className="text-amber-700 dark:text-amber-400">{t('skills.preview.replaces')}</p>
          )}
          <SkillBody body={preview.body} />
          <div>
            <p className="font-medium">{t('skills.preview.files')}</p>
            <ul className="text-xs text-muted-foreground">
              {preview.files.map((f) => (
                <li key={f.path}>
                  {f.path} ({kb(f.size)})
                </li>
              ))}
            </ul>
          </div>
          {preview.skipped.length > 0 && (
            <div data-testid="skill-skipped">
              <p className="font-medium">{t('skills.preview.skipped')}</p>
              <ul className="text-xs text-muted-foreground">
                {preview.skipped.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          <ThemeSwatches themes={preview.themes} />
          <p className="text-xs text-muted-foreground">{t('skills.preview.textOnly')}</p>
          {error && <p className="text-destructive">{t('skills.errors.install')}</p>}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button
              disabled={busy}
              data-testid="skill-install"
              onClick={async () => {
                setBusy(true)
                try {
                  await api.skills.install(preview.token)
                  onInstalled()
                } catch {
                  setError(true)
                  setBusy(false)
                }
              }}
            >
              {busy && <Loader2 className="animate-spin" />}
              {t('skills.preview.install')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
