import type { ArtifactSummary } from '@shared/artifacts'

/** Bỏ dấu + chữ thường để lọc không phân biệt dấu ("bao cao" khớp "Báo cáo"). */
const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()

/** Lọc theo tên artifact hoặc tên cuộc trò chuyện chứa nó (không dấu, mọi từ đều phải khớp). */
export function filterArtifacts(list: ArtifactSummary[], query: string): ArtifactSummary[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return list
  return list.filter((a) => {
    const hay = fold(`${a.title} ${a.conversationTitle}`)
    return words.every((w) => hay.includes(w))
  })
}
