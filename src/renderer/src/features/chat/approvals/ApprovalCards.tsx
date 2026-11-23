import {
  Check,
  ChevronDown,
  Clock,
  ChevronRight,
  FilePen,
  FilePlus2,
  FolderOpen,
  FolderSearch,
  Loader2,
  Mail,
  MessageCircle,
  MessageCircleQuestion,
  PencilLine,
  Play,
  Send,
  SquareTerminal,
  X,
  Zap
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  APPROVAL_MAX_QUESTIONS,
  questionCount,
  type ApprovalCard,
  type ApprovalPastVersion,
  type ApprovalQa,
  type ApprovalRequest
} from '@shared/approvals'
import type { CommandApprovalRequest } from '@shared/commands'
import type { DraftApprovalRequest } from '@shared/connectors'
import type { ScheduleProposalRequest } from '@shared/schedules'
import { recurrenceText } from '@renderer/features/schedules/view'
import type { CodeApprovalRequest, FolderAccessRequest } from '@shared/types'
import { DiffView } from '@renderer/components/DiffView'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { useSyncedState } from '@renderer/lib/sync'
import { usePreferences } from '@renderer/stores/preferences'
import { Markdown } from '../components/Markdown'
import { useChat } from '../store'
import { useApprovals } from './store'
import { CommandView } from './CommandView'
import { AutoEditStartDialog } from './AutoEdits'

type T = (key: string, opts?: Record<string, unknown>) => string

/**
 * Thẻ chờ duyệt nằm ngay trong khung chat (dưới tin trợ lý đang trả lời): sửa file (diff), xin quyền thư mục,
 * nháp Gmail / Telegram. Ô nhập trên thẻ có 2 nút do người dùng chọn: "Hỏi" (trợ lý chỉ giải thích, không tool,
 * thẻ vẫn chờ) và "Yêu cầu sửa" (bên trong là từ chối kèm góp ý → trợ lý làm bản mới trong cùng lượt).
 * Các bản của cùng đề xuất nằm chung một thẻ dạng dòng thời gian: bản cũ thu gọn (chỉ xem) → hỏi đáp → yêu cầu
 * sửa → bản mới nhất (duyệt được). Quyền chỉ được cấp khi người dùng bấm nút đồng ý.
 */
export function ApprovalCards({ cards }: { cards: ApprovalCard[] }) {
  if (cards.length === 0) return null
  return (
    <div className="space-y-3" data-testid="approval-cards">
      {/* key theo chuỗi: Bản 2 thay Bản 1 trong CÙNG một thẻ (không gắn lại thẻ). */}
      {cards.map((card) => (
        <ApprovalCardView key={card.chainId} card={card} />
      ))}
    </div>
  )
}

function ApprovalCardView({ card }: { card: ApprovalCard }) {
  const { t } = useTranslation('chat')
  const { t: tc } = useTranslation('connectors')
  const { t: ts } = useTranslation('schedules')
  const header = cardHeader(card, t, tc, ts)
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm" data-testid="approval-card" data-kind={card.kind}>
      <div
        data-testid={
          card.kind === 'code'
            ? 'code-approval'
            : card.kind === 'folder'
              ? 'folder-access'
              : card.kind === 'schedule'
                ? 'schedule-proposal'
                : card.kind === 'command'
                  ? 'command-approval'
                  : 'draft-approval'
        }
        className="space-y-3 text-sm"
      >
        <div className="flex items-center gap-2 font-medium">
          {header.icon}
          <span>{header.title}</span>
          {card.version > 1 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground" data-testid="approval-version">
              {t('approvals.version', { n: card.version })}
            </span>
          )}
        </div>

        {card.history.map((v) => (
          <PastVersion key={v.version} kind={card.kind} version={v} />
        ))}

        {card.revising !== null ? (
          // Đã "Yêu cầu sửa": bản này chỉ còn để xem, chờ trợ lý làm bản tiếp theo.
          <PastVersion
            kind={card.kind}
            version={{ version: card.version, request: card.request, qa: card.qa, revision: card.revising }}
            waitingFor={card.version + 1}
          />
        ) : (
          // key theo bản: ô nhập / nội dung nháp / tick quyền sửa của bản mới bắt đầu lại từ đầu.
          <CurrentVersion key={card.id} card={card} />
        )}
      </div>
    </div>
  )
}

