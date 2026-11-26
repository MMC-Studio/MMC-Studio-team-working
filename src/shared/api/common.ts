import type { SyncTopic } from '../sync'
import type { UpdateState } from '../update'
import type {
  AccountSession,
  SavedAccountInfo,
  AiSettings,
  Appearance,
  AssistantProfile,
  UpdateSettings,
  ChatOrganizeSettings
} from '../schemas'

/** Phần `window.api` của Dùng chung — đồng bộ, app, cập nhật, cài đặt, tài khoản, đăng nhập (chủ dự án giữ). */
export interface CommonApi {
  /** Đồng bộ trạng thái: main báo các mục vừa đổi → trang đang mở tự hỏi lại (xem lib/sync.ts). */
  sync: {
    onChanged(listener: (topics: SyncTopic[]) => void): () => void
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
  auth: {
    /** Mở trình duyệt tới link đăng nhập Supabase và chờ mã trả về qua cổng loopback. */
    oauth(authorizeUrl: string): Promise<{ code: string } | { error: string }>
    cancel(): Promise<void>
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
