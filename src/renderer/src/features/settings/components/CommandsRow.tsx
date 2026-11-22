import { useTranslation } from 'react-i18next'
import { api } from '@renderer/lib/api'
import { optimistic, useSyncedState } from '@renderer/lib/sync'
import { SettingRow, Switch } from './rows'

/** "Chạy lệnh git (chỉ đọc)" — mặc định tắt; hiện git app sẽ dùng (đường dẫn tuyệt đối) hoặc lý do không dùng được. */
export function CommandsRow() {
  const { t } = useTranslation('settings')
  const { data, setData } = useSyncedState('commands', () => api.commands.status())
  const git = data?.git
  const usable = !!git && !('error' in git)
  const toggle = (gitEnabled: boolean): void => {
    if (!data) return
    void optimistic({
      topic: 'commands',
      apply: () => setData({ ...data, settings: { ...data.settings, gitEnabled } }),
      rollback: () => setData(data),
      save: () => api.commands.setSettings({ ...data.settings, gitEnabled })
    })
  }
  return (
    <SettingRow
      id="commands"
      htmlFor="commands-git"
      control={
        <Switch
          id="commands-git"
          checked={!!data?.settings.gitEnabled}
          // Bật được khi có git dùng được; đang bật mà git hỏng vẫn tắt được.
          disabled={!data || (!usable && !data.settings.gitEnabled)}
          onChange={(e) => toggle(e.target.checked)}
          data-testid="commands-git-switch"
        />
      }
    >
      {git && (
        <p className={usable ? 'text-xs text-muted-foreground' : 'text-xs text-orange-700 dark:text-orange-300'} data-testid="commands-git-status">
          {'error' in git
            ? git.error === 'too_old'
              ? t('commands.gitTooOld', { version: git.version ?? '?' })
              : t('commands.gitNotFound')
            : t('commands.gitAt', { path: git.path, version: git.version })}
        </p>
      )}
    </SettingRow>
  )
}
