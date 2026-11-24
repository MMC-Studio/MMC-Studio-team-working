import { FolderOpen, FolderPlus, FolderX, Lock, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_EXTRA_DIRS, type Conversation, type ExtraFolder } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/utils'
import { useChat } from '../store'

/** Bật quyền sửa phải xác nhận: thư mục chính, hoặc một thư mục phụ (D). */
type Confirm = { kind: 'main' } | { kind: 'extra'; path: string } | null

/**
 * Thư mục của cuộc trò chuyện (mọi chế độ): chọn / đổi / gỡ thư mục và bật/tắt quyền sửa file.
 * Mặc định chỉ đọc; bật sửa phải xác nhận, và mỗi lần sửa vẫn phải duyệt diff.
 * Thư mục phụ (D): tối đa 3, chỉ khi có thư mục chính; sửa = tick riêng từng thư mục, luôn hỏi (không tự duyệt).
 */
export function CodeBar({ conversation, busy }: { conversation: Conversation | undefined; busy: boolean }) {
  const { t } = useTranslation('chat')
  const { chooseFolder, setCodeWrite, clearFolder, addExtraFolder, removeExtraFolder, setExtraWrite } = useChat()
  const [confirm, setConfirm] = useState<Confirm>(null)
  const extras = conversation?.extraDirs ?? []
  const full = extras.length >= MAX_EXTRA_DIRS

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs" data-testid="code-bar">
      <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => void chooseFolder()}>
        <FolderOpen />
        {conversation?.cwd ? t('code.changeFolder') : t('code.chooseFolder')}
      </Button>
      {conversation?.cwd ? (
        <>
          <code className="min-w-0 truncate" title={conversation.cwd}>
            {conversation.cwd}
          </code>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            title={t(extras.length ? 'code.clearFolderHintExtras' : 'code.clearFolderHint')}
            aria-label={t('code.clearFolder')}
            data-testid="code-clear-folder"
            onClick={() => void clearFolder(conversation.id)}
          >
            <FolderX />
          </Button>
        </>
      ) : (
        <span className="text-muted-foreground">{t('code.noFolder')}</span>
      )}
      {conversation?.cwd && (
        <label className={cn('ml-auto flex items-center gap-1.5', conversation.codeWrite && 'text-orange-700 dark:text-orange-300')}>
          <input
            type="checkbox"
            checked={conversation.codeWrite}
            disabled={busy}
            onChange={(e) => (e.target.checked ? setConfirm({ kind: 'main' }) : void setCodeWrite(conversation.id, false))}
          />
          {conversation.codeWrite ? <ShieldAlert className="size-3.5" /> : <Lock className="size-3.5" />}
          {conversation.codeWrite ? t('code.writeOn') : t('code.readOnly')}
        </label>
      )}

      {conversation?.cwd && (
        <div className="flex w-full flex-wrap items-center gap-1.5" data-testid="extra-folders">
          {extras.map((e) => (
            <ExtraChip
              key={e.path}
              folder={e}
              busy={busy}
              onWrite={(on) => (on ? setConfirm({ kind: 'extra', path: e.path }) : void setExtraWrite(conversation.id, e.path, false))}
              onRemove={() => void removeExtraFolder(conversation.id, e.path)}
            />
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            disabled={busy || full}
            title={full ? t('code.extraFull', { max: MAX_EXTRA_DIRS }) : t('code.extraAddHint')}
            data-testid="extra-folder-add"
            onClick={() => void addExtraFolder(conversation.id)}
          >
            <FolderPlus />
            {t('code.extraAdd', { count: extras.length, max: MAX_EXTRA_DIRS })}
          </Button>
        </div>
      )}

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent
          title={t(confirm?.kind === 'extra' ? 'code.extraEnableTitle' : 'code.enableTitle')}
          description={t('code.enableBody', { folder: confirm?.kind === 'extra' ? confirm.path : conversation?.cwd })}
        >
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>{t('code.rule1')}</li>
            <li>{t('code.rule2')}</li>
            <li>{t('code.rule3')}</li>
            {confirm?.kind === 'extra' && <li>{t('code.extraRule')}</li>}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button
              data-testid="code-write-confirm"
              onClick={() => {
                if (conversation && confirm?.kind === 'main') void setCodeWrite(conversation.id, true)
                if (conversation && confirm?.kind === 'extra') void setExtraWrite(conversation.id, confirm.path, true)
                setConfirm(null)
              }}
            >
              {t('code.enable')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Một thư mục phụ: tên (đầy đủ khi rê chuột), ô "Cho phép sửa", nút gỡ (= thu hồi, kể cả khi trợ lý đang chạy). */
function ExtraChip({ folder, busy, onWrite, onRemove }: { folder: ExtraFolder; busy: boolean; onWrite(on: boolean): void; onRemove(): void }) {
  const { t } = useTranslation('chat')
  const name = folder.path.split(/[\\/]/).filter(Boolean).pop() ?? folder.path
  return (
    <span
      className={cn(
        'flex min-w-0 max-w-full items-center gap-1.5 rounded-full border bg-background py-0.5 pr-0.5 pl-2',
        folder.write && 'border-orange-300 dark:border-orange-800'
      )}
      data-testid="extra-folder"
      data-path={folder.path}
    >
      <span className="shrink-0 text-muted-foreground">{t('code.extraLabel')}</span>
      <code className="min-w-0 truncate" title={folder.path}>
        {name}
      </code>
      <label className={cn('flex shrink-0 items-center gap-1', folder.write && 'text-orange-700 dark:text-orange-300')} title={t('code.extraWriteHint')}>
        <input type="checkbox" checked={folder.write} disabled={busy} onChange={(e) => onWrite(e.target.checked)} data-testid="extra-folder-write" />
        {folder.write ? t('code.extraWriteOn') : t('code.readOnly')}
      </label>
      <Button
        size="icon-sm"
        variant="ghost"
        className="size-5"
        title={t('code.extraRemoveHint')}
        aria-label={t('code.extraRemove', { name })}
        data-testid="extra-folder-remove"
        onClick={onRemove}
      >
        <X />
      </Button>
    </span>
  )
}
