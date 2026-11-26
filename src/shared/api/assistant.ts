import type { ApprovalAskResult, ApprovalCard, ApprovalDelta } from '../approvals'
import type {
  AppChooseResult,
  AppProgram,
  CommandDecision,
  CommandRun,
  CommandsSettings,
  CommandsStatus
} from '../commands'
import type { ActionLogPage, ActionLogQuery } from '../actionLog'
import type { PrivacyStatus, ScheduleGrantKey } from '../privacy'
import type {
  AutoEditOffer,
  AutoEditSession,
  AutoEditUndoInput,
  AutoEditUndoResult
} from '../autoEdits'
import type {
  Project,
  ProjectAddFilesResult,
  ProjectDeleteInfo,
  ProjectDetail,
  ProjectUpdate
} from '../projects'
import type { Artifact, ArtifactSummary, ArtifactVersion, MessageArtifact } from '../artifacts'
import type { MessageVoice } from '../voice'
import type {
  SkillDetail,
  SkillInfo,
  SkillPreviewResult,
  SkillSource,
  StyleLearnResult
} from '../skills'
import type { MediaRef, MessageMedia, Reaction } from '../expressive'
import type { ChatEvent, ChatMode, ChatUsage, CliStatus } from '../ai'
import type {
  AgentExchange,
  AgentNotice,
  AgentServerStatus,
  McpApprovalDecision,
  McpApprovalRequest,
  McpReviewResult,
  McpServerInfo,
  NewAgentToken
} from '../agents'
import type { ComputerStatus, ScreenPreview } from '../computer'
import type { SidecarState } from '../sidecar'
import type {
  MemoryAction,
  MemoryCategory,
  SuggestionStatus,
  McpServerInput,
  UserProfile
} from '../schemas'

/** Một thư mục phụ của cuộc trò chuyện (D). */
export type ExtraFolder = { path: string; write: boolean }

/** Tối đa số thư mục phụ mỗi cuộc. */
export const MAX_EXTRA_DIRS = 3

export type Conversation = {
  id: string
  title: string
  mode: ChatMode
  pinned: boolean
  /** Chế độ Code: thư mục dự án đã chọn. */
  cwd: string | null
  /** Chế độ Code: người dùng đã bật cho phép sửa file (mỗi lần sửa vẫn phải duyệt). */
  codeWrite: boolean
  /** Thư mục phụ (D): tối đa 3, chỉ khi có thư mục chính; mặc định chỉ đọc, sửa = tick riêng (luôn hỏi, không tự duyệt). */
  extraDirs: ExtraFolder[]
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
  /** Xin THÊM một thư mục phụ (D) — luôn chỉ đọc; cấp xong người dùng tự tick sửa nếu muốn. */
  extra?: boolean
}
/** Thẻ xin quyền đóng lại (hết giờ, dừng lượt…) mà người dùng chưa trả lời. */
export type FolderAccessClosed = { id: string; closed: true }
export type FolderAccessResult =
  | { status: 'granted'; conversation: Conversation }
  /** Người dùng đóng hộp chọn thư mục mà chưa chọn — thẻ vẫn chờ. `error`: thư mục vừa chọn không dùng được (mã lỗi). */
  | { status: 'pending'; error?: string }
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
  /** File nằm trong thư mục phụ này (D); không có = thư mục chính. `change.path` tương đối với thư mục này. */
  extraFolder?: string
}

/** Sự kiện main → renderer khi danh sách đề xuất memory thay đổi. */
export type MemoryEventPayload =
  | { type: 'suggestions'; pending: number }
  | { type: 'extracting'; conversationId: string; running: boolean }

export type PickAttachmentsResult = {
  attachments: Attachment[]
  rejected: { name: string; reason: string }[]
}

