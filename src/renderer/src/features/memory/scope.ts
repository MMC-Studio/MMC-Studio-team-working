import type { MemorySuggestion } from '@shared/types'

/** Khoá phạm vi để lọc: 'user' = chung, còn lại là id dự án. */
export type ScopeKey = 'user' | (string & {})

export const scopeKeyOf = (s: Pick<MemorySuggestion, 'projectId'>): ScopeKey => s.projectId ?? 'user'

/** Các phạm vi đang có đề xuất (chung trước, rồi dự án theo thứ tự xuất hiện) + số đề xuất mỗi phạm vi. */
export function suggestionScopes(
  suggestions: Pick<MemorySuggestion, 'projectId' | 'projectName'>[]
): { key: ScopeKey; name: string | null; count: number }[] {
  const map = new Map<ScopeKey, { key: ScopeKey; name: string | null; count: number }>()
  for (const s of suggestions) {
    const key = scopeKeyOf(s)
    const entry = map.get(key) ?? { key, name: s.projectName, count: 0 }
    entry.count++
    map.set(key, entry)
  }
  return [...map.values()].sort((a, b) => (a.key === 'user' ? -1 : b.key === 'user' ? 1 : 0))
}

/**
 * Đề xuất hiện ở trang một dự án: đề xuất cho trí nhớ của dự án đó + đề xuất trí nhớ chung sinh ra từ cuộc trò
 * chuyện trong dự án (người dùng có thể chuyển nó vào dự án trước khi duyệt). Cùng một đề xuất với trang Trí nhớ.
 */
export function suggestionsForProject<T extends Pick<MemorySuggestion, 'projectId' | 'sourceProjectId'>>(
  suggestions: T[],
  projectId: string
): T[] {
  return suggestions.filter((s) => s.projectId === projectId || (s.projectId === null && s.sourceProjectId === projectId))
}

/** Dự án mà một đề xuất thêm mới có thể chuyển vào (của đề xuất, hoặc của cuộc sinh ra nó); null = chỉ có "chung". */
export function projectChoice(
  s: Pick<MemorySuggestion, 'action' | 'projectId' | 'projectName' | 'sourceProjectId' | 'sourceProjectName'>
): { id: string; name: string } | null {
  if (s.action !== 'add') return null
  if (s.projectId && s.projectName) return { id: s.projectId, name: s.projectName }
  if (s.sourceProjectId && s.sourceProjectName) return { id: s.sourceProjectId, name: s.sourceProjectName }
  return null
}
