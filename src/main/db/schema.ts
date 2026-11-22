import type { ArtifactType, MessageArtifact } from '@shared/artifacts'
import type { MessageVoice } from '@shared/voice'
import type { MessageMedia, Reaction } from '@shared/expressive'
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { ChatMode, ChatUsage } from '@shared/ai'
import type {
  Recurrence,
  ScheduleGrants,
  ScheduleModel,
  SchedulePauseReason,
  ScheduleRunReason,
  ScheduleRunStatus,
  ScheduleRunTrigger
} from '@shared/schedules'
import type { ActionLogDecision, ActionLogKind } from '@shared/actionLog'
import type { MemoryAction, MemoryCategory, SuggestionStatus, TimeEntryKind } from '@shared/schemas'
import type { MessageRole, MessageStatus, StoredAttachment, ToolEvent } from '@shared/types'

export type TitleSource = 'auto' | 'ai' | 'user' | 'fixed'

const now = sql`(unixepoch('subsec') * 1000)`

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at').notNull().default(now)
})

/** Nhóm cuộc trò chuyện ở thanh bên (vd "Unity", "Học") — chỉ trên máy, theo tài khoản. */
export const conversationGroups = sqliteTable(
  'conversation_groups',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull().default('local'),
    name: text('name').notNull(),
    collapsed: integer('collapsed', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('conversation_groups_owner_idx').on(t.owner, t.createdAt)]
)

/**
 * Dự án cá nhân (khác "Dự án team" trên Supabase): hướng dẫn + file ngữ cảnh luôn gửi kèm cho trợ lý trong mọi cuộc
 * trò chuyện của dự án. Chỉ trên máy, theo tài khoản như lịch sử chat.
 */
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull().default('local'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    instructions: text('instructions').notNull().default(''),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => [index('projects_owner_idx').on(t.owner, t.updatedAt)]
)

/** File ngữ cảnh của dự án — chỉ chữ, chép nội dung vào DB lúc thêm (sửa file gốc sau đó không ảnh hưởng). */
export const projectFiles = sqliteTable(
  'project_files',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    content: text('content').notNull(),
    size: integer('size').notNull(),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('project_files_project_idx').on(t.projectId, t.createdAt)]
)

/**
 * Lịch hẹn: trợ lý tự chạy một lời nhắn theo giờ hẹn khi app đang mở. Chỉ trên máy, theo tài khoản.
 * Xoá dự án → lịch giữ lại (project_id = null) và bị tạm dừng (ProjectRepository.remove).
 */
