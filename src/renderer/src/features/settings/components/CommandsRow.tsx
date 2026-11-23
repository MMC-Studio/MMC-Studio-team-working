import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { APP_EXE_NAMES, type AppProgram } from '@shared/commands'
import { Button } from '@renderer/components/ui/button'
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

/**
 * "Chạy Unity" / "Chạy Blender" (A2) — mặc định tắt, bật riêng từng phần mềm. Chương trình do người dùng tự chọn (hộp
 * chọn file mở ở main, không lấy từ PATH); chưa chọn thì không bật được. Hiện phiên bản đọc được (Unity: app so với
 * phiên bản dự án trước mỗi lần chạy).
 */
export function AppRunRow({ program }: { program: AppProgram }) {
  const { t } = useTranslation('settings')
  const { data, setData } = useSyncedState('commands', () => api.commands.status())
  const [error, setError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const app = data?.apps[program]
  const exe = APP_EXE_NAMES[program]
  const id = program === 'unity' ? 'commandsUnity' : 'commandsBlender'
  const toggle = (enabled: boolean): void => {
    if (!data || !app) return
    void optimistic({
      topic: 'commands',
      apply: () => setData({ ...data, apps: { ...data.apps, [program]: { ...app, enabled } } }),
      rollback: () => setData(data),
      save: () => api.commands.setApp(program, enabled)
    })
  }
  const choose = async (): Promise<void> => {
    setError(null)
    setChoosing(true)
    try {
      const r = await api.commands.chooseApp(program)
      if ('error' in r) setError(t('commands.wrongName', { expected: r.expected }))
      else if ('status' in r) setData(r.status)
    } finally {
      setChoosing(false)
    }
  }
  const warn = 'text-xs text-orange-700 dark:text-orange-300'
  return (
    <SettingRow
      id={id}
      htmlFor={`commands-${program}`}
      label={
        // Blender chưa được test với Blender thật → "Thử nghiệm" cho tới khi có người test (bỏ nhãn = bỏ dòng này).
        program === 'blender' ? (
          <span className="inline-flex items-center gap-2">
            {t(`dialog.items.${id}.label`)}
            <span
              className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-orange-700 dark:text-orange-300"
              data-testid="commands-blender-experimental"
            >
              {t('commands.experimental')}
            </span>
          </span>
        ) : undefined
      }
      control={
        <Switch
          id={`commands-${program}`}
          checked={!!app?.enabled}
          // Chưa chọn chương trình thì không bật được; đang bật thì luôn tắt được.
          disabled={!app || (!app.path && !app.enabled)}
          onChange={(e) => toggle(e.target.checked)}
          data-testid={`commands-${program}-switch`}
        />
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {app && (
          <p
            className={!app.path || app.missing || (program === 'unity' && !app.version) ? warn : 'min-w-0 break-all text-xs text-muted-foreground'}
            data-testid={`commands-${program}-status`}
          >
            {!app.path
              ? t('commands.appNotChosen', { exe })
              : app.missing
                ? t('commands.appMissing', { path: app.path })
                : app.version
                  ? t('commands.appAt', { path: app.path, version: app.version })
                  : program === 'unity'
                    ? t('commands.unityNoVersion', { path: app.path })
                    : t('commands.appAtNoVersion', { path: app.path })}
          </p>
        )}
        <Button size="sm" variant="outline" disabled={!data || choosing} onClick={() => void choose()} data-testid={`commands-${program}-choose`}>
          {t(app?.path ? 'commands.changeExe' : 'commands.chooseExe', { exe })}
        </Button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-destructive" role="alert" data-testid={`commands-${program}-error`}>
          {error}
        </p>
      )}
    </SettingRow>
  )
}
