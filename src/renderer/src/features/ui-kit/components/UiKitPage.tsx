import { LayoutGrid, Plus, Settings, Table2, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ACCENTS, MOTIONS, THEMES } from '@shared/schemas'
import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Segmented } from '@renderer/components/ui/segmented'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import { usePreferences } from '@renderer/stores/preferences'

const VARIANTS = ['default', 'destructive', 'outline', 'ghost', 'link'] as const

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section data-testid={`ui-kit-${id}`} className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      <div className="rounded-(--radius-card) border bg-card p-5">{children}</div>
    </section>
  )
}

/** Đổi nền / màu nhấn / chuyển động ngay trên trang (lưu vào Cài đặt như bình thường). */
function Controls() {
  const { t } = useTranslation('ui-kit')
  const { t: ts } = useTranslation('settings')
  const appearance = usePreferences((s) => s.appearance)
  const save = usePreferences((s) => s.saveAppearance)
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <Segmented
        label={t('controls.theme')}
        value={appearance.theme}
        onValueChange={(theme) => void save({ ...appearance, theme })}
        items={THEMES.map((v) => ({ value: v, label: ts(`appearance.themes.${v}`), testId: `ui-kit-theme-${v}` }))}
      />
      <div role="group" aria-label={t('controls.accent')} className="flex gap-2">
        {ACCENTS.map((accent) => (
          <button
            key={accent}
            type="button"
            data-accent={accent}
            data-testid={`ui-kit-accent-${accent}`}
            aria-label={ts(`appearance.accents.${accent}`)}
            aria-pressed={appearance.accent === accent}
            className={cn(
              'size-6 rounded-full bg-primary ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              appearance.accent === accent && 'ring-2 ring-primary'
            )}
            onClick={() => void save({ ...appearance, accent })}
          />
        ))}
      </div>
      <Segmented
        label={t('controls.motion')}
        value={appearance.motion}
        onValueChange={(motion) => void save({ ...appearance, motion })}
        items={MOTIONS.map((v) => ({ value: v, label: ts(`appearance.motions.${v}`), testId: `ui-kit-motion-${v}` }))}
      />
    </div>
  )
}

export function UiKitPage() {
  const { t } = useTranslation('ui-kit')
  const [loading, setLoading] = useState(false)
  const [on, setOn] = useState(true)
  const [view, setView] = useState<'table' | 'cards'>('table')
  const [tab, setTab] = useState<'dashboard' | 'members' | 'tasks' | 'reports'>('dashboard')

  const tryLoading = (): void => {
    setLoading(true)
    setTimeout(() => setLoading(false), 1500)
  }

  return (
    <div className="thin-scroll h-full overflow-y-auto" data-testid="ui-kit-page">
      <div className="mx-auto max-w-4xl space-y-8 p-8">
        <header className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
          </div>
          <Controls />
        </header>

        <Section id="buttons" title={t('sections.buttons')}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {VARIANTS.map((variant) => (
                <Button key={variant} variant={variant}>
                  {variant === 'destructive' ? t('demo.delete') : variant === 'link' ? t('demo.link') : t('demo.save')}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline">{t('demo.cancel')}</Button>
              <Button size="lg">{t('demo.save')}</Button>
              <Button size="pill" variant="outline">{t('demo.filter')}</Button>
              <Button size="pill">
                <Plus />
                {t('demo.add')}
              </Button>
              <Button loading={loading} onClick={tryLoading} data-testid="ui-kit-loading">
                {t('demo.loading')}
              </Button>
              <Button disabled variant="outline">{t('demo.locked')}</Button>
            </div>
          </div>
        </Section>

        <Section id="icon-buttons" title={t('sections.iconButtons')}>
          <div className="flex items-center gap-2">
            <IconButton label={t('demo.add')} icon={<Plus />} data-testid="ui-kit-icon-add" />
            <IconButton label={t('demo.settings')} icon={<Settings />} variant="outline" />
            <IconButton label={t('demo.delete')} icon={<Trash2 />} size="icon-sm" />
          </div>
        </Section>

        <Section id="switches" title={t('sections.switches')}>
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <label className="flex items-center gap-2">
              <Switch checked={on} onChange={(e) => setOn(e.target.checked)} data-testid="ui-kit-switch" />
              {on ? t('demo.on') : t('demo.off')}
            </label>
            <label className="flex items-center gap-2 text-muted-foreground">
              <Switch checked disabled readOnly />
              {t('demo.locked')}
            </label>
            <label className="flex items-center gap-2 text-muted-foreground">
              <Switch checked={false} disabled readOnly />
              {t('demo.locked')}
            </label>
          </div>
        </Section>

        <Section id="segmented" title={t('sections.segmented')}>
          <div className="flex flex-col items-start gap-5">
            <Segmented
              label={t('demo.view')}
              value={view}
              onValueChange={setView}
              testId="ui-kit-view"
              items={[
                { value: 'table', label: t('demo.table'), icon: <Table2 /> },
                { value: 'cards', label: t('demo.cards'), icon: <LayoutGrid /> }
              ]}
            />
            <Segmented
              size="lg"
              label={t('demo.pageTabs')}
              value={tab}
              onValueChange={setTab}
              testId="ui-kit-tabs"
              items={(['dashboard', 'members', 'tasks', 'reports'] as const).map((v) => ({ value: v, label: t(`demo.${v}`) }))}
            />
          </div>
        </Section>
      </div>
    </div>
  )
}
