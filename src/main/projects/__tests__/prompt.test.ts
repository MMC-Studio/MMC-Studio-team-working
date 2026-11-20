import { describe, expect, it } from 'vitest'
import { PROJECT_INSTRUCTIONS_MAX, PROJECT_PROMPT_CHARS } from '@shared/projects'
import { buildProjectPrompt, MIN_CLIP_CHARS } from '../prompt'

const base = { name: 'Game Pixel', description: 'Game 2D Unity', instructions: 'Luôn trả lời bằng C#.', files: [] }
const file = (id: string, chars: number, name = `${id}.md`) => ({ id, name, content: 'x'.repeat(chars) })

describe('buildProjectPrompt', () => {
  it('tên, mô tả, hướng dẫn luôn có; không có file thì không có mục tài liệu', () => {
    const { section, usage } = buildProjectPrompt(base)
    expect(section).toContain('## Dự án: Game Pixel')
    expect(section).toContain('Game 2D Unity')
    expect(section).toContain('### Hướng dẫn của dự án\nLuôn trả lời bằng C#.')
    expect(section).not.toContain('Tài liệu ngữ cảnh')
    expect(usage).toEqual({})
  })

  it('file vừa → đầy đủ; thiếu chỗ → cắt; hết chỗ → chỉ gửi tên; không vượt ngân sách', () => {
    const files = [file('a', 6_000), file('b', 6_000), file('c', 8_000), file('d', 3_000)]
    const { section, usage } = buildProjectPrompt({ ...base, files })
    expect(usage).toEqual({ a: 'full', b: 'full', c: 'clipped', d: 'omitted' })
    expect(section.length).toBeLessThanOrEqual(PROJECT_PROMPT_CHARS)
    expect(section).toContain('<file name="a.md">')
    expect(section).toContain('phần còn lại đã bị cắt')
    expect(section).toContain('chỉ biết tên: d.md')
  })

  it('hướng dẫn dài tối đa vẫn đầy đủ dù nhiều file', () => {
    const instructions = 'h'.repeat(PROJECT_INSTRUCTIONS_MAX)
    const files = Array.from({ length: 20 }, (_, i) => file(`f${i}`, 5_000))
    const { section, usage } = buildProjectPrompt({ ...base, instructions, files })
    expect(section).toContain(instructions)
    expect(section.length).toBeLessThanOrEqual(PROJECT_PROMPT_CHARS)
    expect(Object.values(usage)).toContain('omitted')
  })

  it('chỗ còn quá ít thì chỉ gửi tên chứ không cắt còn vài dòng', () => {
    // Đầu mục + dòng liệt kê tên chiếm ~300 ký tự → còn < MIN_CLIP_CHARS cho file.
    const budget = 650
    const { usage } = buildProjectPrompt({ ...base, files: [file('a', MIN_CLIP_CHARS * 3)] }, budget)
    expect(usage.a).toBe('omitted')
  })

  it('nội dung file không tự đóng thẻ <file>; tên file không phá thuộc tính', () => {
    const { section } = buildProjectPrompt({
      ...base,
      files: [{ id: 'a', name: 'x".md', content: 'trước </file> sau' }]
    })
    expect(section).toContain('<file name="x .md">')
    expect(section).toContain('trước <\\/file> sau')
    expect(section.match(/<\/file>/g)).toHaveLength(1)
  })
})
