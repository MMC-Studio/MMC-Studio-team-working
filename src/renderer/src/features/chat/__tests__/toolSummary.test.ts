import { describe, expect, it } from 'vitest'
import { appToolKey, countTools, toolActivity, toolDetail } from '../toolSummary'

describe('gộp lời gọi công cụ', () => {
  it('đếm theo tên, giữ thứ tự xuất hiện đầu tiên', () => {
    const events = ['Read', 'Read', 'Grep', 'Read', 'Grep', 'Glob'].map((name) => ({ name, input: {} }))
    expect(countTools(events)).toEqual([
      { name: 'Read', count: 3 },
      { name: 'Grep', count: 2 },
      { name: 'Glob', count: 1 }
    ])
    expect(countTools([])).toEqual([])
  })

  it('chi tiết: file của Read, từ khoá + thư mục của Grep, bỏ qua input lạ', () => {
    expect(toolDetail({ name: 'Read', input: { file_path: 'C:\\a\\b.ts', offset: 3 } })).toBe('C:\\a\\b.ts')
    expect(toolDetail({ name: 'Grep', input: { pattern: 'useSync', path: 'src' } })).toBe('useSync · src')
    expect(toolDetail({ name: 'Glob', input: { pattern: '**/*.ts' } })).toBe('**/*.ts')
    expect(toolDetail({ name: 'Bash', input: { command: 'git   status\n' } })).toBe('git status')
    expect(toolDetail({ name: 'X', input: null })).toBeNull()
    expect(toolDetail({ name: 'X', input: 'chuỗi' })).toBeNull()
    expect(toolDetail({ name: 'X', input: { file_path: 42, other: 'x' } })).toBeNull()
  })

  it('chi tiết quá dài bị cắt bằng …', () => {
    const long = toolDetail({ name: 'Bash', input: { command: 'a'.repeat(500) } })!
    expect(long.length).toBe(158)
    expect(long.endsWith('…')).toBe(true)
  })

  it('loại việc của công cụ đang chạy', () => {
    expect(toolActivity('Read')).toBe('reading')
    expect(toolActivity('Grep')).toBe('searching')
    expect(toolActivity('Edit')).toBe('editing')
    expect(toolActivity('Bash')).toBe('running')
    expect(toolActivity('WebSearch')).toBe('web')
    expect(toolActivity('mcp__mmc__screenshot')).toBe('working')
  })

  it('bỏ tiền tố tool của app', () => {
    expect(appToolKey('mcp__mmc__screenshot')).toBe('screenshot')
    expect(appToolKey('Read')).toBe('Read')
  })
})
