import {
  CodeXml,
  CornerDownLeft,
  Ellipsis,
  MessageCircle,
  MessageCirclePlus,
  Search,
  Shapes,
  SquareTerminal,
  X,
  type LucideIcon
} from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { snippetParts } from '@shared/search'
import type { Conversation } from '@shared/types'
import { api } from '@renderer/lib/api'
import { useSync, useSyncedState } from '@renderer/lib/sync'
import { cn } from '@renderer/lib/utils'
import { ARTIFACT_TYPE_ICON } from '@renderer/features/artifact-library/typeIcon'
import { useArtifacts } from '../artifacts/store'
import { useComposeText } from '../draft'
import { useChat } from '../store'
import {
  buildPalette,
  flatItems,
  itemKey,
  nextTab,
  PALETTE_TABS,
  previewText,
  timeBucket,
  type PaletteItem,
  type PaletteSection,
  type PaletteTab
} from './paletteResults'
import { usePalette } from './paletteStore'

/** Cửa sổ tìm kiếm nổi (Ctrl+K). Gắn luôn trong app; chỉ dựng khi mở (mở lại = ô nhập trống, tab Tất cả). */
export function SearchPalette() {
  const open = usePalette((s) => s.open)
  return open ? <PaletteDialog /> : null
}

type ItemAction = 'open' | 'openConversation' | 'pin' | 'unpin'
/** Đang xem gì trong vùng danh sách: kết quả / chọn loại ("/") / hành động của một dòng (Alt+Enter, nút ⋯). */
type View = { kind: 'list' } | { kind: 'filters' } | { kind: 'actions'; item: PaletteItem }

function actionsOf(item: PaletteItem): ItemAction[] {
  if (item.kind === 'conversation') return ['open', item.pinned ? 'unpin' : 'pin']
  if (item.kind === 'artifact') return ['open', 'openConversation']
  return []
}

