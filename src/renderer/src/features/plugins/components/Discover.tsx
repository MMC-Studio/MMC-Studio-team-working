import { AlertTriangle, ChevronDown, ChevronRight, Download, GitCommit, Loader2, Package, RefreshCw, Settings2, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Catalog, CatalogPlugin, InstalledPlugin, PluginPreview, PluginSourceInfo, PreviewResult, PreviewWarning } from '@shared/pluginStore'
import { matchesAllWords } from '@shared/text'
import { DiffView } from '@renderer/components/DiffView'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@renderer/components/ui/dialog'
import { Input, Label, Select } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { notifyChanged, optimistic, useSyncedState } from '@renderer/lib/sync'
import { cn } from '@renderer/lib/utils'
import { SkillBody } from './skillParts'

type Data = { catalog: Catalog; installed: InstalledPlugin[]; sources: PluginSourceInfo[] }

const short = (sha: string): string => sha.slice(0, 7)

/** Nhãn nguồn: đã duyệt (mặc định, đóng gói cùng app) / bạn tự thêm (chưa được duyệt) / đã bị xoá. */
export function SourceBadge({ builtin, removed }: { builtin: boolean; removed?: boolean }) {
  const { t } = useTranslation('plugins')
  if (removed)
    return (
      <span className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground" data-testid="store-source-removed">
        {t('store.sourceRemoved')}
      </span>
    )
  return builtin ? (
    <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-px text-[11px] text-primary" data-testid="store-source-builtin">
      <ShieldCheck className="size-3" />
      {t('store.sourceBuiltin')}
    </span>
  ) : (
    <span className="rounded bg-orange-500/15 px-1.5 py-px text-[11px] text-orange-700 dark:text-orange-300" data-testid="store-source-user">
      {t('store.sourceUser')}
    </span>
  )
}

/**
 * Tab Khám phá: plugin từ các nguồn (repo GitHub dạng marketplace). Chỉ skill bằng chữ được cài; xem trước (nguồn, SHA,
 * license, file, file bị bỏ, cảnh báo) rồi mới cài. Không tự cập nhật.
 */
