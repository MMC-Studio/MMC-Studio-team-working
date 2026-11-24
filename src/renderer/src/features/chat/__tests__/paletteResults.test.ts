import { describe, expect, it } from 'vitest'
import type { ArtifactSummary } from '@shared/artifacts'
import type { Project } from '@shared/projects'
import type { Conversation } from '@shared/types'
import { buildPalette, flatItems, itemKey, nextTab, previewText, RECENT_LIMIT, timeBucket } from '../search/paletteResults'

const conv = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
  id,
  title: id,
  mode: 'free',
  pinned: false,
  cwd: null,
  codeWrite: false,
  extraDirs: [],
  groupId: null,
  parentId: null,
  suggestedGroupId: null,
  projectId: null,
  scheduleId: null,
  createdAt: 0,
  updatedAt: 0,
  ...extra
})
const art = (id: string, extra: Partial<ArtifactSummary> = {}): ArtifactSummary => ({
  id,
  conversationId: 'c1',
  title: id,
  type: 'doc',
  version: 1,
  updatedAt: 0,
  conversationTitle: 'Cuộc 1',
  ...extra
})
const keys = (s: ReturnType<typeof buildPalette>) => flatItems(s).map(itemKey)

describe('buildPalette', () => {
  const conversations = [
    conv('a', { updatedAt: 30 }),
    conv('code1', { mode: 'code', updatedAt: 20 }),
    conv('pinned-old', { pinned: true, updatedAt: 1 })
  ]
  const artifacts = [art('Báo cáo tuần', { updatedAt: 25 }), art('Slide', { type: 'slides', updatedAt: 5 })]

  it('Tất cả, chưa gõ: Gần đây (cuộc + artifact theo thời gian, ghim không được ưu tiên) + Hành động', () => {
    const s = buildPalette({ tab: 'all', query: '', conversations, artifacts })
    expect(s.map((x) => x.key)).toEqual(['recent', 'actions'])
    expect(keys(s)).toEqual([
      'conversation:a',
      'artifact:Báo cáo tuần',
      'conversation:code1',
      'artifact:Slide',
      'conversation:pinned-old',
      'action:new-chat',
      'action:new-code'
    ])
  })

  it('Gần đây tối đa RECENT_LIMIT mục; chưa có gì thì chỉ còn Hành động', () => {
    const many = Array.from({ length: 20 }, (_, i) => conv(`c${i}`, { updatedAt: i }))
    const s = buildPalette({ tab: 'all', query: '', conversations: many, artifacts: [] })
    expect(s[0].items).toHaveLength(RECENT_LIMIT)
    expect(buildPalette({ tab: 'all', query: '', conversations: [], artifacts: [] }).map((x) => x.key)).toEqual(['actions'])
  })

  it('đang gõ: không còn Hành động, artifact lọc không dấu', () => {
    const s = buildPalette({ tab: 'all', query: 'bao cao', conversations: [], artifacts })
    expect(keys(s)).toEqual(['artifact:Báo cáo tuần'])
  })

  it('tab Code / Cuộc trò chuyện tách theo chế độ; Artifacts chỉ artifact', () => {
    expect(keys(buildPalette({ tab: 'code', query: '', conversations, artifacts }))).toEqual(['conversation:code1'])
    expect(keys(buildPalette({ tab: 'chats', query: '', conversations, artifacts }))).toEqual([
      'conversation:a',
      'conversation:pinned-old'
    ])
    expect(keys(buildPalette({ tab: 'artifacts', query: '', conversations, artifacts }))).toEqual([
      'artifact:Báo cáo tuần',
      'artifact:Slide'
    ])
  })

  it('Dự án / Lịch hẹn chưa có dữ liệu → rỗng; không có kết quả → rỗng', () => {
    expect(buildPalette({ tab: 'projects', query: '', conversations, artifacts })).toEqual([])
    expect(buildPalette({ tab: 'scheduled', query: 'x', conversations, artifacts })).toEqual([])
    expect(buildPalette({ tab: 'artifacts', query: 'không có', conversations, artifacts })).toEqual([])
  })

  it('giữ trích đoạn FTS của cuộc trò chuyện', () => {
    const s = buildPalette({ tab: 'chats', query: 'chill', conversations: [conv('x', { searchSnippet: 'nghe \u0001chill\u0002' })], artifacts: [] })
    expect(flatItems(s)[0]).toMatchObject({ kind: 'conversation', snippet: 'nghe \u0001chill\u0002' })
  })
})

describe('buildPalette — dự án', () => {
  const projects: Project[] = [
    { id: 'p1', name: 'Đồ án Unity', description: 'game 2D', instructions: '', pinned: true, fileCount: 0, createdAt: 0, updatedAt: 50 },
    { id: 'p2', name: 'Ôn thi', description: '', instructions: '', pinned: false, fileCount: 0, createdAt: 0, updatedAt: 1 }
  ]
  it('tab Dự án: lọc không dấu theo tên + mô tả; tab Tất cả có cả dự án', () => {
    expect(keys(buildPalette({ tab: 'projects', query: '', conversations: [], artifacts: [], projects }))).toEqual(['project:p1', 'project:p2'])
    expect(keys(buildPalette({ tab: 'projects', query: 'do an', conversations: [], artifacts: [], projects }))).toEqual(['project:p1'])
    expect(keys(buildPalette({ tab: 'projects', query: 'GAME', conversations: [], artifacts: [], projects }))).toEqual(['project:p1'])
    expect(keys(buildPalette({ tab: 'all', query: 'on thi', conversations: [], artifacts: [], projects }))).toEqual(['project:p2'])
  })
})

describe('timeBucket', () => {
  const now = new Date(2026, 10, 20, 9, 0).getTime()
  const at = (d: number, h = 12) => new Date(2026, 10, d, h).getTime()
  it('theo ngày lịch', () => {
    expect(timeBucket(at(20, 1), now)).toBe('today')
    expect(timeBucket(at(19, 23), now)).toBe('yesterday')
    expect(timeBucket(at(14), now)).toBe('week')
    expect(timeBucket(at(13), now)).toBe('week')
    expect(timeBucket(at(12), now)).toBe('month')
    expect(timeBucket(new Date(2026, 9, 1).getTime(), now)).toBe('older')
  })
})

describe('nextTab', () => {
  it('vòng tròn', () => {
    expect(nextTab('all', 1)).toBe('artifacts')
    expect(nextTab('all', -1)).toBe('scheduled')
    expect(nextTab('scheduled', 1)).toBe('all')
  })
})

describe('previewText', () => {
  it('bỏ ký hiệu Markdown / thẻ HTML, cắt ngắn', () => {
    expect(previewText('doc', '# Tiêu đề\n\n- **một** `x`\n> trích')).toBe('Tiêu đề\n\nmột x\ntrích')
    expect(previewText('html', '<style>a{}</style><h1>Xin chào</h1><script>1</script>')).toBe('Xin chào')
    expect(previewText('mermaid', 'graph TD; A-->B')).toBe('graph TD; A-->B')
    expect(previewText('doc', 'a'.repeat(20), 10)).toBe(`${'a'.repeat(10)}…`)
  })
})