/** Bản cũ: nội dung thu gọn (bấm để xem lại), hỏi đáp, yêu cầu sửa. Không có nút duyệt. */
function PastVersion({
  kind,
  version,
  waitingFor
}: {
  kind: ApprovalCard['kind']
  version: ApprovalPastVersion
  waitingFor?: number
}) {
  const { t } = useTranslation('chat')
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="space-y-2 border-l-2 border-muted pl-3" data-testid="approval-past-version" data-version={version.version}>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-muted"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        data-testid="approval-past-toggle"
      >
        <Chevron className="size-3.5 shrink-0" />
        <span className="font-medium">{t('approvals.version', { n: version.version })}</span>
        <span className="min-w-0 truncate">· {summary(kind, version.request)}</span>
        <span className="ml-auto shrink-0">{open ? t('approvals.hideVersion') : t('approvals.showVersion')}</span>
      </button>
      {open && <RequestView kind={kind} request={version.request} />}
      {version.qa.length > 0 && <QaThread qa={version.qa} />}
      <p className="flex items-start gap-1.5 text-sm" data-testid="approval-revision">
        <PencilLine className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <span>
          <span className="font-medium">{t('approvals.revisionLabel')}</span> {version.revision}
        </span>
      </p>
      {waitingFor !== undefined && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="approval-waiting">
          <Loader2 className="size-3.5 animate-spin" />
          {t('approvals.waitingVersion', { n: waitingFor })}
        </p>
      )}
    </div>
  )
}

