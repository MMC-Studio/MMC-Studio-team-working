import { useLocation, useNavigate, type To } from 'react-router'
import { DEFAULT_TAB, isSettingsTab, tabOf, type SettingsTab } from './catalog'

/**
 * Cửa sổ Cài đặt mở / đóng bằng tham số trên địa chỉ trang hiện tại: `?settings=<tab>` (+ `&setting=<id>` để nhảy tới
 * một dòng). Nhờ vậy cửa sổ nổi đè lên đúng trang đang xem; chuyển trang (vd bấm "Mở" Gmail & Telegram) là tự đóng.
 * Đều dùng `replace` → không chèn thêm lượt vào lịch sử Back.
 */
export const SETTINGS_PARAM = 'settings'
export const FOCUS_PARAM = 'setting'

export type SettingsDialogState = {
  open: boolean
  tab: SettingsTab
  /** Dòng cần nhảy tới + nháy nền (một lần). */
  focus: string | null
  show(tab?: SettingsTab, focus?: string): void
  setTab(tab: SettingsTab): void
  /** Nhảy tới một dòng (đổi tab nếu cần). */
  focusOn(id: string): void
  clearFocus(): void
  close(): void
}

/** Đường dẫn mở Cài đặt ở `pathname` (vd từ trang khác / thông báo). */
export function settingsLink(pathname: string, tab: SettingsTab = DEFAULT_TAB, focus?: string): To {
  const p = new URLSearchParams({ [SETTINGS_PARAM]: tab })
  if (focus) p.set(FOCUS_PARAM, focus)
  return { pathname, search: `?${p.toString()}` }
}

export function useSettingsDialog(): SettingsDialogState {
  const location = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const raw = params.get(SETTINGS_PARAM)
  const tab = isSettingsTab(raw) ? raw : DEFAULT_TAB

  const update = (change: (p: URLSearchParams) => void): void => {
    const p = new URLSearchParams(location.search)
    change(p)
    const search = p.toString()
    void navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true })
  }
  const set = (nextTab: SettingsTab, focus: string | null): void =>
    update((p) => {
      p.set(SETTINGS_PARAM, nextTab)
      if (focus) p.set(FOCUS_PARAM, focus)
      else p.delete(FOCUS_PARAM)
    })

  return {
    open: raw !== null,
    tab,
    focus: params.get(FOCUS_PARAM),
    show: (nextTab, focus) => set(nextTab ?? (focus ? (tabOf(focus) ?? DEFAULT_TAB) : DEFAULT_TAB), focus ?? null),
    setTab: (nextTab) => set(nextTab, null),
    focusOn: (id) => set(tabOf(id) ?? tab, id),
    clearFocus: () => update((p) => p.delete(FOCUS_PARAM)),
    close: () =>
      update((p) => {
        p.delete(SETTINGS_PARAM)
        p.delete(FOCUS_PARAM)
      })
  }
}
