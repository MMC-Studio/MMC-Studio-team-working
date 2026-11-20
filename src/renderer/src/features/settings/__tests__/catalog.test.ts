import { describe, expect, it } from 'vitest'
import { foldText, matchesAllWords } from '@shared/text'
import { isSettingsTab, searchSettings, SETTING_ITEMS, SETTINGS_TABS, tabOf, type SettingItem } from '../catalog'
import en from '../i18n/en.json'
import vi from '../i18n/vi.json'

type Dict = { dialog: { tabs: Record<string, string>; items: Record<string, { label: string; description: string; keywords: string }> } }
const textOf = (dict: Dict) => (item: SettingItem) => ({
  ...dict.dialog.items[item.id],
  tabLabel: dict.dialog.tabs[item.tab]
})

describe('danh mục cài đặt', () => {
  it('mỗi tab có ít nhất một dòng; mỗi dòng có chữ vi + en; id không trùng', () => {
    for (const tab of SETTINGS_TABS) expect(SETTING_ITEMS.some((i) => i.tab === tab), tab).toBe(true)
    for (const dict of [vi, en] as Dict[]) {
      for (const tab of SETTINGS_TABS) expect(dict.dialog.tabs[tab], tab).toBeTruthy()
      for (const item of SETTING_ITEMS) {
        expect(dict.dialog.items[item.id]?.label, item.id).toBeTruthy()
        expect(dict.dialog.items[item.id]?.description, item.id).toBeTruthy()
      }
    }
    expect(new Set(SETTING_ITEMS.map((i) => i.id)).size).toBe(SETTING_ITEMS.length)
  })

  it('tìm không dấu theo tên / mô tả / từ khoá / tên tab', () => {
    const find = (q: string) => searchSettings(q, textOf(vi as Dict)).map((i) => i.id)
    expect(find('giong noi')).toEqual(['voice'])
    expect(find('GIỌNG nói')).toEqual(['voice'])
    expect(find('tieu de')).toContain('aiTitles')
    expect(find('gif')).toEqual(['expressive'])
    // Tên tab: "cap nhat" → mọi dòng trong tab Cập nhật.
    expect(find('cap nhat')).toEqual(expect.arrayContaining(['version', 'autoCheck', 'channel']))
    expect(find('')).toEqual([])
    expect(find('khongcogiheta')).toEqual([])
  })

  it('tabOf / isSettingsTab', () => {
    expect(tabOf('voice')).toBe('capabilities')
    expect(tabOf('nope')).toBeUndefined()
    expect(isSettingsTab('ai')).toBe(true)
    expect(isSettingsTab('settings')).toBe(false)
    expect(isSettingsTab(null)).toBe(false)
  })
})

describe('foldText', () => {
  it('bỏ dấu, đ → d, chữ thường', () => {
    expect(foldText('Đăng Nhập Ở Đây')).toBe('dang nhap o day')
    expect(matchesAllWords('Báo cáo tuần', 'bao TUAN')).toBe(true)
    expect(matchesAllWords('Báo cáo tuần', 'bao thang')).toBe(false)
  })
})