/** Phần `window.api` của Mảng A — Trợ lý & Agent: chat, hội thoại, dự án, duyệt, Code, lệnh, agent, MCP, máy tính, artifact, skill, trí nhớ, quyền. */
export interface AssistantApi {
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
  /** Nhật ký thao tác cần quyền (chỉ trên máy, 90 ngày, không nội dung). */
  actionLog: {
    list(query: ActionLogQuery): Promise<ActionLogPage>
  }
  /** Quyền trợ lý đang có. Thu hồi = huỷ thẻ đang chờ + dừng lệnh / lượt / lần chạy đang dùng quyền đó. */
  privacy: {
    status(): Promise<PrivacyStatus>
    /** false = cuộc không có thư mục (đã gỡ ở nơi khác). */
    revokeFolder(conversationId: string): Promise<boolean>
    /** Thu hồi một thư mục phụ (D). false = không còn. */
    revokeExtraFolder(conversationId: string, path: string): Promise<boolean>
    revokeScheduleGrant(scheduleId: string, key: ScheduleGrantKey): Promise<boolean>
  }
  /** Chạy lệnh theo danh sách cho phép (git chỉ đọc) — mỗi lần đều qua thẻ duyệt. */
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
  conversationGroups: {
    list(): Promise<ConversationGroup[]>
    create(name: string): Promise<ConversationGroup | { error: string }>
    update(input: {
      id: string
      name?: string
      collapsed?: boolean
    }): Promise<ConversationGroup | { error: string }>
    /** Xoá nhóm — các cuộc trò chuyện trong nhóm KHÔNG bị xoá, chỉ ra khỏi nhóm. */
    remove(id: string): Promise<void>
  }
  messages: {
    list(conversationId: string): Promise<Message[]>
  }
  chat: {
    send(
      conversationId: string,
      text: string,
      attachmentIds?: string[],
      replyToId?: string
    ): Promise<ChatSendResult>
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
  artifacts: {
    list(conversationId: string): Promise<Artifact[]>
    /** Trang Artifacts: mọi artifact của tài khoản hiện tại, kèm tên cuộc trò chuyện. */
    listAll(): Promise<ArtifactSummary[]>
    versions(id: string): Promise<Omit<ArtifactVersion, 'content'>[]>
    content(
      id: string,
      version?: number
    ): Promise<{ artifact: Artifact; version: ArtifactVersion } | null>
    /** Người dùng sửa (vd ô trong bảng) → phiên bản mới. */
    saveVersion(id: string, content: string): Promise<Artifact | null>
    restore(id: string, version: number): Promise<Artifact | null>
    /** Xuất ra file — hộp thoại Lưu của Windows. */
    export(
      id: string,
      version: number,
      format: string
    ): Promise<{ path: string } | { canceled: true } | { error: string }>
    templates(): Promise<{ id: string; name: string; prompt: string }[]>
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
    setStoreHeaders(
      id: string,
      headers: Record<string, string>
    ): Promise<McpServerInfo | { error: string }>
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
  code: {
    /** Mở hộp thoại chọn thư mục dự án cho hội thoại (đổi thư mục → tắt quyền sửa). */
    chooseFolder(conversationId: string): Promise<Conversation | null>
    setWrite(conversationId: string, enabled: boolean): Promise<Conversation>
    /** Từ chối có thể kèm góp ý → Claude đề xuất bản sửa mới trong cùng lượt. */
    respond(id: string, allow: boolean, feedback?: string): Promise<void>
    /** Gỡ thư mục khỏi hội thoại = thu hồi quyền đọc/sửa. */
    clearFolder(conversationId: string): Promise<Conversation | null>
    /** Thư mục phụ (D): mở hộp chọn thư mục (null = huỷ); bị cấm / chồng lấn / đủ 3 → lỗi có mã. */
    addExtraFolder(conversationId: string): Promise<Conversation | null>
    /** Gỡ một thư mục phụ = thu hồi (huỷ thẻ đang chờ, dừng lượt đang chạy). */
    removeExtraFolder(conversationId: string, path: string): Promise<Conversation | null>
    setExtraWrite(conversationId: string, path: string, enabled: boolean): Promise<Conversation>
    /** Trả lời thẻ trợ lý xin quyền thư mục (grant = mở hộp chọn thư mục). */
    respondFolderAccess(
      id: string,
      grant: boolean,
      write: boolean,
      feedback?: string
    ): Promise<FolderAccessResult>
    /** "Đồng ý, và không hỏi lại trong phiên này" (PR C). Không đủ điều kiện nữa → lỗi, thẻ vẫn chờ. */
    respondAuto(
      id: string
    ): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'not_eligible' | 'changed' }>
  }
  /** Phiên tự duyệt sửa file (PR C): băng trong khung chat + Cài đặt → Quyền & riêng tư. */
  autoEdits: {
    /** Không truyền cuộc = mọi phiên của tài khoản (đang chạy + còn hoàn tác được). */
    list(conversationId?: string): Promise<AutoEditSession[]>
    stop(sessionId: string): Promise<boolean>
    undo(input: AutoEditUndoInput): Promise<AutoEditUndoResult | null>
    dismiss(sessionId: string): Promise<boolean>
  }
}
