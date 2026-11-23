import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FileStack,
  Loader2,
  Mail,
  MessageCircle,
  MessageCircleQuestion,
  PencilLine,
  X
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFERRED_QUESTIONS_MAX, type DeferredActionResult, type DeferredCard, type DeferredFile } from '@shared/deferred'
import { DiffView } from '@renderer/components/DiffView'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { optimistic, useSyncedState } from '@renderer/lib/sync'
import { cn } from '@renderer/lib/utils'

type Setter = (fn: (prev: DeferredCard[]) => DeferredCard[]) => void

/**
 * Thẻ hoãn duyệt của lần chạy theo lịch (nằm trong khung chat của cuộc đó): "Bộ thay đổi" (duyệt từng file hoặc Đồng ý
 * tất cả file) và nháp (duyệt TỪNG nháp, người nhận to rõ, cảnh báo người chưa từng liên lạc). Không có hạn 10 phút —
 * hết hạn sau 7 ngày; tắt app không mất.
 */
export function DeferredCards({ conversationId }: { conversationId: string }) {
  const { data, setData } = useSyncedState(['deferred'], () => api.schedules.deferred.list(conversationId))
  if (!data || data.length === 0) return null
  const set: Setter = (fn) => setData((prev) => fn(prev))
  return (
    <div className="space-y-3" data-testid="deferred-cards">
      {data.map((card) =>
        card.kind === 'changeset' ? <ChangesetCard key={card.id} card={card} set={set} /> : <DraftCard key={card.id} card={card} set={set} />
      )}
    </div>
  )
}

/** Bấm trên thẻ: đổi ngay trên giao diện, xong (hoặc lỗi) thì lấy lại trạng thái thật từ main. */
async function act(set: Setter, card: DeferredCard, patch: (c: DeferredCard) => DeferredCard, save: () => Promise<DeferredActionResult>): Promise<string | null> {
  let error: string | null = null
  await optimistic({
    topic: 'deferred',
    apply: () => set((list) => list.map((c) => (c.id === card.id ? patch(c) : c))),
    rollback: () => set((list) => list.map((c) => (c.id === card.id ? card : c))),
    save: async () => {
      const r = await save()
      return r.status === 'error' ? { error: r.error } : r
    },
    onError: (code) => {
      error = code
    }
  })
  return error
}

function Shell({ card, icon, title, children }: { card: DeferredCard; icon: ReactNode; title: string; children: ReactNode }) {
  const { t, i18n } = useTranslation('schedules')
  const [now] = useState(Date.now)
  const days = Math.max(1, Math.ceil((card.expiresAt - now) / 86_400_000))
  return (
    <div className="rounded-xl border bg-card p-4 text-sm shadow-sm" data-testid="deferred-card" data-kind={card.kind} data-status={card.status}>
      <div className="flex flex-wrap items-center gap-2 font-medium">
        {icon}
        <span>{title}</span>
        {card.scheduleName && <span className="text-xs font-normal text-muted-foreground">· {card.scheduleName}</span>}
        <span className="ml-auto text-xs font-normal text-muted-foreground" data-testid="deferred-state">
          {card.status === 'pending'
            ? t('deferred.expiresIn', { count: days })
            : card.status === 'expired'
              ? t('deferred.expired')
              : card.status === 'revoked'
                ? t('deferred.revoked')
              : card.status === 'revised'
                ? t('deferred.revised')
                : t('deferred.done')}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('deferred.createdAt', { when: new Date(card.createdAt).toLocaleString(i18n.language) })}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  )
}

