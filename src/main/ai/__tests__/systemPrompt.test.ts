import { describe, expect, it } from 'vitest'
import { DEFAULT_ASSISTANT } from '@shared/schemas'
import { buildSystemPrompt } from '../systemPrompt'

describe('buildSystemPrompt', () => {
  it('chèn tên, tính cách và ngôn ngữ của trợ lý', () => {
    const prompt = buildSystemPrompt({
      assistant: { ...DEFAULT_ASSISTANT, name: 'Bông', persona: 'concise', language: 'en' },
      mode: 'free'
    })
    expect(prompt.split('\n')[0]).toBe(
      'Bạn là Bông. Tính cách: ngắn gọn, đi thẳng vào vấn đề. Trả lời bằng English.'
    )
    expect(prompt).toContain('Chế độ: Tự do')
  })

  it('dùng tính cách tùy chỉnh, rỗng thì về mặc định thân thiện', () => {
    const custom = buildSystemPrompt({
      assistant: { ...DEFAULT_ASSISTANT, persona: 'custom', customPersona: 'như một người anh' },
      mode: 'free'
    })
    expect(custom).toContain('Tính cách: như một người anh.')
    const empty = buildSystemPrompt({
      assistant: { ...DEFAULT_ASSISTANT, persona: 'custom', customPersona: '  ' },
      mode: 'free'
    })
    expect(empty).toContain('Tính cách: thân thiện')
  })

  it('xếp phần theo thứ tự: danh tính → hồ sơ → memory → chế độ → ngữ cảnh', () => {
    const prompt = buildSystemPrompt({
      assistant: DEFAULT_ASSISTANT,
      mode: 'study',
      modeSkill: '# Gia sư',
      user: { name: 'An', goals: 'Học React' },
      memories: ['Deadline đồ án 15/12'],
      extraContext: 'Task: viết báo cáo'
    })
    const order = ['Bạn là Mây', '## Người dùng', 'Deadline đồ án', '## Chế độ: Học tập', '# Gia sư', '## Ngữ cảnh']
    const positions = order.map((s) => prompt.indexOf(s))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('tôn trọng giới hạn độ dài và luôn giữ phần danh tính', () => {
    const prompt = buildSystemPrompt({
      assistant: DEFAULT_ASSISTANT,
      mode: 'code',
      modeSkill: 'x'.repeat(5000),
      memories: Array.from({ length: 30 }, (_, i) => `memory ${i} ${'y'.repeat(100)}`),
      extraContext: 'z'.repeat(5000),
      maxChars: 2000
    })
    expect(prompt.length).toBeLessThanOrEqual(2000)
    expect(prompt.startsWith('Bạn là Mây.')).toBe(true)
  })

  it('bỏ memory cũ trước memory mới khi thiếu chỗ', () => {
    const memories = Array.from({ length: 10 }, (_, i) => `m${i}-${'k'.repeat(80)}`)
    const prompt = buildSystemPrompt({ assistant: DEFAULT_ASSISTANT, mode: 'free', memories, maxChars: 900 })
    expect(prompt).toContain('m0-')
    expect(prompt).not.toContain('m9-')
  })

  it('phần dự án: sau hồ sơ, trước memory; có ngân sách riêng, không bị cắt khi prompt dài', () => {
    const project = `## Dự án: Game
${'p'.repeat(5_000)}`
    const memories = Array.from({ length: 10 }, (_, i) => `m${i}-${'x'.repeat(80)}`)
    const prompt = buildSystemPrompt({
      assistant: DEFAULT_ASSISTANT,
      mode: 'free',
      user: { name: 'An' },
      memories,
      project,
      maxChars: 900
    })
    expect(prompt).toContain(project)
    expect(prompt.indexOf('## Người dùng')).toBeLessThan(prompt.indexOf('## Dự án: Game'))
    expect(prompt.indexOf('## Dự án: Game')).toBeLessThan(prompt.indexOf('m0-'))
    // Phần còn lại vẫn trong giới hạn cũ (900) — dự án không lấy chỗ của memory.
    expect(prompt.length).toBeLessThanOrEqual(900 + project.length + 2)
    expect(prompt).toContain('m0-')
  })

  it('chế độ project hiện là "Quản lý công việc"', () => {
    expect(buildSystemPrompt({ assistant: DEFAULT_ASSISTANT, mode: 'project' })).toContain('Quản lý công việc')
  })
})
