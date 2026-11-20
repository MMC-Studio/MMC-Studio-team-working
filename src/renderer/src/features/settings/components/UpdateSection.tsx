import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { UPDATE_CHANNELS, type UpdateSettings } from '@shared/schemas'
import { Button } from '@renderer/components/ui/button'
import { Select } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { optimistic, useSyncedState } from '@renderer/lib/sync'
import { useUpdate } from '@renderer/stores/update'
import { SettingRow, Switch } from './rows'

/** Tab Cập nhật: phiên bản + "Kiểm tra ngay", tự kiểm tra bản mới, kênh stable/beta. */
export function UpdateRows() {
  const { t } = useTranslation('settings')
  const { data: settings, setData: setSettings } = useSyncedState('update', () => api.update.getSettings())
  const update = useUpdate((s) => s.state)

  if (!settings) return null

  // Hiện ngay khi bấm (không đợi IPC), lưu sau; lỗi → hoàn tác + báo lỗi chung.
  const save = async (patch: Partial<UpdateSettings>): Promise<void> => {
    const next = { autoCheck: settings.autoCheck, channel: settings.channel, ...patch }
    await optimistic({
      topic: 'update',
      apply: () => setSettings({ ...settings, ...next }),
      rollback: () => setSettings(settings),
      save: () => api.update.setSettings(next)
    })
  }

  const status = (() => {
    switch (update.state) {
      case 'unsupported':
        return t('update.status.unsupported')
      case 'checking':
        return t('update.status.checking')
      case 'none':
        return t('update.status.none')
      case 'available':
        return t('update.status.available', { version: update.info.version })
      case 'downloading':
        return t('update.status.downloading', { version: update.info.version, percent: Math.round(update.percent) })
      case 'downloaded':
        return t('update.status.downloaded', { version: update.info.version })
      case 'error':
        return t('update.status.error', { message: update.message })
      default:
        return ''
    }
  })()

  const busy = update.state === 'checking' || update.state === 'downloading'
  const pending = update.state === 'available' || update.state === 'downloaded'

  return (
    <>
      <SettingRow
        id="version"
        label={t('update.current', { version: settings.currentVersion })}
        description={
          <>
            {status && (
              <span className="block" data-testid="update-status">
                {status}
              </span>
            )}
            <span className="block">{t('dialog.items.version.description')}</span>
          </>
        }
        control={
          <>
            {pending && (
              <Button size="sm" onClick={() => void api.update.check()}>
                {t('update.view')}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || update.state === 'unsupported'}
              onClick={() => void api.update.check()}
            >
              <RefreshCw />
              {t('update.checkNow')}
            </Button>
          </>
        }
      />
      <SettingRow
        id="autoCheck"
        htmlFor="update-auto-check"
        control={
          <Switch
            id="update-auto-check"
            checked={settings.autoCheck}
            onChange={(e) => void save({ autoCheck: e.target.checked })}
            data-testid="update-auto-check"
          />
        }
      />
      <SettingRow
        id="channel"
        htmlFor="update-channel"
        description={t(`update.channels.${settings.channel}.description`)}
        control={
          <Select
            id="update-channel"
            className="w-auto"
            value={settings.channel}
            onChange={(e) => void save({ channel: e.target.value as UpdateSettings['channel'] })}
            data-testid="update-channel"
          >
            {UPDATE_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`update.channels.${c}.name`)}
              </option>
            ))}
          </Select>
        }
      />
    </>
  )
}
