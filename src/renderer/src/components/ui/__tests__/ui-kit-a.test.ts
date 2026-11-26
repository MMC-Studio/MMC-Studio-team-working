import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from '../button'
import { IconButton } from '../icon-button'
import { Segmented } from '../segmented'
import { segmentedKeyTarget } from '../segmented-keys'
import { Switch } from '../switch'

// Môi trường test là node (không có DOM) → kiểm phần logic thuần + HTML dựng sẵn (renderToStaticMarkup).
// Hành vi bấm / phím thật kiểm trong e2e trang mẫu.

describe('Segmented — bàn phím', () => {
  it('mũi tên phải / xuống sang mục sau, vòng về đầu', () => {
    expect(segmentedKeyTarget('ArrowRight', 0, 3)).toBe(1)
    expect(segmentedKeyTarget('ArrowDown', 1, 3)).toBe(2)
    expect(segmentedKeyTarget('ArrowRight', 2, 3)).toBe(0)
  })

  it('mũi tên trái / lên về mục trước, vòng về cuối', () => {
    expect(segmentedKeyTarget('ArrowLeft', 2, 3)).toBe(1)
    expect(segmentedKeyTarget('ArrowUp', 0, 3)).toBe(2)
  })

  it('Home / End; phím khác không làm gì', () => {
    expect(segmentedKeyTarget('Home', 2, 4)).toBe(0)
    expect(segmentedKeyTarget('End', 0, 4)).toBe(3)
    expect(segmentedKeyTarget('Enter', 1, 4)).toBeNull()
    expect(segmentedKeyTarget('a', 1, 4)).toBeNull()
    expect(segmentedKeyTarget('ArrowRight', 0, 0)).toBeNull()
  })
})

describe('Segmented — HTML', () => {
  const items = [
    { value: 'table', label: 'Bảng' },
    { value: 'cards', label: 'Thẻ' },
    { value: 'list', label: 'Danh sách' }
  ] as const
  const render = (value: string): string =>
    renderToStaticMarkup(
      h(Segmented<string>, { items: [...items], value, onValueChange: () => {}, label: 'Kiểu xem' })
    )

  it('radiogroup có tên; chỉ mục đang chọn aria-checked và nhận Tab', () => {
    const html = render('cards')
    expect(html).toContain('role="radiogroup" aria-label="Kiểu xem"')
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-checked="true" tabindex="0" data-testid="segmented-cards"/)
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
  })

  it('nền trượt bằng transform (không đổi độ rộng theo mục)', () => {
    expect(render('list')).toContain('transform:translateX(200%)')
    expect(render('table')).toContain('transform:translateX(0%)')
  })

  it('giá trị không có trong danh sách → không có nền chọn, mục đầu vẫn Tab tới được', () => {
    const html = render('khac')
    expect(html).not.toContain('segmented-indicator')
    expect(html).not.toContain('aria-checked="true"')
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
  })
})

describe('IconButton', () => {
  it('aria-label lấy từ label', () => {
    const html = renderToStaticMarkup(h(IconButton, { label: 'Thêm task', icon: h('svg') }))
    expect(html).toContain('aria-label="Thêm task"')
  })

  it('thiếu label → lỗi typecheck', () => {
    // @ts-expect-error — `label` là bắt buộc (bỏ dòng này đi thì `npm run typecheck` báo lỗi)
    const el = h(IconButton, { icon: h('svg') })
    expect(el).toBeTruthy()
  })
})

describe('Button', () => {
  it('loading: khoá nút, aria-busy, chữ vẫn giữ chỗ (ẩn) + vòng xoay', () => {
    const html = renderToStaticMarkup(h(Button, { loading: true }, 'Lưu'))
    expect(html).toMatch(/<button[^>]*disabled=""/)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('<span class="invisible contents">Lưu</span>')
    expect(html).toContain('data-testid="button-spinner"')
  })

  it('không loading: giữ nguyên như cũ (không bọc thêm thẻ)', () => {
    const html = renderToStaticMarkup(h(Button, null, 'Lưu'))
    expect(html).toMatch(/<button[^>]*>Lưu<\/button>/)
    expect(html).not.toContain('aria-busy')
    expect(html).not.toContain('disabled=""')
  })

  it('cỡ pill bo tròn hẳn', () => {
    expect(renderToStaticMarkup(h(Button, { size: 'pill' }, 'Lọc'))).toContain('rounded-full')
  })
})

describe('Switch', () => {
  it('là checkbox thật (Space bật tắt) có role switch; disabled khoá được', () => {
    const html = renderToStaticMarkup(h(Switch, { disabled: true, readOnly: true, checked: true }))
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('role="switch"')
    expect(html).toContain('disabled=""')
  })
})