/** Bản mới nhất: nội dung mở sẵn → hỏi đáp → ô nhập (Hỏi / Yêu cầu sửa) → Từ chối / Đồng ý. */
function CurrentVersion({ card }: { card: ApprovalCard }) {
  const { t } = useTranslation('chat')
  const { t: tc } = useTranslation('connectors')
  const { t: ts } = useTranslation('schedules')
  const decide = useApprovals((s) => s.decide)
  const revise = useApprovals((s) => s.revise)
  const ask = useApprovals((s) => s.ask)
  const askError = useApprovals((s) => (s.askError?.id === card.id ? s.askError.code : null))
  const respondFolder = useChat((s) => s.respondFolderAccess)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  // Thẻ thư mục: cho phép sửa hay không — luôn KHÔNG tick sẵn, kể cả khi trợ lý xin quyền sửa (người dùng tự chọn;
  // quyền sửa còn mở cả chạy Unity / Blender). Thẻ nháp: nội dung người dùng sửa.
  const [write, setWrite] = useState(false)
  const [body, setBody] = useState(card.kind === 'draft' ? card.request.body : '')
  // Tự duyệt sửa file (PR C): nút chỉ có khi main nói lần sửa này đủ điều kiện (file không thuộc nhóm "vẫn hỏi").
  const autoEdit = card.kind === 'code' ? card.request.autoEdit : undefined
  const [autoDialog, setAutoDialog] = useState(false)
  const cwd = useChat((s) => s.conversations.find((c) => c.id === card.conversationId)?.cwd ?? '')
  const acceptAuto = async (): Promise<void> => {
    setAutoDialog(false)
    // Không còn đủ điều kiện lúc bấm (file vừa đổi…) → thẻ quay lại, người dùng chọn Đồng ý thường / Từ chối.
    if (!(await decide(card.id, () => api.code.respondAuto(card.id)))) setHint(t('autoEdit.notEligible'))
  }
  const answering = card.qa.some((q) => q.status === 'answering')
  const limitReached = questionCount(card) >= APPROVAL_MAX_QUESTIONS
  const text = input.trim()

  /** Từ chối; có `note` = "Yêu cầu sửa" (từ chối kèm góp ý → trợ lý làm bản mới). */
  const respondReject = (note?: string): Promise<unknown> => {
    switch (card.kind) {
      case 'code':
        return api.code.respond(card.id, false, note)
      case 'folder':
        return respondFolder(card.request, false, false, t('folderAccess.continue'), note)
      case 'draft':
        return api.drafts.respond({ id: card.id, approve: false, feedback: note })
      case 'schedule':
        return api.schedules.respondProposal({ id: card.id, approve: false, feedback: note })
      case 'command':
        return api.commands.respond({ id: card.id, approve: false, feedback: note })
    }
  }

  const accept = async (): Promise<void> => {
    if (card.kind === 'code') void decide(card.id, () => api.code.respond(card.id, true))
    else if (card.kind === 'draft') void decide(card.id, () => api.drafts.respond({ id: card.id, approve: true, body }))
    else if (card.kind === 'schedule') void decide(card.id, () => api.schedules.respondProposal({ id: card.id, approve: true }))
    else if (card.kind === 'command') void decide(card.id, () => api.commands.respond({ id: card.id, approve: true }))
    else {
      // Mở hộp chọn thư mục của Windows; đóng hộp mà chưa chọn → thẻ vẫn chờ.
      setBusy(true)
      const status = await respondFolder(card.request, true, write, t('folderAccess.continue'))
      setBusy(false)
      setHint(status === 'pending' ? t('folderAccess.pickAgain') : null)
    }
  }

  // Trả lời xong (hoặc lỗi) → focus ô nhập và cuộn VỪA ĐỦ để thấy ô nhập + nút (không kéo cả thẻ lên đầu).
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const inputBox = useRef<HTMLDivElement>(null)
  const wasAnswering = useRef(answering)
  useEffect(() => {
    if (wasAnswering.current && !answering) {
      inputRef.current?.focus({ preventScroll: true })
      inputBox.current?.scrollIntoView({ block: 'nearest' })
    }
    wasAnswering.current = answering
  }, [answering])

  const canAsk = !!text && !answering && !limitReached && !busy
  const askQuestion = async (): Promise<void> => {
    if (canAsk && (await ask(card.id, text))) setInput('')
  }
  const requestRevision = (): void => {
    if (text && !busy) void revise(card.id, text, () => respondReject(text))
  }

  // Enter = Hỏi, Ctrl+Enter = Yêu cầu sửa, Shift+Enter = xuống dòng. Bộ gõ (Unikey / EVKey / IME) đang ghép chữ
  // thì không gửi — Enter lúc đó là để chốt chữ.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) requestRevision()
    else void askQuestion()
  }

  const accentLabel =
    card.kind === 'code'
      ? t('code.accept')
      : card.kind === 'folder'
        ? t('folderAccess.choose')
        : card.kind === 'schedule'
          ? ts('proposal.accept')
          : card.kind === 'command'
            ? t('command.run')
            : tc(`draft.approve.${card.request.service}`)
  const rejectLabel = card.kind === 'folder' ? t('folderAccess.deny') : card.kind === 'schedule' ? ts('proposal.reject') : t('code.reject')

  return (
    <div className="space-y-3" data-testid="approval-current" data-version={card.version}>
      {card.history.length > 0 && (
        <p className="text-xs font-medium text-muted-foreground">{t('approvals.latestVersion', { n: card.version })}</p>
      )}

      {card.kind === 'folder' ? (
        <>
          <RequestView kind="folder" request={card.request} />
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={write}
              disabled={busy}
              onChange={(e) => setWrite(e.target.checked)}
              data-testid="folder-access-write"
            />
            <span>
              {t('folderAccess.write')}
              <span className="block text-xs text-muted-foreground">{t('folderAccess.writeHint')}</span>
              <WriteRunsHint />
            </span>
          </label>
          {hint && <p className="text-xs text-orange-700 dark:text-orange-300">{hint}</p>}
        </>
      ) : card.kind === 'draft' ? (
        <DraftView request={card.request} body={body} onBody={setBody} />
      ) : card.kind === 'schedule' ? (
        <ScheduleProposalView request={card.request} current />
      ) : card.kind === 'command' ? (
        <CommandView request={card.request} current />
      ) : (
        <>
          <RequestView kind="code" request={card.request} />
          {autoEdit && !autoEdit.offer && autoEdit.sessionActive && (
            <p className="text-xs text-violet-700 dark:text-violet-300" data-testid="auto-edit-ask-reason" data-reason={autoEdit.reason}>
              {t(`autoEdit.askReason.${autoEdit.reason}`, { detail: autoEdit.detail ?? '' })}
            </p>
          )}
          {hint && <p className="text-xs text-orange-700 dark:text-orange-300">{hint}</p>}
        </>
      )}

      {/* Như một khung chat nhỏ: hỏi đáp (cuộn riêng khi dài) → ô nhập luôn nằm dưới câu trả lời mới nhất. */}
      {card.qa.length > 0 && (
        <QaThread
          qa={card.qa}
          onSuggest={busy ? undefined : (question) => void revise(card.id, question, () => respondReject(question))}
        />
      )}
      {askError && (
        <p className="text-xs text-destructive" data-testid="approval-ask-error">
          {t(`approvals.errors.${askError}`, {
            max: APPROVAL_MAX_QUESTIONS,
            defaultValue: t('approvals.errors.generic', { code: askError })
          })}
        </p>
      )}

      <div className="space-y-2" data-testid="approval-input-box" ref={inputBox}>
        <Textarea
          ref={inputRef}
          rows={2}
          value={input}
          maxLength={2000}
          placeholder={t('approvals.inputPlaceholder')}
          aria-label={t('approvals.inputPlaceholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          data-testid="approval-input"
        />
        <p className="text-[11px] text-muted-foreground" data-testid="approval-key-hint">
          {t('approvals.keyHint')}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!canAsk}
            onClick={() => void askQuestion()}
            data-testid="approval-ask-send"
          >
            <MessageCircleQuestion />
            {t('approvals.askButton')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!text || busy}
            onClick={requestRevision}
            data-testid="approval-revise"
          >
            <PencilLine />
            {t('approvals.revise')}
          </Button>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t pt-3">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void decide(card.id, () => respondReject())}
          data-testid={card.kind === 'draft' ? 'draft-reject' : 'approval-reject'}
        >
          <X />
          {rejectLabel}
        </Button>
        {autoEdit?.offer && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setAutoDialog(true)} data-testid="approval-accept-auto">
            <Zap />
            {t('autoEdit.acceptAuto')}
          </Button>
        )}
        <Button
          size="sm"
          disabled={busy || (card.kind === 'draft' && !body.trim())}
          onClick={() => void accept()}
          data-testid={
            card.kind === 'folder'
              ? 'folder-access-choose'
              : card.kind === 'draft'
                ? 'draft-approve'
                : card.kind === 'schedule'
                  ? 'schedule-proposal-accept'
                  : 'approval-accept'
          }
        >
          {card.kind === 'folder' ? <FolderOpen /> : card.kind === 'schedule' ? <Clock /> : card.kind === 'command' ? <Play /> : <Check />}
          {accentLabel}
        </Button>
      </div>
      {autoEdit?.offer && (
        <AutoEditStartDialog open={autoDialog} onOpenChange={setAutoDialog} folder={cwd} onConfirm={() => void acceptAuto()} />
      )}
    </div>
  )
}

