import { describe, expect, it } from 'vitest'
import { CHAT_MIN, computeLayout, PANEL_WIDTH, SIDEBAR_WIDTH, type LayoutInput } from '../layout/sidebarStore'

const base: LayoutInput = { containerWidth: 1224, hidden: false, sidebarWidth: 256, panelOpen: false, panelWidth: 520 }
/** Bề rộng khung chat còn lại. */
const chat = (i: LayoutInput): number => {
  const l = computeLayout(i)
  return i.containerWidth - l.sidebarWidth - l.panelWidth
}

describe('computeLayout — khung chat luôn ≥ 360px', () => {
  it('cửa sổ rộng: thanh bên cố định + panel, khung chat đủ chỗ', () => {
    const l = computeLayout({ ...base, panelOpen: true })
    expect(l).toMatchObject({ sidebar: 'inline', autoHidden: false, sidebarWidth: 256, panelWidth: 520 })
    expect(chat({ ...base, panelOpen: true })).toBeGreaterThanOrEqual(CHAT_MIN)
  })

  it('cửa sổ 900px + panel: thanh bên tự ẩn (không đổi lựa chọn), panel co lại để khung chat ≥ 360', () => {
    const i = { ...base, containerWidth: 844, panelOpen: true }
    const l = computeLayout(i)
    expect(l).toMatchObject({ sidebar: 'hidden', autoHidden: true, sidebarWidth: 0 })
    expect(l.panelWidth).toBe(844 - CHAT_MIN)
    expect(chat(i)).toBe(CHAT_MIN)
    // Đóng panel → thanh bên hiện lại như cũ.
    expect(computeLayout({ ...i, panelOpen: false })).toMatchObject({ sidebar: 'inline', sidebarWidth: 256 })
  })

  it('người dùng đã ẩn → luôn ẩn, không tính là tự ẩn', () => {
    expect(computeLayout({ ...base, hidden: true, containerWidth: 844, panelOpen: true })).toMatchObject({
      sidebar: 'hidden',
      autoHidden: false
    })
  })

  it('giới hạn độ rộng thanh bên: 200–420 và không làm khung chat < 360', () => {
    expect(computeLayout({ ...base, sidebarWidth: 999 }).sidebarWidth).toBe(SIDEBAR_WIDTH.max)
    expect(computeLayout({ ...base, sidebarWidth: 50 }).sidebarWidth).toBe(SIDEBAR_WIDTH.min)
    // Cửa sổ hẹp (644px vùng chat): tối đa 644 - 360 = 284.
    const narrow = computeLayout({ ...base, containerWidth: 644, sidebarWidth: 400 })
    expect(narrow).toMatchObject({ sidebar: 'inline', sidebarWidth: 284, sidebarMax: 284 })
    // Hẹp tới mức không còn 200px cho thanh bên → tự ẩn.
    expect(computeLayout({ ...base, containerWidth: 540 })).toMatchObject({ sidebar: 'hidden', autoHidden: true })
  })

  it('panel: tối thiểu 320, không vượt quá phần chừa cho khung chat', () => {
    expect(computeLayout({ ...base, panelOpen: true, panelWidth: 100 }).panelWidth).toBe(PANEL_WIDTH.min)
    expect(computeLayout({ ...base, panelOpen: true, panelWidth: 5000 }).panelWidth).toBe(1224 - CHAT_MIN)
    expect(computeLayout({ ...base, panelOpen: false, panelWidth: 700 }).panelWidth).toBe(0)
  })
})
