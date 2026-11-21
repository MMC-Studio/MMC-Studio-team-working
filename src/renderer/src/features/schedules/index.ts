import { Clock } from 'lucide-react'
import type { FeatureDefinition } from '../types'
import { ScheduleOverlay } from './components/ScheduleOverlay'
import { SchedulesRoute } from './components/SchedulesRoute'
import { setupSchedules } from './store'
import { SCHEDULES_ROUTE } from './view'
import en from './i18n/en.json'
import vi from './i18n/vi.json'

/**
 * Lịch hẹn: trợ lý tự chạy lời nhắn theo giờ khi app đang mở (lần chạy CHỈ ĐỌC, mặc định tắt). Mở từ thanh bên chat
 * (không có trên thanh biểu tượng). Dữ liệu dùng cả ở thanh bên (số chưa xem), Cài đặt, trang dự án, Ctrl+K.
 */
export const schedulesFeature: FeatureDefinition = {
  id: 'schedules',
  titleKey: 'title',
  icon: Clock,
  route: `${SCHEDULES_ROUTE}/*`,
  roles: [],
  component: SchedulesRoute,
  i18n: { vi, en },
  nav: false,
  setup: setupSchedules,
  overlay: ScheduleOverlay
}
