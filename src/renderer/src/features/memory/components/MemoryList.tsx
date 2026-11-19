import { Check, ChevronDown, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { MEMORY_CATEGORIES, type MemoryCategory } from '@shared/schemas'
import type { Memory } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { Input, Select } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { groupMemories, MEMORIES_SHOWN, type MemoryGroup } from '../groupMemories'
import { useMemory } from '../store'
import { useCollapsed } from '../useCollapsed'

function CategorySelect({ value, onChange }: { value: MemoryCategory; onChange(v: MemoryCategory): void }) {
  const { t } = useTranslation('memory')
  return (
    <Select
      aria-label={t(`categories.${value}`)}
      className="w-40 shrink-0"
      value={value}
      onChange={(e) => onChange(e.target.value as MemoryCategory)}
    >
      {MEMORY_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {t(`categories.${c}`)}
        </option>
      ))}
    </Select>
  )
}

function MemoryRow({ memory }: { memory: Memory }) {
  const { t, i18n } = useTranslation('memory')
  const { update, remove } = useMemory()
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(memory.content)
  const [category, setCategory] = useState(memory.category)

  if (editing) {
    return (
      <li className="flex items-center gap-2 py-2">
        <Input value={content} maxLength={500} onChange={(e) => setContent(e.target.value)} autoFocus />
        <CategorySelect value={category} onChange={setCategory} />
        <Button
          size="icon-sm"
          title={t('common:actions.save')}
          disabled={!content.trim()}
          onClick={async () => {
            await update(memory.id, content.trim(), category)
            setEditing(false)
          }}
        >
          <Check />
        </Button>
        <Button size="icon-sm" variant="ghost" title={t('common:actions.cancel')} onClick={() => setEditing(false)}>
          <X />
        </Button>
      </li>
    )
  }

  return (
    <li className="group flex items-center gap-3 py-1" data-testid="memory-item">
      <div className="min-w-0 flex-1">
        <ClampedText text={memory.content} />
        {memory.lastUsedAt && (
          <p className="text-xs text-muted-foreground">
            {t('list.lastUsed', { date: new Date(memory.lastUsedAt).toLocaleDateString(i18n.language) })}
          </p>
        )}
      </div>
      <div className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <Button size="icon-sm" variant="ghost" title={t('list.edit')} onClick={() => setEditing(true)}>
          <Pencil />
        </Button>
        <Button size="icon-sm" variant="ghost" title={t('common:actions.delete')} onClick={() => void remove(memory.id)}>
          <Trash2 />
        </Button>
      </div>
    </li>
  )
}

export function MemoryList() {
  const { t } = useTranslation('memory')
  const { memories, query, setQuery, create } = useMemory()
  const [search, setSearch] = useState(query)
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<MemoryCategory>('other')

  useEffect(() => {
    const timer = setTimeout(() => void setQuery(search), 200)
    return () => clearTimeout(timer)
  }, [search, setQuery])

  const onAdd = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!content.trim()) return
    await create(content.trim(), category)
    setContent('')
  }

  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={onAdd}>
        <Input
          placeholder={t('list.addPlaceholder')}
          aria-label={t('list.addPlaceholder')}
          value={content}
          maxLength={500}
          onChange={(e) => setContent(e.target.value)}
        />
        <CategorySelect value={category} onChange={setCategory} />
        <Button type="submit" disabled={!content.trim()}>
          <Plus />
          {t('list.add')}
        </Button>
      </form>
      <div className="relative">
        <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder={t('list.search')}
          aria-label={t('list.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {memories.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t(query ? 'list.noResults' : 'list.empty')}</p>
      ) : (
        <div className="space-y-1">
          {groupMemories(memories).map((g) => (
            // Đổi giữa đang tìm / không tìm → dựng lại nhóm (trạng thái thu gọn tạm thời về mặc định).
            <MemoryGroupSection key={`${g.category}:${query ? 'search' : ''}`} group={g} searching={!!query} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Nội dung một dòng (cắt …); dài quá thì có "Xem thêm" / "Thu gọn". */
function ClampedText({ text }: { text: string }) {
  const { t } = useTranslation('memory')
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || expanded) return
    const measure = (): void => setOverflowing(el.scrollWidth > el.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, expanded])

  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <p
        ref={ref}
        className={cn('min-w-0 flex-1 text-sm', expanded ? 'whitespace-pre-wrap break-words' : 'truncate')}
        title={expanded ? undefined : text}
        data-testid="memory-content"
      >
        {text}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          data-testid="memory-expand"
        >
          {expanded ? t('list.collapseItem') : t('list.expandItem')}
        </button>
      )}
    </div>
  )
}

/** Một nhóm theo loại: tiêu đề + số, bấm để thu / mở (nhớ trạng thái); 5 mục đầu + "Xem thêm N". */
function MemoryGroupSection({ group, searching }: { group: MemoryGroup; searching: boolean }) {
  const { t } = useTranslation('memory')
  const [savedCollapsed, setSavedCollapsed] = useCollapsed(`group.${group.category}`)
  // Đang tìm: nhóm có kết quả tự mở; bấm thu gọn chỉ tạm thời (không lưu), xoá ô tìm → về trạng thái đã lưu.
  const [searchCollapsed, setSearchCollapsed] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const collapsed = searching ? searchCollapsed : savedCollapsed
  const toggle = (): void => (searching ? setSearchCollapsed(!collapsed) : setSavedCollapsed(!collapsed))
  const visible = showAll ? group.items : group.items.slice(0, MEMORIES_SHOWN)
  const label = t(`categories.${group.category}`)

  return (
    <section data-testid="memory-group" data-category={group.category}>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-expanded={!collapsed}
        onClick={toggle}
        data-testid="memory-group-toggle"
      >
        <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', collapsed && '-rotate-90')} />
        <span>{label}</span>
        <span className="rounded-full bg-muted px-1.5 text-[11px] leading-4" data-testid="memory-group-count">
          {group.items.length}
        </span>
      </button>
      {!collapsed && (
        <>
          <ul className="divide-y pl-5">
            {visible.map((m) => (
              <MemoryRow key={m.id} memory={m} />
            ))}
          </ul>
          {group.items.length > visible.length && (
            <button
              type="button"
              className="ml-5 rounded-md px-2 py-1 text-xs text-primary hover:bg-muted"
              onClick={() => setShowAll(true)}
              data-testid="memory-show-more"
            >
              {t('list.showMore', { count: group.items.length - visible.length })}
            </button>
          )}
        </>
      )}
    </section>
  )
}
