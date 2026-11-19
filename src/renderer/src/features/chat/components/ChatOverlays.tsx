import { ApprovalBanner } from '../approvals/ApprovalBanner'

/** Luôn gắn trong app: nhắc thẻ chờ duyệt (sửa file, quyền thư mục, nháp) khi người dùng đang ở trang / cuộc khác. */
export function ChatOverlays() {
  return <ApprovalBanner />
}
