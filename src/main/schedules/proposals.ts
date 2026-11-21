import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  HOURLY_STEPS,
  NO_GRANTS,
  SCHEDULE_NAME_MAX,
  SCHEDULE_PROMPT_MAX,
  recurrenceSchema,
  type Recurrence,
  type ScheduleInput,
  type ScheduleProposalDecision,
  type ScheduleProposalRequest
} from '@shared/schedules'
import { ApprovalTimer, type ApprovalTimerOptions } from '../approvals/timer'
import { errorResult, type AppToolRegistry, type ToolResult } from '../tools/registry'
import { describeRecurrence } from './describe'

export const PROPOSE_TOOL = 'propose_schedule'

type Verdict = { approve: true } | { approve: false; reason: string }
type Pending = ScheduleProposalRequest & { conversationId: string; resolve(v: Verdict): void; timer: ApprovalTimer }

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/

const proposeInput = z.object({
  name: z.string().trim().min(1).max(SCHEDULE_NAME_MAX).describe('Tên ngắn của lịch, vd "Tóm tắt thư buổi sáng".'),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(SCHEDULE_PROMPT_MAX)
    .describe('Lời nhắn gửi cho bạn ở MỖI lần chạy (viết như người dùng nhờ bạn làm).'),
  kind: z.enum(['once', 'daily', 'weekly', 'hourly']),
  at: z.string().regex(LOCAL_DATETIME).optional().describe('kind=once: giờ máy dạng "YYYY-MM-DD HH:MM".'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe('kind=daily / weekly: "HH:MM".'),
  days: z.array(z.number().int().min(0).max(6)).max(7).optional().describe('kind=weekly: 0 = Chủ nhật … 6 = Thứ bảy.'),
  every: z
    .number()
    .int()
    .optional()
    .describe(`kind=hourly: mỗi bao nhiêu giờ (${HOURLY_STEPS.join(', ')}).`),
  from_hour: z.number().int().min(0).max(23).optional().describe('kind=hourly: bắt đầu từ giờ (mặc định 8).'),
  to_hour: z.number().int().min(1).max(24).optional().describe('kind=hourly: tới trước giờ (mặc định 22).'),
  cheap: z.boolean().optional().describe('true = model tiết kiệm (Haiku) — đủ cho tóm tắt / nhắc việc đơn giản.')
})

/** Đầu vào của tool → giờ hẹn hợp lệ; sai → câu báo lỗi cho trợ lý. */
export function toRecurrence(input: z.infer<typeof proposeInput>): Recurrence | string {
  let raw: unknown
  switch (input.kind) {
    case 'once': {
      const m = LOCAL_DATETIME.exec(input.at ?? '')
      if (!m) return 'kind=once cần at = "YYYY-MM-DD HH:MM".'
      const [, y, mo, d, h, mi] = m.map(Number)
      raw = { kind: 'once', at: new Date(y, mo - 1, d, h, mi).getTime() }
      break
    }
    case 'daily':
      raw = { kind: 'daily', time: input.time }
      break
    case 'weekly':
      raw = { kind: 'weekly', time: input.time, days: input.days }
      break
    case 'hourly':
      raw = { kind: 'hourly', every: input.every ?? 1, from: input.from_hour ?? 8, to: input.to_hour ?? 22 }
      break
  }
  const parsed = recurrenceSchema.safeParse(raw)
  return parsed.success ? parsed.data : `Giờ hẹn không hợp lệ cho kind=${input.kind}: kiểm tra lại time / days / every / from_hour / to_hour.`
}

export type ScheduleProposalsDeps = {
  /** Tính năng đang bật (tắt → không có tool). */
  enabled(): boolean
  /** Dự án của cuộc trò chuyện (lịch đề xuất trong dự án thuộc dự án đó). */
  projectOf(conversationId: string): { id: string; name: string } | null
  /** Tạo lịch sau khi người dùng bấm "Tạo lịch" — không có quyền nào (lịch chỉ đọc). Lỗi → mã lỗi. */
  create(input: ScheduleInput): { ok: true } | { ok: false; error: string }
  emit(event: (ScheduleProposalRequest & { conversationId: string }) | { id: string; closed: true }): void
  log: { info(msg: string): void }
  timer?: ApprovalTimerOptions
}

/**
 * Trợ lý chỉ ĐỀ XUẤT lịch: thẻ duyệt trong khung chat, người dùng bấm "Tạo lịch" mới tạo. Lịch đề xuất luôn
 * không có quyền thư mục / Gmail / Telegram (người dùng tự thêm sau, qua hộp xác nhận). Không trả lời trong 10 phút
 * (tối đa 30 nếu đang hỏi lại), dừng lượt chat hoặc tắt tính năng → coi như từ chối.
 */
export class ScheduleProposals {
  private pending = new Map<string, Pending>()

  constructor(private readonly deps: ScheduleProposalsDeps) {}

  registerTools(registry: AppToolRegistry): void {
    registry.register({
      name: PROPOSE_TOOL,
      description:
        'Đề xuất tạo một LỊCH HẸN: app tự chạy lời nhắn theo giờ (khi app đang mở), mỗi lần là một cuộc trò chuyện mới. Người dùng xem và bấm "Tạo lịch" mới tạo — bạn không tự tạo được. Lần chạy theo lịch chỉ đọc.',
      input: proposeInput,
      available: () => this.deps.enabled(),
      run: (input, ctx) => this.propose(input, ctx.conversationId)
    })
  }

  /** Tool + hướng dẫn cho lượt chat (chỉ khi tính năng bật). */
  toolsFor(): { names: string[]; context: string } | null {
    if (!this.deps.enabled()) return null
    return {
      names: [PROPOSE_TOOL],
      context:
        'LỊCH HẸN: người dùng muốn việc lặp lại / nhắc theo giờ ("mỗi sáng tóm tắt thư", "thứ 6 nhắc nộp báo cáo") → gọi mcp__mmc__propose_schedule để ĐỀ XUẤT. Lịch chỉ được tạo khi người dùng bấm "Tạo lịch" trên thẻ; đừng nói là đã tạo trước khi tool trả kết quả. Lịch chỉ chạy khi app đang mở; lần chạy chỉ đọc (người dùng tự thêm quyền thư mục / Gmail / Telegram sau).'
    }
  }

  private async propose(input: z.infer<typeof proposeInput>, conversationId: string): Promise<ToolResult> {
    const recurrence = toRecurrence(input)
    if (typeof recurrence === 'string') return errorResult(recurrence)
    if (recurrence.kind === 'once' && recurrence.at <= Date.now()) return errorResult('Giờ hẹn (một lần) đã qua — chọn giờ trong tương lai.')
    const project = this.deps.projectOf(conversationId)
    const verdict = await this.request(conversationId, {
      name: input.name,
      prompt: input.prompt,
      recurrence,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      model: input.cheap ? 'cheap' : 'default'
    })
    if (!verdict.approve) return errorResult(`${verdict.reason} Không tạo lịch.`)
    const created = this.deps.create({
      name: input.name,
      prompt: input.prompt,
      recurrence,
      projectId: project?.id ?? null,
      grants: NO_GRANTS,
      model: input.cheap ? 'cheap' : 'default',
      catchUp: recurrence.kind !== 'hourly'
    })
    if (!created.ok) return errorResult(`Người dùng đồng ý nhưng không tạo được lịch (${created.error}).`)
    return {
      content: [
        {
          type: 'text',
          text: `Đã tạo lịch hẹn "${input.name}" (${describeRecurrence(recurrence)}). Lịch chỉ chạy khi app đang mở; người dùng xem / sửa / tắt ở trang Lịch hẹn.`
        }
      ]
    }
  }

  request(conversationId: string, proposal: Omit<ScheduleProposalRequest, 'id'>): Promise<Verdict> {
    const id = randomUUID()
    return new Promise<Verdict>((resolve) => {
      const timer = new ApprovalTimer(() => this.settle(id, { approve: false, reason: 'Hết thời gian chờ người dùng duyệt.' }), this.deps.timer)
      const req: ScheduleProposalRequest = { id, ...proposal }
      this.pending.set(id, { ...req, conversationId, resolve, timer })
      this.deps.emit({ ...req, conversationId })
    })
  }

  touch(id: string): boolean {
    const p = this.pending.get(id)
    p?.timer.touch()
    return !!p
  }

  respond(decision: ScheduleProposalDecision): boolean {
    const p = this.pending.get(decision.id)
    if (!p) return false
    this.deps.log.info(`Đề xuất lịch hẹn: ${decision.approve ? 'tạo' : 'từ chối'}`)
    const note = decision.feedback?.trim()
    return this.settle(
      decision.id,
      decision.approve
        ? { approve: true }
        : {
            approve: false,
            reason: note
              ? `Người dùng từ chối đề xuất lịch này và góp ý: "${note}". Hãy đề xuất lại theo góp ý (người dùng sẽ duyệt lại).`
              : 'Người dùng đã từ chối đề xuất lịch này.'
          }
    )
  }

  cancelConversation(conversationId: string): void {
    for (const [id, p] of this.pending) if (p.conversationId === conversationId) this.settle(id, { approve: false, reason: 'Đã dừng.' })
  }

  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, { approve: false, reason: 'Lịch hẹn đã tắt.' })
  }

  private settle(id: string, verdict: Verdict): boolean {
    const p = this.pending.get(id)
    if (!p) return false
    this.pending.delete(id)
    p.timer.clear()
    this.deps.emit({ id, closed: true })
    p.resolve(verdict)
    return true
  }
}
