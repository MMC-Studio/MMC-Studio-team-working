import { describe, expect, it } from 'vitest'
import type { MemorySuggestion } from '@shared/types'
import { projectChoice, suggestionScopes, suggestionsForProject } from '../scope'

const s = (id: string, extra: Partial<MemorySuggestion> = {}): MemorySuggestion => ({
  id,
  conversationId: null,
  action: 'add',
  targetMemoryId: null,
  targetContent: null,
  content: id,
  category: 'other',
  status: 'pending',
  projectId: null,
  projectName: null,
  sourceProjectId: null,
  sourceProjectName: null,
  createdAt: 0,
  ...extra
})

const inA = { projectId: 'A', projectName: 'Game', sourceProjectId: 'A', sourceProjectName: 'Game' }
const fromA = { sourceProjectId: 'A', sourceProjectName: 'Game' }

describe('phạm vi đề xuất (renderer)', () => {
  it('suggestionScopes: chung trước, đếm theo phạm vi', () => {
    expect(suggestionScopes([s('1', inA), s('2'), s('3', inA), s('4', { projectId: 'B', projectName: 'Web' })])).toEqual([
      { key: 'user', name: null, count: 1 },
      { key: 'A', name: 'Game', count: 2 },
      { key: 'B', name: 'Web', count: 1 }
    ])
  })

  it('trang dự án: đề xuất của dự án + đề xuất chung sinh từ cuộc trong dự án; không lấy của dự án khác', () => {
    const list = [s('a', inA), s('chung-tu-A', fromA), s('chung'), s('b', { projectId: 'B', sourceProjectId: 'B' })]
    expect(suggestionsForProject(list, 'A').map((x) => x.id)).toEqual(['a', 'chung-tu-A'])
  })

  it('projectChoice: chỉ đề xuất thêm mới, lấy dự án của đề xuất hoặc của cuộc sinh ra nó', () => {
    expect(projectChoice(s('1', inA))).toEqual({ id: 'A', name: 'Game' })
    expect(projectChoice(s('2', fromA))).toEqual({ id: 'A', name: 'Game' })
    expect(projectChoice(s('3'))).toBeNull()
    expect(projectChoice(s('4', { ...inA, action: 'update' }))).toBeNull()
  })
})
