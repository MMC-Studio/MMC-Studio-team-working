import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_PROFILE,
  aiSettingsSchema,
  userProfileSchema,
  type MemoryCategory,
  type UserProfile
} from '@shared/schemas'
import { APP_NAME } from '@shared/appConfig'
import type { ExtractResult, Memory, MemoryEventPayload, MemorySuggestion } from '@shared/types'
import { completeText, type AIProvider } from '../ai/AIProvider'
import type { UserProfileContext } from '../ai/systemPrompt'
import {
  LOCAL_OWNER,
  type ConversationRepository,
  type MemoryRepository,
  type MessageRepository,
  type SettingsRepository,
  type SuggestionRepository
} from '../db/repositories'
import { profileKey } from './accountScope'
import { buildExtractionPrompt, parseSuggestions, type ExtractionProject } from './extraction'
import { selectMemories } from './selectMemories'

export type MemoryServiceDeps = {
  conversations: ConversationRepository
  messages: MessageRepository
  memories: MemoryRepository
  suggestions: SuggestionRepository
  settings: SettingsRepository
  getProvider(): AIProvider
  loadSkill(name: string): Promise<string | undefined>
  workspaceDir: string
  emit(payload: MemoryEventPayload): void
  log: { info(msg: string): void; warn(msg: string): void }
  /** Tài khoản đang đăng nhập (repository cũng lọc theo cùng hàm này). */
  getOwner?(): string
  /** Dự án của người đang đăng nhập (null = không có / của người khác). Thiếu → không có trí nhớ dự án. */
  getProject?(id: string): ExtractionProject | null
}

/** Số tin nhắn mới của người dùng tối thiểu để tự đề xuất khi rời cuộc trò chuyện. */
export const AUTO_EXTRACT_MIN_USER_MESSAGES = 2
const EXTRACT_TIMEOUT_MS = 180_000
/** Trí nhớ dự án có ngân sách riêng — không chiếm chỗ của trí nhớ chung (15 mục / 3.000 ký tự). */
export const PROJECT_MEMORY_LIMIT = 10
export const PROJECT_MEMORY_CHARS = 2000

export type ResolveInput = {
  id: string
  accept: boolean
  content?: string
  category?: MemoryCategory
  /** Đổi phạm vi trước khi duyệt (chỉ đề xuất thêm mới): null = chung, id = dự án. */
  projectId?: string | null
}

export type MemoryContext = { user: UserProfileContext; memories: string[]; projectMemories: string[] }

export class MemoryService {
  private running = new Set<string>()

  constructor(private readonly deps: MemoryServiceDeps) {}

  /** Hồ sơ của NGƯỜI ĐANG ĐĂNG NHẬP (khóa theo tài khoản). */
  getProfile(): UserProfile {
    return this.deps.settings.get(profileKey(this.deps.getOwner?.() ?? LOCAL_OWNER), userProfileSchema, DEFAULT_PROFILE)
  }

  setProfile(profile: UserProfile): UserProfile {
    return this.deps.settings.set(profileKey(this.deps.getOwner?.() ?? LOCAL_OWNER), profile)
  }

  /** Dự án (của người đang đăng nhập) mà cuộc trò chuyện thuộc về. */
  private projectOf(conversationId: string | null | undefined): ExtractionProject | null {
    if (!conversationId || !this.deps.getProject) return null
    const projectId = this.deps.conversations.get(conversationId)?.projectId
    return projectId ? this.deps.getProject(projectId) : null
  }

  /**
   * Hồ sơ + memory liên quan tới câu hỏi; đánh dấu memory đã dùng.
   * Cuộc trong dự án: thêm trí nhớ của CHÍNH dự án đó (ngân sách riêng). Không bao giờ lấy trí nhớ dự án khác.
   */
  contextFor(query: string, conversationId?: string): MemoryContext {
    const general = selectMemories(this.deps.memories.list(undefined, null), query)
    const project = this.projectOf(conversationId)
    const own = project
      ? selectMemories(this.deps.memories.list(undefined, project.id), query, {
          limit: PROJECT_MEMORY_LIMIT,
          maxChars: PROJECT_MEMORY_CHARS
        })
      : []
    this.deps.memories.markUsed([...general, ...own].map((m) => m.id))
    return {
      user: this.getProfile(),
      memories: general.map((m) => m.content),
      projectMemories: own.map((m) => m.content)
    }
  }

  /** Dự án hợp lệ để gắn trí nhớ (của người đang đăng nhập); null = chung. */
  private checkProject(projectId: string | null | undefined): string | null {
    if (!projectId) return null
    if (!this.deps.getProject?.(projectId)) throw new Error('project_not_found')
    return projectId
  }

  /** Người dùng tự thêm trí nhớ (trang Trí nhớ / trang dự án). */
  create(content: string, category: MemoryCategory, projectId?: string | null): Memory {
    return this.deps.memories.create(content, category, null, this.checkProject(projectId))
  }

