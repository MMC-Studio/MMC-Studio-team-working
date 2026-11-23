import { matchesAllWords } from '@shared/text'

/**
 * Cửa sổ Cài đặt: các tab (chia nhóm bằng đường kẻ) và từng dòng cài đặt — dùng cho ô tìm kiếm (không dấu) và
 * để nhảy tới đúng dòng (`data-setting-id`). Thêm cài đặt mới: thêm dòng ở đây + `dialog.items.<id>` trong i18n,
 * rồi bọc phần giao diện bằng `SettingRow id="<id>"`.
 *
 * Chỉ là cách sắp xếp giao diện — tên / chỗ lưu của từng cài đặt không đổi.
 */
export const SETTINGS_TAB_GROUPS = [
  ['appearance', 'assistant'],
  ['ai', 'capabilities', 'connections', 'privacy'],
  ['updates', 'support']
] as const
export type SettingsTab = (typeof SETTINGS_TAB_GROUPS)[number][number]
export const SETTINGS_TABS: SettingsTab[] = SETTINGS_TAB_GROUPS.flat()
export const DEFAULT_TAB: SettingsTab = 'appearance'

export const isSettingsTab = (v: string | null | undefined): v is SettingsTab =>
  !!v && (SETTINGS_TABS as string[]).includes(v)

export type SettingItem = { id: string; tab: SettingsTab }

/** Theo đúng thứ tự hiển thị trong từng tab. */
export const SETTING_ITEMS: SettingItem[] = [
  { id: 'theme', tab: 'appearance' },
  { id: 'accent', tab: 'appearance' },
  { id: 'profile', tab: 'assistant' },
  { id: 'myStyle', tab: 'assistant' },
  { id: 'autoSuggestMemory', tab: 'assistant' },
  { id: 'memory', tab: 'assistant' },
  { id: 'provider', tab: 'ai' },
  { id: 'apiKey', tab: 'ai' },
  { id: 'cliCheck', tab: 'ai' },
  { id: 'aiTitles', tab: 'ai' },
  { id: 'suggestGroups', tab: 'ai' },
  { id: 'expressive', tab: 'capabilities' },
  { id: 'voice', tab: 'capabilities' },
  { id: 'computer', tab: 'capabilities' },
  { id: 'commands', tab: 'capabilities' },
  { id: 'commandsUnity', tab: 'capabilities' },
  { id: 'commandsBlender', tab: 'capabilities' },
  { id: 'schedules', tab: 'capabilities' },
  { id: 'scheduleTray', tab: 'capabilities' },
  { id: 'plugins', tab: 'connections' },
  { id: 'grantFolders', tab: 'privacy' },
  { id: 'grantGit', tab: 'privacy' },
  { id: 'grantUnity', tab: 'privacy' },
  { id: 'grantBlender', tab: 'privacy' },
  { id: 'grantSchedules', tab: 'privacy' },
  { id: 'grantConnections', tab: 'privacy' },
  { id: 'actionLog', tab: 'privacy' },
  { id: 'version', tab: 'updates' },
  { id: 'autoCheck', tab: 'updates' },
  { id: 'channel', tab: 'updates' },
  { id: 'reportBug', tab: 'support' }
]

export const tabOf = (id: string): SettingsTab | undefined => SETTING_ITEMS.find((i) => i.id === id)?.tab

/** Chữ đã dịch của một dòng (tên, mô tả, từ khoá thêm) — tab cũng tìm được theo tên ("giọng nói" → Khả năng). */
export type SettingText = { label: string; description: string; keywords: string; tabLabel: string }

/** Lọc dòng cài đặt theo tên + mô tả + từ khoá + tên tab; không dấu, mọi từ phải khớp. Giữ thứ tự tab → dòng. */
export function searchSettings(query: string, text: (item: SettingItem) => SettingText): SettingItem[] {
  if (!query.trim()) return []
  return SETTING_ITEMS.filter((item) => {
    const t = text(item)
    return matchesAllWords(`${t.label} ${t.description} ${t.keywords} ${t.tabLabel}`, query)
  })
}
