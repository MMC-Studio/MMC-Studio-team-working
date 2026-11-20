import { Loader2, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { optimistic, useSyncedState } from '@renderer/lib/sync'

/** Học phong cách: trợ lý đề xuất ghi chú, người dùng chọn / sửa rồi mới lưu vào my-style. */
/** Ghi chú my-style (tab Trợ lý của bạn, trong dòng "Phong cách của bạn"). */
export function StyleNotes() {
  const { t } = useTranslation('settings')
  // Ghi chú my-style là một skill → đồng bộ cùng mục "skills".
  const { data, setData: setNotes } = useSyncedState('skills', () => api.skills.styleNotes())
  const notes = data ?? []
  const [proposed, setProposed] = useState<{ text: string; keep: boolean }[] | null>(null)
  const [state, setState] = useState<'idle' | 'learning' | 'empty' | 'error'>('idle')
  const [draft, setDraft] = useState('')

  // Hiện ngay, lưu sau; lỗi → hoàn tác + báo lỗi chung. Danh sách skill tự cập nhật qua đồng bộ.
  const save = async (next: string[]): Promise<void> => {
    await optimistic({
      topic: 'skills',
      apply: () => setNotes(next),
      rollback: () => setNotes(notes),
      save: () => api.skills.setStyleNotes(next)
    })
  }

  const learn = async (): Promise<void> => {
    setState('learning')
    const r = await api.skills.learnStyle()
    if ('error' in r) return setState(r.error === 'no_messages' ? 'empty' : 'error')
    setState(r.notes.length ? 'idle' : 'empty')
    setProposed(r.notes.length ? r.notes.map((text) => ({ text, keep: true })) : null)
  }

  return (
    <div className="space-y-2 text-sm" data-testid="style-notes">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={state === 'learning'}
          onClick={() => void learn()}
          data-testid="style-learn"
        >
          {state === 'learning' ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {t('skills.style.learn')}
        </Button>
      </div>
      {state === 'empty' && (
        <p className="text-xs text-muted-foreground">{t('skills.style.nothing')}</p>
      )}
      {state === 'error' && <p className="text-xs text-destructive">{t('skills.style.error')}</p>}

      {proposed && (
        <div className="space-y-1.5 rounded bg-muted/40 p-2" data-testid="style-proposed">
          <p className="text-xs font-medium">{t('skills.style.proposed')}</p>
          {proposed.map((p, i) => (
            <label key={i} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1.5"
                checked={p.keep}
                onChange={(e) =>
                  setProposed(
                    proposed.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x))
                  )
                }
              />
              <Input
                value={p.text}
                maxLength={300}
                onChange={(e) =>
                  setProposed(
                    proposed.map((x, j) => (j === i ? { ...x, text: e.target.value } : x))
                  )
                }
              />
            </label>
          ))}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setProposed(null)}>
              {t('skills.style.discard')}
            </Button>
            <Button
              size="sm"
              data-testid="style-save"
              disabled={!proposed.some((p) => p.keep && p.text.trim())}
              onClick={async () => {
                await save([
                  ...notes,
                  ...proposed.filter((p) => p.keep && p.text.trim()).map((p) => p.text.trim())
                ])
                setProposed(null)
              }}
            >
              {t('skills.style.save')}
            </Button>
          </div>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="space-y-1 text-sm" data-testid="style-saved">
          {notes.map((n, i) => (
            <li key={`${i}-${n}`} className="flex items-start gap-2">
              <span className="flex-1">• {n}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('skills.style.removeNote')}
                onClick={() => void save(notes.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!draft.trim()) return
          void save([...notes, draft.trim()]).then(() => setDraft(''))
        }}
      >
        <Input
          value={draft}
          maxLength={300}
          placeholder={t('skills.style.addPlaceholder')}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button size="sm" variant="outline" type="submit" disabled={!draft.trim()}>
          {t('skills.style.add')}
        </Button>
      </form>
    </div>
  )
}
