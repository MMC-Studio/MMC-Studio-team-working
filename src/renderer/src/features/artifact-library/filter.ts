import type { ArtifactSummary } from '@shared/artifacts'
import { matchesAllWords } from '@shared/text'

/** Lọc theo tên artifact hoặc tên cuộc trò chuyện chứa nó (không dấu, mọi từ đều phải khớp). */
export function filterArtifacts(list: ArtifactSummary[], query: string): ArtifactSummary[] {
  if (!query.trim()) return list
  return list.filter((a) => matchesAllWords(`${a.title} ${a.conversationTitle}`, query))
}