  /**
   * Nhờ trợ lý đọc phần hội thoại mới và ĐỀ XUẤT memory (không tự lưu).
   * Đề xuất vào hàng chờ để người dùng duyệt.
   */
  async extract(conversationId: string): Promise<ExtractResult> {
    const { deps } = this
    const conversation = deps.conversations.get(conversationId)
    if (!conversation) return { error: 'conversation_not_found' }
    if (this.running.has(conversationId)) return { error: 'already_running' }

    const fresh = deps.messages
      .since(conversationId, conversation.memoryExtractedAt)
      .filter((m) => m.status === 'done')
    if (!fresh.some((m) => m.role === 'user')) return { added: 0 }

    this.running.add(conversationId)
    deps.emit({ type: 'extracting', conversationId, running: true })
    try {
      // Trợ lý chỉ thấy (và chỉ sửa / xoá được) trí nhớ chung + trí nhớ của dự án của cuộc này.
      const project = this.projectOf(conversationId)
      const existing = deps.memories.list().filter((m) => !m.projectId || m.projectId === project?.id)
      const skill = (await deps.loadSkill('memory-keeper')) ?? ''
      const result = await completeText(
        deps.getProvider(),
        {
          prompt: buildExtractionPrompt(fresh, existing, project),
          systemPrompt: `${skill}\n\nChỉ trả lời bằng đúng một khối JSON theo định dạng trên.`,
          mode: 'free',
          cwd: deps.workspaceDir,
          ephemeral: true
        },
        AbortSignal.timeout(EXTRACT_TIMEOUT_MS)
      )
      if ('error' in result) {
        deps.log.warn(`Trích memory lỗi: ${result.error}`)
        return { error: result.error }
      }
      const parsed = parseSuggestions(result.text, existing, project?.id ?? null)
      if (!parsed) {
        deps.log.warn(`Trích memory: đầu ra không đúng định dạng: ${result.text.slice(0, 300)}`)
        return { error: 'invalid_output' }
      }
      deps.suggestions.insertMany(parsed.map((s) => ({ ...s, conversationId })))
      deps.conversations.setMemoryExtractedAt(conversationId, fresh[fresh.length - 1].createdAt)
      this.emitCount()
      return { added: parsed.length }
    } finally {
      this.running.delete(conversationId)
      deps.emit({ type: 'extracting', conversationId, running: false })
    }
  }

  /** Gọi khi người dùng rời một cuộc trò chuyện: tự đề xuất nếu bật và có đủ tin mới. */
  async maybeAutoExtract(conversationId: string): Promise<void> {
    const ai = this.deps.settings.get('ai', aiSettingsSchema, DEFAULT_AI_SETTINGS)
    if (!ai.autoSuggestMemory) return
    const conversation = this.deps.conversations.get(conversationId)
    if (!conversation) return
    const newUserMessages = this.deps.messages
      .since(conversationId, conversation.memoryExtractedAt)
      .filter((m) => m.role === 'user' && m.status === 'done').length
    if (newUserMessages >= AUTO_EXTRACT_MIN_USER_MESSAGES) await this.extract(conversationId)
  }

  /** Người dùng duyệt (có thể sửa) hoặc bỏ qua một đề xuất. */
  resolve(input: ResolveInput): void {
    const { memories, suggestions } = this.deps
    const s = suggestions.getPending(input.id)
    if (!s) throw new Error('suggestion_not_found')

    if (input.accept) {
      const content = input.content ?? s.content
      const category = input.category ?? s.category
      if (s.action === 'add') {
        memories.create(content, category, s.conversationId, this.scopeOnAccept(s, input.projectId))
      } else if (s.action === 'update') {
        const updated = s.targetMemoryId ? memories.update(s.targetMemoryId, content, category) : null
        if (!updated) memories.create(content, category, s.conversationId, this.checkProjectOrChung(s.projectId))
      } else if (s.targetMemoryId) {
        memories.remove(s.targetMemoryId)
      }
    }
    suggestions.setStatus(s.id, input.accept ? 'accepted' : 'rejected')
    this.emitCount()
  }

  /**
   * Phạm vi khi duyệt một đề xuất thêm mới. Người dùng chỉ đổi được giữa "chung" và dự án của đề xuất / của cuộc
   * trò chuyện sinh ra nó (không gắn sang dự án tuỳ ý).
   */
  private scopeOnAccept(s: MemorySuggestion, requested: string | null | undefined): string | null {
    if (requested === undefined) return this.checkProjectOrChung(s.projectId)
    if (requested === null) return null
    if (requested !== s.projectId && requested !== s.sourceProjectId) throw new Error('invalid_scope')
    return this.checkProject(requested)
  }

  /** Dự án của đề xuất đã bị xoá (hiếm: xoá dự án xoá luôn đề xuất) → lưu thành trí nhớ chung thay vì lỗi. */
  private checkProjectOrChung(projectId: string | null): string | null {
    return projectId && this.deps.getProject?.(projectId) ? projectId : null
  }

  /** Duyệt nhiều đề xuất: đề xuất đã được duyệt ở nơi khác (không còn chờ) thì bỏ qua, không làm hỏng cả lượt. */
  resolveMany(inputs: ResolveInput[]): number {
    let done = 0
    for (const input of inputs) {
      if (!this.deps.suggestions.getPending(input.id)) continue
      this.resolve(input)
      done++
    }
    return done
  }

  /** Đề xuất một memory (vd "cần ôn: …" sau quiz) vào hàng chờ duyệt — không tự lưu. */
  suggest(content: string, category: MemoryCategory): void {
    const exists = this.deps.memories.list(undefined, null).some((m) => m.content.trim().toLowerCase() === content.trim().toLowerCase())
    if (exists) return
    this.deps.suggestions.insertMany([{ conversationId: null, action: 'add', targetMemoryId: null, content, category }])
    this.emitCount()
  }

  exportData(): { app: string; exportedAt: string; profile: UserProfile; memories: Memory[] } {
    return {
      app: APP_NAME,
      exportedAt: new Date().toISOString(),
      profile: this.getProfile(),
      memories: this.deps.memories.list()
    }
  }

  emitCount(): void {
    this.deps.emit({ type: 'suggestions', pending: this.deps.suggestions.countPending() })
  }
}
