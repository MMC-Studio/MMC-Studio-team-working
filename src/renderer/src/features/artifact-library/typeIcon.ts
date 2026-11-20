import { ChartBar, FileCode2, FileText, GitFork, Presentation, Table2, type LucideIcon } from 'lucide-react'
import type { ArtifactType } from '@shared/artifacts'

/** Biểu tượng theo loại artifact (trang Artifacts, cửa sổ tìm kiếm). */
export const ARTIFACT_TYPE_ICON: Record<ArtifactType, LucideIcon> = {
  doc: FileText,
  slides: Presentation,
  sheet: Table2,
  chart: ChartBar,
  mermaid: GitFork,
  html: FileCode2
}
