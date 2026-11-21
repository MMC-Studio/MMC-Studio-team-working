import {
  ChevronDown,
  ChevronRight,
  Clock,
  FolderInput,
  FolderKanban,
  FolderPlus,
  GitBranch,
  Pencil,
  Pin,
  PinOff,
  Plug,
  Plus,
  Search,
  Shapes,
  Sparkles,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { useMemo, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import type { Conversation, ConversationGroup } from '@shared/types'
import { GROUP_NAME_MAX } from '@shared/schemas'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { AssistantAvatar } from '@renderer/components/AssistantAvatar'
import { cn } from '@renderer/lib/utils'
import { useAuth } from '@renderer/stores/auth'
import { usePreferences } from '@renderer/stores/preferences'
import { SidebarToggle } from '../layout/ChatLayout'
import { useSidebar, type SidebarSectionKey } from '../layout/sidebarStore'
import { usePalette } from '../search/paletteStore'
import type { Project } from '@shared/projects'
import { ProjectMenu } from '@renderer/features/projects/components/ProjectMenu'
import { useProjects } from '@renderer/features/projects/store'
import { pinnedProjects, PROJECTS_ROUTE, projectPath } from '@renderer/features/projects/view'
import { PLUGINS_ROUTE } from '@renderer/features/plugins/model'
import { useSchedules } from '@renderer/features/schedules/store'
import { SCHEDULES_ROUTE } from '@renderer/features/schedules/view'
import { buildSidebar, DRAG_TYPE, type SidebarRow, type SidebarSection } from '../sidebarTree'
import { useChat } from '../store'

type Drop = { kind: 'pinned' } | { kind: 'group'; groupId: string } | { kind: 'recent' }
const dropKey = (d: Drop): string => (d.kind === 'group' ? `group:${d.groupId}` : d.kind)
const hasConversation = (e: DragEvent): boolean => e.dataTransfer.types.includes(DRAG_TYPE)

/** `variant="overlay"`: thanh bên nổi (đè lên nội dung khi thanh bên đang ẩn / thiếu chỗ). */
export function ConversationSidebar({ variant }: { variant?: 'overlay' } = {}) {
  const { t } = useTranslation('chat')
  const {
    conversations,
    groups,
    activeId,
    streaming,
    select,
    togglePin,
    rename,
    remove,
    moveTo,
    createGroup,
    renameGroup,
    toggleGroup,
    removeGroup
  } = useChat()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const paletteOpen = usePalette((s) => s.open)
  const showPalette = usePalette((s) => s.show)
  const sectionCollapsed = useSidebar((s) => s.collapsed)
  const toggleSection = useSidebar((s) => s.toggleSection)
  const setOverlay = useSidebar((s) => s.setOverlay)
  const [renaming, setRenaming] = useState<Conversation | null>(null)
  const [deleting, setDeleting] = useState<Conversation | null>(null)
  const [moving, setMoving] = useState<Conversation | null>(null)
  /** Hộp tên nhóm: tạo mới (group = null) hoặc đổi tên. */
  const [groupDialog, setGroupDialog] = useState<{ group: ConversationGroup | null; error: string | null } | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<ConversationGroup | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const projects = useProjects((s) => s.projects)
  // Lịch hẹn: số lần chạy chưa xem (chỉ khi tính năng bật).
  const scheduleUnseen = useSchedules((s) => (s.status?.settings.enabled ? s.status.unseen : 0))
  const pinnedProj = useMemo(() => pinnedProjects(projects), [projects])
  // Dự án ghim nằm đầu mục "Đã ghim" — mục này hiện cả khi chưa ghim cuộc trò chuyện nào.
  const sections = useMemo(() => {
    const built = buildSidebar(conversations, groups)
    return pinnedProj.length && !built.some((s) => s.kind === 'pinned')
      ? [{ kind: 'pinned' as const, rows: [] }, ...built]
      : built
  }, [conversations, groups, pinnedProj.length])
  const groupName = (id: string | null): string | undefined => groups.find((g) => g.id === id)?.name

  // ---- Kéo thả ----
  const dropProps = (target: Drop) => ({
    onDragOver: (e: DragEvent) => {
      if (!hasConversation(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (over !== dropKey(target)) setOver(dropKey(target))
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
    },
    onDrop: (e: DragEvent) => {
      if (!hasConversation(e)) return
      e.preventDefault()
      setOver(null)
      const id = e.dataTransfer.getData(DRAG_TYPE)
      const conv = conversations.find((c) => c.id === id)
      if (!conv) return
      // Thả vào Đã ghim → ghim (giữ nhóm); vào nhóm / chưa xếp nhóm → chuyển + bỏ ghim để thấy ngay ở đó.
      if (target.kind === 'pinned') {
        if (!conv.pinned) void togglePin(id)
      } else void moveTo(id, { groupId: target.kind === 'group' ? target.groupId : null, pinned: false })
    },
    'data-drop-over': over === dropKey(target) ? 'true' : undefined
  })

  const renderRow = ({ conversation: c, depth }: SidebarRow) => (
    <li key={c.id} style={{ paddingLeft: depth * 12 }}>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-muted',
          c.id === activeId && 'bg-muted font-medium'
        )}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, c.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        data-testid="conversation-item"
        data-title={c.title}
      >
        <button
          className="flex min-w-0 flex-1 flex-col px-2.5 py-2 text-left"
          onClick={() => {
            void select(c.id)
            // Thanh bên nổi: chọn xong thì đóng lại (trả chỗ cho khung chat).
            if (variant === 'overlay') setOverlay('none')
            if (pathname !== '/') void navigate('/')
          }}
          title={c.title || t('untitled')}
        >
          <span className="flex w-full min-w-0 items-center gap-1.5">
            {streaming[c.id] && <span className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />}
            {c.projectId && (
              <FolderKanban className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('sidebar.inProject')} />
            )}
            {c.parentId && (
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('organize.fork')} />
            )}
            <span className="truncate">{c.title || t('untitled')}</span>
            {c.suggestedGroupId && (
              <Sparkles
                className="size-3 shrink-0 text-primary"
                aria-label={t('organize.suggestedBadge', { group: groupName(c.suggestedGroupId) })}
              />
            )}
          </span>
        </button>
        <div className="hidden shrink-0 group-hover:flex">
          <Button variant="ghost" size="icon-sm" title={c.pinned ? t('unpin') : t('pin')} onClick={() => void togglePin(c.id)}>
            {c.pinned ? <PinOff /> : <Pin />}
          </Button>
          <Button variant="ghost" size="icon-sm" title={t('organize.moveTo')} onClick={() => setMoving(c)}>
            <FolderInput />
          </Button>
          <Button variant="ghost" size="icon-sm" title={t('common:actions.rename')} onClick={() => setRenaming(c)}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon-sm" title={t('common:actions.delete')} onClick={() => setDeleting(c)}>
            <Trash2 />
          </Button>
        </div>
      </div>
    </li>
  )

  const zone = (target: Drop, children: ReactNode, testId: string, extra?: Record<string, string>) => (
    <div
      {...dropProps(target)}
      {...extra}
      data-testid={testId}
      className="rounded-md data-[drop-over=true]:bg-primary/10 data-[drop-over=true]:ring-1 data-[drop-over=true]:ring-primary/40"
    >
      {children}
    </div>
  )

  /** Tiêu đề mục (Đã ghim / Gần đây): bấm để thu gọn / mở — lưu trên máy này. */
  const sectionHeader = (key: SidebarSectionKey, label: string) => {
    const collapsed = sectionCollapsed[key]
    return (
      <button
        className="flex w-full items-center gap-1 px-2.5 pt-3 pb-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => toggleSection(key)}
        aria-expanded={!collapsed}
        data-testid={`section-toggle-${key}`}
      >
        <span>{label}</span>
        {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>
    )
  }

  /** Dự án ghim: bấm → trang dự án; ⋯ khi rê chuột (đổi tên, bỏ ghim, xoá). */
  const renderProjectRow = (p: Project) => {
    const path = projectPath(p.id)
    return (
      <li key={`project:${p.id}`}>
        <div
          className={cn('group flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-muted', pathname === path && 'bg-muted font-medium')}
          data-testid="pinned-project"
          data-name={p.name}
        >
          <button
            className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
            onClick={() => {
              if (variant === 'overlay') setOverlay('none')
              void navigate(path)
            }}
            title={p.name}
          >
            <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{p.name}</span>
          </button>
          <ProjectMenu
            project={p}
            onDeleted={() => pathname === path && void navigate(PROJECTS_ROUTE)}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          />
        </div>
      </li>
    )
  }

  const renderSection = (s: SidebarSection) => {
    if (s.kind === 'pinned')
      return zone(
        { kind: 'pinned' },
        <>
          {sectionHeader('pinned', t('pinned'))}
          {!sectionCollapsed.pinned && (
            <ul>
              {pinnedProj.map(renderProjectRow)}
              {s.rows.map(renderRow)}
            </ul>
          )}
        </>,
        'section-pinned'
      )
    if (s.kind === 'recent')
      return zone(
        { kind: 'recent' },
        <>
          {sectionHeader('recent', groups.length ? t('organize.ungrouped') : t('recent'))}
          {!sectionCollapsed.recent && <ul>{s.rows.map(renderRow)}</ul>}
        </>,
        'section-recent'
      )
    const g = s.group
    return zone(
      { kind: 'group', groupId: g.id },
      <>
        <div className="group flex items-center gap-1 pt-2 pr-1">
          <button
            className="flex min-w-0 flex-1 items-center gap-1 px-2.5 py-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => void toggleGroup(g.id)}
            aria-expanded={!s.collapsed}
            data-testid="group-toggle"
          >
            {/* Như ảnh mẫu: tên nhóm rồi mới tới mũi tên (giống Đã ghim / Gần đây). */}
            <span className="truncate">{g.name}</span>
            {s.collapsed ? <ChevronRight className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
            <span className="shrink-0 tabular-nums opacity-70" data-testid="group-count">
              {s.count}
            </span>
          </button>
          <div className="hidden shrink-0 group-hover:flex">
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('organize.renameGroup')}
              onClick={() => setGroupDialog({ group: g, error: null })}
            >
              <Pencil />
            </Button>
            <Button variant="ghost" size="icon-sm" title={t('organize.deleteGroup')} onClick={() => setDeletingGroup(g)}>
              <Trash2 />
            </Button>
          </div>
        </div>
        {!s.collapsed &&
          (s.rows.length ? (
            <ul>{s.rows.map(renderRow)}</ul>
          ) : (
            <p className="px-2.5 py-1.5 text-xs text-muted-foreground/70">{t('organize.emptyGroup')}</p>
          ))}
      </>,
      'group-section',
      { 'data-group': g.name }
    )
  }

  const onRename = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    const title = String(new FormData(e.currentTarget).get('title') ?? '').trim()
    if (renaming && title) void rename(renaming.id, title)
    setRenaming(null)
  }

  const onGroupSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!groupDialog) return
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim()
    if (!name) return
    const target = groupDialog.group
    setGroupDialog(null)
    const error = target ? await renameGroup(target.id, name) : await createGroup(name)
    // Trùng tên → mở lại hộp kèm lỗi (đã hoàn tác trên thanh bên).
    if (error) setGroupDialog({ group: target, error })
  }

  const hasAny = sections.length > 0

  return (
    // Độ rộng do ChatLayout quyết định (kéo đổi được); thanh bên nổi có viền phải rõ hơn.
    <aside className="flex h-full w-full flex-col border-r bg-sidebar" data-testid="chat-sidebar" data-variant={variant ?? 'inline'}>
      <div className="flex items-center justify-between px-2 pt-2">
        <SidebarToggle variant={variant} />
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('organize.newGroup')}
          aria-label={t('organize.newGroup')}
          onClick={() => setGroupDialog({ group: null, error: null })}
          data-testid="new-group"
        >
          <FolderPlus />
        </Button>
      </div>

      {/* Điều hướng luôn hiện (không cuộn theo danh sách). */}
      <div className="space-y-0.5 px-2 pt-1 pb-2" role="navigation" aria-label={t('sidebar.navLabel')}>
        <SidebarItem
          icon={Plus}
          label={t('newChat')}
          active={pathname === '/' && !activeId && !paletteOpen}
          onClick={() => {
            void select(null)
            if (pathname !== '/') void navigate('/')
          }}
          testId="nav-new"
        />
        <SidebarItem
          icon={Search}
          label={t('sidebar.search')}
          title={t('sidebar.searchHint')}
          active={paletteOpen}
          onClick={() => showPalette()}
          testId="nav-search"
        />
        <SidebarItem
          icon={FolderKanban}
          label={t('sidebar.projects')}
          active={pathname.startsWith(PROJECTS_ROUTE)}
          onClick={() => void navigate(PROJECTS_ROUTE)}
          testId="nav-projects"
        />
        <SidebarItem
          icon={Shapes}
          label={t('sidebar.artifacts')}
          active={pathname === '/artifacts'}
          onClick={() => void navigate('/artifacts')}
          testId="nav-artifacts"
        />
        <SidebarItem
          icon={Clock}
          label={t('sidebar.scheduled')}
          active={pathname.startsWith(SCHEDULES_ROUTE)}
          onClick={() => void navigate(SCHEDULES_ROUTE)}
          badge={scheduleUnseen}
          badgeLabel={t('sidebar.scheduledUnseen', { count: scheduleUnseen })}
          testId="nav-scheduled"
        />
        <SidebarItem
          icon={Plug}
          label={t('sidebar.plugins')}
          active={pathname.startsWith(PLUGINS_ROUTE)}
          onClick={() => void navigate(PLUGINS_ROUTE)}
          testId="nav-plugins"
        />
      </div>

      <nav className="thin-scroll min-h-0 flex-1 space-y-1 overflow-y-auto border-t px-2 pb-3" aria-label={t('sidebar.listLabel')} data-testid="sidebar-list">
        {!hasAny && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {t('noConversations')}
          </p>
        )}
        {sections.map((s) => (
          <div key={s.kind === 'group' ? s.group.id : s.kind}>{renderSection(s)}</div>
        ))}
        {/* Luôn có chỗ thả "bỏ khỏi nhóm" khi chưa có cuộc nào ngoài nhóm. */}
        {groups.length > 0 &&
          !sections.some((s) => s.kind === 'recent') &&
          zone(
            { kind: 'recent' },
            <p className="px-2.5 py-2 text-xs text-muted-foreground/70">{t('organize.dropUngroup')}</p>,
            'section-recent'
          )}
      </nav>

      <SidebarFooter />

      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent title={t('renameTitle')}>
          <form onSubmit={onRename} className="space-y-4">
            <Input name="title" defaultValue={renaming?.title} maxLength={120} autoFocus />
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">{t('common:actions.cancel')}</Button>
              </DialogClose>
              <Button type="submit">{t('common:actions.save')}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!groupDialog} onOpenChange={(open) => !open && setGroupDialog(null)}>
        <DialogContent title={groupDialog?.group ? t('organize.renameGroup') : t('organize.newGroup')}>
          <form onSubmit={(e) => void onGroupSubmit(e)} className="space-y-4">
            <Input
              name="name"
              defaultValue={groupDialog?.group?.name}
              placeholder={t('organize.groupPlaceholder')}
              maxLength={GROUP_NAME_MAX}
              aria-label={t('organize.groupName')}
              autoFocus
            />
            {groupDialog?.error && (
              <p className="text-sm text-destructive" role="alert">
                {t(`organize.errors.${groupDialog.error}`, { defaultValue: t('common:errors.generic', { message: groupDialog.error }) })}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">{t('common:actions.cancel')}</Button>
              </DialogClose>
              <Button type="submit">{t('common:actions.save')}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!moving} onOpenChange={(open) => !open && setMoving(null)}>
        <DialogContent title={t('organize.moveTitle', { title: moving?.title || t('untitled') })}>
          <div className="grid gap-1.5">
            {groups.length === 0 && <p className="text-sm text-muted-foreground">{t('organize.noGroups')}</p>}
            {groups.map((g) => (
              <Button
                key={g.id}
                variant={moving?.groupId === g.id ? 'default' : 'outline'}
                className="justify-start"
                onClick={() => {
                  if (moving) void moveTo(moving.id, { groupId: g.id })
                  setMoving(null)
                }}
              >
                <FolderInput />
                {g.name}
              </Button>
            ))}
            {moving?.groupId && (
              <Button
                variant="ghost"
                className="justify-start"
                onClick={() => {
                  if (moving) void moveTo(moving.id, { groupId: null })
                  setMoving(null)
                }}
              >
                {t('organize.removeFromGroup')}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent
          title={t('deleteTitle')}
          description={t('deleteDescription', { title: deleting?.title || t('untitled') })}
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) void remove(deleting.id)
                setDeleting(null)
              }}
            >
              {t('common:actions.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletingGroup} onOpenChange={(open) => !open && setDeletingGroup(null)}>
        <DialogContent
          title={t('organize.deleteGroup')}
          description={t('organize.deleteGroupDescription', { name: deletingGroup?.name ?? '' })}
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (deletingGroup) void removeGroup(deletingGroup.id)
                setDeletingGroup(null)
              }}
            >
              {t('organize.deleteGroupConfirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  )
}

/** Một mục điều hướng trên đầu thanh bên (Mới, Tìm kiếm, Dự án…). Mục đang mở được tô nền. */
function SidebarItem({
  icon: Icon,
  label,
  active,
  onClick,
  testId,
  title,
  badge = 0,
  badgeLabel
}: {
  icon: LucideIcon
  label: string
  title?: string
  active: boolean
  onClick(): void
  testId: string
  /** Số nhỏ bên phải (vd lần chạy lịch hẹn chưa xem); 0 = ẩn. */
  badge?: number
  badgeLabel?: string
}) {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-foreground/90 hover:bg-muted',
        active && 'bg-muted font-medium text-foreground'
      )}
      aria-current={active ? 'page' : undefined}
      title={title}
      onClick={onClick}
      data-testid={testId}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
      {badge > 0 && (
        <span
          className="ml-auto rounded-full bg-primary px-1.5 text-[11px] leading-[18px] font-medium text-primary-foreground"
          aria-label={badgeLabel}
          data-testid={`${testId}-badge`}
        >
          {badge}
        </span>
      )}
    </button>
  )
}

/** Đáy thanh bên: tên trợ lý + tài khoản đang dùng (cài đặt / đổi tài khoản vẫn ở thanh biểu tượng bên trái). */
function SidebarFooter() {
  const { t } = useTranslation('chat')
  const assistant = usePreferences((s) => s.assistant)
  const account = useAuth((s) => {
    if (s.status !== 'signed_in' || !s.session) return null
    const id = s.session.user.id
    const me = s.accounts.find((a) => a.id === id)
    return me ? me.name || me.login : (s.session.user.email ?? null)
  })
  return (
    <div className="flex items-center gap-2.5 border-t px-3 py-2.5" data-testid="sidebar-footer">
      <AssistantAvatar avatar={assistant.avatar} className="size-7 shrink-0 text-base" />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-medium">{assistant.name}</div>
        <div className="truncate text-xs text-muted-foreground">{account ?? t('sidebar.localAccount')}</div>
      </div>
    </div>
  )
}
