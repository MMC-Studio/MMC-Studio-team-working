import { ApprovalBanner } from '../approvals/ApprovalBanner'
import { SearchPalette } from '../search/SearchPalette'

/**
 * Luôn gắn trong app: nhắc thẻ chờ duyệt (sửa file, quyền thư mục, nháp) khi người dùng đang ở trang / cuộc khác;
 * cửa sổ tìm kiếm Ctrl+K (mở được ở mọi trang).
 */
export function ChatOverlays() {
  return (
    <>
      <ApprovalBanner />
      <SearchPalette />
    </>
  )
}
