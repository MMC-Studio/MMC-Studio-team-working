import {
  Bot,
  LifeBuoy,
  MessagesSquare,
  Palette,
  Plug,
  RefreshCw,
  Search,
  Sparkles,
  X,
  type LucideIcon
} from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { SETTINGS_TAB_GROUPS, searchSettings, type SettingItem, type SettingsTab } from '../catalog'
import { useSettingsDialog } from '../dialog'
import { SettingsTabContent } from './SettingsTabs'

const TAB_ICON: Record<SettingsTab, LucideIcon> = {
  appearance: Palette,
  assistant: Bot,
  ai: MessagesSquare,
  capabilities: Sparkles,
  connections: Plug,
  updates: RefreshCw,
  support: LifeBuoy
}

/** Thời gian nháy nền dòng vừa nhảy tới (khớp animation `setting-flash` trong styles.css). */
const FLASH_MS = 1600

/** Cửa sổ Cài đặt nổi (gắn luôn trong app; mở bằng `?settings=<tab>` — xem dialog.ts). */
export function SettingsDialog() {
  const dialog = useSettingsDialog()
  return dialog.open ? <SettingsDialogContent dialog={dialog} /> : null
}

function SettingsDialogContent({ dialog }: { dialog: ReturnType<typeof useSettingsDialog> }) {
  const { t } = useTranslation('settings')
  const { tab, focus, setTab, focusOn, clearFocus, close } = dialog
  const [query, setQuery] = useState('')
  const searchBox = useRef<HTMLInputElement>(null)
  const content = useRef<HTMLDivElement>(null)

  const results = useMemo(
    () =>
      searchSettings(query, (item: SettingItem) => ({
        label: t(`dialog.items.${item.id}.label`),
        description: t(`dialog.items.${item.id}.description`),
        keywords: t(`dialog.items.${item.id}.keywords`),
        tabLabel: t(`dialog.tabs.${item.tab}`)
      })),
    [query, t]
  )
  const searching = query.trim().length > 0

  // Đổi tab → về đầu nội dung (trừ khi đang nhảy tới một dòng).
  useEffect(() => {
    if (!focus) content.current?.scrollTo({ top: 0 })
  }, [tab, focus])

  // Nhảy tới dòng + nháy nền. Dòng có thể chưa có ngay (phần đó còn đang tải dữ liệu) → thử lại một lúc.
  const clearFocusRef = useRef(clearFocus)
  useEffect(() => {
    clearFocusRef.current = clearFocus
  })
  useEffect(() => {
    if (!focus) return
    let tries = 0
    let flashTimer: ReturnType<typeof setTimeout> | undefined
    const timer = setInterval(() => {
      const el = content.current?.querySelector<HTMLElement>(`[data-setting-id="${focus}"]`)
      if (!el && ++tries < 40) return
      clearInterval(timer)
      if (el) {
        el.scrollIntoView({ block: 'center' })
        el.classList.remove('setting-flash')
        void el.offsetWidth // chạy lại animation nếu nhảy tới cùng dòng lần nữa
        el.classList.add('setting-flash')
        el.dataset.flashed = 'true'
        flashTimer = setTimeout(() => el.classList.remove('setting-flash'), FLASH_MS)
      }
      clearFocusRef.current()
    }, 25)
    return () => {
      clearInterval(timer)
      if (flashTimer) clearTimeout(flashTimer)
    }
  }, [focus, tab])

  const pick = (item: SettingItem): void => {
    setQuery('')
    focusOn(item.id)
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(v) => !v && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed top-1/2 left-1/2 z-50 flex h-[min(760px,calc(100vh-48px))] w-[min(1040px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-card shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            searchBox.current?.focus()
          }}
          onEscapeKeyDown={(e) => {
            // Esc khi đang tìm → xoá ô tìm trước, Esc lần nữa mới đóng.
            if (!searching) return
            e.preventDefault()
            setQuery('')
          }}
          data-testid="settings-dialog"
          data-tab={tab}
        >
          <header className="flex items-center justify-between border-b px-5 py-3">
            <DialogPrimitive.Title className="text-base font-semibold">{t('dialog.title')}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">{t('dialog.title')}</DialogPrimitive.Description>
            <DialogPrimitive.Close
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t('dialog.close')}
              title={`${t('dialog.close')} (Esc)`}
              data-testid="settings-close"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </header>

          <div className="flex min-h-0 flex-1">
            <aside className="thin-scroll flex w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r p-3 lg:w-60">
              <div className="relative mb-1">
                <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
                <input
                  ref={searchBox}
                  className="h-8 w-full rounded-md bg-muted pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
                  placeholder={t('dialog.search')}
                  aria-label={t('dialog.search')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && results[0]) {
                      e.preventDefault()
                      pick(results[0])
                    }
                  }}
                  data-testid="settings-search"
                />
              </div>

              {searching ? (
                results.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground" data-testid="settings-no-results">
                    {t('dialog.noResults', { query: query.trim() })}
                  </p>
                ) : (
                  <ul className="space-y-0.5" aria-label={t('dialog.search')}>
                    {results.map((item) => (
                      <li key={item.id}>
                        <button
                          className="w-full rounded-md px-2.5 py-1.5 text-left hover:bg-muted"
                          onClick={() => pick(item)}
                          data-testid="settings-result"
                          data-setting={item.id}
                        >
                          <span className="block truncate text-sm">{t(`dialog.items.${item.id}.label`)}</span>
                          <span className="block truncate text-xs text-muted-foreground">{t(`dialog.tabs.${item.tab}`)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <nav aria-label={t('dialog.title')}>
                  {SETTINGS_TAB_GROUPS.map((group, gi) => (
                    <Fragment key={gi}>
                      {gi > 0 && <div className="mx-2 my-2 border-t" />}
                      {group.map((id) => {
                        const Icon = TAB_ICON[id]
                        return (
                          <button
                            key={id}
                            className={cn(
                              'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-foreground/85 hover:bg-muted',
                              id === tab && 'bg-muted font-medium text-foreground'
                            )}
                            aria-current={id === tab ? 'page' : undefined}
                            onClick={() => setTab(id)}
                            data-testid={`settings-tab-${id}`}
                          >
                            <Icon className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{t(`dialog.tabs.${id}`)}</span>
                          </button>
                        )
                      })}
                    </Fragment>
                  ))}
                </nav>
              )}
            </aside>

            <div ref={content} className="thin-scroll min-w-0 flex-1 overflow-y-auto px-6 py-5" data-testid="settings-content">
              <h2 className="pb-3 text-base font-semibold">{t(`dialog.tabs.${tab}`)}</h2>
              <SettingsTabContent tab={tab} />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