export const schedules = sqliteTable(
  'schedules',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull().default('local'),
    name: text('name').notNull(),
    prompt: text('prompt').notNull(),
    recurrence: text('recurrence', { mode: 'json' }).$type<Recurrence>().notNull(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    /** Quyền chốt lúc tạo lịch (thư mục đọc, tài khoản Gmail, Telegram). */
    grants: text('grants', { mode: 'json' }).$type<ScheduleGrants>().notNull(),
    model: text('model').$type<ScheduleModel>().notNull().default('default'),
    catchUp: integer('catch_up', { mode: 'boolean' }).notNull().default(true),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    pausedReason: text('paused_reason').$type<SchedulePauseReason>(),
    skipNext: integer('skip_next', { mode: 'boolean' }).notNull().default(false),
    nextRunAt: integer('next_run_at'),
    lastRunAt: integer('last_run_at'),
    lastStatus: text('last_status').$type<ScheduleRunStatus>(),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    origin: text('origin').$type<'user' | 'assistant'>().notNull().default('user'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => [index('schedules_owner_idx').on(t.owner, t.createdAt)]
)

/** Nhật ký các lần chạy (kể cả bỏ lỡ / bỏ qua). Xoá lịch → xoá nhật ký; xoá cuộc trò chuyện → dòng còn, mất link. */
export const scheduleRuns = sqliteTable(
  'schedule_runs',
  {
    id: text('id').primaryKey(),
    scheduleId: text('schedule_id')
      .notNull()
      .references(() => schedules.id, { onDelete: 'cascade' }),
    scheduledFor: integer('scheduled_for').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    status: text('status').$type<ScheduleRunStatus>().notNull(),
    trigger: text('trigger').$type<ScheduleRunTrigger>().notNull().default('on_time'),
    reason: text('reason').$type<ScheduleRunReason>(),
    detail: text('detail'),
    missed: integer('missed').notNull().default(0),
    conversationId: text('conversation_id').references((): AnySQLiteColumn => conversations.id, { onDelete: 'set null' }),
    toolCount: integer('tool_count').notNull().default(0),
    seenAt: integer('seen_at'),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('schedule_runs_schedule_idx').on(t.scheduleId, t.createdAt), index('schedule_runs_started_idx').on(t.startedAt)]
)

/**
 * Thẻ hoãn duyệt (Lịch hẹn 7b): đề xuất sửa file / nháp của lần chạy theo lịch, người dùng duyệt sau. Lưu DB vì phải
 * còn sau khi tắt app; hết hạn sau 7 ngày. `payload` = file (bản gốc + hash + bản đề xuất) hoặc nháp.
 */
export const deferredApprovals = sqliteTable(
  'deferred_approvals',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull().default('local'),
    conversationId: text('conversation_id')
      .notNull()
      .references((): AnySQLiteColumn => conversations.id, { onDelete: 'cascade' }),
    scheduleId: text('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
    runId: text('run_id'),
    kind: text('kind').$type<'changeset' | 'draft'>().notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    status: text('status').$type<'pending' | 'done' | 'expired' | 'revised'>().notNull().default('pending'),
    qa: text('qa', { mode: 'json' }).$type<{ question: string; answer: string; status: 'answering' | 'done' | 'error' }[]>().notNull().default([]),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [index('deferred_owner_idx').on(t.owner, t.status), index('deferred_conversation_idx').on(t.conversationId)]
)

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    /** Tài khoản sở hữu (như memories.owner): mỗi tài khoản chỉ thấy lịch sử chat của mình. */
    owner: text('owner').notNull().default('local'),
    title: text('title').notNull().default(''),
    mode: text('mode').$type<ChatMode>().notNull().default('free'),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    provider: text('provider').notNull().default('claude-cli'),
    cliSessionId: text('cli_session_id'),
    /**
     * Khoá phần "Dự án" của system prompt lúc tạo session CLI. CLI khi `--resume` giữ system prompt của lượt đầu và
     * bỏ qua file mới → phần dự án đổi (sửa hướng dẫn / file) thì phải mở session mới. null = session tạo trước khi
     * có cột này.
     */
    cliSessionPromptKey: text('cli_session_prompt_key'),
    cwd: text('cwd'),
    /** Lần cuối trích đề xuất memory từ hội thoại này (tin sau mốc này là "mới"). */
    memoryExtractedAt: integer('memory_extracted_at'),
    /** Chế độ Code: người dùng đã bật rõ ràng cho phép sửa file (mỗi lần sửa vẫn phải duyệt). */
    codeWrite: integer('code_write', { mode: 'boolean' }).notNull().default(false),
    groupId: text('group_id').references(() => conversationGroups.id, { onDelete: 'set null' }),
    /** Nhánh (fork): hội thoại gốc + tin được tách ra. Xoá gốc → nhánh thành hội thoại thường. */
    parentId: text('parent_id').references((): AnySQLiteColumn => conversations.id, { onDelete: 'set null' }),
    forkedFromMessageId: text('forked_from_message_id'),
    /** auto = tạm lấy từ tin đầu (AI sẽ đặt lại sau lượt trả lời); ai / user / fixed = giữ nguyên. */
    titleSource: text('title_source').$type<TitleSource>().notNull().default('fixed'),
    /** Nhóm trợ lý gợi ý, chờ người dùng đồng ý (null = không có / đã trả lời). */
    suggestedGroupId: text('suggested_group_id').references(() => conversationGroups.id, { onDelete: 'set null' }),
    /** Dự án chứa cuộc này. Xoá dự án → thành cuộc thường (không xoá cuộc). */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    /** Cuộc do một lần chạy lịch hẹn tạo ra. Xoá lịch → thành cuộc thường. */
    scheduleId: text('schedule_id').references((): AnySQLiteColumn => schedules.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => [index('conversations_updated_idx').on(t.pinned, t.updatedAt), index('conversations_owner_idx').on(t.owner)]
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').$type<MessageRole>().notNull(),
    content: text('content').notNull().default(''),
    status: text('status').$type<MessageStatus>().notNull().default('done'),
    error: text('error'),
    toolEvents: text('tool_events', { mode: 'json' }).$type<ToolEvent[]>().notNull().default([]),
    attachments: text('attachments', { mode: 'json' }).$type<StoredAttachment[]>().notNull().default([]),
    usage: text('usage', { mode: 'json' }).$type<ChatUsage>(),
    reactions: text('reactions', { mode: 'json' }).$type<Reaction[]>().notNull().default([]),
    media: text('media', { mode: 'json' }).$type<MessageMedia>(),
    voice: text('voice', { mode: 'json' }).$type<MessageVoice>(),
    artifacts: text('artifacts', { mode: 'json' }).$type<MessageArtifact[]>().notNull().default([]),
    /** Trả lời một tin cụ thể (tin gốc có thể đã bị xoá khi sửa & gửi lại → hiện "tin gốc không còn"). */
    replyToId: text('reply_to_id'),
    /** Ghim tin trong cuộc trò chuyện (tối đa MAX_PINNED_MESSAGES). */
    pinnedAt: integer('pinned_at'),
    /** Thu hồi: nội dung đã xoá, chỉ còn dòng "đã thu hồi"; không gửi lại cho trợ lý. */
    recalledAt: integer('recalled_at'),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)]
)

export const memories = sqliteTable(
  'memories',
  {
    id: text('id').primaryKey(),
    /** Tài khoản sở hữu: id GitHub/Supabase của người đăng nhập, 'local' khi chưa đăng nhập. */
    owner: text('owner').notNull().default('local'),
    content: text('content').notNull(),
    category: text('category').$type<MemoryCategory>().notNull().default('other'),
    sourceConversationId: text('source_conversation_id'),
    /** Trí nhớ riêng của dự án (null = trí nhớ chung). Xoá dự án → xoá theo. */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
    lastUsedAt: integer('last_used_at')
  },
  (t) => [index('memories_updated_idx').on(t.updatedAt), index('memories_owner_idx').on(t.owner)]
)

/** Chấm công: lưu trên máy để dùng offline. ended_at null = đang bấm giờ (tối đa một). */
export const timeEntries = sqliteTable(
  'time_entries',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id'),
    projectId: text('project_id'),
    title: text('title').notNull(),
    projectName: text('project_name'),
    kind: text('kind').$type<TimeEntryKind>().notNull().default('timer'),
    note: text('note').notNull().default(''),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at')
  },
  (t) => [index('time_entries_started_idx').on(t.startedAt)]
)