function ChangesetCard({ card, set }: { card: Extract<DeferredCard, { kind: 'changeset' }>; set: Setter }) {
  const { t } = useTranslation('schedules')
  const open = card.status === 'pending'
  const waiting = card.files.filter((f) => f.status !== 'applied' && f.status !== 'rejected')
  const mark = (paths: string[] | null, status: DeferredFile['status']) => (c: DeferredCard): DeferredCard =>
    c.kind === 'changeset'
      ? { ...c, files: c.files.map((f) => (!paths || paths.includes(f.path) ? (f.status === 'applied' ? f : { ...f, status, error: null }) : f)) }
      : c
  return (
    <Shell card={card} icon={<FileStack className="size-4" />} title={t('deferred.changesetTitle', { count: card.files.length })}>
      <p className="text-xs text-muted-foreground">
        {t('deferred.folder')} <code className="rounded bg-muted px-1 py-0.5">{card.folder}</code>
      </p>
      <ul className="divide-y rounded-lg border" data-testid="deferred-files">
        {card.files.map((f) => (
          <FileRow
            key={f.path}
            file={f}
            open={open}
            onApprove={() => void act(set, card, mark([f.path], 'applied'), () => api.schedules.deferred.approveFiles(card.id, [f.path]))}
            onReject={() => void act(set, card, mark([f.path], 'rejected'), () => api.schedules.deferred.rejectFiles(card.id, [f.path]))}
          />
        ))}
      </ul>
      {open && waiting.length > 1 && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => void act(set, card, mark(null, 'rejected'), () => api.schedules.deferred.rejectFiles(card.id))} data-testid="deferred-reject-all">
            <X />
            {t('deferred.rejectAll')}
          </Button>
          <Button size="sm" onClick={() => void act(set, card, mark(null, 'applied'), () => api.schedules.deferred.approveFiles(card.id))} data-testid="deferred-approve-all">
            <Check />
            {t('deferred.approveAll', { count: waiting.length })}
          </Button>
        </div>
      )}
      <AskRevise card={card} set={set} />
    </Shell>
  )
}

function FileRow({ file: f, open, onApprove, onReject }: { file: DeferredFile; open: boolean; onApprove(): void; onReject(): void }) {
  const { t } = useTranslation('schedules')
  const [show, setShow] = useState(f.status === 'pending')
  const Chevron = show ? ChevronDown : ChevronRight
  const actionable = open && f.status !== 'applied' && f.status !== 'rejected'
  // Thẻ đã khép (thu hồi quyền / hết hạn / đã yêu cầu sửa): file chưa ghi sẽ không bao giờ được ghi → "không ghi",
  // không còn "chờ duyệt".
  const shown = !open && f.status === 'pending' ? 'closed' : f.status
  return (
    <li className="space-y-2 px-3 py-2" data-testid="deferred-file" data-path={f.path} data-status={f.status} data-shown={shown}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="flex min-w-0 items-center gap-1.5 text-left" onClick={() => setShow(!show)} aria-expanded={show}>
          <Chevron className="size-3.5 shrink-0" />
          <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5" title={f.path}>
            {f.path}
          </code>
        </button>
        {f.isNew && <span className="text-xs text-muted-foreground">{t('deferred.newFile')}</span>}
        <span className="text-xs text-green-600">+{f.added}</span>
        <span className="text-xs text-red-600">−{f.removed}</span>
        {f.versions > 1 && <span className="rounded-full bg-muted px-2 text-xs text-muted-foreground">{t('deferred.version', { n: f.versions })}</span>}
        <span
          className={cn(
            'ml-auto text-xs',
            shown === 'applied'
              ? 'text-green-700 dark:text-green-400'
              : shown === 'pending' || shown === 'closed'
                ? 'text-muted-foreground'
                : 'text-orange-700 dark:text-orange-300'
          )}
          data-testid="deferred-file-status"
        >
          {t(`deferred.fileStatus.${shown}`)}
        </span>
        {actionable && (
          <>
            <Button size="sm" variant="outline" className="h-7" onClick={onReject} data-testid="deferred-file-reject">
              <X />
              {t('deferred.reject')}
            </Button>
            <Button size="sm" className="h-7" onClick={onApprove} data-testid="deferred-file-approve">
              <Check />
              {t('deferred.approve')}
            </Button>
          </>
        )}
      </div>
      {f.error && (
        <p className="flex items-start gap-1.5 text-xs text-orange-700 dark:text-orange-300" data-testid="deferred-file-error">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t(`deferred.fileError.${f.error}`)}
        </p>
      )}
      {show && <DiffView patch={f.patch} />}
    </li>
  )
}

