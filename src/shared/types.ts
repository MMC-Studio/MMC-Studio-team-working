import type { ApprovalAskResult, ApprovalCard, ApprovalDelta } from './approvals'
import type { SyncTopic } from './sync'
import type { AppChooseResult, AppProgram, CommandDecision, CommandRun, CommandsSettings, CommandsStatus } from './commands'
import type { ActionLogPage, ActionLogQuery } from './actionLog'
import type { PrivacyStatus, ScheduleGrantKey } from './privacy'
import type { AutoEditOffer, AutoEditSession, AutoEditUndoInput, AutoEditUndoResult } from './autoEdits'
import type { Project, ProjectAddFilesResult, ProjectDeleteInfo, ProjectDetail, ProjectUpdate } from './projects'
import type {
  Schedule,
  ScheduleInput,
  ScheduleNoticeEvent,
  ScheduleOpenEvent,
  ScheduleProposalDecision,
  ScheduleRun,
  ScheduleErrorResult,
  ScheduleSaveResult,
  SchedulesStatus
} from './schedules'
import type { DeferredActionResult, DeferredCard } from './deferred'
import type { Catalog, InstallResult, InstalledPlugin, PluginSourceInfo, PluginStoreError, PreviewResult } from './pluginStore'
import type { Artifact, ArtifactSummary, ArtifactVersion, MessageArtifact } from './artifacts'
import type { MessageVoice, SpeakChunk, TranscribeResult, VoiceComponent, VoicePackState, VoiceSettings, VoiceStatus } from './voice'
import type { SkillDetail, SkillInfo, SkillPreviewResult, SkillSource, StyleLearnResult } from './skills'
import type {
  ExpressiveSettings,
  ExpressiveStatus,
  MediaItem,
  MediaKind,
  MediaRef,
  MediaSearchResult,
  MessageMedia,
  ExpressiveRecent,
  RecentKind,
  Reaction
} from './expressive'
import type { ChatEvent, ChatMode, ChatUsage, CliStatus } from './ai'
import type {
  AgentExchange,
  AgentNotice,
  AgentServerStatus,
  McpApprovalDecision,
  McpApprovalRequest,
  McpReviewResult,
  McpServerInfo,
  NewAgentToken
} from './agents'
import type { ComputerStatus, ScreenPreview } from './computer'
import type { SidecarState } from './sidecar'
import type {
  DraftDecision,
  GmailAccountUpdate,
  GmailPreviewItem,
  GmailStatus,
  TelegramChatInfo,
  TelegramMode,
  TelegramStatus
} from './connectors'
import type { CsvHeaders, TimeEntry } from './timesheet'
import type { UpdateState } from './update'
import type {
  AccountSession,
  SavedAccountInfo,
  AiResult,
  AiSettings,
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
  Appearance,
  AssistantProfile,
  DesktopNotification,
  FeedbackCoachRequest,
  FeedbackSummaryRequest,
  MemoryAction,
  TextResult,
  PlanRequest,
  PlanResult,
  MemoryCategory,
  SuggestionStatus,
  UpdateSettings,
  McpServerInput,
  UserProfile,
  ChatOrganizeSettings
} from './schemas'

export type Conversation = {
  id: string
  title: string
  mode: ChatMode
  pinned: boolean
  /** Chế độ Code: thư mục dự án đã chọn. */
  cwd: string | null
  /** Chế độ Code: người dùng đã bật cho phép sửa file (mỗi lần sửa vẫn phải duyệt). */
  codeWrite: boolean
  /** Nhóm ở thanh bên (null = chưa xếp nhóm). */
  groupId: string | null
  /** Nhánh: hội thoại gốc (null = không phải nhánh, hoặc gốc đã bị xoá). */
  parentId: string | null
  /** Trợ lý gợi ý xếp vào nhóm này — chờ người dùng đồng ý. */
  suggestedGroupId: string | null
  /** Dự án chứa cuộc này (null = cuộc thường). */
  projectId: string | null
  /** Cuộc do một lần chạy lịch hẹn tạo ra (null = cuộc thường). Không hiện ở thanh bên trừ khi được ghim. */
  scheduleId: string | null
  /**
   * Chỉ khi đang tìm kiếm và khớp nội dung tin nhắn (không phải tiêu đề): trích đoạn, chữ khớp nằm giữa
   * SNIPPET_OPEN / SNIPPET_CLOSE (`@shared/search`).
   */
  searchSnippet?: string | null
  createdAt: number
  updatedAt: number
}

export type ConversationGroup = {
  id: string
  name: string
  collapsed: boolean
  createdAt: number
}

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'streaming' | 'done' | 'error' | 'aborted'

export type ToolEvent = { name: string; input: unknown }

