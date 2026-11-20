import { describe, expect, it } from 'vitest'
import type { Memory, Message } from '@shared/types'
import {
  MAX_TRANSCRIPT_CHARS,
  buildExtractionPrompt,
  extractJsonBlock,
  parseSuggestions,
  resolveScope
} from '../extraction'

const memory = (id: string, content: string): Memory => ({
  id,
  content,
  category: 'goal',
  sourceConversationId: null,
  projectId: null,
  createdAt: 0,
  updatedAt: 0,
  lastUsedAt: null
})

const msg = (role: 'user' | 'assistant', content: string): Message => ({
  id: content,
  conversationId: 'c',
  role,
  content,
  status: 'done',
  error: null,
  toolEvents: [],
  attachments: [],
  usage: null,
  reactions: [],
  media: null,
  voice: null,
  artifacts: [],
  replyToId: null,
  pinnedAt: null,
  recalledAt: null,
  createdAt: 0
})

const existing = [memory('m1', 'Đang học React'), memory('m2', 'Deadline đồ án 15/12')]

describe('extractJsonBlock', () => {
  it('đọc JSON trong khối ```json và JSON trần có chữ xung quanh', () => {
    expect(extractJsonBlock('Đây:\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJsonBlock('ok {"a":2} xong')).toEqual({ a: 2 })
    expect(extractJsonBlock('không có json')).toBeNull()
    expect(extractJsonBlock('{hỏng')).toBeNull()
  })
})

describe('parseSuggestions', () => {
  const wrap = (items: unknown[]): string => JSON.stringify({ type: 'memory_suggestions', items })

  it('giữ add/update/delete hợp lệ, category lạ → other', () => {
    const out = parseSuggestions(
      wrap([
        { action: 'add', content: 'Thích ví dụ bằng Python', category: 'preference' },
        { action: 'update', id: 'm2', content: 'Deadline đồ án dời sang 20/12', category: 'deadline' },
        { action: 'delete', id: 'm1' },
        { action: 'add', content: 'Làm ở công ty X', category: 'job' }
      ]),
      existing
    )
    expect(out).toEqual([
      { action: 'add', targetMemoryId: null, content: 'Thích ví dụ bằng Python', category: 'preference', projectId: null },
      { action: 'update', targetMemoryId: 'm2', content: 'Deadline đồ án dời sang 20/12', category: 'deadline', projectId: null },
      { action: 'delete', targetMemoryId: 'm1', content: 'Đang học React', category: 'goal', projectId: null },
      { action: 'add', targetMemoryId: null, content: 'Làm ở công ty X', category: 'other', projectId: null }
    ])
  })

  it('bỏ mục trùng memory cũ, trùng nhau, rỗng, hoặc id không tồn tại', () => {
    const out = parseSuggestions(
      wrap([
        { action: 'add', content: '  đang học   react ' },
        { action: 'add', content: 'Mới' },
        { action: 'add', content: 'mới' },
        { action: 'add', content: '' },
        { action: 'update', id: 'khong-co', content: 'x' },
        { action: 'update', id: 'm1', content: 'Đang học React' },
        { action: 'delete' }
      ]),
      existing
    )
    expect(out?.map((s) => s.content)).toEqual(['Mới'])
  })

  it('danh sách rỗng hợp lệ; sai định dạng trả null', () => {
    expect(parseSuggestions(wrap([]), existing)).toEqual([])
    expect(parseSuggestions('{"type":"other"}', existing)).toBeNull()
    expect(parseSuggestions('xin lỗi, tôi không hiểu', existing)).toBeNull()
  })
})

describe('buildExtractionPrompt', () => {
  it('liệt kê memory kèm id và hội thoại theo vai', () => {
    const prompt = buildExtractionPrompt([msg('user', 'Mình học React'), msg('assistant', 'Tuyệt!')], existing)
    expect(prompt).toContain('- id=m1 [goal] Đang học React')
    expect(prompt).toContain('NGƯỜI DÙNG: Mình học React\n\nTRỢ LÝ: Tuyệt!')
  })

  it('giữ phần cuối khi hội thoại quá dài', () => {
    const long = msg('user', 'đầu ' + 'x'.repeat(MAX_TRANSCRIPT_CHARS) + ' CUỐI')
    const prompt = buildExtractionPrompt([long], [])
    expect(prompt).toContain('CUỐI')
    expect(prompt).not.toContain('đầu ')
    expect(prompt).toContain('(chưa có)')
  })
})

describe('phạm vi trí nhớ (scope)', () => {
  const wrap = (items: unknown[]): string => JSON.stringify({ type: 'memory_suggestions', items })
  const scoped = { ...memory('p1', 'Dùng Unity 6'), projectId: 'P' }

  it('thiếu scope: cuộc trong dự án → dự án, cuộc ngoài dự án → chung', () => {
    const item = [{ action: 'add', content: 'Không ghi scope' }]
    expect(parseSuggestions(wrap(item), existing, 'P')?.[0].projectId).toBe('P')
    expect(parseSuggestions(wrap(item), existing, null)?.[0].projectId).toBeNull()
    expect(parseSuggestions(wrap(item), existing)?.[0].projectId).toBeNull()
  })

  it('scope lạ / viết hoa: trong dự án → dự án (không chắc thì hẹp), "USER" vẫn là chung', () => {
    const out = parseSuggestions(
      wrap([
        { action: 'add', content: 'a', scope: 'global' },
        { action: 'add', content: 'b', scope: ' USER ' },
        { action: 'add', content: 'c', scope: 'Project' }
      ]),
      existing,
      'P'
    )
    expect(out?.map((s) => s.projectId)).toEqual(['P', null, 'P'])
  })

  it('cuộc ngoài dự án: scope "project" vẫn thành chung', () => {
    const out = parseSuggestions(wrap([{ action: 'add', content: 'a', scope: 'project' }]), existing, null)
    expect(out?.[0].projectId).toBeNull()
  })

  it('update / delete giữ phạm vi của memory đích, bỏ qua scope trợ lý ghi', () => {
    const out = parseSuggestions(
      wrap([
        { action: 'update', id: 'p1', content: 'Dùng Unity 6.1', scope: 'user' },
        { action: 'delete', id: 'm1', scope: 'project' }
      ]),
      [...existing, scoped],
      'P'
    )
    expect(out?.map((s) => [s.action, s.projectId])).toEqual([
      ['update', 'P'],
      ['delete', null]
    ])
  })

  it('resolveScope', () => {
    expect(resolveScope(undefined, null)).toBeNull()
    expect(resolveScope('project', null)).toBeNull()
    expect(resolveScope(undefined, 'P')).toBe('P')
    expect(resolveScope('user', 'P')).toBeNull()
    expect(resolveScope('lạ', 'P')).toBe('P')
  })

  it('prompt trong dự án: tên + mô tả, hai nhóm memory, dặn scope; ngoài dự án không nhắc scope', () => {
    const inProject = buildExtractionPrompt([msg('user', 'hi')], [...existing, scoped], {
      id: 'P',
      name: 'Game',
      description: 'đồ án 2D'
    })
    expect(inProject).toContain('DỰ ÁN "Game" — đồ án 2D')
    expect(inProject).toContain('Không chắc → "project"')
    const general = inProject.slice(inProject.indexOf('## Memory chung'), inProject.indexOf('## Memory của dự án'))
    const own = inProject.slice(inProject.indexOf('## Memory của dự án'), inProject.indexOf('## Hội thoại'))
    expect(general).toContain('Đang học React')
    expect(general).not.toContain('Unity')
    expect(own).toContain('id=p1')

    const plain = buildExtractionPrompt([msg('user', 'hi')], existing)
    expect(plain).not.toContain('scope')
    expect(plain).toContain('## Memory hiện có')
  })
})
