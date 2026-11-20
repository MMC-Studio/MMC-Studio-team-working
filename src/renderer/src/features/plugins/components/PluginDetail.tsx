import { ChevronRight, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import type { SkillDetail } from '@shared/skills'
import { api } from '@renderer/lib/api'
import { ChatLayout, SidebarToggle } from '@renderer/features/chat/layout/ChatLayout'
import { AgentsPanel } from '@renderer/features/agents/components/AgentsPanel'
import { McpServersSection } from '@renderer/features/agents/components/McpServersSection'
import { GmailSection } from '@renderer/features/connectors/components/GmailSection'
import { TelegramSection } from '@renderer/features/connectors/components/TelegramSection'
import { useConnectors } from '@renderer/features/connectors/store'
import { pluginDescription, pluginName, pluginSubtitle } from '../labels'
import { PLUGINS_ROUTE, type PluginItem } from '../model'
import { useSkills } from '../store'
import { usePlugins } from '../usePlugins'
import { PluginMenu } from './PluginMenu'
import { PluginBadges, PluginIcon } from './PluginsPage'
import { SkillBody, ThemeSwatches } from './skillParts'

/** Khung trang chi tiết: "Plugin › Tên", biểu tượng + trạng thái + menu ⋯ (công tắc duy nhất), rồi phần cấu hình. */
function DetailLayout({ item, title, experimental, children }: { item?: PluginItem; title: string; experimental?: boolean; children: ReactNode }) {
  const { t } = useTranslation('plugins')
  return (
    <ChatLayout>
      <section className="thin-scroll flex min-w-0 flex-1 flex-col overflow-y-auto" data-testid="plugin-detail">
        <div className="flex min-h-11 items-center gap-1 px-4 py-1.5 text-sm text-muted-foreground">
          <SidebarToggle when="hidden" />
          <Link to={PLUGINS_ROUTE} className="hover:text-foreground" data-testid="plugin-breadcrumb">
            {t('detail.back')}
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="truncate text-foreground">{title}</span>
        </div>
        <div className="mx-auto w-full max-w-3xl space-y-5 px-6 pt-4 pb-12 sm:px-10">
          <div className="flex items-start gap-3">
            {item && <PluginIcon item={item} className="size-11" />}
            <div className="min-w-0 flex-1">
              <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold" data-testid="plugin-detail-name">
                {title}
                {experimental && (
                  <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-xs font-semibold text-orange-700 dark:text-orange-300">
                    {t('state.experimental')}
                  </span>
                )}
                {item && <PluginBadges item={item} />}
              </h1>
              {item && <p className="mt-1 text-sm text-muted-foreground">{pluginDescription(item, t)}</p>}
              {item && <p className="mt-0.5 text-xs text-muted-foreground">{pluginSubtitle(item, t)}</p>}
            </div>
            {item && (item.toggleable || item.removable) && <PluginMenu item={item} showSettings={false} />}
          </div>
          {children}
        </div>
      </section>
    </ChatLayout>
  )
}

function Privacy() {
  const { t } = useTranslation('connectors')
  const points = t('privacy.points', { returnObjects: true }) as string[]
  return (
    <section className="rounded-lg border bg-muted/30 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <ShieldCheck className="size-4 text-primary" />
        {t('privacy.title')}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </section>
  )
}

function NotFound() {
  const { t } = useTranslation('plugins')
  return (
    <DetailLayout title="—">
      <p className="py-10 text-center text-sm text-muted-foreground" data-testid="plugin-not-found">
        {t('detail.notFound')}
      </p>
    </DetailLayout>
  )
}

/** `/plugins/<gmail|telegram|agents|mcp|skill/<user|builtin>/<tên>>`. */
export function PluginDetail({ path }: { path: string[] }) {
  const { t } = useTranslation('plugins')
  const groups = usePlugins()
  const all = [...groups.yours, ...groups.suggestions, ...groups.builtin]
  const gmail = useConnectors((s) => s.gmail)
  const telegram = useConnectors((s) => s.telegram)
  const [params] = useSearchParams()
  const [type, source, rawName] = path

  if (type === 'gmail' || type === 'telegram' || type === 'agents') {
    const item = all.find((x) => x.type === type)
    if (!item) return null // đang tải
    return (
      <DetailLayout item={item} title={pluginName(item, t)} experimental>
        {type !== 'agents' && <Privacy />}
        {type === 'gmail' && gmail && <GmailSection key={gmail.clientId ?? ''} status={gmail} />}
        {type === 'telegram' && telegram && <TelegramSection key={String(telegram.apiId)} status={telegram} />}
        {type === 'agents' && <AgentsPanel />}
      </DetailLayout>
    )
  }

  if (type === 'mcp') {
    const items = new Map(all.filter((x) => x.type === 'mcp').map((x) => [x.key, x]))
    return (
      <DetailLayout title={t('kind.mcp')} experimental>
        <McpServersSection
          startAdding={params.get('add') === '1'}
          highlight={params.get('id') ?? undefined}
          renderMenu={(s) => {
            const item = items.get(`mcp:${s.id}`)
            return item ? <PluginMenu item={item} showSettings={false} /> : null
          }}
        />
      </DetailLayout>
    )
  }

  if (type === 'skill' && (source === 'user' || source === 'builtin') && rawName) {
    const name = decodeURIComponent(rawName)
    const item = all.find((x) => x.type === (source === 'user' ? 'skill' : 'builtinSkill') && x.name === name)
    return <SkillPage key={`${source}:${name}`} source={source} name={name} item={item} />
  }
  return <NotFound />
}

function SkillPage({ source, name, item }: { source: 'user' | 'builtin'; name: string; item?: PluginItem }) {
  const { t } = useTranslation(['plugins', 'settings'])
  const skills = useSkills((s) => s.skills)
  const [detail, setDetail] = useState<SkillDetail | null | undefined>(undefined)
  // Tải lại nội dung khi danh sách skill đổi (cài lại bản mới cùng tên…).
  useEffect(() => {
    let alive = true
    void api.skills
      .get(source, name)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail(null))
    return () => {
      alive = false
    }
  }, [source, name, skills])

  if (skills && !item) return <NotFound />
  if (!item) return null
  return (
    <DetailLayout item={item} title={name}>
      {detail && (
        <div className="space-y-3 text-sm" data-testid="skill-detail">
          {detail.origin && (
            <p className="break-all text-xs text-muted-foreground">
              {t('settings:skills.preview.origin')}: <code>{detail.origin}</code>
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t('settings:skills.howToCall')}</p>
          <SkillBody body={detail.body} />
          <ThemeSwatches themes={detail.themes} />
          <p className="text-xs text-muted-foreground">{t('plugins:detail.files', { files: detail.files.join(', ') })}</p>
        </div>
      )}
    </DetailLayout>
  )
}
