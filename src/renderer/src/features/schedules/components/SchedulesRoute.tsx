import { useParams } from 'react-router'
import { ScheduleDetailPage } from './ScheduleDetailPage'
import { SchedulesPage } from './SchedulesPage'

/** `/scheduled` → danh sách; `/scheduled/<id>` → một lịch + nhật ký. */
export function SchedulesRoute() {
  const id = useParams()['*']?.split('/')[0]
  return id ? <ScheduleDetailPage key={id} id={id} /> : <SchedulesPage />
}
