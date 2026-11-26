import { create } from 'zustand'
import {
  DEFAULT_APPEARANCE,
  DEFAULT_ASSISTANT,
  type Appearance,
  type AssistantProfile
} from '@shared/schemas'
import { api } from '@renderer/lib/api'
import i18n from '@renderer/i18n'
import { pushAssistantIfSignedIn } from './assistantSync'

type PreferencesState = {
  assistant: AssistantProfile
  appearance: Appearance
  loaded: boolean
  load(): Promise<void>
  /** Đổi tài khoản → đọc lại trợ lý của tài khoản mới. */
  reloadAssistant(): Promise<void>
  /** Người dùng đổi cài đặt trợ lý (lưu máy + đồng bộ tài khoản). */
  saveAssistant(profile: AssistantProfile): Promise<void>
  /** Áp cài đặt (vd lấy từ tài khoản) mà không đẩy ngược lên. */
  applyAssistant(profile: AssistantProfile): Promise<void>
  saveAppearance(appearance: Appearance): Promise<void>
}

const darkQuery = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)')
const reduceMotionQuery = (): MediaQueryList => window.matchMedia('(prefers-reduced-motion: reduce)')

export function resolveDark(theme: Appearance['theme'], systemDark: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && systemDark)
}

/** "Theo Windows" → theo `prefers-reduced-motion` của hệ thống. */
export function resolveReduceMotion(motion: Appearance['motion'], systemReduce: boolean): boolean {
  return motion === 'reduce' || (motion === 'system' && systemReduce)
}

/** Đang giảm chuyển động? Thành phần dùng để bỏ hiệu ứng chạy bằng JS (vd số đếm lên). */
export function isMotionReduced(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduce'
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement
  root.classList.toggle('dark', resolveDark(appearance.theme, darkQuery().matches))
  root.dataset.accent = appearance.accent
  // styles.css: 'reduce' tắt mọi animation / transition trong app; 'full' bật biến thể `motion-ok:`.
  root.dataset.motion = resolveReduceMotion(appearance.motion, reduceMotionQuery().matches) ? 'reduce' : 'full'
}

export const usePreferences = create<PreferencesState>((set, get) => ({
  assistant: DEFAULT_ASSISTANT,
  appearance: DEFAULT_APPEARANCE,
  loaded: false,

  async load() {
    const [assistant, appearance] = await Promise.all([
      api.settings.getAssistant(),
      api.settings.getAppearance()
    ])
    applyAppearance(appearance)
    await i18n.changeLanguage(assistant.language)
    set({ assistant, appearance, loaded: true })
    darkQuery().addEventListener('change', () => applyAppearance(get().appearance))
    reduceMotionQuery().addEventListener('change', () => applyAppearance(get().appearance))
  },

  async reloadAssistant() {
    const assistant = await api.settings.getAssistant()
    await i18n.changeLanguage(assistant.language)
    set({ assistant })
  },

  async saveAssistant(profile) {
    await get().applyAssistant(profile)
    // Người dùng tự đổi → đánh dấu mới nhất và đẩy lên tài khoản (nếu đang đăng nhập).
    void pushAssistantIfSignedIn(get().assistant)
  },

  async applyAssistant(profile) {
    const assistant = await api.settings.setAssistant(profile)
    await i18n.changeLanguage(assistant.language)
    set({ assistant })
  },

  async saveAppearance(next) {
    const appearance = await api.settings.setAppearance(next)
    applyAppearance(appearance)
    set({ appearance })
  }
}))
