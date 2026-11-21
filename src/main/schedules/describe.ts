import type { Recurrence } from '@shared/schedules'

const DAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']
const pad = (n: number): string => String(n).padStart(2, '0')

/** Mô tả giờ hẹn bằng chữ cho trợ lý (prompt "Hỏi lại", kết quả tool). Giao diện dùng i18n riêng. */
export function describeRecurrence(r: Recurrence): string {
  switch (r.kind) {
    case 'once': {
      const d = new Date(r.at)
      return `một lần lúc ${pad(d.getHours())}:${pad(d.getMinutes())} ngày ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
    }
    case 'daily':
      return `hằng ngày lúc ${r.time}`
    case 'weekly':
      return `hằng tuần (${r.days.map((d) => DAYS[d]).join(', ')}) lúc ${r.time}`
    case 'hourly':
      return `${r.every === 1 ? 'mỗi giờ' : `mỗi ${r.every} giờ`} từ ${pad(r.from)}:00 tới trước ${pad(r.to)}:00`
  }
}