/** Nội dung một bản (chỉ xem): diff / thông tin thư mục / nháp. */
function RequestView({ kind, request }: { kind: ApprovalCard['kind']; request: ApprovalRequest }) {
  const { t } = useTranslation('chat')
  if (kind === 'code') {
    const { change } = request as CodeApprovalRequest
    return (
      <div className="space-y-2" data-testid="approval-diff">
        <div className="flex items-center gap-2">
          <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5" title={change.path}>
            {change.path}
          </code>
          <span className="text-green-600">+{change.added}</span>
          <span className="text-red-600">−{change.removed}</span>
        </div>
        <DiffView patch={change.patch} />
      </div>
    )
  }
  if (kind === 'folder') {
    const r = request as FolderAccessRequest
    return (
      <div className="space-y-2">
        <p className="rounded-md bg-muted/60 px-3 py-2">{r.reason}</p>
        {r.suggestedPath && (
          <div className="flex items-center gap-2">
            <FolderSearch className="size-4 shrink-0" />
            <span className="text-muted-foreground">{t('folderAccess.suggested')}</span>
            <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5" title={r.suggestedPath}>
              {r.suggestedPath}
            </code>
          </div>
        )}
      </div>
    )
  }
  if (kind === 'schedule') return <ScheduleProposalView request={request as ScheduleProposalRequest} />
  if (kind === 'command') return <CommandView request={request as CommandApprovalRequest} />
  return <DraftView request={request as DraftApprovalRequest} />
}

