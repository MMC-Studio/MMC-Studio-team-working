import type { ScheduleNotice } from './scheduler'

/**
 * Chữ của thông báo Windows (main không dùng i18next — như các thông báo khác của main). CHỈ tên lịch + trạng thái,
 * KHÔNG có nội dung trả lời: thông báo có thể hiện trên màn hình khoá.
 */
export function scheduleNoticeText(n: ScheduleNotice): string {
  switch (n.kind) {
    case 'finished':
      if (n.status === 'done')
        return n.pending ? `Lịch hẹn "${n.name}" đã chạy xong · ${n.pending} việc chờ duyệt.` : `Lịch hẹn "${n.name}" đã chạy xong.`
      if (n.status === 'timeout') return `Lịch hẹn "${n.name}" bị dừng vì chạy quá 10 phút.`
      if (n.status === 'aborted') return `Lịch hẹn "${n.name}" đã dừng.`
      if (n.reason === 'folder_missing') return `Lịch hẹn "${n.name}" lỗi: không tìm thấy thư mục.`
      if (n.reason === 'quota') return `Lịch hẹn "${n.name}" dừng vì hết hạn mức Claude.`
      if (n.reason === 'cli_missing') return `Lịch hẹn "${n.name}" không chạy được: chưa cài / chưa đăng nhập Claude.`
      return `Lịch hẹn "${n.name}" bị lỗi.`
    case 'paused':
      return `Lịch hẹn "${n.name}" lỗi 3 lần liền nên đã tạm dừng.`
    case 'pausedAll':
      return n.reason === 'quota'
        ? 'Hết hạn mức Claude: mọi lịch hẹn tạm dừng tới ngày mai.'
        : 'Đã dừng khẩn cấp: mọi lịch hẹn đang tạm dừng.'
    case 'dailyLimit':
      return 'Đã chạy đủ số lần lịch hẹn cho hôm nay — các lượt còn lại bị bỏ qua.'
  }
}
