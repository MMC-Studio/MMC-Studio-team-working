/** Nhật ký thao tác (bảng `action_log`, chỉ trên máy). */
export type ActionLogKind = 'command' | 'file_edit' | 'mcp' | 'draft'
/**
 * approved / rejected = người dùng bấm; timeout = hết hạn chờ; stopped = dừng lượt / Ctrl+Alt+Q;
 * blocked = app tự chặn (tham số / đường dẫn không hợp lệ) trước khi hỏi; auto = tự duyệt (PR C).
 */
export type ActionLogDecision = 'approved' | 'rejected' | 'timeout' | 'stopped' | 'blocked' | 'auto'
/** Giữ nhật ký bao lâu. */
export const ACTION_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