/** Đề xuất lịch hẹn: tên, giờ, dự án, model, lời nhắn + câu nói rõ lịch chỉ đọc, không có quyền thêm. */
function ScheduleProposalView({ request, current }: { request: ScheduleProposalRequest; current?: boolean }) {
  const { t, i18n } = useTranslation('schedules')
  return (
    <div className="space-y-2" data-testid={current ? 'schedule-proposal-view' : undefined}>
      <p className="font-medium" data-testid={current ? 'schedule-proposal-name' : undefined}>
        {request.name}
      </p>
      <p>
        {t('proposal.when')} <span className="font-medium" data-testid={current ? 'schedule-proposal-when' : undefined}>{recurrenceText(request.recurrence, t, i18n.language)}</span>
      </p>
      {request.projectName && (
        <p>
          {t('proposal.project')} <span className="font-medium">{request.projectName}</span>
        </p>
      )}
      <p>
        {t('proposal.model')} <span className="font-medium">{t(`models.${request.model}`)}</span>
      </p>
      <p className="text-xs text-muted-foreground">{t('proposal.prompt')}</p>
      <p className="whitespace-pre-wrap rounded-md bg-muted/60 px-3 py-2">{request.prompt}</p>
      <p className="text-xs text-muted-foreground">{t('proposal.readOnly')}</p>
    </div>
  )
}

/** Nháp Gmail / Telegram: có `onBody` = bản mới nhất (sửa được), không có = bản cũ (chỉ xem). */
function DraftView({ request, body, onBody }: { request: DraftApprovalRequest; body?: string; onBody?: (v: string) => void }) {
  const { t: tc } = useTranslation('connectors')
  return (
    <div className="space-y-2">
      <p>
        {tc(`draft.target.${request.service}`)}{' '}
        <span className="font-medium" data-testid={onBody ? 'draft-target' : undefined}>
          {request.target}
        </span>
      </p>
      {request.account && (
        <p className="rounded-md bg-muted px-3 py-2" data-testid={onBody ? 'draft-account' : undefined}>
          {tc('draft.account')} <span className="font-medium">{request.account.email}</span>{' '}
          <span className="text-muted-foreground">({request.account.label})</span>
        </p>
      )}
      {request.subject !== null && (
        <p>
          {tc('draft.subject')} <span className="font-medium">{request.subject || '—'}</span>
        </p>
      )}
      {request.replyTo && <p className="text-xs text-muted-foreground">{tc('draft.replyTo', { subject: request.replyTo })}</p>}
      {onBody ? (
        <>
          <Textarea rows={8} value={body} onChange={(e) => onBody(e.target.value)} className="resize-y" data-testid="draft-body" />
          <p className="text-xs text-muted-foreground">{tc(`draft.hint.${request.service}`)}</p>
        </>
      ) : (
        <p className="whitespace-pre-wrap rounded-md bg-muted/60 px-3 py-2">{request.body}</p>
      )}
    </div>
  )
}

