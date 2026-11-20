import { Check, ExternalLink, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { Memory, MemorySuggestion } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { Input, Textarea } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { optimistic, useSyncedState } from '@renderer/lib/sync'
import { cn } from '@renderer/lib/utils'
import { projectChoice, suggestionsForProject } from '../scope'
import { useMemory } from '../store'
import { scheduleBackup } from '../backup'

/**
 * Trí nhớ ở cột phải trang dự án: đề xuất đang chờ của dự án (CÙNG đề xuất với trang Trí nhớ — duyệt ở đâu,
 * chỗ kia cập nhật qua đồng bộ 'memory') + trí nhớ riêng của dự án (thêm / sửa / xoá tay).
 */
export function ProjectMemoryPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation('memory')
  const all = useMemory((s) => s.suggestions)
  const suggestions = useMemo(() => suggestionsForProject(all, projectId), [all, projectId])
  const { data: memories, setData } = useSyncedState(['memory'], () => api.memory.list({ projectId }))
  const [adding, setAdding] = useState(false)

  const remove = (id: string): void => {
    if (!memories) return
    void optimistic({
      topic: 'memory',
      apply: () => setData(memories.filter((m) => m.id !== id)),
      rollback: () => setData(memories),
      save: () => api.memory.remove(id)
    }).then(() => scheduleBackup())
  }

  return (
    <div className="space-y-3" data-testid="project-memory">
      {suggestions.length > 0 && (
        <div>
          <p className="pb-1 text-xs font-medium text-muted-foreground">{t('project.pending', { count: suggestions.length })}</p>
          <ul className="space-y-1">
            {suggestions.map((s) => (
              <PendingRow key={s.id} suggestion={s} />
            ))}
          </ul>
        </div>
      )}

      {memories && memories.length === 0 && suggestions.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground" data-testid="project-memory-empty">
          {t('project.empty')}
        </p>
      )}
      {memories && memories.length > 0 && (
        <ul className="space-y-0.5" data-testid="project-memory-list">
          {memories.map((m) => (
            <MemoryRow key={m.id} memory={m} onRemove={() => remove(m.id)} />
          ))}
        </ul>
      )}

      {adding ? (
        <AddForm projectId={projectId} onDone={() => setAdding(false)} />
      ) : (
        <div className="flex items-center justify-between gap-2">
          <button
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-muted"
            onClick={() => setAdding(true)}
            data-testid="project-memory-add"
          >
            <Plus className="size-3.5" />
            {t('project.add')}
          </button>
          <Link
            to={`/memory?project=${encodeURIComponent(projectId)}`}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            data-testid="project-memory-open"
          >
            {t('project.openAll')}
            <ExternalLink className="size-3" />
          </Link>
        </div>
      )}
    </div>
  )
}

/** Một đề xuất: nội dung (2 dòng), nút phạm vi (đề xuất thêm mới: bấm để đổi Chung ↔ Dự án), ✓ / ✕. */
function PendingRow({ suggestion }: { suggestion: MemorySuggestion }) {
  const { t } = useTranslation('memory')
  const resolve = useMemory((s) => s.resolve)
  const choice = projectChoice(suggestion)
  const [scope, setScope] = useState<string | null>(suggestion.projectId)
  const isProject = scope !== null
  return (
    <li className="rounded-md border px-2 py-1.5" data-testid="project-memory-suggestion" data-scope={isProject ? 'project' : 'user'}>
      <p
        className={cn('line-clamp-2 text-xs', suggestion.action === 'delete' && 'line-through')}
        title={suggestion.content}
        data-testid="project-memory-suggestion-content"
      >
        {suggestion.action !== 'add' && <span className="font-medium">{t(`suggestions.${suggestion.action}`)}: </span>}
        {suggestion.content}
      </p>
      <div className="mt-1 flex items-center gap-1">
        {choice ? (
          <button
            className={cn(
              'rounded px-1.5 py-px text-[11px]',
              isProject ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
              'hover:ring-1 hover:ring-border'
            )}
            title={t('project.toggleScope')}
            aria-label={t('project.toggleScope')}
            onClick={() => setScope(isProject ? null : choice.id)}
            data-testid="project-memory-scope"
          >
            {isProject ? t('project.scopeProject') : t('project.scopeUser')}
          </button>
        ) : (
          <span className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">
            {isProject ? t('project.scopeProject') : t('project.scopeUser')}
          </span>
        )}
        <span className="ml-auto" />
        <Button
          size="icon-sm"
          variant="ghost"
          title={t('suggestions.accept')}
          aria-label={t('suggestions.accept')}
          onClick={() => void resolve(suggestion.id, true, choice ? { projectId: scope } : {})}
          data-testid="project-memory-accept"
        >
          <Check />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title={t('suggestions.reject')}
          aria-label={t('suggestions.reject')}
          onClick={() => void resolve(suggestion.id, false)}
          data-testid="project-memory-reject"
        >
          <X />
        </Button>
      </div>
    </li>
  )
}

function MemoryRow({ memory, onRemove }: { memory: Memory; onRemove(): void }) {
  const { t } = useTranslation('memory')
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(memory.content)

  if (editing) {
    const save = async (): Promise<void> => {
      const ok = await optimistic({
        topic: 'memory',
        apply: () => undefined,
        rollback: () => undefined,
        save: () => api.memory.update(memory.id, content.trim(), memory.category)
      })
      if (ok) {
        setEditing(false)
        scheduleBackup()
      }
    }
    return (
      <li className="space-y-1 py-1">
        <Textarea
          autoFocus
          rows={1}
          maxLength={500}
          aria-label={t('project.edit')}
          className="min-h-8 overflow-hidden text-xs [field-sizing:content]"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          data-testid="project-memory-edit-input"
        />
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {t('project.cancel')}
          </Button>
          <Button size="sm" disabled={!content.trim()} onClick={() => void save()} data-testid="project-memory-save">
            {t('project.save')}
          </Button>
        </div>
      </li>
    )
  }
  return (
    <li className="group flex items-start gap-1 rounded px-1 py-0.5 hover:bg-muted" data-testid="project-memory-item">
      <p className="line-clamp-2 min-w-0 flex-1 text-xs" title={memory.content}>
        {memory.content}
      </p>
      <span className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <button
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          title={t('project.edit')}
          aria-label={t('project.edit')}
          onClick={() => {
            setContent(memory.content)
            setEditing(true)
          }}
          data-testid="project-memory-edit"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          title={t('project.remove')}
          aria-label={t('project.remove')}
          onClick={onRemove}
          data-testid="project-memory-remove"
        >
          <Trash2 className="size-3.5" />
        </button>
      </span>
    </li>
  )
}

function AddForm({ projectId, onDone }: { projectId: string; onDone(): void }) {
  const { t } = useTranslation('memory')
  const [content, setContent] = useState('')
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!content.trim()) return
    const ok = await optimistic({
      topic: 'memory',
      apply: () => undefined,
      rollback: () => undefined,
      save: () => api.memory.create(content.trim(), 'other', projectId)
    })
    if (ok) {
      scheduleBackup()
      onDone()
    }
  }
  return (
    <form className="space-y-1" onSubmit={(e) => void submit(e)}>
      <Input
        autoFocus
        maxLength={500}
        className="h-8 text-xs"
        placeholder={t('project.addPlaceholder')}
        aria-label={t('project.addPlaceholder')}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onDone()}
        data-testid="project-memory-input"
      />
      <div className="flex justify-end gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t('project.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!content.trim()} data-testid="project-memory-submit">
          {t('project.add')}
        </Button>
      </div>
    </form>
  )
}
