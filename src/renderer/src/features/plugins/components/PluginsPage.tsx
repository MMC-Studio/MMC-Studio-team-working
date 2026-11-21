import {
  ArrowRight,
  Blocks,
  ChevronDown,
  FileArchive,
  FolderOpen,
  FolderPlus,
  ListFilter,
  Mail,
  MessageCircle,
  Network,
  Plus,
  Search,
  Server,
  Sparkles
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import type { SkillPreview } from '@shared/skills'
import { Button } from '@renderer/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@renderer/components/ui/menu'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import { ChatLayout, SidebarToggle } from '@renderer/features/chat/layout/ChatLayout'
import { pluginDescription, pluginName, pluginSearchText, pluginSubtitle } from '../labels'
import { filterPlugins, PLUGINS_ROUTE, type PluginItem, type PluginStatusFilter, type PluginTab } from '../model'
import { useSkills } from '../store'
import { usePlugins } from '../usePlugins'
import { EnableDialog, PluginMenu } from './PluginMenu'
import { PreviewDialog } from './skillParts'
import { DiscoverView } from './Discover'

/** Số dòng hiện sẵn mỗi phần; còn lại sau "Xem tất cả". */
export const ROWS_SHOWN = 5
const TABS: PluginTab[] = ['all', 'connectors', 'skills', 'discover']
const STATUS: PluginStatusFilter[] = ['all', 'on', 'off', 'attention']

export function PluginIcon({ item, className }: { item: PluginItem; className?: string }) {
  const Icon =
    item.type === 'gmail'
      ? Mail
      : item.type === 'telegram'
        ? MessageCircle
        : item.type === 'agents'
          ? Network
          : item.type === 'mcp'
            ? Server
            : item.type === 'builtinSkill'
              ? Blocks
              : Sparkles
  return (
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50', className)}>
      <Icon className="size-4.5 text-muted-foreground" />
    </span>
  )
}

/** Nhãn trạng thái nhỏ cạnh tên: "Đang tắt" / "Cần chú ý". */
export function PluginBadges({ item }: { item: PluginItem }) {
  const { t } = useTranslation('plugins')
  return (
    <>
      {item.toggleable && !item.enabled && (
        <span className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground" data-testid="plugin-off">
          {t('state.off')}
        </span>
      )}
      {item.attention && (
        <span className="rounded bg-orange-500/15 px-1.5 py-px text-[11px] text-orange-700 dark:text-orange-300" data-testid="plugin-attention">
          {t('state.attention')}
        </span>
      )}
    </>
  )
}

export function PluginsPage() {
  const { t } = useTranslation('plugins')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: PluginTab = (TABS as string[]).includes(tabParam ?? '') ? (tabParam as PluginTab) : 'all'
  const [status, setStatus] = useState<PluginStatusFilter>('all')
  const [text, setText] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [enabling, setEnabling] = useState<PluginItem | null>(null)
  const [preview, setPreview] = useState<SkillPreview | null>(null)
  const [skillError, setSkillError] = useState<string | null>(null)
  const groups = usePlugins()

  const q = { tab, status, text }
  const label = (item: PluginItem): string => pluginSearchText(item, t)
  const yours = filterPlugins(groups.yours, q, label)
  const builtin = filterPlugins(groups.builtin, q, label)
  // Gợi ý = thứ chưa bật → bộ lọc "Đang bật" / "Cần chú ý" không có gợi ý.
  const suggestions = status === 'all' || status === 'off' ? filterPlugins(groups.suggestions, { ...q, status: 'all' }, label) : []
  const searching = !!text.trim() || status !== 'all'

  const setTab = (next: PluginTab): void =>
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (next === 'all') p.delete('tab')
      else p.set('tab', next)
      return p
    }, { replace: true })

  const pickSkill = async (kind: 'folder' | 'zip'): Promise<void> => {
    setSkillError(null)
    const r = await api.skills.pick(kind)
    if (!r) return
    if ('error' in r) setSkillError(r.error)
    else setPreview(r)
  }

  /** Thêm ▾ → kết nối: đang bật thì mở cấu hình, chưa bật thì qua hộp cảnh báo như menu ⋯. */
  const openConnector = (type: 'gmail' | 'telegram' | 'agents'): void => {
    const item = [...groups.yours, ...groups.suggestions].find((x) => x.type === type)
    if (!item) return
    if (item.enabled) void navigate(item.href)
    else setEnabling(item)
  }

  const nothing = yours.length + builtin.length + suggestions.length === 0

  return (
    <ChatLayout>
      <section className="thin-scroll flex min-w-0 flex-1 flex-col overflow-y-auto" data-testid="plugins-page">
        <div className="flex min-h-11 items-center px-4 py-1.5">
          <SidebarToggle when="hidden" />
        </div>
        <div className="mx-auto w-full max-w-3xl px-6 pt-4 pb-12 sm:px-10">
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('intro')}</p>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <label className="relative min-w-48 flex-1">
              <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <input
                className="h-9 w-full rounded-lg border bg-muted/40 pr-3 pl-9 text-sm outline-none focus:border-primary"
                placeholder={t('search')}
                aria-label={t('search')}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setText('')}
                data-testid="plugins-search"
              />
            </label>
            <div className="flex rounded-lg border bg-muted/40 p-0.5 text-sm" role="tablist" data-testid="plugins-tabs">
              {TABS.map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  className={cn(
                    'rounded-md px-3 py-1',
                    tab === k ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setTab(k)}
                  data-testid={`plugins-tab-${k}`}
                >
                  {t(`tabs.${k}`)}
                </button>
              ))}
            </div>
            <Menu>
              <MenuTrigger
                className={cn(
                  'flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground',
                  status !== 'all' && 'bg-primary/10 text-primary'
                )}
                aria-label={t('filter.label')}
                title={t('filter.label')}
                data-testid="plugins-filter"
              >
                <ListFilter className="size-4" />
              </MenuTrigger>
              <MenuContent>
                {STATUS.map((s) => (
                  <MenuItem
                    key={s}
                    onSelect={() => setStatus(s)}
                    className={cn(status === s && 'font-medium text-primary')}
                    data-testid={`plugins-filter-${s}`}
                  >
                    {t(`filter.${s}`)}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm" className="h-9" data-testid="plugins-add">
                  <Plus />
                  {t('add.button')}
                  <ChevronDown />
                </Button>
              </MenuTrigger>
              <MenuContent className="min-w-60">
                <MenuItem icon={<FolderPlus />} onSelect={() => void pickSkill('folder')} data-testid="plugins-add-skill-folder">
                  {t('add.skillFolder')}
                </MenuItem>
                <MenuItem icon={<FileArchive />} onSelect={() => void pickSkill('zip')} data-testid="plugins-add-skill-zip">
                  {t('add.skillZip')}
                </MenuItem>
                <MenuItem icon={<FolderOpen />} onSelect={() => void api.skills.openFolder()}>
                  {t('add.openSkillFolder')}
                </MenuItem>
                <MenuItem icon={<Server />} onSelect={() => void navigate(`${PLUGINS_ROUTE}/mcp?add=1`)} data-testid="plugins-add-mcp">
                  {t('add.mcp')}
                </MenuItem>
                <MenuItem icon={<Mail />} onSelect={() => openConnector('gmail')} data-testid="plugins-add-gmail">
                  {t('add.gmail')}
                </MenuItem>
                <MenuItem icon={<MessageCircle />} onSelect={() => openConnector('telegram')} data-testid="plugins-add-telegram">
                  {t('add.telegram')}
                </MenuItem>
                <MenuItem icon={<Network />} onSelect={() => openConnector('agents')} data-testid="plugins-add-agents">
                  {t('add.agents')}
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
          {skillError && (
            <p className="mt-2 text-sm text-destructive" data-testid="skill-error">
              {t(`settings:skills.errors.${skillError}`)}
            </p>
          )}

          {tab === 'discover' && <DiscoverView query={text} />}

          {tab !== 'discover' && groups.loaded && nothing && searching && (
            <p className="py-10 text-center text-sm text-muted-foreground" data-testid="plugins-no-results">
              {t('empty.results')}
            </p>
          )}

          {tab !== 'discover' && (!searching || yours.length > 0) && (
            <Section
              title={t('sections.yours')}
              testId="plugins-yours"
              items={yours}
              expanded={!!expanded.yours}
              onExpand={() => setExpanded((e) => ({ ...e, yours: !e.yours }))}
              empty={groups.loaded ? t('empty.yours') : undefined}
            />
          )}
          {tab !== 'connectors' && tab !== 'discover' && builtin.length > 0 && (
            <Section
              title={t('sections.builtin')}
              help={t('sections.builtinHelp')}
              testId="plugins-builtin"
              items={builtin}
              expanded={!!expanded.builtin}
              onExpand={() => setExpanded((e) => ({ ...e, builtin: !e.builtin }))}
            />
          )}
          {tab !== 'discover' && suggestions.length > 0 && (
            <section className="mt-10" data-testid="plugins-suggestions">
              <h2 className="pb-2 text-base font-semibold">{t('sections.suggestions')}</h2>
              <div className="grid gap-x-6 sm:grid-cols-2">
                {suggestions.map((item) => (
                  <button
                    key={item.key}
                    className="flex items-start gap-3 border-b py-4 text-left hover:bg-muted/40"
                    onClick={() => setEnabling(item)}
                    data-testid={`plugin-suggestion-${item.key}`}
                  >
                    <PluginIcon item={item} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{pluginName(item, t)}</span>
                      <span className="line-clamp-2 block text-xs text-muted-foreground">{pluginDescription(item, t)}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {t(`kind.${item.kind}`)} · {t('meta.byApp')}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>
      {enabling && <EnableDialog item={enabling} onClose={() => setEnabling(null)} />}
      {preview && (
        <PreviewDialog
          preview={preview}
          onClose={() => setPreview(null)}
          onInstalled={() => {
            setPreview(null)
            void useSkills.getState().refresh()
          }}
        />
      )}
    </ChatLayout>
  )
}

function Section({
  title,
  help,
  items,
  expanded,
  onExpand,
  empty,
  testId
}: {
  title: string
  help?: string
  items: PluginItem[]
  expanded: boolean
  onExpand(): void
  empty?: string
  testId: string
}) {
  const { t } = useTranslation('plugins')
  const visible = expanded ? items : items.slice(0, ROWS_SHOWN)
  return (
    <section className="mt-8" data-testid={testId}>
      <div className="flex items-center justify-between pb-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {items.length > ROWS_SHOWN && (
          <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={onExpand} data-testid="plugins-show-all">
            {expanded ? t('sections.showLess') : t('sections.showAll')}
            <ArrowRight className={cn('size-4', expanded && '-rotate-90')} />
          </button>
        )}
      </div>
      {help && <p className="pb-1 text-xs text-muted-foreground">{help}</p>}
      {items.length === 0 ? (
        empty && <p className="py-4 text-sm text-muted-foreground" data-testid={`${testId}-empty`}>{empty}</p>
      ) : (
        <ul>
          {visible.map((item) => (
            <PluginRow key={item.key} item={item} />
          ))}
        </ul>
      )}
    </section>
  )
}

function PluginRow({ item }: { item: PluginItem }) {
  const { t } = useTranslation('plugins')
  const navigate = useNavigate()
  const description = pluginDescription(item, t)
  return (
    <li className="group flex items-center gap-3 border-b py-3" data-testid="plugin-row" data-key={item.key} data-enabled={item.enabled}>
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => void navigate(item.href)}>
        <PluginIcon item={item} />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className={cn('truncate text-sm font-medium', !item.enabled && 'text-muted-foreground')}>{pluginName(item, t)}</span>
            <PluginBadges item={item} />
          </span>
          {item.kind === 'skill' && description && (
            <span className="block truncate text-xs text-muted-foreground" title={description}>
              {description}
            </span>
          )}
          <span className="block truncate text-xs text-muted-foreground" data-testid="plugin-subtitle">
            {pluginSubtitle(item, t)}
          </span>
        </span>
      </button>
      <PluginMenu item={item} />
    </li>
  )
}

