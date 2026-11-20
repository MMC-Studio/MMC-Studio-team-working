import { ChevronDown, Download } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { Select } from '@renderer/components/ui/input'
import { useProjects } from '@renderer/features/projects/store'
import { Button } from '@renderer/components/ui/button'
import { api } from '@renderer/lib/api'
import { useAuth } from '@renderer/stores/auth'
import { cn } from '@renderer/lib/utils'
import { usePreferences } from '@renderer/stores/preferences'
import { useMemory } from '../store'
import { useCollapsed } from '../useCollapsed'
import { BackupSection } from './BackupSection'
import { MemoryList } from './MemoryList'
import { ProfileForm } from './ProfileForm'
import { SuggestionList } from './SuggestionList'

function Section({
  title,
  description,
  badge,
  collapseKey,
  testId,
  children
}: {
  title: string
  description?: string
  badge?: number
  /** Có → bấm tiêu đề để thu gọn / mở rộng, nhớ trạng thái. */
  collapseKey?: string
  testId?: string
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useCollapsed(collapseKey ?? '')
  const isCollapsed = !!collapseKey && collapsed
  const heading = (
    <>
      {title}
      {badge !== undefined && (badge > 0 || !!collapseKey) && (
        <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground" data-testid="section-count">
          {badge}
        </span>
      )}
    </>
  )
  return (
    <section className="rounded-lg border bg-card p-5" data-testid={testId}>
      <h2 className="font-semibold">
        {collapseKey ? (
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left"
            aria-expanded={!isCollapsed}
            onClick={() => setCollapsed(!collapsed)}
            data-testid="section-toggle"
          >
            <ChevronDown className={cn('size-4 shrink-0 transition-transform', isCollapsed && '-rotate-90')} />
            {heading}
          </button>
        ) : (
          <span className="flex items-center gap-2">{heading}</span>
        )}
      </h2>
      {!isCollapsed && (
        <>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          <div className="mt-4">{children}</div>
        </>
      )}
    </section>
  )
}

export function MemoryPage() {
  const { t } = useTranslation('memory')
  const name = usePreferences((s) => s.assistant.name)
  const profile = useAuth((s) => s.profile)
  const loadAll = useMemory((s) => s.loadAll)
  const pending = useMemory((s) => s.pendingCount)
  const [exported, setExported] = useState<string | null>(null)

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 px-6 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{t('heading', { name })}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
            <p className="mt-1 text-sm font-medium" data-testid="memory-account">
              {profile ? t('account', { name: profile.github_username ? `@${profile.github_username}` : profile.display_name }) : t('accountLocal')}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={async () => {
              const path = await api.memory.export()
              if (path) setExported(path)
            }}
          >
            <Download />
            {t('export')}
          </Button>
        </div>
        {exported && <p className="text-sm text-muted-foreground break-all">{t('exported', { path: exported })}</p>}

        <Section title={t('suggestions.heading')} badge={pending} collapseKey="suggestions" testId="suggestions-section">
          <SuggestionList />
        </Section>
        <Section title={t('profile.heading')} description={t('profile.description')}>
          <ProfileForm />
        </Section>
        <Section title={t('list.heading')} testId="memory-list-section">
          <MemoryScopePicker />
        </Section>
        <Section title={t('backup.heading')}>
          <BackupSection />
        </Section>
      </div>
    </div>
  )
}

/**
 * Chọn phạm vi danh sách trí nhớ: mặc định trí nhớ chung; chọn một dự án để xem / sửa trí nhớ riêng của nó.
 * Phạm vi nằm trên URL (?project=<id>) để trang dự án mở thẳng đúng dự án.
 */
function MemoryScopePicker() {
  const { t } = useTranslation('memory')
  const projects = useProjects((s) => s.projects)
  const [params, setParams] = useSearchParams()
  const requested = params.get('project')
  const projectId = requested && projects.some((p) => p.id === requested) ? requested : null
  const setScope = (id: string | null): void =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (id) next.set('project', id)
      else next.delete('project')
      return next
    }, { replace: true })

  return (
    <div className="space-y-3">
      {projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="text-muted-foreground" htmlFor="memory-scope">
            {t('list.scope')}
          </label>
          <Select
            id="memory-scope"
            className="w-auto max-w-72"
            value={projectId ?? ''}
            onChange={(e) => setScope(e.target.value || null)}
            data-testid="memory-scope"
          >
            <option value="">{t('list.scopeUser')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {t('list.scopeProject', { name: p.name })}
              </option>
            ))}
          </Select>
          {projectId && <span className="text-xs text-muted-foreground">{t('list.scopeHelpProject')}</span>}
        </div>
      )}
      <MemoryList key={projectId ?? 'user'} projectId={projectId} />
    </div>
  )
}
