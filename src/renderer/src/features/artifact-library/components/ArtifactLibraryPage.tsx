import { ChartBar, FileCode2, FileText, GitFork, Presentation, Search, Shapes, Table2, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { ArtifactType } from '@shared/artifacts'
import { Input } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { useSyncedState } from '@renderer/lib/sync'
import { useArtifacts } from '@renderer/features/chat/artifacts/store'
import { ChatLayout, SidebarToggle } from '@renderer/features/chat/layout/ChatLayout'
import { useChat } from '@renderer/features/chat/store'
import { filterArtifacts } from '../filter'

const TYPE_ICON: Record<ArtifactType, LucideIcon> = {
  doc: FileText,
  slides: Presentation,
  sheet: Table2,
  chart: ChartBar,
  mermaid: GitFork,
  html: FileCode2
}

/** Trang Artifacts: mọi artifact của mọi cuộc trò chuyện; bấm → mở cuộc trò chuyện chứa nó + panel artifact. */
export function ArtifactLibraryPage() {
  const { t, i18n } = useTranslation('artifactLibrary')
  const navigate = useNavigate()
  // Tên cuộc trò chuyện đổi (AI đặt tiêu đề, người dùng đổi tên) cũng phải hiện ngay.
  const { data } = useSyncedState(['artifacts', 'conversations'], () => api.artifacts.listAll())
  const [query, setQuery] = useState('')
  const list = useMemo(() => filterArtifacts(data ?? [], query), [data, query])
  const time = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language]
  )

  const open = async (conversationId: string, id: string): Promise<void> => {
    await useChat.getState().select(conversationId)
    await useArtifacts.getState().openIn(conversationId, id)
    void navigate('/')
  }

  return (
    <ChatLayout>
      <section className="flex min-w-0 flex-1 flex-col" data-testid="artifact-library">
        <header className="flex min-h-11 items-center gap-2 border-b px-4 py-1.5">
          <SidebarToggle when="hidden" />
          <h1 className="text-sm font-medium">{t('title')}</h1>
        </header>
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={t('filter')}
                aria-label={t('filter')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {data === null ? null : list.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground" data-testid="artifact-library-empty">
                <Shapes className="size-8 opacity-60" />
                <p>{data.length === 0 ? t('empty') : t('noMatch')}</p>
              </div>
            ) : (
              <ul className="divide-y rounded-lg border" data-testid="artifact-library-list">
                {list.map((a) => {
                  const Icon = TYPE_ICON[a.type] ?? Shapes
                  return (
                    <li key={a.id}>
                      <button
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted"
                        onClick={() => void open(a.conversationId, a.id)}
                        data-testid="artifact-library-item"
                        data-title={a.title}
                      >
                        <Icon className="size-5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{a.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {t(`types.${a.type}`)} · {a.conversationTitle || t('untitled')}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{time.format(a.updatedAt)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </section>
    </ChatLayout>
  )
}
