import { Folder, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { PrivacyScheduleGrant, PrivacyStatus, ScheduleGrantKey } from '@shared/privacy'
import { Button } from '@renderer/components/ui/button'
import { api } from '@renderer/lib/api'
import { optimistic, useSyncedState } from '@renderer/lib/sync'
import { cn } from '@renderer/lib/utils'
import { useSettingsDialog } from '../dialog'
import { AutoEditSessionList } from '@renderer/features/chat/approvals/AutoEdits'
import { SettingRow } from './rows'

/**
 * Quyền trợ lý đang có (B2). Không có mục sync riêng: hỏi lại theo các mục sẵn có của từng nơi lưu gốc. Thu hồi được
 * thư mục theo cuộc và từng quyền của lịch hẹn; lệnh git / Gmail / Telegram / agent / MCP chỉ hiện trạng thái + nút
 * tới chỗ quản lý (không thêm công tắc thứ hai).
 */
export function PrivacyGrants() {
  const { data, setData } = useSyncedState(
    ['conversations', 'schedules', 'deferred', 'commands', 'gmail', 'telegram', 'agents', 'mcpServers'],
    () => api.privacy.status()
  )
  if (!data) return null
  const revokeFolder = (conversationId: string): void => {
    void optimistic({
      topic: 'conversations',
      apply: () => setData({ ...data, folders: data.folders.filter((f) => f.conversationId !== conversationId) }),
      rollback: () => setData(data),
      save: () => api.privacy.revokeFolder(conversationId)
    })
  }
  const revokeGrant = (scheduleId: string, key: ScheduleGrantKey): void => {
    const drop = (s: PrivacyScheduleGrant): PrivacyScheduleGrant => ({
      ...s,
      // Thu hồi đọc thư mục mất luôn đề xuất sửa (như main).
      grants: s.grants.filter((g) => g.key !== key && !(key === 'folder' && g.key === 'folderWrite'))
    })
    void optimistic({
      topic: 'schedules',
      apply: () =>
        setData({
          ...data,
          schedules: data.schedules.map((s) => (s.scheduleId === scheduleId ? drop(s) : s)).filter((s) => s.grants.length > 0)
        }),
      rollback: () => setData(data),
      save: () => api.privacy.revokeScheduleGrant(scheduleId, key)
    })
  }
  return (
    <>
      <FoldersRow data={data} revoke={revokeFolder} />
      <AutoEditsRow />
      <GitRow enabled={data.git.enabled} />
      <GitRow id="grantUnity" focus="commandsUnity" testId="grant-unity" enabled={data.apps.unity.enabled} />
      <GitRow id="grantBlender" focus="commandsBlender" testId="grant-blender" enabled={data.apps.blender.enabled} />
      <SchedulesRow data={data} revoke={revokeGrant} />
      <ConnectionsRow data={data} />
    </>
  )
}

function FoldersRow({ data, revoke }: { data: PrivacyStatus; revoke(id: string): void }) {
  const { t } = useTranslation('settings')
  return (
    <SettingRow id="grantFolders">
      {data.folders.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="grant-folders-empty">
          {t('privacy.noFolders')}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="grant-folders">
          {data.folders.map((f) => (
            <li key={f.conversationId} className="flex items-center gap-3 px-3 py-2" data-testid="grant-folder" data-conversation={f.conversationId}>
              <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{f.title || t('actionLog.untitled')}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground" title={f.path}>
                  {f.path}
                </div>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
                  f.write ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300' : 'bg-muted text-muted-foreground'
                )}
                data-testid="grant-folder-access"
              >
                {f.write ? t('privacy.readWrite') : t('privacy.readOnly')}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => revoke(f.conversationId)}
                aria-label={t('privacy.revokeFolder', { title: f.title || t('actionLog.untitled') })}
                data-testid="grant-folder-revoke"
              >
                {t('privacy.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SettingRow>
  )
}

/** Phiên tự duyệt sửa file (PR C) — tự hỏi lại theo mục sync `autoEdits`; Tắt / Hoàn tác / Xong như trên băng khung chat. */
function AutoEditsRow() {
  const { t } = useTranslation('settings')
  return (
    <SettingRow id="grantAutoEdits">
      <AutoEditSessionList
        empty={
          <p className="text-xs text-muted-foreground" data-testid="grant-auto-edits-empty">
            {t('privacy.noAutoEdits')}
          </p>
        }
      />
    </SettingRow>
  )
}

/** Công tắc git / Unity / Blender là CHUNG cho mọi cuộc → chỉ hiện trạng thái, đổi ở Khả năng. */
function GitRow({
  enabled,
  id = 'grantGit',
  focus = 'commands',
  testId = 'grant-git'
}: {
  enabled: boolean
  id?: string
  focus?: string
  testId?: string
}) {
  const { t } = useTranslation('settings')
  const dialog = useSettingsDialog()
  return (
    <SettingRow
      id={id}
      control={
        <>
          <StatusText on={enabled} testId={`${testId}-status`} />
          <Button variant="outline" size="sm" onClick={() => dialog.focusOn(focus)} data-testid={`${testId}-open`}>
            {t('privacy.changeInCapabilities')}
          </Button>
        </>
      }
    />
  )
}

function SchedulesRow({ data, revoke }: { data: PrivacyStatus; revoke(id: string, key: ScheduleGrantKey): void }) {
  const { t } = useTranslation('settings')
  return (
    <SettingRow id="grantSchedules">
      {data.schedules.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="grant-schedules-empty">
          {t('privacy.noSchedules')}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="grant-schedules">
          {data.schedules.map((s) => (
            <li key={s.scheduleId} className="px-3 py-2" data-testid="grant-schedule" data-schedule={s.scheduleId}>
              <div className="flex items-center gap-2 text-sm">
                <span className="truncate">{s.name}</span>
                {!s.enabled && <span className="shrink-0 text-[11px] text-muted-foreground">· {t('privacy.scheduleOff')}</span>}
              </div>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {s.grants.map((g) => {
                  const text = t(`privacy.grantKinds.${g.kind}`, { value: g.label })
                  return (
                    <li
                      key={g.key}
                      className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2 text-xs"
                      data-testid="grant-schedule-item"
                      data-key={g.key}
                    >
                      <span className="truncate" title={text}>
                        {text}
                      </span>
                      <button
                        type="button"
                        className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
                        onClick={() => revoke(s.scheduleId, g.key)}
                        aria-label={t('privacy.revokeGrant', { grant: text })}
                        title={t('privacy.revoke')}
                        data-testid="grant-schedule-revoke"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </SettingRow>
  )
}

/** Gmail / Telegram / agent / MCP: chỉ trạng thái, quản lý (bật / tắt / gỡ) ở trang Plugin. */
function ConnectionsRow({ data }: { data: PrivacyStatus }) {
  const { t } = useTranslation('settings')
  const mcpOn = data.mcp.filter((s) => s.enabled)
  const always = data.mcp.flatMap((s) => s.alwaysAllow.map((tool) => `${s.name}/${tool}`))
  const rows: { key: string; on: boolean; detail: string; to: string }[] = [
    {
      key: 'gmail',
      on: data.gmail.enabled && data.gmail.accounts.length > 0,
      detail: data.gmail.accounts.map((a) => a.email).join(', '),
      to: '/plugins/gmail'
    },
    { key: 'telegram', on: data.telegram.enabled, detail: data.telegram.account ?? '', to: '/plugins/telegram' },
    { key: 'agents', on: data.agents.enabled, detail: data.agents.clients.join(', '), to: '/plugins/agents' },
    {
      key: 'mcp',
      on: mcpOn.length > 0,
      detail: [
        mcpOn.map((s) => s.name).join(', '),
        always.length ? t('privacy.alwaysAllowed', { tools: always.join(', ') }) : ''
      ]
        .filter(Boolean)
        .join(' · '),
      to: '/plugins/mcp'
    }
  ]
  return (
    <SettingRow id="grantConnections">
      <ul className="divide-y rounded-lg border" data-testid="grant-connections">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3 px-3 py-2" data-testid="grant-connection" data-key={r.key}>
            <div className="min-w-0 flex-1">
              <div className="text-sm">{t(`privacy.connections.${r.key}`)}</div>
              {r.detail && <div className="truncate text-[11px] text-muted-foreground" title={r.detail}>{r.detail}</div>}
            </div>
            <StatusText on={r.on} testId="grant-connection-status" />
            <Button variant="outline" size="sm" asChild>
              <Link to={r.to} data-testid="grant-connection-open">
                {t('privacy.openPlugins')}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </SettingRow>
  )
}

function StatusText({ on, testId }: { on: boolean; testId: string }) {
  const { t } = useTranslation('settings')
  return (
    <span
      className={cn('shrink-0 text-xs', on ? 'font-medium text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground')}
      data-testid={testId}
      data-on={on}
    >
      {on ? t('privacy.on') : t('privacy.off')}
    </span>
  )
}