/** Thông tin file đính kèm renderer được thấy (không có đường dẫn). */
export type Attachment = {
  id: string
  name: string
  mimeType: string
  size: number
  /** Thumbnail (data URL) trả về lúc vừa thêm ảnh — chỉ dùng ở khung soạn tin, không lưu DB. */
  thumbnail?: string
}

/** Bản lưu trong main — có đường dẫn file đã copy vào workspace. */
export type StoredAttachment = Attachment & {
  path: string
  /** Bản thu nhỏ gửi cho Claude khi ảnh gốc vượt giới hạn (bản gốc vẫn là `path`). */
  modelPath?: string
  modelMimeType?: string
}

export type Message = {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  status: MessageStatus
  error: string | null
  toolEvents: ToolEvent[]
  attachments: Attachment[]
  usage: ChatUsage | null
  /** Cảm xúc đã thả (mỗi bên tối đa 1). */
  reactions: Reaction[]
  /** GIF / sticker kèm tin. */
  media: MessageMedia | null
  /** Tin gửi bằng giọng nói (chữ do máy chép lại) + ghi âm gốc. */
  voice: MessageVoice | null
  /** Artifact tạo / sửa trong câu trả lời này. */
  artifacts: MessageArtifact[]
  /** Tin này trả lời tin nào (tin gốc có thể không còn). */
  replyToId: string | null
  /** Đã ghim (thời điểm ghim). */
  pinnedAt: number | null
  /** Đã thu hồi — nội dung đã xoá. */
  recalledAt: number | null
  createdAt: number
}

/** Mỗi cuộc trò chuyện ghim tối đa từng này tin — ghim quá nhiều thì như không ghim. */
export const MAX_PINNED_MESSAGES = 5

export type ChatSendResult = {
  requestId: string
  userMessage: Message
  assistantMessage: Message
}

/** Gói sự kiện main → renderer trên kênh `chat:event`. */
export type ChatStreamPayload = {
  requestId: string
  conversationId: string
  messageId: string
  event: ChatEvent
}

export type ConversationUpdate = {
  id: string
  title?: string
  pinned?: boolean
  mode?: ChatMode
  /** null = bỏ khỏi nhóm. */
  groupId?: string | null
}

export type Memory = {
  id: string
  content: string
  category: MemoryCategory
  sourceConversationId: string | null
  /** Trí nhớ riêng của dự án (null = trí nhớ chung). */
  projectId: string | null
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
}

export type MemorySuggestion = {
  id: string
  conversationId: string | null
  action: MemoryAction
  targetMemoryId: string | null
  /** Nội dung memory hiện tại (với update/delete) để người dùng so sánh. */
  targetContent: string | null
  content: string
  category: MemoryCategory
  status: SuggestionStatus
  /** Đề xuất cho trí nhớ dự án (null = trí nhớ chung) + tên dự án để hiện nhãn. */
  projectId: string | null
  projectName: string | null
  /** Dự án của cuộc trò chuyện sinh ra đề xuất — để đổi Chung ↔ Dự án trước khi duyệt. */
  sourceProjectId: string | null
  sourceProjectName: string | null
  createdAt: number
}

export type ExtractResult = { added: number } | { error: string }

/** Yêu cầu sửa file ở chế độ Code đang chờ người dùng duyệt. */
/** Trợ lý xin quyền đọc (và có thể sửa) một thư mục trên máy — người dùng tự chọn thư mục mới có quyền. */
export type FolderAccessRequest = {
  id: string
  conversationId: string
  /** Đường dẫn trợ lý đề xuất (chỉ để gợi ý trong hộp chọn thư mục — KHÔNG tự cấp). */
  suggestedPath: string | null
  /** Xin cả quyền sửa (mỗi lần sửa vẫn phải duyệt diff). */
  write: boolean
  reason: string
}
/** Thẻ xin quyền đóng lại (hết giờ, dừng lượt…) mà người dùng chưa trả lời. */
export type FolderAccessClosed = { id: string; closed: true }
export type FolderAccessResult =
  | { status: 'granted'; conversation: Conversation }
  /** Người dùng đóng hộp chọn thư mục mà chưa chọn — thẻ vẫn chờ. */
  | { status: 'pending' }
  | { status: 'denied' }
  /** Yêu cầu không còn (lượt chat đã kết thúc). */
  | { status: 'expired' }

export type CodeApprovalRequest = {
  id: string
  conversationId: string
  toolName: string
  change: { path: string; isNewFile: boolean; patch: string; added: number; removed: number }
  /** Có nút "Đồng ý, và không hỏi lại trong phiên này" không; không → vì sao (PR C). */
  autoEdit?: AutoEditOffer
}

