import type { CsvHeaders, TimeEntry } from '../timesheet'
import type {
  AiResult,
  DayBlock,
  DayPlanRequest,
  LearningPathRequest,
  PlannedStep,
  QuizGrade,
  QuizGradeRequest,
  QuizQuestion,
  QuizRequest,
  ReportRequest,
  TimeEntryKind,
  Workday,
  DesktopNotification,
  FeedbackCoachRequest,
  FeedbackSummaryRequest,
  TextResult,
  PlanRequest,
  PlanResult,
  MemoryCategory
} from '../schemas'

/** Phần `window.api` của Mảng B — Team & Quản lý: chấm công, học tập, ý tưởng, feedback, lập kế hoạch, thông báo. */
export interface TeamApi {
  ideas: {
    /** Trợ lý chuẩn hóa ý tưởng/báo lỗi thành GitHub issue (bản nháp để người dùng sửa). */
    format(input: {
      title: string
      description: string
      kind: 'idea' | 'bug'
      language: 'vi' | 'en'
    }): Promise<AiResult<{ title: string; body: string; labels: string[] }>>
  }
  notify: {
    show(notification: DesktopNotification): Promise<void>
  }
  planner: {
    planTasks(request: PlanRequest): Promise<PlanResult>
  }
  feedback: {
    /** Trợ lý viết lại bản nháp feedback / câu trả lời (không tự gửi). */
    coach(request: FeedbackCoachRequest): Promise<TextResult>
    summarize(request: FeedbackSummaryRequest): Promise<TextResult>
  }
  time: {
    current(): Promise<TimeEntry | null>
    start(input: TimeStartInput): Promise<TimeEntry>
    stop(): Promise<TimeEntry | null>
    list(from: number, to: number): Promise<TimeEntry[]>
    addManual(input: TimeManualInput): Promise<TimeEntry>
    update(input: TimeUpdateInput): Promise<TimeEntry>
    remove(id: string): Promise<void>
    exportCsv(input: {
      from: number
      to: number
      headers: CsvHeaders
      kinds: Record<TimeEntryKind, string>
    }): Promise<string | null>
    onChanged(listener: () => void): () => void
    getWorkday(): Promise<Workday>
    setWorkday(workday: Workday): Promise<Workday>
  }
  learning: {
    planPath(request: LearningPathRequest): Promise<AiResult<{ steps: PlannedStep[] }>>
    makeQuiz(request: QuizRequest): Promise<AiResult<{ questions: QuizQuestion[] }>>
    grade(request: QuizGradeRequest): Promise<AiResult<QuizGrade>>
    /** Đề xuất memory (vào hàng chờ duyệt, không tự lưu). */
    suggestMemory(content: string, category: MemoryCategory): Promise<void>
  }
  dayPlanner: {
    plan(request: DayPlanRequest): Promise<AiResult<{ blocks: DayBlock[] }>>
    report(request: ReportRequest): Promise<TextResult>
  }
}

export type TimeStartInput = {
  taskId?: string | null
  projectId?: string | null
  title: string
  projectName?: string | null
  kind?: 'timer' | 'pomodoro'
}
export type TimeManualInput = {
  taskId?: string | null
  projectId?: string | null
  title: string
  projectName?: string | null
  startedAt: number
  endedAt: number
  note?: string
}
export type TimeUpdateInput = {
  id: string
  title: string
  note: string
  startedAt: number
  endedAt: number
}