/**
 * Đoạn hỏi đáp: dài quá thì cuộn riêng trong thẻ (nút duyệt không bị đẩy xa). Đang ở đáy → câu mới / chữ đang
 * stream giữ ở đáy; người dùng cuộn lên đọc câu cũ thì không kéo xuống.
 * `onSuggest` (chỉ bản mới nhất): nút "Gửi câu này như Yêu cầu sửa" dưới câu trả lời trợ lý đánh dấu.
 */
function QaThread({ qa, onSuggest }: { qa: ApprovalQa[]; onSuggest?: (question: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const last = qa.at(-1)
  useLayoutEffect(() => {
    if (atBottom.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [qa.length, last?.answer.length, last?.status])
  return (
    <div
      ref={box}
      className="max-h-80 space-y-2 overflow-y-auto border-t pt-3 pr-1"
      onScroll={(e) => {
        const el = e.currentTarget
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
      data-testid="approval-qa"
    >
      {qa.map((item, i) => (
        <QaItem key={i} qa={item} onSuggest={onSuggest} />
      ))}
    </div>
  )
}

function QaItem({ qa, onSuggest }: { qa: ApprovalQa; onSuggest?: (question: string) => void }) {
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
        {qa.status === 'done' && qa.suggestRevision && onSuggest && (
          <Button
            size="sm"
            variant="outline"
            className="mt-1.5"
            onClick={() => onSuggest(qa.question)}
            data-testid="approval-suggest-revise"
          >
            <Send />
            {t('approvals.sendAsRevision')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Một dòng tóm tắt bản cũ (khi thu gọn). */
function summary(kind: ApprovalCard['kind'], request: ApprovalRequest): string {
  if (kind === 'code') {
    const { change } = request as CodeApprovalRequest
    return `${change.path} +${change.added} −${change.removed}`
  }
  if (kind === 'folder') {
    const r = request as FolderAccessRequest
    return r.suggestedPath ?? r.reason
  }
  if (kind === 'schedule') return (request as ScheduleProposalRequest).name
  if (kind === 'command') return (request as CommandApprovalRequest).display
  const r = request as DraftApprovalRequest
  return r.subject ? `${r.target} · ${r.subject}` : r.target
}

function cardHeader(card: ApprovalCard, t: T, tc: T, ts: T): { icon: ReactNode; title: string } {
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
    case 'schedule':
      return { icon: <Clock className="size-4" />, title: ts('proposal.title') }
    case 'command':
      return {
        icon: <SquareTerminal className="size-4" />,
        title: card.request.program === 'git' ? t('command.title') : t(`command.titleApp.${card.request.program}`)
      }
  }
}

/** Dưới ô "Cho phép sửa file": khi Chạy Unity / Blender đang bật, quyền sửa cũng mở các tool đó (A2) — nói rõ. */
function WriteRunsHint() {
  const { t } = useTranslation('chat')
  const { data } = useSyncedState('commands', () => api.commands.status())
  const on = (['unity', 'blender'] as const).filter((p) => data?.apps[p].enabled && data.apps[p].path)
  if (!on.length) return null
  return (
    <span className="mt-1 block text-xs text-orange-700 dark:text-orange-300" data-testid="folder-access-write-runs">
      {t('folderAccess.writeRuns', { apps: on.map((p) => (p === 'unity' ? 'Unity' : 'Blender')).join(' / ') })}
    </span>
  )
}