export function DiscoverView({ query }: { query: string }) {
  const { t } = useTranslation('plugins')
  const { data, setData, refresh } = useSyncedState(['pluginStore'], async (): Promise<Data> => {
    const [catalog, installed, sources] = await Promise.all([api.pluginStore.catalog(), api.pluginStore.installed(), api.pluginStore.sources()])
    return { catalog, installed, sources }
  })
  const [category, setCategory] = useState('')
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [removing, setRemoving] = useState<InstalledPlugin | null>(null)
  const [busy, setBusy] = useState<'refresh' | 'updates' | null>(null)

  const categories = useMemo(() => [...new Set((data?.catalog.plugins ?? []).map((p) => p.category).filter((c): c is string => !!c))].sort(), [data])
  const plugins = useMemo(
    () =>
      (data?.catalog.plugins ?? []).filter(
        (p) => (!category || p.category === category) && (!query.trim() || matchesAllWords(`${p.name} ${p.description} ${p.author ?? ''} ${p.category ?? ''}`, query))
      ),
    [data, category, query]
  )

  const reload = async (force: boolean): Promise<void> => {
    setBusy('refresh')
    try {
      const catalog = await api.pluginStore.catalog(force)
      setData((d) => ({ ...d, catalog }))
    } finally {
      setBusy(null)
    }
  }
  const checkUpdates = async (): Promise<void> => {
    setBusy('updates')
    try {
      const installed = await api.pluginStore.checkUpdates()
      setData((d) => ({ ...d, installed }))
    } finally {
      setBusy(null)
    }
  }
  const uninstall = async (p: InstalledPlugin): Promise<void> => {
    const before = data
    await optimistic({
      topic: 'pluginStore',
      apply: () => setData((d) => ({ ...d, installed: d.installed.filter((x) => x.key !== p.key) })),
      rollback: () => before && setData(before),
      save: async () => ((await api.pluginStore.uninstall(p.key)) ? true : { error: 'not_found' })
    })
    notifyChanged('skills')
  }

  return (
    <div className="mt-6 space-y-6" data-testid="plugins-discover">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">{t('store.intro')}</p>
        <Button variant="outline" size="sm" onClick={() => setSourcesOpen(true)} data-testid="store-sources">
          <Settings2 />
          {t('store.sources', { count: data?.sources.length ?? 0 })}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void reload(true)} data-testid="store-refresh">
          {busy === 'refresh' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {t('store.refresh')}
        </Button>
      </div>

      {data?.catalog.sources
        .flatMap((s) => (s.status === 'error' ? [{ repo: s.repo, error: s.error, retryAt: s.retryAt }] : s.stale ? [{ repo: s.repo, ...s.stale }] : []))
        .map((s) => (
          <p key={s.repo} className="flex items-start gap-2 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-sm" data-testid="store-source-error">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              <code>{s.repo}</code>:{' '}
              {t(`store.errors.${s.error}`, { time: s.retryAt ? new Date(s.retryAt).toLocaleTimeString() : '' })}
            </span>
          </p>
        ))}

      {data && data.installed.length > 0 && (
        <section data-testid="store-installed">
          <div className="flex items-center justify-between pb-1">
            <h2 className="text-base font-semibold">{t('store.installed')}</h2>
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void checkUpdates()} data-testid="store-check-updates">
              {busy === 'updates' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {t('store.checkUpdates')}
            </Button>
          </div>
          <ul>
            {data.installed.map((p) => (
              <li key={p.key} className="flex flex-wrap items-center gap-3 border-b py-3" data-testid="store-installed-row" data-key={p.key}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                  <Package className="size-4.5 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    <SourceBadge builtin={p.source.builtin} removed={p.sourceRemoved} />
                    {p.modified && (
                      <span className="rounded bg-orange-500/15 px-1.5 py-px text-[11px] text-orange-700 dark:text-orange-300" data-testid="store-modified">
                        {t('store.modifiedBadge')}
                      </span>
                    )}
                    {p.updateAvailable && (
                      <span className="rounded bg-primary/10 px-1.5 py-px text-[11px] text-primary" data-testid="store-update-available">
                        {t('store.updateAvailable', { sha: short(p.updateAvailable) })}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t('store.installedMeta', { skills: p.skills.join(', '), repo: p.location.repo, sha: short(p.location.sha) })}
                    {p.license && ` · ${p.license}`}
                  </span>
                </span>
                {!p.sourceRemoved && (p.updateAvailable || p.modified) && (
                  <Button size="sm" variant="outline" onClick={() => setPreviewKey(p.key)} data-testid="store-update">
                    <Download />
                    {p.modified && !p.updateAvailable ? t('store.reinstall') : t('store.update')}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setRemoving(p)} data-testid="store-uninstall">
                  <Trash2 />
                  {t('store.uninstall')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <h2 className="mr-auto text-base font-semibold">{t('store.catalog')}</h2>
          {categories.length > 0 && (
            <Select aria-label={t('store.category')} className="h-8 w-auto text-xs" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="store-category">
              <option value="">{t('store.allCategories')}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </div>
        {!data ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('store.loading')}
          </p>
        ) : data.sources.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground" data-testid="store-no-sources">
            {t('store.noSources')}
          </p>
        ) : plugins.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground" data-testid="store-empty">
            {t('store.empty')}
          </p>
        ) : (
          <ul className="grid gap-x-6 sm:grid-cols-2" data-testid="store-catalog">
            {plugins.map((p) => (
              <CatalogCard key={p.key} plugin={p} onOpen={() => setPreviewKey(p.key)} />
            ))}
          </ul>
        )}
      </section>

      {previewKey && <StorePreviewDialog pluginKey={previewKey} onClose={() => setPreviewKey(null)} onDone={() => void refresh()} />}
      {sourcesOpen && data && <SourcesDialog sources={data.sources} onClose={() => setSourcesOpen(false)} onChanged={() => void refresh()} />}
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent title={t('store.uninstallTitle', { name: removing?.name })} description={t('store.uninstallBody', { skills: removing?.skills.join(', ') })}>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                const p = removing
                setRemoving(null)
                if (p) void uninstall(p)
              }}
              data-testid="store-uninstall-confirm"
            >
              {t('store.uninstall')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CatalogCard({ plugin: p, onOpen }: { plugin: CatalogPlugin; onOpen(): void }) {
  const { t } = useTranslation('plugins')
  const supported = !!p.location
  return (
    <li className="border-b">
      <button
        className="flex w-full items-start gap-3 py-4 text-left hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!supported}
        onClick={onOpen}
        data-testid="store-plugin"
        data-key={p.key}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
          <Package className="size-4.5 text-muted-foreground" />
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{p.name}</span>
            {p.installed && <span className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">{t('store.installedBadge')}</span>}
          </span>
          <span className="line-clamp-2 block text-xs text-muted-foreground">{p.description}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {p.category && <span>{p.category}</span>}
            {p.author && <span>· {p.author}</span>}
            <SourceBadge builtin={p.source.builtin} />
            {!supported && <span>· {t(`store.unsupported.${p.unsupportedReason ?? 'unsupported_kind'}`)}</span>}
          </span>
        </span>
      </button>
    </li>
  )
}

/** Xem trước trước khi cài / cập nhật: tải đúng commit, CHƯA ghi gì. Bấm Cài mới ghi (từ chính bản vừa xem). */
function StorePreviewDialog({ pluginKey, onClose, onDone }: { pluginKey: string; onClose(): void; onDone(): void }) {
  const { t } = useTranslation('plugins')
  // Tải MỘT lần khi mở (không làm mới khi quay lại cửa sổ — mỗi lần xem trước là một lần tải từ GitHub + token mới).
  const [result, setResult] = useState<PreviewResult | null>(null)
  useEffect(() => {
    let alive = true
    void api.pluginStore.preview(pluginKey).then((r) => alive && setResult(r), () => alive && setResult({ status: 'error', error: 'network' }))
    return () => {
      alive = false
    }
  }, [pluginKey])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview: PluginPreview | null = result?.status === 'ok' ? result.preview : null
  const installable = preview?.skills.filter((s) => !s.conflict) ?? []
  // Plugin đã cài, cùng commit → cài lại (vd file bị sửa ngoài app), không phải cập nhật.
  const same = !!preview?.update && preview.update.fromSha === preview.location.sha

  const close = (): void => {
    if (preview) void api.pluginStore.cancelPreview(preview.token)
    onClose()
  }
  const install = async (): Promise<void> => {
    if (!preview) return
    setBusy(true)
    const r = await api.pluginStore.install(preview.token)
    setBusy(false)
    if (r.status === 'error') return setError(r.error)
    notifyChanged(['pluginStore', 'skills'])
    onDone()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent title={same ? t('store.preview.reinstallTitle', { name: preview?.name }) : preview?.update ? t('store.preview.updateTitle', { name: preview.name }) : t('store.preview.title', { name: preview?.name ?? '…' })} className="max-w-2xl" data-testid="store-preview">
        <div className="thin-scroll max-h-[70vh] space-y-4 overflow-x-hidden overflow-y-auto pr-1 text-sm">
          {!result ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('store.preview.loading')}
            </p>
          ) : result.status === 'error' ? (
            <p className="text-destructive" data-testid="store-preview-error">
              {t(`store.errors.${result.error}`, { time: result.retryAt ? new Date(result.retryAt).toLocaleTimeString() : '' })}
            </p>
          ) : (
            preview && (
              <>
                <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
                  <dt className="text-muted-foreground">{t('store.preview.source')}</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <code>{preview.source.repo}</code>
                    <SourceBadge builtin={preview.source.builtin} />
                  </dd>
                  <dt className="text-muted-foreground">{t('store.preview.version')}</dt>
                  <dd className="flex items-center gap-1.5" data-testid="store-preview-sha">
                    <GitCommit className="size-3.5" />
                    <code>
                      {preview.location.repo}
                      {preview.location.path ? `/${preview.location.path}` : ''}@{short(preview.location.sha)}
                    </code>
                    {preview.update && <span className="text-muted-foreground">({t('store.preview.from', { sha: short(preview.update.fromSha) })})</span>}
                  </dd>
                  <dt className="text-muted-foreground">{t('store.preview.license')}</dt>
                  <dd data-testid="store-preview-license">{preview.license ?? t('store.preview.noLicense')}</dd>
                </dl>
                {!preview.source.builtin && (
                  <p className="flex items-start gap-2 rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {t('store.preview.userSourceWarning')}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">{t('store.preview.rules')}</p>

                {preview.warnings.length > 0 && <Warnings list={preview.warnings} />}

                {preview.update && (
                  <section data-testid="store-preview-changes">
                    <h3 className="pb-1 font-medium">{t('store.preview.changes')}</h3>
                    {preview.update.changes.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t('store.preview.noChanges')}</p>
                    ) : (
                      <ul className="space-y-1">
                        {preview.update.changes.map((c) => (
                          <ChangeRow key={c.path} change={c} />
                        ))}
                      </ul>
                    )}
                  </section>
                )}

                <section className="space-y-2" data-testid="store-preview-skills">
                  <h3 className="font-medium">{t('store.preview.skills', { count: preview.skills.length })}</h3>
                  {preview.skills.map((s) => (
                    <SkillCard key={s.name} skill={s} />
                  ))}
                </section>

                <Ignored ignored={preview.ignored} />
              </>
            )
          )}
          {error && <p className="text-destructive">{t(`store.errors.${error}`, { time: '' })}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            {t('common:actions.cancel')}
          </Button>
          <Button disabled={!preview || installable.length === 0 || busy} onClick={() => void install()} data-testid="store-install">
            {busy ? <Loader2 className="animate-spin" /> : <Download />}
            {same ? t('store.reinstall') : preview?.update ? t('store.update') : t('store.install', { count: installable.length })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Warnings({ list }: { list: PreviewWarning[] }) {
  const { t } = useTranslation('plugins')
  return (
    <section className="rounded-md border border-orange-500/40 bg-orange-500/5 p-3" data-testid="store-preview-warnings">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 text-orange-600 dark:text-orange-400" />
        {t('store.preview.warningsTitle', { count: list.length })}
      </p>
      <p className="pt-1 text-xs text-muted-foreground">{t('store.preview.warningsHint')}</p>
      <ul className="mt-2 space-y-1 text-xs">
        {list.map((w, i) => (
          <li key={i} data-testid="store-warning" data-kind={w.kind}>
            <code className="text-muted-foreground">{w.file}</code>:{' '}
            {t(`store.warnings.${w.kind}`, {
              excerpt: 'excerpt' in w ? w.excerpt : '',
              tool: 'tool' in w ? w.tool : '',
              url: 'url' in w ? w.url : '',
              target: 'target' in w ? w.target : ''
            })}
          </li>
        ))}
      </ul>
    </section>
  )
}

function ChangeRow({ change }: { change: { path: string; change: 'added' | 'modified' | 'removed'; patch: string | null } }) {
  const { t } = useTranslation('plugins')
  const [open, setOpen] = useState(false)
  return (
    <li data-testid="store-change" data-change={change.change}>
      <button type="button" className="flex items-center gap-1.5 text-xs" onClick={() => setOpen(!open)} disabled={!change.patch}>
        {change.patch ? open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" /> : <span className="w-3.5" />}
        <span className={cn('rounded px-1', change.change === 'added' ? 'bg-green-500/15' : change.change === 'removed' ? 'bg-red-500/15' : 'bg-muted')}>
          {t(`store.change.${change.change}`)}
        </span>
        <code>{change.path}</code>
      </button>
      {open && change.patch && <DiffView patch={change.patch} />}
    </li>
  )
}

function SkillCard({ skill: s }: { skill: PluginPreview['skills'][number] }) {
  const { t } = useTranslation('plugins')
  const [open, setOpen] = useState(false)
  return (
    <div className={cn('rounded-lg border p-3', s.conflict && 'opacity-70')} data-testid="store-preview-skill" data-name={s.name}>
      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="mt-0.5 size-4 shrink-0" /> : <ChevronRight className="mt-0.5 size-4 shrink-0" />}
        <span className="min-w-0">
          <span className="font-medium">{s.name}</span>
          <span className="block text-xs text-muted-foreground">{s.description}</span>
        </span>
      </button>
      {s.conflict && (
        <p className="mt-1 text-xs text-orange-700 dark:text-orange-300" data-testid="store-skill-conflict">
          {t(`store.conflict.${s.conflict}`)}
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {t('store.preview.files', { files: s.files.map((f) => `${f.path} (${Math.ceil(f.size / 1024)} KB)`).join(', ') })}
      </p>
      {s.skipped.length > 0 && (
        <p className="mt-1 text-xs text-orange-700 dark:text-orange-300" data-testid="store-skill-skipped">
          {t('store.preview.skipped', { files: s.skipped.join(', ') })}
        </p>
      )}
      {open && (
        <div className="mt-2">
          <SkillBody body={s.body} />
        </div>
      )}
    </div>
  )
}

function Ignored({ ignored }: { ignored: PluginPreview['ignored'] }) {
  const { t } = useTranslation('plugins')
  const items = [
    ignored.hooks && t('store.ignored.hooks'),
    ignored.commands > 0 && t('store.ignored.commands', { count: ignored.commands }),
    ignored.agents > 0 && t('store.ignored.agents', { count: ignored.agents }),
    ignored.mcp && t('store.ignored.mcp'),
    ignored.otherFiles > 0 && t('store.ignored.other', { count: ignored.otherFiles })
  ].filter((x): x is string => !!x)
  if (!items.length) return null
  return (
    <section className="rounded-md bg-muted/50 p-3 text-xs" data-testid="store-preview-ignored">
      <p className="font-medium">{t('store.ignored.title')}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </section>
  )
}

/** Nguồn: mặc định (đã duyệt, không xoá được) + bạn tự thêm (cảnh báo khi thêm; xoá → plugin đã cài giữ lại). */
function SourcesDialog({ sources, onClose, onChanged }: { sources: PluginSourceInfo[]; onClose(): void; onChanged(): void }) {
  const { t } = useTranslation('plugins')
  const [repo, setRepo] = useState('')
  const [ref, setRef] = useState('')
  const [ack, setAck] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [list, setList] = useState(sources)

  const add = async (): Promise<void> => {
    setError(null)
    const r = await api.pluginStore.addSource({ repo, ...(ref.trim() ? { ref: ref.trim() } : {}) })
    if (r.status === 'error') return setError(r.error)
    setList((l) => [...l, r.source])
    setRepo('')
    setRef('')
    setAck(false)
    onChanged()
  }
  const remove = async (s: PluginSourceInfo): Promise<void> => {
    const before = list
    await optimistic({
      topic: 'pluginStore',
      apply: () => setList((l) => l.filter((x) => x.repo !== s.repo)),
      rollback: () => setList(before),
      save: async () => {
        const r = await api.pluginStore.removeSource(s.repo)
        return r.status === 'error' ? { error: r.error } : r
      }
    })
    onChanged()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t('store.sourcesTitle')} description={t('store.sourcesHelp')} className="max-w-lg" data-testid="store-sources-dialog">
        <ul className="divide-y rounded-lg border text-sm">
          {list.length === 0 && <li className="px-3 py-2 text-muted-foreground">{t('store.noSources')}</li>}
          {list.map((s) => (
            <li key={s.repo} className="flex items-center gap-2 px-3 py-2" data-testid="store-source-row" data-repo={s.repo}>
              <code className="min-w-0 flex-1 truncate">
                {s.repo}
                {s.ref !== 'HEAD' && `@${s.ref}`}
              </code>
              <SourceBadge builtin={s.builtin} />
              {!s.builtin && (
                <Button size="icon-sm" variant="ghost" title={t('store.removeSource')} aria-label={t('store.removeSource')} onClick={() => void remove(s)} data-testid="store-source-remove">
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">{t('store.removeSourceHint')}</p>
        <div className="mt-4 space-y-2">
          <Label htmlFor="store-repo">{t('store.addSource')}</Label>
          <div className="flex gap-2">
            <Input id="store-repo" placeholder="owner/repo" value={repo} onChange={(e) => setRepo(e.target.value)} data-testid="store-source-repo" />
            <Input className="w-32" placeholder={t('store.refPlaceholder')} aria-label={t('store.refPlaceholder')} value={ref} onChange={(e) => setRef(e.target.value)} />
          </div>
          <label className="flex items-start gap-2 rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="store-source-ack" />
            <span>{t('store.addSourceWarning')}</span>
          </label>
          {error && <p className="text-xs text-destructive">{t(`store.errors.${error}`, { time: '' })}</p>}
          <div className="flex justify-end">
            <Button disabled={!repo.trim() || !ack} onClick={() => void add()} data-testid="store-source-add">
              {t('store.addSourceButton')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
