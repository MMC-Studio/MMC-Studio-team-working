import { ArrowDownUp, FolderKanban, Pin, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Button } from '@renderer/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@renderer/components/ui/menu'
import { cn } from '@renderer/lib/utils'
import { ChatLayout, SidebarToggle } from '@renderer/features/chat/layout/ChatLayout'
import { useProjects } from '../store'
import { PROJECT_SORTS, projectPath, viewProjects, type ProjectSort } from '../view'
import { ProjectFormDialog } from './ProjectDialogs'
import { ProjectMenu } from './ProjectMenu'

const SORT_KEY = 'mmc.projects.sort'
function readSort(): ProjectSort {
  try {
    const v = localStorage.getItem(SORT_KEY)
    return (PROJECT_SORTS as readonly string[]).includes(v ?? '') ? (v as ProjectSort) : 'updated'
  } catch {
    return 'updated'
  }
}

/** Trang Dự án: tìm (không dấu), sắp xếp (nhớ trên máy), lưới thẻ 2 cột, ghim, Dự án mới. */
export function ProjectsPage() {
  const { t, i18n } = useTranslation('projects')
  const navigate = useNavigate()
  const projects = useProjects((s) => s.projects)
  const loaded = useProjects((s) => s.loaded)
  const togglePin = useProjects((s) => s.togglePin)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [sort, setSortState] = useState<ProjectSort>(readSort)
  const [creating, setCreating] = useState(false)
  const list = useMemo(() => viewProjects(projects, sort, query), [projects, sort, query])
  const date = useMemo(() => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }), [i18n.language])

  const setSort = (s: ProjectSort): void => {
    setSortState(s)
    try {
      localStorage.setItem(SORT_KEY, s)
    } catch {
      // chỉ là cách xem — không lưu được thì thôi
    }
  }

  return (
    <ChatLayout>
      <section className="thin-scroll flex min-w-0 flex-1 flex-col overflow-y-auto" data-testid="projects-page">
        <div className="flex min-h-11 items-center px-4 py-1.5">
          <SidebarToggle when="hidden" />
        </div>
        <div className="mx-auto w-full max-w-4xl px-6 pb-10 sm:px-10">
          <header className="flex flex-wrap items-center gap-2 pt-4 pb-8">
            <h1 className="mr-auto text-3xl font-semibold tracking-tight">{t('title')}</h1>
            {searchOpen ? (
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
                <input
                  className="h-9 w-56 rounded-md border bg-transparent pr-8 pl-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  placeholder={t('search')}
                  aria-label={t('search')}
                  value={query}
                  autoFocus
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Escape') return
                    setQuery('')
                    setSearchOpen(false)
                  }}
                  data-testid="projects-search"
                />
                <button
                  className="absolute top-2 right-2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label={t('closeSearch')}
                  onClick={() => {
                    setQuery('')
                    setSearchOpen(false)
                  }}
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <Button variant="ghost" size="icon" title={t('search')} aria-label={t('search')} onClick={() => setSearchOpen(true)} data-testid="projects-search-open">
                <Search />
              </Button>
            )}
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="icon" title={`${t('sort')}: ${t(`sorts.${sort}`)}`} aria-label={t('sort')} data-testid="projects-sort">
                  <ArrowDownUp />
                </Button>
              </MenuTrigger>
              <MenuContent>
                {PROJECT_SORTS.map((s) => (
                  <MenuItem key={s} onSelect={() => setSort(s)} className={cn(s === sort && 'font-medium')} data-testid={`projects-sort-${s}`}>
                    {t(`sorts.${s}`)}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <Button variant="outline" onClick={() => setCreating(true)} data-testid="project-new">
              {t('new')}
            </Button>
          </header>

          {loaded && projects.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center" data-testid="projects-empty">
              <FolderKanban className="size-9 text-muted-foreground" />
              <p className="font-medium">{t('empty')}</p>
              <p className="max-w-md text-sm text-muted-foreground">{t('emptyHint')}</p>
              <Button onClick={() => setCreating(true)}>{t('new')}</Button>
            </div>
          ) : list.length === 0 && loaded ? (
            <p className="py-16 text-center text-sm text-muted-foreground">{t('noMatch')}</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2" data-testid="projects-grid">
              {list.map((p) => (
                <li key={p.id}>
                  <div
                    role="link"
                    tabIndex={0}
                    className="group flex cursor-pointer items-center gap-3 rounded-xl border bg-card px-4 py-3.5 hover:bg-muted/60"
                    onClick={() => void navigate(projectPath(p.id))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void navigate(projectPath(p.id))
                    }}
                    data-testid="project-card"
                    data-name={p.name}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <FolderKanban className="size-4 text-muted-foreground" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {date.format(p.updatedAt)}
                        {p.fileCount > 0 && ` · ${t('files', { count: p.fileCount })}`}
                      </span>
                    </span>
                    <button
                      className={cn(
                        'rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground',
                        !p.pinned && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                      )}
                      title={p.pinned ? t('unpin') : t('pin')}
                      aria-label={p.pinned ? t('unpin') : t('pin')}
                      aria-pressed={p.pinned}
                      onClick={(e) => {
                        e.stopPropagation()
                        void togglePin(p.id)
                      }}
                      data-testid="project-pin"
                    >
                      <Pin className={cn('size-4', p.pinned && 'fill-current text-foreground')} />
                    </button>
                    <ProjectMenu project={p} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <ProjectFormDialog open={creating} project={null} onClose={() => setCreating(false)} onSaved={(p) => void navigate(projectPath(p.id))} />
      </section>
    </ChatLayout>
  )
}