/** Sự kiện main → renderer khi danh sách đề xuất memory thay đổi. */
export type MemoryEventPayload =
  | { type: 'suggestions'; pending: number }
  | { type: 'extracting'; conversationId: string; running: boolean }

export type PickAttachmentsResult = {
  attachments: Attachment[]
  rejected: { name: string; reason: string }[]
}

/** API có kiểu mà preload expose tại `window.api`. */
export interface TeamWorkingApi {
  /** Đồng bộ trạng thái: main báo các mục vừa đổi → trang đang mở tự hỏi lại (xem lib/sync.ts). */
  sync: {
    onChanged(listener: (topics: SyncTopic[]) => void): () => void
  }
  /** Thẻ đang chờ duyệt trong khung chat (sửa file, quyền thư mục, nháp) + "Hỏi lại". */
  approvals: {
    list(): Promise<ApprovalCard[]>
    ask(id: string, question: string): Promise<ApprovalAskResult>
    onDelta(listener: (delta: ApprovalDelta) => void): () => void
  }
  cli: {
    check(): Promise<CliStatus>
  }
  conversations: {
    list(query?: string): Promise<Conversation[]>
    create(mode?: ChatMode, projectId?: string): Promise<Conversation>
    update(input: ConversationUpdate): Promise<Conversation>
    remove(id: string): Promise<void>
    /** Tách nhánh từ một tin nhắn: hội thoại mới có sẵn các tin tới tin đó. */
    fork(messageId: string): Promise<Conversation>
    /** Trả lời gợi ý nhóm của trợ lý: đồng ý → chuyển vào nhóm; không → bỏ gợi ý. */
    answerSuggestion(id: string, accept: boolean): Promise<Conversation>
  }
  /** Dự án cá nhân (hướng dẫn + file ngữ cảnh gửi kèm trợ lý trong mọi cuộc của dự án). */
  projects: {
    list(): Promise<Project[]>
    get(id: string): Promise<ProjectDetail | null>
    create(input: { name: string; description?: string }): Promise<Project>
    update(input: ProjectUpdate): Promise<Project>
    deleteInfo(id: string): Promise<ProjectDeleteInfo | null>
    remove(id: string): Promise<boolean>
    /** Mở hộp thoại chọn file chữ (main) rồi thêm vào dự án. */
    addFiles(id: string): Promise<ProjectAddFilesResult>
    removeFile(fileId: string): Promise<void>
  }
  /** Lịch hẹn. Lỗi biết trước trả `{ status: 'error', error }` (mã lỗi → i18n). */
  /** Chạy lệnh theo danh sách cho phép (git chỉ đọc) — mỗi lần đều qua thẻ duyệt. */
  /** Nhật ký thao tác cần quyền (chỉ trên máy, 90 ngày, không nội dung). */
  actionLog: {
    list(query: ActionLogQuery): Promise<ActionLogPage>
  }
  /** Quyền trợ lý đang có. Thu hồi = huỷ thẻ đang chờ + dừng lệnh / lượt / lần chạy đang dùng quyền đó. */
  privacy: {
    status(): Promise<PrivacyStatus>
    /** false = cuộc không có thư mục (đã gỡ ở nơi khác). */
    revokeFolder(conversationId: string): Promise<boolean>
    revokeScheduleGrant(scheduleId: string, key: ScheduleGrantKey): Promise<boolean>
  }
  commands: {
    status(): Promise<CommandsStatus>
    setSettings(settings: CommandsSettings): Promise<CommandsStatus>
    respond(decision: CommandDecision): Promise<boolean>
    setApp(program: AppProgram, enabled: boolean): Promise<CommandsStatus>
    chooseApp(program: AppProgram): Promise<AppChooseResult>
    /** Lần chạy Unity / Blender của một cuộc (đang chạy + đã xong gần đây), mới nhất trước. */
    runs(conversationId: string): Promise<CommandRun[]>
    stopRun(id: string): Promise<boolean>
    dismissRun(id: string): Promise<boolean>
    openRunLog(id: string): Promise<boolean>
  }
  schedules: {
    list(): Promise<Schedule[]>
    status(): Promise<SchedulesStatus>
    /** Quyền MỚI chưa xác nhận → `{ status: 'confirm', added }` (gọi lại với confirmed = true sau hộp xác nhận). */
    save(input: { id?: string; input: ScheduleInput; confirmed?: boolean }): Promise<ScheduleSaveResult | ScheduleErrorResult>
    setEnabled(id: string, enabled: boolean): Promise<{ status: 'saved'; schedule: Schedule } | ScheduleErrorResult>
    skipNext(id: string, skip: boolean): Promise<{ status: 'saved'; schedule: Schedule } | ScheduleErrorResult>
    remove(id: string): Promise<boolean>
    runNow(id: string): Promise<boolean>
    stop(): Promise<boolean>
    runs(scheduleId: string | null, limit?: number): Promise<ScheduleRun[]>
    markSeen(conversationId: string): Promise<boolean>
    /** Bật / tắt tính năng (lần đầu bật phải kèm acknowledged), ẩn xuống khay khi đóng. */
    setFeature(input: { enabled?: boolean; acknowledged?: true; trayOnClose?: boolean }): Promise<SchedulesStatus>
    pauseAll(paused: boolean): Promise<SchedulesStatus>
    /** Hộp chọn thư mục (main) — null = huỷ. */
    pickFolder(): Promise<string | null>
    respondProposal(decision: ScheduleProposalDecision): Promise<boolean>
    /** Thẻ hoãn duyệt (lần chạy theo lịch): của một cuộc, hoặc mọi thẻ còn chờ (null). */
    deferred: {
      list(conversationId: string | null): Promise<DeferredCard[]>
      /** Bỏ trống paths = mọi file đang chờ ("Đồng ý tất cả" — chỉ cho file). */
      approveFiles(id: string, paths?: string[]): Promise<DeferredActionResult>
      rejectFiles(id: string, paths?: string[]): Promise<DeferredActionResult>
      /** Nháp: duyệt TỪNG cái, sửa được nội dung trước khi tạo. */
      approveDraft(id: string, body?: string): Promise<DeferredActionResult>
      rejectDraft(id: string): Promise<DeferredActionResult>
      ask(id: string, question: string): Promise<DeferredActionResult>
      revise(id: string, note: string): Promise<DeferredActionResult>
    }
    onOpen(listener: (e: ScheduleOpenEvent) => void): () => void
    onNotice(listener: (e: ScheduleNoticeEvent) => void): () => void
    /** Chỉ e2e (MMC_FAKE_CLOCK): tua đồng hồ, giả máy thức dậy, nhấn phím dừng. */
    test: { advance(ms: number): Promise<void>; sleep(ms: number): Promise<void>; hotkey(): Promise<void> }
  }
  /** Kho plugin online: chỉ skill bằng chữ, cài theo commit SHA, không tự cập nhật. */
  pluginStore: {
    sources(): Promise<PluginSourceInfo[]>
    addSource(input: { repo: string; ref?: string }): Promise<{ status: 'ok'; source: PluginSourceInfo } | { status: 'error'; error: PluginStoreError }>
    /** Nguồn tự thêm: plugin đã cài giữ lại ("nguồn đã bị xoá"). Nguồn mặc định không xoá được. */
    removeSource(repo: string): Promise<{ status: 'ok' } | { status: 'error'; error: PluginStoreError }>
    /** `force` = nút Làm mới (tối đa 1 lần / phút). */
    catalog(force?: boolean): Promise<Catalog>
    preview(key: string): Promise<PreviewResult>
    cancelPreview(token: string): Promise<void>
    /** `mcp`: tên các MCP server (trong gói) người dùng đã tick xác nhận. */
    install(token: string, mcp?: string[]): Promise<InstallResult>
    uninstall(key: string): Promise<boolean>
    installed(): Promise<InstalledPlugin[]>
    checkUpdates(): Promise<InstalledPlugin[]>
  }
  conversationGroups: {
    list(): Promise<ConversationGroup[]>
    create(name: string): Promise<ConversationGroup | { error: string }>
    update(input: { id: string; name?: string; collapsed?: boolean }): Promise<ConversationGroup | { error: string }>
    /** Xoá nhóm — các cuộc trò chuyện trong nhóm KHÔNG bị xoá, chỉ ra khỏi nhóm. */
    remove(id: string): Promise<void>
  }
  messages: {
    list(conversationId: string): Promise<Message[]>
  }
  chat: {
    send(conversationId: string, text: string, attachmentIds?: string[], replyToId?: string): Promise<ChatSendResult>
    abort(requestId: string): Promise<void>
    onEvent(listener: (payload: ChatStreamPayload) => void): () => void
    pickAttachments(): Promise<PickAttachmentsResult>
    /** Thêm một file từ kéo thả / dán (gửi nội dung, không gửi đường dẫn). */
    addFile(name: string, data: Uint8Array): Promise<PickAttachmentsResult>
    /** Ctrl+V khi trình duyệt không đưa ra file: main đọc ảnh / file trong clipboard của Windows. */
    pasteClipboard(): Promise<PickAttachmentsResult>
    /** Ảnh xem trước (data URL); null nếu không phải ảnh hoặc không có quyền xem. */
    attachmentPreview(id: string, size: 'thumb' | 'large'): Promise<string | null>
    /** Gửi GIF / sticker (chỉ id; có thể kèm chữ). */
    sendMedia(conversationId: string, text: string, media: MediaRef): Promise<ChatSendResult>
    /** Gửi chữ chép từ giọng nói (đánh dấu "🎤 nói"). */
    sendVoice(conversationId: string, text: string, voice: MessageVoice): Promise<ChatSendResult>
    /** Thả cảm xúc (null = bỏ). Mỗi người tối đa 1 cảm xúc mỗi tin. */
    react(messageId: string, emoji: string | null): Promise<Message>
    /** Ghim / bỏ ghim (lỗi pin_limit khi đã đủ MAX_PINNED_MESSAGES). */
    pin(messageId: string, pinned: boolean): Promise<Message>
    /** Thu hồi tin của người dùng (xoá nội dung, không gửi lại cho trợ lý). */
    recall(messageId: string): Promise<Message>
    /** Sửa & gửi lại: xoá tin này và mọi tin sau nó rồi gửi nội dung mới. */
    editResend(messageId: string, text: string): Promise<ChatSendResult>
  }
  skills: {
    /** Skill người dùng cài + skill có sẵn của app (chỉ xem). */
    list(): Promise<SkillInfo[]>
    get(source: SkillSource, name: string): Promise<SkillDetail | null>
    /** Chọn thư mục / file .zip → bản xem trước (chưa cài). null = huỷ chọn. */
    pick(kind: 'folder' | 'zip'): Promise<SkillPreviewResult>
    /** Cài đúng gói đã xem trước. */
    install(token: string): Promise<SkillInfo>
    cancelPreview(token: string): Promise<void>
    remove(name: string): Promise<void>
    setEnabled(name: string, enabled: boolean): Promise<void>
    openFolder(): Promise<void>
    /** Ghi chú trong skill my-style. */
    styleNotes(): Promise<string[]>
    /** Ghi lại toàn bộ ghi chú my-style (đã được người dùng duyệt). Rỗng = xoá skill. */
    setStyleNotes(notes: string[]): Promise<void>
    /** Nhờ trợ lý đọc hội thoại gần đây và ĐỀ XUẤT ghi chú phong cách — không tự lưu. */
    learnStyle(): Promise<StyleLearnResult>
  }
  voice: {
    status(): Promise<VoiceStatus>
    setSettings(value: VoiceSettings): Promise<VoiceStatus>
    /** Tải một phần của gói giọng nói (thư viện / CUDA / model) — chỉ khi người dùng bấm. */
    install(component: VoiceComponent): Promise<VoiceStatus>
    cancel(): Promise<void>
    removeModel(component: Exclude<VoiceComponent, 'packages' | 'cuda'>): Promise<VoiceStatus>
    /** WAV 16 kHz mono từ micro → chữ (ghi âm gốc giữ 7 ngày trên máy). */
    transcribe(wav: Uint8Array, durationMs: number): Promise<TranscribeResult>
    /** Đọc một câu → data URL âm thanh. */
    speak(text: string): Promise<SpeakChunk>
    /** Đang đọc: giữ phím dừng khẩn cấp Ctrl+Alt+Q để dừng đọc. */
    setSpeaking(on: boolean): Promise<void>
    recording(id: string): Promise<string | null>
    onPack(listener: (state: VoicePackState) => void): () => void
    /** Ctrl+Alt+Q → dừng đọc. */
    onStop(listener: () => void): () => void
  }
  artifacts: {
    list(conversationId: string): Promise<Artifact[]>
    /** Trang Artifacts: mọi artifact của tài khoản hiện tại, kèm tên cuộc trò chuyện. */
    listAll(): Promise<ArtifactSummary[]>
    versions(id: string): Promise<Omit<ArtifactVersion, 'content'>[]>
    content(id: string, version?: number): Promise<{ artifact: Artifact; version: ArtifactVersion } | null>
    /** Người dùng sửa (vd ô trong bảng) → phiên bản mới. */
    saveVersion(id: string, content: string): Promise<Artifact | null>
    restore(id: string, version: number): Promise<Artifact | null>
    /** Xuất ra file — hộp thoại Lưu của Windows. */
    export(id: string, version: number, format: string): Promise<{ path: string } | { canceled: true } | { error: string }>
    templates(): Promise<{ id: string; name: string; prompt: string }[]>
  }
  expressive: {
    status(): Promise<ExpressiveStatus>
    setSettings(value: ExpressiveSettings): Promise<ExpressiveStatus>
    resetAuto(): Promise<ExpressiveStatus>
    /** Key GIPHY của người dùng (mã hoá DPAPI); null = xoá. Key không bao giờ quay về renderer. */
    setGiphyKey(key: string | null): Promise<ExpressiveStatus | { error: string }>
    /** Tìm GIF / sticker GIPHY; query rỗng = thịnh hành. */
    search(kind: MediaKind, query: string, offset?: number): Promise<MediaSearchResult>
    stickers(): Promise<MediaItem[]>
    stickerData(id: string): Promise<string | null>
    openStickersFolder(): Promise<void>
    favorites(): Promise<{ refs: MediaRef[]; items: MediaItem[] }>
    toggleFavorite(ref: MediaRef): Promise<MediaRef[]>
    /** Emoji / GIF / sticker dùng gần đây (chỉ trên máy), mới dùng xếp đầu. */
    recent(): Promise<ExpressiveRecent>
    /** Ghi nhận emoji vừa dùng (chọn trong bộ chọn, gõ trong tin). Cảm xúc / GIF / sticker main tự ghi. */
    recordEmoji(emoji: string[]): Promise<void>
    clearRecent(kind: RecentKind): Promise<void>
  }
  memory: {
    getProfile(): Promise<UserProfile>
    setProfile(profile: UserProfile): Promise<UserProfile>
    /** Bỏ `projectId` = mọi phạm vi, null = chỉ trí nhớ chung, id = chỉ của dự án đó. */
    list(filter?: { query?: string; projectId?: string | null }): Promise<Memory[]>
    create(content: string, category: MemoryCategory, projectId?: string | null): Promise<Memory>
    update(id: string, content: string, category: MemoryCategory): Promise<Memory>
    remove(id: string): Promise<void>
    suggestions(): Promise<MemorySuggestion[]>
    resolve(input: {
      id: string
      accept: boolean
      content?: string
      category?: MemoryCategory
      projectId?: string | null
    }): Promise<void>
    /** Duyệt nhiều đề xuất một lần; trả về số đề xuất đã xử lý (đề xuất không còn chờ thì bỏ qua). */
    resolveMany(
      items: { id: string; accept: boolean; content?: string; category?: MemoryCategory }[]
    ): Promise<number>
    extract(conversationId: string): Promise<ExtractResult>
    /** Báo đã rời một cuộc trò chuyện — main tự đề xuất memory nếu được bật và có đủ tin mới. */
    conversationLeft(conversationId: string): Promise<void>
    export(): Promise<string | null>
    onEvent(listener: (payload: MemoryEventPayload) => void): () => void
  }
  settings: {
    getAssistant(): Promise<AssistantProfile>
    setAssistant(profile: AssistantProfile): Promise<AssistantProfile>
    getAppearance(): Promise<Appearance>
    setAppearance(appearance: Appearance): Promise<Appearance>
    getAi(): Promise<AiSettings & { hasApiKey: boolean; secureStorage: boolean }>
    setAi(settings: AiSettings): Promise<AiSettings>
    setApiKey(key: string): Promise<void>
    clearApiKey(): Promise<void>
    getChatOrganize(): Promise<ChatOrganizeSettings>
    setChatOrganize(settings: ChatOrganizeSettings): Promise<ChatOrganizeSettings>
  }
  update: {
    getState(): Promise<UpdateState>
    onState(listener: (state: UpdateState) => void): () => void
    /** Kiểm tra ngay (người dùng bấm) — hiện kết quả kể cả khi đã bỏ qua phiên bản đó. */
    check(): Promise<void>
    download(): Promise<void>
    /** Để sau: bản thường nhắc lại lần mở app sau; bản [critical] nhắc ở lần kiểm tra kế tiếp. */
    postpone(): Promise<void>
    /** Không nhắc lại phiên bản này (không áp dụng cho bản [critical]). */
    skip(): Promise<void>
    /** Khởi động lại để cài bản đã tải. */
    install(): Promise<void>
    getSettings(): Promise<UpdateSettings & { currentVersion: string }>
    setSettings(settings: UpdateSettings): Promise<UpdateSettings>
  }
  app: {
    openExternal(url: string): Promise<void>
    /** Main yêu cầu chuyển trang (vd khi bấm thông báo Windows). */
    onNavigate(listener: (route: string) => void): () => void
    /** Ghi lỗi của giao diện vào file log. */
    logError(message: string): Promise<void>
    /** Phiên bản, hệ điều hành, đoạn cuối log (đã che đường dẫn/email) cho báo lỗi. */
    bugInfo(): Promise<{ version: string; os: string; logTail: string }>
  }
  computer: {
    status(): Promise<ComputerStatus>
    onStatus(listener: (status: ComputerStatus) => void): () => void
    /** Bật lần đầu phải kèm acceptWarning (người dùng đã đọc cảnh báo). */
    setEnabled(
      enabled: boolean,
      acceptWarning?: boolean
    ): Promise<ComputerStatus | { error: string }>
    /** Cho trợ lý xem màn hình trong phiên này (tắt khi khởi động lại app hoặc dừng khẩn cấp). */
    setScreenAccess(on: boolean): Promise<ComputerStatus | { error: string }>
    emergencyStop(): Promise<void>
    /** Chụp thử tại máy (không gửi cho Claude) để xem trợ lý sẽ thấy gì. */
    preview(display?: number): Promise<ScreenPreview | { error: string }>
    openLogs(): Promise<void>
  }
  agents: {
    status(): Promise<AgentServerStatus>
    onStatus(listener: (s: AgentServerStatus) => void): () => void
    onNotice(listener: (n: AgentNotice) => void): () => void
    setEnabled(on: boolean): Promise<AgentServerStatus | { error: string }>
    setLimits(limits: { perHour: number; concurrency: number }): Promise<AgentServerStatus>
    /** Token chỉ trả về đúng lần tạo này. */
    createClient(name: string): Promise<NewAgentToken>
    revoke(clientId: string): Promise<AgentServerStatus>
    respondPairing(clientId: string, allow: boolean): Promise<AgentServerStatus>
    /** Ngắt mọi kết nối (như Ctrl+Alt+Q). */
    stopAll(): Promise<void>
    exchanges(): Promise<AgentExchange[]>
  }
  mcp: {
    list(): Promise<McpServerInfo[]>
    save(input: McpServerInput): Promise<McpServerInfo | { error: string }>
    remove(id: string): Promise<void>
    setEnabled(id: string, enabled: boolean): Promise<void>
    revokeAlways(id: string, tool: string): Promise<void>
    onApproval(listener: (req: McpApprovalRequest) => void): () => void
    respond(id: string, decision: McpApprovalDecision): Promise<boolean>
    /** Server từ kho: kết nối, lấy danh sách tool + mô tả để người dùng xem trước khi bật. */
    review(id: string): Promise<McpReviewResult>
    /** Bật sau khi xem (token của lần xem); false = hết hạn, xem lại. */
    approveReview(token: string): Promise<boolean>
    /** Nhập header bí mật (vd token) cho server từ kho — chỉ các khoá plugin khai báo. */
    setStoreHeaders(id: string, headers: Record<string, string>): Promise<McpServerInfo | { error: string }>
  }
  sidecar: {
    state(): Promise<SidecarState>
    onState(listener: (state: SidecarState) => void): () => void
    /** Bắt đầu tải + cài (chạy nền); theo dõi qua onState. */
    install(): Promise<SidecarState | { error: string }>
    cancel(): Promise<void>
    /** Gỡ sạch uv, Python, thư viện. */
    uninstall(): Promise<SidecarState | { error: string }>
    /** Thử đọc danh sách cửa sổ tại máy (không gửi cho Claude). */
    check(): Promise<{ windows: number; python: string } | { error: string }>
  }
  /** Gmail cá nhân (thử nghiệm, mặc định tắt): chỉ đọc + tạo nháp sau khi duyệt. Secret không bao giờ về renderer. */
  gmail: {
    status(): Promise<GmailStatus>
    onStatus(listener: (status: GmailStatus) => void): () => void
    setEnabled(enabled: boolean): Promise<GmailStatus | { error: string }>
    /** clientSecret bỏ trống = giữ secret đã lưu. */
    setCredentials(input: { clientId: string; clientSecret?: string }): Promise<GmailStatus | { error: string }>
    setOptions(input: { testingMode: boolean }): Promise<GmailStatus | { error: string }>
    /** Tên gọi, bật/tắt cho trợ lý đọc, lọc riêng tư của một tài khoản. */
    updateAccount(input: GmailAccountUpdate): Promise<GmailStatus | { error: string }>
    /** Mở trình duyệt đăng nhập Google; chờ tới khi xong / huỷ / hết 5 phút. Không id = thêm tài khoản mới. */
    connect(accountId?: string): Promise<GmailStatus | { error: string }>
    cancelConnect(): Promise<void | { error: string }>
    /** Ngắt một tài khoản: thu hồi + xoá token trên máy, bỏ khỏi danh sách. */
    disconnect(accountId: string): Promise<GmailStatus | { error: string }>
    /** 5 thư mới nhất của một tài khoản, tại máy (không gửi cho Claude). */
    preview(accountId: string): Promise<GmailPreviewItem[] | { error: string }>
  }
  /** Telegram tài khoản cá nhân qua GramJS (thử nghiệm, mặc định tắt): chỉ đọc + lưu nháp sau khi duyệt. */
  telegram: {
    status(): Promise<TelegramStatus>
    onStatus(listener: (status: TelegramStatus) => void): () => void
    setEnabled(enabled: boolean): Promise<TelegramStatus | { error: string }>
    /** apiHash bỏ trống = giữ hash đã lưu. */
    setCredentials(input: { apiId: number; apiHash?: string }): Promise<TelegramStatus | { error: string }>
    sendCode(phone: string): Promise<TelegramStatus | { error: string }>
    signIn(code: string): Promise<TelegramStatus | { error: string }>
    password(password: string): Promise<TelegramStatus | { error: string }>
    cancelLogin(): Promise<TelegramStatus | { error: string }>
    /** Đăng xuất phía Telegram + xoá session trên máy. */
    logout(): Promise<TelegramStatus | { error: string }>
    /** force = tải lại ngay (tối đa 1 lần/phút); mặc định dùng bản lưu tạm 15 phút. */
    chats(force?: boolean): Promise<TelegramChatInfo[] | { error: string }>
    setLists(input: { mode: TelegramMode; allow: string[]; block: string[] }): Promise<TelegramStatus | { error: string }>
  }
  /** Bản nháp trợ lý đề xuất (Gmail / Telegram) chờ người dùng duyệt. */
  drafts: {
    respond(decision: DraftDecision): Promise<boolean>
  }
  ideas: {
    /** Trợ lý chuẩn hóa ý tưởng/báo lỗi thành GitHub issue (bản nháp để người dùng sửa). */
    format(input: {
      title: string
      description: string
      kind: 'idea' | 'bug'
      language: 'vi' | 'en'
    }): Promise<AiResult<{ title: string; body: string; labels: string[] }>>
  }
  auth: {
    /** Mở trình duyệt tới link đăng nhập Supabase và chờ mã trả về qua cổng loopback. */
    oauth(authorizeUrl: string): Promise<{ code: string } | { error: string }>
    cancel(): Promise<void>
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
  code: {
    /** Mở hộp thoại chọn thư mục dự án cho hội thoại (đổi thư mục → tắt quyền sửa). */
    chooseFolder(conversationId: string): Promise<Conversation | null>
    setWrite(conversationId: string, enabled: boolean): Promise<Conversation>
    /** Từ chối có thể kèm góp ý → Claude đề xuất bản sửa mới trong cùng lượt. */
    respond(id: string, allow: boolean, feedback?: string): Promise<void>
    /** Gỡ thư mục khỏi hội thoại = thu hồi quyền đọc/sửa. */
    clearFolder(conversationId: string): Promise<Conversation | null>
    /** Trả lời thẻ trợ lý xin quyền thư mục (grant = mở hộp chọn thư mục). */
    respondFolderAccess(id: string, grant: boolean, write: boolean, feedback?: string): Promise<FolderAccessResult>
    /** "Đồng ý, và không hỏi lại trong phiên này" (PR C). Không đủ điều kiện nữa → lỗi, thẻ vẫn chờ. */
    respondAuto(id: string): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'not_eligible' | 'changed' }>
  }
  /** Phiên tự duyệt sửa file (PR C): băng trong khung chat + Cài đặt → Quyền & riêng tư. */
  autoEdits: {
    /** Không truyền cuộc = mọi phiên của tài khoản (đang chạy + còn hoàn tác được). */
    list(conversationId?: string): Promise<AutoEditSession[]>
    stop(sessionId: string): Promise<boolean>
    undo(input: AutoEditUndoInput): Promise<AutoEditUndoResult | null>
    dismiss(sessionId: string): Promise<boolean>
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
  account: {
    /** Báo main tài khoản đang đăng nhập (null = đăng xuất) — trí nhớ/hồ sơ đổi theo. */
    set(uid: string | null): Promise<{ owner: string; claimed: boolean }>
  }
  accounts: {
    /** Tài khoản từng đăng nhập trên máy, mới dùng gần nhất trước. */
    list(): Promise<SavedAccount[]>
    /** Sau mỗi lần đăng nhập/làm mới phiên: cập nhật thông tin (và phiên nếu đang ghi nhớ). */
    record(account: SavedAccountInfo, session: AccountSession): Promise<void>
    /** Bật/tắt "ghi nhớ đăng nhập" cho tài khoản (bật thì cần phiên hiện tại). */
    remember(id: string, remember: boolean, session?: AccountSession): Promise<void>
    /** Phiên đã lưu để đổi nhanh (null nếu không ghi nhớ). */
    session(id: string): Promise<AccountSession | null>
    /** Phiên đã lưu không còn dùng được (đăng xuất / hết hạn) → xóa, giữ tài khoản trong danh sách. */
    dropSession(id: string): Promise<void>
    forget(id: string): Promise<void>
  }
}

export type SavedAccount = SavedAccountInfo & { remembered: boolean; lastUsedAt: number }

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
