import { agentsFeature } from './agents'
import { artifactLibraryFeature } from './artifact-library'
import { chatFeature } from './chat'
import { claudeCheckFeature } from './claude-check'
import { computerFeature } from './computer'
import { connectorsFeature } from './connectors'
import { dashboardFeature } from './dashboard'
import { feedbackFeature } from './feedback'
import { ideasFeature } from './ideas'
import { learningFeature } from './learning'
import { memoryFeature } from './memory'
import { notificationsFeature } from './notifications'
import { pluginsFeature } from './plugins'
import { projectsFeature } from './projects'
import { schedulesFeature } from './schedules'
import { settingsFeature } from './settings'
import { teamFeature } from './team'
import { timeFeature } from './time'
import { todayFeature } from './today'
import type { FeatureDefinition } from './types'
import { workFeature } from './work'

/**
 * Nơi DUY NHẤT đăng ký tính năng. Thêm tính năng mới: tạo thư mục trong features/
 * (xem skill add-feature-module) rồi thêm vào danh sách này.
 */
export const features: FeatureDefinition[] = [
  chatFeature,
  // Trang mở từ thanh bên chat (không có trên thanh biểu tượng).
  artifactLibraryFeature,
  projectsFeature,
  pluginsFeature,
  schedulesFeature,
  todayFeature,
  memoryFeature,
  workFeature,
  dashboardFeature,
  feedbackFeature,
  learningFeature,
  timeFeature,
  teamFeature,
  notificationsFeature,
  ideasFeature,
  claudeCheckFeature,
  computerFeature,
  agentsFeature,
  connectorsFeature,
  settingsFeature
]
