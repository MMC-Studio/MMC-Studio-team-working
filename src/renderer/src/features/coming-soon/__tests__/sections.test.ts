import { describe, expect, it } from 'vitest'
import vi from '../i18n/vi.json'
import { SOON_SECTIONS, isSoonSection } from '../sections'

describe('trang "Sắp có"', () => {
  it('chỉ nhận đúng các mục của thanh bên, mục nào cũng có tiêu đề + mô tả', () => {
    expect(isSoonSection('scheduled')).toBe(true)
    // Dự án đã là trang thật (PR 5).
    expect(isSoonSection('projects')).toBe(false)
    expect(isSoonSection('settings')).toBe(false)
    expect(isSoonSection(undefined)).toBe(false)
    for (const s of SOON_SECTIONS) {
      expect(vi.sections[s].title).toBeTruthy()
      expect(vi.sections[s].description).toBeTruthy()
    }
  })
})
