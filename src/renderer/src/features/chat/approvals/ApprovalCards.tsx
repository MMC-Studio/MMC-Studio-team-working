import {
  Check,
  FilePen,
  FilePlus2,
  FolderOpen,
  FolderSearch,
  Loader2,
  Mail,
  MessageCircle,
  MessageCircleQuestion,
  MessageSquareX,
  X
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { APPROVAL_MAX_QUESTIONS, type ApprovalCard, type ApprovalQa } from '@shared/approvals'
import { DiffView } from '@renderer/components/DiffView'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { usePreferences } from '@renderer/stores/preferences'
import { Markdown } from '../components/Markdown'
import { useChat } from '../store'
import { useApprovals } from './store'

/**
 * Thẻ chờ duyệt nằm ngay trong khung chat (dưới tin trợ lý đang trả lời): sửa file (diff), xin quyền thư mục,
 * nháp Gmail / Telegram. Người dùng có thể "Hỏi lại" (trợ lý chỉ giải thích, không tool) hoặc "Từ chối kèm góp ý"
 * (trợ lý đề xuất lại trong cùng lượt). Quyền chỉ được cấp khi người dùng bấm nút đồng ý.
 */
export function ApprovalCards({ cards }: { cards: ApprovalCard[] }) {
  if (cards.length === 0) return null
  return (
    <div className="space-y-3" data-testid="approval-cards">
      {cards.map((card) => (
        <ApprovalCardView key={card.id} card={card} />
      ))}
    </div>
  )
}

function ApprovalCardView({ card }: { card: ApprovalCard }) {
  const { t } = useTranslation('chat')
  const { t: tc } = useTranslation('connectors')
  const decide = useApprovals((s) => s.decide)
  const focusAsk = useApprovals((s) => s.focusAsk)
  const askTarget = useApprovals((s) => s.askTarget)
  const askError = useApprovals((s) => (s.askError?.id === card.id ? s.askError.code : null))
  const respondFolder = useChat((s) => s.respondFolderAccess)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  // Thẻ thư mục: cho phép sửa hay không (mặc định theo điều trợ lý xin). Thẻ nháp: nội dung người dùng sửa.
  const [write, setWrite] = useState(card.kind === 'folder' ? card.request.write : false)
  const [body, setBody] = useState(card.kind === 'draft' ? card.request.body : '')
  const answering = card.qa.some((q) => q.status === 'answering')

  const reject = (note?: string): void => {
    const fb = note?.trim() || undefined
    void decide(card.id, () => {
      switch (card.kind) {
        case 'code':
          return api.code.respond(card.id, false, fb)
        case 'folder':
          return respondFolder(card.request, false, false, t('folderAccess.continue'), fb)
        case 'draft':
          return api.drafts.respond({ id: card.id, approve: false, feedback: fb })
      }
    })
  }

  const accept = async (): Promise<void> => {
    if (card.kind === 'code') void decide(card.id, () => api.code.respond(card.id, true))
    else if (card.kind === 'draft') void decide(card.id, () => api.drafts.respond({ id: card.id, approve: true, body }))
    else {
      // Mở hộp chọn thư mục của Windows; đóng hộp mà chưa chọn → thẻ vẫn chờ.
      setBusy(true)
      const status = await respondFolder(card.request, true, write, t('folderAccess.continue'))
      setBusy(false)
      setHint(status === 'pending' ? t('folderAccess.pickAgain') : null)
    }
  }

  const header = cardHeader(card, t, tc)
  const accentLabel =
    card.kind === 'code' ? t('code.accept') : card.kind === 'folder' ? t('folderAccess.choose') : tc(`draft.approve.${card.request.service}`)
  const rejectLabel = card.kind === 'folder' ? t('folderAccess.deny') : t('code.reject')
  const limitReached = card.qa.length >= APPROVAL_MAX_QUESTIONS

  return (
    <div
      className="rounded-xl border bg-card p-4 shadow-sm"
      data-testid="approval-card"
      data-kind={card.kind}
    >
      <div
        data-testid={card.kind === 'code' ? 'code-approval' : card.kind === 'folder' ? 'folder-access' : 'draft-approval'}
        className="space-y-3 text-sm"
      >
        <div className="flex items-center gap-2 font-medium">
          {header.icon}
          <span>{header.title}</span>
        </div>

        {card.kind === 'code' && (
          <>
            <div className="flex items-center gap-2">
              <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5" title={card.request.change.path}>
                {card.request.change.path}
              </code>
              <span className="text-green-600">+{card.request.change.added}</span>
              <span className="text-red-600">−{card.request.change.removed}</span>
            </div>
            <DiffView patch={card.request.change.patch} />
          </>
        )}

        {card.kind === 'folder' && (
          <>
            <p className="rounded-md bg-muted/60 px-3 py-2">{card.request.reason}</p>
            {card.request.suggestedPath && (
              <div className="flex items-center gap-2">
                <FolderSearch className="size-4 shrink-0" />
                <span className="text-muted-foreground">{t('folderAccess.suggested')}</span>
                <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5" title={card.request.suggestedPath}>
                  {card.request.suggestedPath}
                </code>
              </div>
            )}
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={write} disabled={busy} onChange={(e) => setWrite(e.target.checked)} />
              <span>
                {t('folderAccess.write')}
                <span className="block text-xs text-muted-foreground">{t('folderAccess.writeHint')}</span>
              </span>
            </label>
            {hint && <p className="text-xs text-orange-700 dark:text-orange-300">{hint}</p>}
          </>
        )}

        {card.kind === 'draft' && (
          <>
            <p>
              {tc(`draft.target.${card.request.service}`)}{' '}
              <span className="font-medium" data-testid="draft-target">
                {card.request.target}
              </span>
            </p>
            {card.request.account && (
              <p className="rounded-md bg-muted px-3 py-2" data-testid="draft-account">
                {tc('draft.account')} <span className="font-medium">{card.request.account.email}</span>{' '}
                <span className="text-muted-foreground">({card.request.account.label})</span>
              </p>
            )}
            {card.request.subject !== null && (
              <p>
                {tc('draft.subject')} <span className="font-medium">{card.request.subject || '—'}</span>
              </p>
            )}
            {card.request.replyTo && (
              <p className="text-xs text-muted-foreground">{tc('draft.replyTo', { subject: card.request.replyTo })}</p>
            )}
            <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} className="resize-y" data-testid="draft-body" />
            <p className="text-xs text-muted-foreground">{tc(`draft.hint.${card.request.service}`)}</p>
          </>
        )}

        {card.qa.length > 0 && (
          <div className="space-y-2 border-t pt-3" data-testid="approval-qa">
            {card.qa.map((qa, i) => (
              <QaItem key={i} qa={qa} />
            ))}
          </div>
        )}
        {askError && (
          <p className="text-xs text-destructive" data-testid="approval-ask-error">
            {t(`approvals.errors.${askError}`, {
              max: APPROVAL_MAX_QUESTIONS,
              defaultValue: t('approvals.errors.generic', { code: askError })
            })}
          </p>
        )}

        {feedbackOpen && (
          <div className="space-y-2 rounded-md border p-2">
            <Textarea
              autoFocus
              rows={3}
              value={feedback}
              placeholder={t('approvals.feedbackPlaceholder')}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setFeedbackOpen(false)
              }}
              data-testid="approval-feedback-input"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setFeedbackOpen(false)}>
                {t('approvals.cancel')}
              </Button>
              <Button size="sm" disabled={!feedback.trim() || busy} onClick={() => reject(feedback)} data-testid="approval-feedback-send">
                <MessageSquareX />
                {t('approvals.sendFeedback')}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={answering || limitReached}
            title={t('approvals.askHint')}
            onClick={() => focusAsk(card.id)}
            data-testid="approval-ask"
            className={askTarget === card.id ? 'bg-muted' : undefined}
          >
            <MessageCircleQuestion />
            {t('approvals.ask')}
          </Button>
          {!feedbackOpen && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setFeedbackOpen(true)} data-testid="approval-feedback-toggle">
              <MessageSquareX />
              {t('approvals.rejectWithFeedback')}
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => reject()}
              data-testid={card.kind === 'draft' ? 'draft-reject' : 'approval-reject'}
            >
              <X />
              {rejectLabel}
            </Button>
            <Button
              size="sm"
              disabled={busy || (card.kind === 'draft' && !body.trim())}
              onClick={() => void accept()}
              data-testid={card.kind === 'folder' ? 'folder-access-choose' : card.kind === 'draft' ? 'draft-approve' : 'approval-accept'}
            >
              {card.kind === 'folder' ? <FolderOpen /> : <Check />}
              {accentLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function QaItem({ qa }: { qa: ApprovalQa }) {
  const { t } = useTranslation('chat')
  const name = usePreferences((s) => s.assistant.name)
  return (
    <div className="space-y-1">
      <p className="ml-auto w-fit max-w-[85%] rounded-lg bg-muted px-3 py-1.5" data-testid="approval-question">
        {qa.question}
      </p>
      <div className="text-sm" data-testid="approval-answer" data-status={qa.status}>
        <span className="text-xs font-medium text-muted-foreground">{name}</span>
        {qa.status === 'error' ? (
          <p className="text-destructive">{t('approvals.answerError', { code: qa.answer })}</p>
        ) : qa.answer ? (
          <Markdown text={qa.answer} />
        ) : (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t('approvals.answering')}
          </p>
        )}
      </div>
    </div>
  )
}

type T = (key: string, opts?: Record<string, unknown>) => string

function cardHeader(card: ApprovalCard, t: T, tc: T): { icon: ReactNode; title: string } {
  switch (card.kind) {
    case 'code':
      return card.request.change.isNewFile
        ? { icon: <FilePlus2 className="size-4" />, title: t('code.approveCreate') }
        : { icon: <FilePen className="size-4" />, title: t('code.approveEdit') }
    case 'folder':
      return {
        icon: <FolderOpen className="size-4" />,
        title: t(card.request.write ? 'folderAccess.titleWrite' : 'folderAccess.title')
      }
    case 'draft':
      return {
        icon: card.request.service === 'gmail' ? <Mail className="size-4" /> : <MessageCircle className="size-4" />,
        title: tc(`draft.title.${card.request.service}`)
      }
  }
}
