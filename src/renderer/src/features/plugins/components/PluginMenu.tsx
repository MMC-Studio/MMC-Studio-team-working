import { Ellipsis, Eye, Power, PowerOff, Settings2, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@renderer/components/ui/dialog'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@renderer/components/ui/menu'
import { cn } from '@renderer/lib/utils'
import { useConnectors } from '@renderer/features/connectors/store'
import { pluginName } from '../labels'
import type { PluginItem } from '../model'
import { removePlugin, setPluginEnabled } from '../store'

/**
 * Menu ⋯ của MỘT plugin (dòng trên trang Plugin và đầu trang chi tiết): Cài đặt / Xem, Bật / Tắt, Gỡ.
 * Đây là công tắc DUY NHẤT của mục đó trong app. Bật Gmail / Telegram / Kết nối agent hiện đúng các cảnh báo mà công tắc
 * cũ hiện bên cạnh (mô tả, Riêng tư, Thử nghiệm) trong một hộp xác nhận; các bước duyệt sau đó (agent mới, tool MCP, nháp)
 * không đổi. Gỡ luôn qua hộp xác nhận.
 */
export function PluginMenu({ item, showSettings = true, className }: { item: PluginItem; showSettings?: boolean; className?: string }) {
  const { t } = useTranslation('plugins')
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<'enable' | 'remove' | null>(null)
  const name = pluginName(item, t)
  const builtin = item.type === 'builtinSkill'

  const turnOn = (): void => {
    if (item.confirmEnable) setDialog('enable')
    else void setPluginEnabled(item, true)
  }

  return (
    <>
      <Menu>
        <MenuTrigger
          className={cn('rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground', className)}
          aria-label={t('menu.options', { name })}
          title={t('menu.options', { name })}
          onClick={(e) => e.stopPropagation()}
          data-testid={`plugin-menu-${item.key}`}
        >
          <Ellipsis className="size-4" />
        </MenuTrigger>
        <MenuContent onClick={(e) => e.stopPropagation()}>
          {showSettings && (
            <MenuItem
              icon={builtin ? <Eye /> : <Settings2 />}
              onSelect={() => void navigate(item.href)}
              data-testid="plugin-menu-settings"
            >
              {builtin ? t('menu.view') : t('menu.settings')}
            </MenuItem>
          )}
          {item.toggleable &&
            (item.enabled ? (
              <MenuItem icon={<PowerOff />} onSelect={() => void setPluginEnabled(item, false)} data-testid="plugin-menu-disable">
                {t('menu.disable')}
              </MenuItem>
            ) : (
              <MenuItem icon={<Power />} onSelect={turnOn} data-testid="plugin-menu-enable">
                {t('menu.enable')}
              </MenuItem>
            ))}
          {item.removable && (
            <MenuItem icon={<Trash2 />} destructive onSelect={() => setDialog('remove')} data-testid="plugin-menu-remove">
              {t('menu.remove')}
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
      {dialog === 'enable' && <EnableDialog item={item} onClose={() => setDialog(null)} />}
      {dialog === 'remove' && <RemoveDialog item={item} onClose={() => setDialog(null)} />}
    </>
  )
}

/** Cảnh báo khi bật — cùng nội dung đã đứng cạnh công tắc cũ ở trang Gmail & Telegram / Kết nối agent. */
function EnableWarnings({ item }: { item: PluginItem }) {
  const { t } = useTranslation(['plugins', 'connectors', 'agents'])
  if (item.type === 'agents') {
    return (
      <div className="space-y-2" data-testid="plugin-enable-warnings">
        <p>{t('agents:server.enableHelp')}</p>
        <p className="text-muted-foreground">{t('agents:server.help')}</p>
      </div>
    )
  }
  const points = t('connectors:privacy.points', { returnObjects: true }) as string[]
  return (
    <div className="space-y-3" data-testid="plugin-enable-warnings">
      <p>{t(`connectors:${item.type}.enableHelp`)}</p>
      <section className="rounded-lg border bg-muted/30 p-3">
        <p className="flex items-center gap-2 font-medium">
          <ShieldCheck className="size-4 text-primary" />
          {t('connectors:privacy.title')}
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export function EnableDialog({ item, onClose }: { item: PluginItem; onClose(): void }) {
  const { t } = useTranslation('plugins')
  const navigate = useNavigate()
  const gmail = useConnectors((s) => s.gmail)
  const telegram = useConnectors((s) => s.telegram)
  // Chưa nhập OAuth client / api_id → bật xong mở thẳng trang cấu hình.
  const needsSetup = (item.type === 'gmail' && !gmail?.configured) || (item.type === 'telegram' && !telegram?.configured)
  const name = pluginName(item, t)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={t('enableDialog.title', { name })} data-testid="plugin-enable-dialog">
        <div className="space-y-4 text-sm">
          <span className="inline-block rounded bg-orange-500/15 px-1.5 py-0.5 text-xs font-semibold text-orange-700 dark:text-orange-300">
            {t('state.experimental')}
          </span>
          <EnableWarnings item={item} />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button
              onClick={() => {
                onClose()
                void setPluginEnabled(item, true)
                if (needsSetup) void navigate(item.href)
              }}
              data-testid="plugin-enable-confirm"
            >
              {needsSetup ? t('enableDialog.confirmSetup') : t('enableDialog.confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RemoveDialog({ item, onClose }: { item: PluginItem; onClose(): void }) {
  const { t } = useTranslation('plugins')
  const name = pluginName(item, t)
  const body = item.type === 'mcp' ? 'mcp' : 'skill'
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={t('removeDialog.title', { name })} data-testid="plugin-remove-dialog">
        <div className="space-y-4 text-sm">
          <p>{t(`removeDialog.${body}`)}</p>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                onClose()
                void removePlugin(item)
              }}
              data-testid="plugin-remove-confirm"
            >
              {t('removeDialog.confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