export const memorySuggestions = sqliteTable(
  'memory_suggestions',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull().default('local'),
    conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    action: text('action').$type<MemoryAction>().notNull(),
    targetMemoryId: text('target_memory_id'),
    content: text('content').notNull().default(''),
    category: text('category').$type<MemoryCategory>().notNull().default('other'),
    status: text('status').$type<SuggestionStatus>().notNull().default('pending'),
    /** Đề xuất cho trí nhớ dự án (null = trí nhớ chung). Xoá dự án → xoá theo. */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('memory_suggestions_status_idx').on(t.status, t.createdAt)]
)

/** Lịch sử trao đổi với agent khác (Claude Code, Claude Desktop…) qua MCP server của app. */
export const agentExchanges = sqliteTable(
  'agent_exchanges',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    clientName: text('client_name').notNull(),
    tool: text('tool').notNull(),
    /** Yêu cầu của agent (đã cắt ngắn). */
    input: text('input').notNull().default(''),
    output: text('output'),
    status: text('status').$type<'queued' | 'running' | 'done' | 'error' | 'rejected'>().notNull(),
    error: text('error'),
    createdAt: integer('created_at').notNull().default(now),
    finishedAt: integer('finished_at')
  },
  (t) => [index('agent_exchanges_created_idx').on(t.createdAt), index('agent_exchanges_client_idx').on(t.clientId)]
)

/** Artifact (tài liệu, slide, bảng, biểu đồ, sơ đồ, HTML) theo hội thoại — chỉ lưu trên máy. */
export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    type: text('type').$type<ArtifactType>().notNull(),
    version: integer('version').notNull().default(1),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => [index('artifacts_conversation_idx').on(t.conversationId, t.updatedAt)]
)

export const artifactVersions = sqliteTable(
  'artifact_versions',
  {
    id: text('id').primaryKey(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    by: text('by').$type<'assistant' | 'user'>().notNull(),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('artifact_versions_idx').on(t.artifactId, t.version)]
)

/**
 * Nhật ký thao tác của trợ lý cần quyền (A1: lệnh; trang Quyền & riêng tư thêm sửa file / MCP / nháp). Chỉ trên máy,
 * theo tài khoản, giữ 90 ngày. Chỉ tên lệnh / file, không chép nội dung. Xoá cuộc trò chuyện → nhật ký vẫn còn.
 */
export const actionLog = sqliteTable(
  'action_log',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull().default('local'),
    at: integer('at').notNull(),
    conversationId: text('conversation_id').references((): AnySQLiteColumn => conversations.id, { onDelete: 'set null' }),
    kind: text('kind').$type<ActionLogKind>().notNull(),
    /** Lệnh dễ đọc / đường dẫn file / tên tool. */
    target: text('target').notNull(),
    decision: text('decision').$type<ActionLogDecision>().notNull(),
    exitCode: integer('exit_code'),
    durationMs: integer('duration_ms'),
    /** Lý do bị chặn / lỗi ngắn. */
    detail: text('detail')
  },
  (t) => [index('action_log_owner_idx').on(t.owner, t.at), index('action_log_conversation_idx').on(t.conversationId)]
)