function PaletteDialog() {
  const { t, i18n } = useTranslation('chat')
  const { t: tArt } = useTranslation('artifactLibrary')
  const navigate = useNavigate()
  const tab = usePalette((s) => s.tab)
  const setTab = usePalette((s) => s.setTab)
  const close = usePalette((s) => s.close)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 120)
    return () => clearTimeout(id)
  }, [query])

  // Cuộc trò chuyện: main lọc theo FTS (tiêu đề / tên nhóm / nội dung + trích đoạn). Câu trả lời cũ về muộn bị bỏ.
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const queryRef = useRef('')
  const seq = useRef(0)
  const loadConversations = useCallback(async () => {
    const n = ++seq.current
    const result = await api.conversations.list(queryRef.current.trim() || undefined)
    if (n === seq.current) setConversations(result)
  }, [])
  useSync('conversations', loadConversations)
  useEffect(() => {
    queryRef.current = debounced
    void loadConversations()
  }, [debounced, loadConversations])
  // Tên cuộc trò chuyện chứa artifact đổi cũng phải hiện ngay.
  const { data: artifacts } = useSyncedState(['artifacts', 'conversations'], () => api.artifacts.listAll())

  const sections = useMemo<PaletteSection[]>(
    () =>
      conversations && artifacts
        ? buildPalette({ tab, query: debounced, conversations, artifacts })
        : [],
    [tab, debounced, conversations, artifacts]
  )
  const items = useMemo(() => flatItems(sections), [sections])
  const loading = conversations === null || artifacts === null

  const [view, setView] = useState<View>({ kind: 'list' })
  // Dòng đang chọn gắn với (tab, chữ tìm): đổi một trong hai → về dòng đầu.
  const selKey = `${tab}|${debounced}`
  const [selState, setSelState] = useState({ key: selKey, index: 0 })
  const sel = selState.key === selKey ? selState.index : 0
  const setSel = (index: number): void => setSelState({ key: selKey, index })
  const rows: number =
    view.kind === 'list' ? items.length : view.kind === 'filters' ? PALETTE_TABS.length : actionsOf(view.item).length
  const selIndex = Math.min(sel, Math.max(0, rows - 1))
  const selected = view.kind === 'list' ? items[selIndex] : undefined
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selIndex, view])

  // ---- Mở / hành động ----
  const go = async (conversationId: string | null): Promise<void> => {
    await useChat.getState().select(conversationId)
    void navigate('/')
  }
  const run = (item: PaletteItem, action: ItemAction = 'open'): void => {
    close()
    if (item.kind === 'action') {
      // Cuộc mới chưa tạo ngay (như nút "Mới"); Code → chế độ Code.
      useComposeText.getState().put({ mode: item.id === 'new-code' ? 'code' : 'free' })
      void go(null)
      return
    }
    if (item.kind === 'conversation') {
      if (action === 'pin' || action === 'unpin') void useChat.getState().togglePin(item.id)
      else void go(item.id)
      return
    }
    void (async () => {
      await go(item.conversationId)
      if (action === 'open') await useArtifacts.getState().openIn(item.conversationId, item.id)
    })()
  }
  /** Tab = "Soạn": chữ đang gõ thành tin nhắn mới (chưa gửi) trong cuộc trò chuyện mới. */
  const compose = (): void => {
    close()
    useComposeText.getState().put({ text: query.trim() || null })
    void go(null)
  }
  const pickTab = (next: PaletteTab): void => {
    setTab(next)
    setView({ kind: 'list' })
    input.current?.focus()
  }
  const activate = (index = selIndex): void => {
    if (view.kind === 'filters') return pickTab(PALETTE_TABS[index])
    if (view.kind === 'actions') return run(view.item, actionsOf(view.item)[index])
    const item = items[index]
    if (item) run(item)
  }
  const openActions = (item: PaletteItem): void => {
    if (actionsOf(item).length === 0) return
    setView({ kind: 'actions', item })
    setSel(0)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const el = input.current
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault()
        if (rows === 0) return
        const step = e.key === 'ArrowDown' ? 1 : -1
        setSel((selIndex + step + rows) % rows)
        return
      }
      case 'Enter':
        e.preventDefault()
        if (e.altKey && view.kind === 'list' && selected) return openActions(selected)
        return activate()
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (view.kind !== 'list') return
        // Đang gõ dở giữa chữ thì ← → vẫn di chuyển con trỏ; ở đầu / cuối ô (hoặc ô trống) mới đổi loại.
        const atEdge =
          !el || el.value === '' || (e.key === 'ArrowLeft' ? el.selectionStart === 0 && el.selectionEnd === 0 : el.selectionStart === el.value.length)
        if (!atEdge || e.shiftKey || e.ctrlKey || e.altKey) return
        e.preventDefault()
        setTab(nextTab(tab, e.key === 'ArrowRight' ? 1 : -1))
        return
      }
      case '/':
        if (query !== '' || view.kind !== 'list') return
        e.preventDefault()
        setView({ kind: 'filters' })
        setSel(PALETTE_TABS.indexOf(tab))
        return
      case 'Tab':
        e.preventDefault()
        compose()
        return
    }
  }

  // Cửa sổ chỉ mở trong chốc lát → lấy mốc "bây giờ" một lần lúc mở.
  const [now] = useState(() => Date.now())
  const tabLabel = (k: PaletteTab): string => t(`palette.tabs.${k}`)
  const timeLabel = (ts: number): string => {
    const b = timeBucket(ts, now)
    if (b !== 'older') return t(`palette.time.${b}`)
    return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(ts)
  }
  const itemTitle = (item: PaletteItem): string =>
    item.kind === 'action' ? t(`palette.actions.${item.id}`) : item.title || t('untitled')

  // ---- Vùng danh sách ----
  let body: ReactNode
  if (view.kind === 'filters') {
    body = (
      <Group label={t('palette.sections.filters')}>
        {PALETTE_TABS.map((k, i) => (
          <Row key={k} selected={i === selIndex} onHover={() => setSel(i)} onClick={() => activate(i)} testId="palette-filter" icon={Search} title={tabLabel(k)} />
        ))}
      </Group>
    )
  } else if (view.kind === 'actions') {
    body = (
      <Group label={t('palette.sections.itemActions', { title: itemTitle(view.item) })}>
        {actionsOf(view.item).map((a, i) => (
          <Row
            key={a}
            selected={i === selIndex}
            onHover={() => setSel(i)}
            onClick={() => activate(i)}
            testId="palette-action"
            icon={a === 'openConversation' ? MessageCircle : CornerDownLeft}
            title={t(`palette.actions.${a}`)}
          />
        ))}
      </Group>
    )
  } else if (loading) {
    body = null
  } else if (items.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-3 py-8 text-center" data-testid="palette-empty">
        <p className="text-sm font-medium">
          {tab === 'all' ? t('palette.noResults') : t('palette.noResultsIn', { tab: tabLabel(tab) })}
        </p>
        {tab !== 'all' && (
          <button
            className="rounded-md bg-muted px-3 py-1.5 text-sm hover:bg-muted/70"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pickTab('all')}
            data-testid="palette-search-all"
          >
            {t('palette.searchAll')}
          </button>
        )}
      </div>
    )
  } else {
    let index = 0
    body = sections.map((s) => (
      <Group key={s.key} label={s.key === 'results' ? undefined : t(`palette.sections.${s.key}`)} testId={`palette-section-${s.key}`}>
        {s.items.map((item) => {
          const i = index++
          const isSel = i === selIndex
          return (
            <Row
              key={itemKey(item)}
              selected={isSel}
              onHover={() => setSel(i)}
              onClick={() => activate(i)}
              testId="palette-item"
              kind={item.kind}
              icon={iconOf(item)}
              title={itemTitle(item)}
              suffix={item.kind === 'artifact' ? tArt(`types.${item.type}`) : undefined}
              snippet={item.kind === 'conversation' ? item.snippet : null}
              right={item.kind === 'action' ? undefined : timeLabel(item.updatedAt)}
              onMore={actionsOf(item).length > 0 ? () => openActions(item) : undefined}
              moreLabel={t('palette.more')}
            />
          )
        })}
      </Group>
    ))
  }

  const hasActions = view.kind === 'list' && !!selected && actionsOf(selected).length > 0

  return (
    <DialogPrimitive.Root open onOpenChange={(v) => !v && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[76vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 flex-col rounded-xl border bg-card shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            input.current?.focus()
          }}
          onEscapeKeyDown={(e) => {
            // Esc trong danh sách loại / hành động → về danh sách kết quả, chưa đóng cửa sổ.
            if (view.kind === 'list') return
            e.preventDefault()
            setView({ kind: 'list' })
            setSel(0)
          }}
          onKeyDown={onKeyDown}
          data-testid="search-palette"
          data-tab={tab}
        >
          <DialogPrimitive.Title className="sr-only">{t('palette.title')}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{t('palette.title')}</DialogPrimitive.Description>
          <div className="flex items-center gap-2 px-5 pt-4">
            <input
              ref={input}
              className="h-8 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              placeholder={t('palette.placeholder')}
              aria-label={t('palette.placeholder')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                if (view.kind !== 'list') setView({ kind: 'list' })
              }}
              data-testid="palette-input"
            />
            <DialogPrimitive.Close
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t('palette.close')}
              title={`${t('palette.close')} (Esc)`}
              data-testid="palette-close"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex flex-wrap gap-1 border-b px-4 pt-2 pb-3" role="tablist" aria-label={t('palette.title')}>
            {PALETTE_TABS.map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={k === tab}
                className={cn(
                  'rounded-md px-2.5 py-1 text-sm text-foreground/80 hover:bg-muted',
                  k === tab && 'bg-muted font-medium text-foreground'
                )}
                // Giữ con trỏ trong ô nhập (phím tắt vẫn chạy sau khi bấm tab).
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickTab(k)}
                data-testid={`palette-tab-${k}`}
              >
                {tabLabel(k)}
              </button>
            ))}
          </div>
          <div ref={list} className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2" role="listbox" aria-label={t('palette.title')} data-testid="palette-list">
            {body}
          </div>
          <Footer showActions={hasActions} />
          {view.kind === 'list' && selected?.kind === 'artifact' && <ArtifactPreview item={selected} when={timeLabel(selected.updatedAt)} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function iconOf(item: PaletteItem): LucideIcon {
  if (item.kind === 'action') return item.id === 'new-code' ? SquareTerminal : MessageCirclePlus
  if (item.kind === 'artifact') return ARTIFACT_TYPE_ICON[item.type] ?? Shapes
  return item.mode === 'code' ? CodeXml : MessageCircle
}

function Group({ label, testId, children }: { label?: string; testId?: string; children: ReactNode }) {
  return (
    <div className="pb-1" data-testid={testId}>
      {label && <div className="px-3 pt-2 pb-1 text-xs text-muted-foreground">{label}</div>}
      {children}
    </div>
  )
}

function Row({
  selected,
  onHover,
  onClick,
  testId,
  kind,
  icon: Icon,
  title,
  suffix,
  snippet,
  right,
  onMore,
  moreLabel
}: {
  selected: boolean
  onHover(): void
  onClick(): void
  testId: string
  kind?: string
  icon: LucideIcon
  title: string
  suffix?: string
  snippet?: string | null
  right?: string
  onMore?: () => void
  moreLabel?: string
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      className={cn('flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm', selected && 'bg-muted')}
      // Chỉ đổi dòng chọn khi chuột thật sự di chuyển (cuộn bằng phím không bị dòng dưới con trỏ "cướp" chọn).
      onMouseMove={selected ? undefined : onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      data-testid={testId}
      data-kind={kind}
      data-title={title}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          {title}
          {suffix && <span className="text-muted-foreground"> · {suffix}</span>}
        </span>
        {snippet && (
          <span className="block truncate text-xs text-muted-foreground" data-testid="search-snippet">
            {snippetParts(snippet).map((p, i) =>
              p.hit ? (
                <strong key={i} className="font-semibold text-foreground">
                  {p.text}
                </strong>
              ) : (
                <span key={i}>{p.text}</span>
              )
            )}
          </span>
        )}
      </span>
      {selected ? (
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {onMore && (
            <button
              className="rounded p-0.5 hover:bg-background/60 hover:text-foreground"
              title={moreLabel}
              aria-label={moreLabel}
              onClick={(e) => {
                e.stopPropagation()
                onMore()
              }}
              data-testid="palette-more"
            >
              <Ellipsis className="size-4" />
            </button>
          )}
          <CornerDownLeft className="size-4" />
        </span>
      ) : (
        right && <span className="shrink-0 text-xs text-muted-foreground">{right}</span>
      )}
    </div>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-sans text-[11px] text-muted-foreground">{children}</kbd>
}

function Footer({ showActions }: { showActions: boolean }) {
  const { t } = useTranslation('chat')
  const hint = (label: string, keys: ReactNode, testId?: string) => (
    <span className="flex items-center gap-1.5" data-testid={testId}>
      {label}
      <span className="flex gap-0.5">{keys}</span>
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-5 py-2.5 text-xs text-muted-foreground">
      {hint(t('palette.hints.close'), <Kbd>Esc</Kbd>)}
      {hint(
        t('palette.hints.changeType'),
        <>
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
        </>
      )}
      {hint(t('palette.hints.filters'), <Kbd>/</Kbd>)}
      {showActions &&
        hint(
          t('palette.hints.actions'),
          <>
            <Kbd>Alt</Kbd>
            <Kbd>↵</Kbd>
          </>,
          'palette-hint-actions'
        )}
      <span className="ml-auto">{hint(t('palette.hints.compose'), <Kbd>Tab</Kbd>)}</span>
    </div>
  )
}

/** Khung xem trước nhỏ bên phải cửa sổ (chỉ khi đủ chỗ): tên, chữ đầu của artifact, loại · thời gian. */
function ArtifactPreview({ item, when }: { item: Extract<PaletteItem, { kind: 'artifact' }>; when: string }) {
  const { t } = useTranslation('chat')
  const { t: tArt } = useTranslation('artifactLibrary')
  const [loaded, setLoaded] = useState<{ id: string; text: string } | null>(null)
  const text = loaded?.id === item.id ? loaded.text : null
  useEffect(() => {
    let alive = true
    // Chờ một chút: ↑ ↓ lướt nhanh qua nhiều dòng không gọi IPC cho từng dòng.
    const timer = setTimeout(() => {
      void api.artifacts.content(item.id).then((r) => {
        if (alive) setLoaded({ id: item.id, text: r ? previewText(item.type, r.version.content) : '' })
      })
    }, 80)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [item.id, item.type])
  return (
    <div
      className="pointer-events-none absolute top-24 left-full ml-3 hidden w-72 rounded-xl border bg-card p-2 shadow-2xl min-[1250px]:block"
      data-testid="palette-preview"
    >
      <div className="h-44 overflow-hidden rounded-lg border bg-background px-3 py-2.5">
        <div className="truncate text-sm font-semibold">{item.title}</div>
        <p className="mt-1.5 text-[11px] leading-snug whitespace-pre-line text-muted-foreground" data-testid="palette-preview-text">
          {text === null ? t('palette.previewLoading') : text || t('palette.previewEmpty')}
        </p>
      </div>
      <div className="px-1 pt-1.5 text-xs text-muted-foreground">
        {tArt(`types.${item.type}`)} · {when}
      </div>
    </div>
  )
}
