import { KeyRound, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { AI_PROVIDERS, apiKeySchema, type AiProviderId, type AiSettings, type ChatOrganizeSettings } from '@shared/schemas'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { optimistic, useSyncedState } from '@renderer/lib/sync'
import { cn } from '@renderer/lib/utils'
import { SettingRow, Switch } from './rows'

type AiState = AiSettings & { hasApiKey: boolean; secureStorage: boolean }

const CONSOLE_URL = 'https://platform.claude.com/settings/keys'

/**
 * Cài đặt AI (nhà cung cấp, key, tự đề xuất ghi nhớ) — dùng chung cho các dòng ở tab khác nhau.
 * Đồng bộ mục `ai`; bấm là đổi ngay, lỗi thì hoàn tác + báo.
 */
function useAiSettings() {
  const { data: state, setData, refresh } = useSyncedState('ai', (): Promise<AiState> => api.settings.getAi())
  const save = async (patch: Partial<AiSettings>): Promise<void> => {
    if (!state) return
    const next = { provider: state.provider, autoSuggestMemory: state.autoSuggestMemory, ...patch }
    await optimistic({
      topic: 'ai',
      apply: () => setData({ ...state, ...next }),
      rollback: () => setData(state),
      save: () => api.settings.setAi(next)
    })
  }
  return { state, reload: refresh, save }
}

/** Tab Trò chuyện & AI: chạy trợ lý bằng CLI / API key, ô API key, kiểm tra CLI. */
export function AiConnectionRows() {
  const { t } = useTranslation('settings')
  const { state, reload, save } = useAiSettings()
  const [key, setKey] = useState('')
  const [keyError, setKeyError] = useState(false)

  if (!state) return null

  const saveKey = async (): Promise<void> => {
    if (!apiKeySchema.safeParse(key).success) {
      setKeyError(true)
      return
    }
    await api.settings.setApiKey(key.trim())
    setKey('')
    setKeyError(false)
    await reload()
  }

  const canUse = (p: AiProviderId): boolean => p === 'claude-cli' || state.hasApiKey

  return (
    <>
      <SettingRow id="provider">
        <div className="space-y-2" role="radiogroup" aria-label={t('ai.provider')}>
          {AI_PROVIDERS.map((p) => (
            <label
              key={p}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border p-3',
                state.provider === p && 'border-primary bg-primary/5',
                !canUse(p) && 'cursor-not-allowed opacity-60'
              )}
            >
              <input
                type="radio"
                name="ai-provider"
                className="mt-1"
                checked={state.provider === p}
                disabled={!canUse(p)}
                onChange={() => void save({ provider: p })}
              />
              <span>
                <span className="block text-sm font-medium">{t(`ai.providers.${p}.name`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`ai.providers.${p}.description`)}</span>
              </span>
            </label>
          ))}
        </div>
      </SettingRow>

      <SettingRow id="apiKey" htmlFor="api-key">
        {!state.secureStorage ? (
          <p className="text-sm text-destructive">{t('ai.noSecureStorage')}</p>
        ) : state.hasApiKey ? (
          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <KeyRound className="size-4" />
              {t('ai.keySaved')}
            </span>
            <Button variant="ghost" size="sm" onClick={async () => (await api.settings.clearApiKey(), reload())}>
              <Trash2 />
              {t('ai.removeKey')}
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Input
              id="api-key"
              type="password"
              autoComplete="off"
              placeholder="sk-ant-…"
              value={key}
              onChange={(e) => {
                setKey(e.target.value)
                setKeyError(false)
              }}
            />
            <Button onClick={() => void saveKey()} disabled={!key.trim()}>
              {t('common:actions.save')}
            </Button>
          </div>
        )}
        {keyError && <p className="mt-2 text-sm text-destructive">{t('ai.invalidKey')}</p>}
        <button type="button" className="mt-2 text-xs text-primary underline" onClick={() => void api.app.openExternal(CONSOLE_URL)}>
          {t('ai.getKey')}
        </button>
      </SettingRow>

      <SettingRow
        id="cliCheck"
        control={
          <Button variant="outline" size="sm" asChild>
            <Link to="/claude">{t('dialog.open')}</Link>
          </Button>
        }
      />
    </>
  )
}

/** Tab Trợ lý của bạn: tự đề xuất ghi nhớ khi rời cuộc trò chuyện. */
export function AutoSuggestRow() {
  const { state, save } = useAiSettings()
  if (!state) return null
  return (
    <SettingRow
      id="autoSuggestMemory"
      htmlFor="auto-suggest-memory"
      control={
        <Switch
          id="auto-suggest-memory"
          checked={state.autoSuggestMemory}
          onChange={(e) => void save({ autoSuggestMemory: e.target.checked })}
          data-testid="auto-suggest-memory"
        />
      }
    />
  )
}

/** Đặt tiêu đề / gợi ý nhóm cho cuộc trò chuyện mới bằng model rẻ (Haiku). */
export function OrganizeRows() {
  const { data, setData } = useSyncedState('conversations', () => api.settings.getChatOrganize())
  if (!data) return null
  const toggle = (key: keyof ChatOrganizeSettings, value: boolean): void => {
    const next = { ...data, [key]: value }
    void optimistic({
      topic: 'conversations',
      apply: () => setData(next),
      rollback: () => setData(data),
      save: () => api.settings.setChatOrganize(next)
    })
  }
  return (
    <>
      {(['aiTitles', 'suggestGroups'] as const).map((key) => (
        <SettingRow
          key={key}
          id={key}
          htmlFor={`organize-${key}`}
          control={
            <Switch
              id={`organize-${key}`}
              checked={data[key]}
              onChange={(e) => toggle(key, e.target.checked)}
              data-testid={`organize-${key}`}
            />
          }
        />
      ))}
    </>
  )
}
