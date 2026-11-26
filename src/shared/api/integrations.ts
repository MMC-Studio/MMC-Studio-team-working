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
} from '../schedules'
import type { DeferredActionResult, DeferredCard } from '../deferred'
import type {
  Catalog,
  InstallResult,
  InstalledPlugin,
  PluginSourceInfo,
  PluginStoreError,
  PreviewResult
} from '../pluginStore'
import type {
  SpeakChunk,
  TranscribeResult,
  VoiceComponent,
  VoicePackState,
  VoiceSettings,
  VoiceStatus
} from '../voice'
import type {
  ExpressiveSettings,
  ExpressiveStatus,
  MediaItem,
  MediaKind,
  MediaRef,
  MediaSearchResult,
  ExpressiveRecent,
  RecentKind
} from '../expressive'
import type {
  DraftDecision,
  GmailAccountUpdate,
  GmailPreviewItem,
  GmailStatus,
  TelegramChatInfo,
  TelegramMode,
  TelegramStatus
} from '../connectors'

/** Phần `window.api` của Mảng C — Trải nghiệm & Kết nối ngoài: lịch hẹn, kho plugin, giọng nói, biểu cảm, Gmail, Telegram, nháp. */
export interface IntegrationsApi {
  /** Lịch hẹn. Lỗi biết trước trả `{ status: 'error', error }` (mã lỗi → i18n). */
  schedules: {
    list(): Promise<Schedule[]>
    status(): Promise<SchedulesStatus>
    /** Quyền MỚI chưa xác nhận → `{ status: 'confirm', added }` (gọi lại với confirmed = true sau hộp xác nhận). */
    save(input: {
      id?: string
      input: ScheduleInput
      confirmed?: boolean
    }): Promise<ScheduleSaveResult | ScheduleErrorResult>
    setEnabled(
      id: string,
      enabled: boolean
    ): Promise<{ status: 'saved'; schedule: Schedule } | ScheduleErrorResult>
    skipNext(
      id: string,
      skip: boolean
    ): Promise<{ status: 'saved'; schedule: Schedule } | ScheduleErrorResult>
    remove(id: string): Promise<boolean>
    runNow(id: string): Promise<boolean>
    stop(): Promise<boolean>
    runs(scheduleId: string | null, limit?: number): Promise<ScheduleRun[]>
    markSeen(conversationId: string): Promise<boolean>
    /** Bật / tắt tính năng (lần đầu bật phải kèm acknowledged), ẩn xuống khay khi đóng. */
    setFeature(input: {
      enabled?: boolean
      acknowledged?: true
      trayOnClose?: boolean
    }): Promise<SchedulesStatus>
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
    test: {
      advance(ms: number): Promise<void>
      sleep(ms: number): Promise<void>
      hotkey(): Promise<void>
    }
  }
  /** Kho plugin online: chỉ skill bằng chữ, cài theo commit SHA, không tự cập nhật. */
  pluginStore: {
    sources(): Promise<PluginSourceInfo[]>
    addSource(input: {
      repo: string
      ref?: string
    }): Promise<
      { status: 'ok'; source: PluginSourceInfo } | { status: 'error'; error: PluginStoreError }
    >
    /** Nguồn tự thêm: plugin đã cài giữ lại ("nguồn đã bị xoá"). Nguồn mặc định không xoá được. */
    removeSource(
      repo: string
    ): Promise<{ status: 'ok' } | { status: 'error'; error: PluginStoreError }>
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
  /** Gmail cá nhân (thử nghiệm, mặc định tắt): chỉ đọc + tạo nháp sau khi duyệt. Secret không bao giờ về renderer. */
  gmail: {
    status(): Promise<GmailStatus>
    onStatus(listener: (status: GmailStatus) => void): () => void
    setEnabled(enabled: boolean): Promise<GmailStatus | { error: string }>
    /** clientSecret bỏ trống = giữ secret đã lưu. */
    setCredentials(input: {
      clientId: string
      clientSecret?: string
    }): Promise<GmailStatus | { error: string }>
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
    setCredentials(input: {
      apiId: number
      apiHash?: string
    }): Promise<TelegramStatus | { error: string }>
    sendCode(phone: string): Promise<TelegramStatus | { error: string }>
    signIn(code: string): Promise<TelegramStatus | { error: string }>
    password(password: string): Promise<TelegramStatus | { error: string }>
    cancelLogin(): Promise<TelegramStatus | { error: string }>
    /** Đăng xuất phía Telegram + xoá session trên máy. */
    logout(): Promise<TelegramStatus | { error: string }>
    /** force = tải lại ngay (tối đa 1 lần/phút); mặc định dùng bản lưu tạm 15 phút. */
    chats(force?: boolean): Promise<TelegramChatInfo[] | { error: string }>
    setLists(input: {
      mode: TelegramMode
      allow: string[]
      block: string[]
    }): Promise<TelegramStatus | { error: string }>
  }
  /** Bản nháp trợ lý đề xuất (Gmail / Telegram) chờ người dùng duyệt. */
  drafts: {
    respond(decision: DraftDecision): Promise<boolean>
  }
}