function DraftCard({ card, set }: { card: Extract<DeferredCard, { kind: 'draft' }>; set: Setter }) {
  const { t } = useTranslation('schedules')
  const d = card.draft
  const [body, setBody] = useState(d.body)
  const open = card.status === 'pending'
  const done = (c: DeferredCard): DeferredCard => ({ ...c, status: 'done' })
  return (
    <Shell
      card={card}
      icon={d.service === 'gmail' ? <Mail className="size-4" /> : <MessageCircle className="size-4" />}
      title={t(`deferred.draftTitle.${d.service}`)}
    >
      <div className="rounded-lg border-2 border-primary/30 bg-primary/5 px-3 py-2">
        <p className="text-xs text-muted-foreground">{t('deferred.recipients')}</p>
        <p className="text-base font-semibold break-all" data-testid="deferred-recipients">
          {d.recipients.join(', ')}
        </p>
      </div>
      {d.unknownRecipients.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-2" role="alert" data-testid="deferred-unknown">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-orange-600 dark:text-orange-400" />
          <span>{t('deferred.unknown', { list: d.unknownRecipients.join(', ') })}</span>
        </p>
      )}
      {d.account && (
        <p>
          {t('deferred.account')} <span className="font-medium">{d.account.email}</span> <span className="text-muted-foreground">({d.account.label})</span>
        </p>
      )}
      {d.subject !== null && (
        <p>
          {t('deferred.subject')} <span className="font-medium">{d.subject || '—'}</span>
        </p>
      )}
      {d.replyTo && <p className="text-xs text-muted-foreground">{t('deferred.replyTo', { subject: d.replyTo })}</p>}
      {open ? (
        <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} className="resize-y" data-testid="deferred-draft-body" />
      ) : (
        <p className="rounded-md bg-muted/60 px-3 py-2 whitespace-pre-wrap">{d.body}</p>
      )}
      {d.error && (
        <p className="text-xs text-orange-700 dark:text-orange-300" data-testid="deferred-draft-error">
          {t(`deferred.draftError.${d.error}`, { defaultValue: t('deferred.draftError.generic', { code: d.error }) })}
        </p>
      )}
      {open && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => void act(set, card, done, () => api.schedules.deferred.rejectDraft(card.id))} data-testid="deferred-draft-reject">
            <X />
            {t('deferred.reject')}
          </Button>
          {/* Không có "Đồng ý tất cả" cho nháp: mỗi nháp một lần bấm, sau khi xem người nhận. */}
          <Button size="sm" disabled={!body.trim()} onClick={() => void act(set, card, done, () => api.schedules.deferred.approveDraft(card.id, body))} data-testid="deferred-draft-approve">
            <Check />
            {t(`deferred.createDraft.${d.service}`)}
          </Button>
        </div>
      )}
      <AskRevise card={card} set={set} />
    </Shell>
  )
}

/** Hỏi (trợ lý chỉ giải thích, không tool) / Yêu cầu sửa (lượt mới cùng cuộc, cùng quyền của lịch, tính vào giới hạn ngày). */
function AskRevise({ card, set }: { card: DeferredCard; set: Setter }) {
  const { t } = useTranslation('schedules')
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const text = input.trim()
  const answering = card.qa.some((q) => q.status === 'answering')
  return (
    <>
      {card.qa.length > 0 && (
        <div className="space-y-2 border-t pt-3" data-testid="deferred-qa">
          {card.qa.map((q, i) => (
            <div key={i} className="space-y-1">
              <p className="ml-auto w-fit max-w-[85%] rounded-lg bg-muted px-3 py-1.5">{q.question}</p>
              {q.status === 'answering' ? (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t('deferred.answering')}
                </p>
              ) : (
                <p className={cn('whitespace-pre-wrap', q.status === 'error' && 'text-destructive')} data-testid="deferred-answer">
                  {q.answer}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {card.status === 'pending' && (
        <div className="space-y-2 border-t pt-3">
          <Textarea rows={2} value={input} maxLength={2000} placeholder={t('deferred.inputPlaceholder')} aria-label={t('deferred.inputPlaceholder')} onChange={(e) => setInput(e.target.value)} data-testid="deferred-input" />
          {error && <p className="text-xs text-destructive">{t(`deferred.errors.${error}`, { defaultValue: t('deferred.errors.generic', { code: error }) })}</p>}
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!text || answering || card.qa.length >= DEFERRED_QUESTIONS_MAX}
              onClick={async () => {
                const question = text
                setInput('')
                setError(
                  await act(
                    set,
                    card,
                    (c) => ({ ...c, qa: [...c.qa, { question, answer: '', status: 'answering' }] }),
                    () => api.schedules.deferred.ask(card.id, question)
                  )
                )
              }}
              data-testid="deferred-ask"
            >
              <MessageCircleQuestion />
              {t('deferred.ask')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!text}
              onClick={async () => {
                const note = text
                setInput('')
                setError(await act(set, card, (c) => ({ ...c, status: 'revised' }), () => api.schedules.deferred.revise(card.id, note)))
              }}
              data-testid="deferred-revise"
            >
              <PencilLine />
              {t('deferred.revise')}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('deferred.reviseHint')}</p>
        </div>
      )}
    </>
  )
}
