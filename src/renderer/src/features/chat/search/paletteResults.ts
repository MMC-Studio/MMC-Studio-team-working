import type { ArtifactSummary, ArtifactType } from '@shared/artifacts'
import type { ChatMode } from '@shared/ai'
import type { Conversation } from '@shared/types'
import { filterArtifacts } from '@renderer/features/artifact-library/filter'

/**
 * Cửa sổ tìm kiếm (Ctrl+K): các tab lọc. "Code" = cuộc trò chuyện chế độ Code, "Cuộc trò chuyện" = các chế độ khác.
 * Dự án / Lịch hẹn chưa có dữ liệu (PR 5 / PR 7) — tab vẫn hiện, luôn "Không có kết quả".
 */
export const PALETTE_TABS = ['all', 'artifacts', 'chats', 'code', 'projects', 'scheduled'] as const
export type PaletteTab = (typeof PALETTE_TABS)[number]

export type PaletteAction = 'new-chat' | 'new-code'

export type PaletteItem =
  | {
      kind: 'conversation'
      id: string
      title: string
      mode: ChatMode
      pinned: boolean
      updatedAt: number
      /** Khớp nội dung tin nhắn (không phải tiêu đề) → trích đoạn FTS. */
      snippet: string | null
    }
  | {
      kind: 'artifact'
      id: string
      conversationId: string
      title: string
      type: ArtifactType
      conversationTitle: string
      updatedAt: number
    }
  | { kind: 'action'; id: PaletteAction }

export type PaletteSection = { key: 'recent' | 'results' | 'actions'; items: PaletteItem[] }

/** Chưa gõ gì ở tab Tất cả: số mục "Gần đây". */
export const RECENT_LIMIT = 8
/** Giới hạn số dòng hiện (danh sách dài vẫn cuộn được, nhưng không dựng hàng nghìn dòng). */
export const RESULT_LIMIT = 100

const conversationItem = (c: Conversation): PaletteItem => ({
  kind: 'conversation',
  id: c.id,
  title: c.title,
  mode: c.mode,
  pinned: c.pinned,
  updatedAt: c.updatedAt,
  snippet: c.searchSnippet ?? null
})
const artifactItem = (a: ArtifactSummary): PaletteItem => ({
  kind: 'artifact',
  id: a.id,
  conversationId: a.conversationId,
  title: a.title,
  type: a.type,
  conversationTitle: a.conversationTitle,
  updatedAt: a.updatedAt
})

const byRecent = (a: PaletteItem, b: PaletteItem): number =>
  (b.kind === 'action' ? 0 : b.updatedAt) - (a.kind === 'action' ? 0 : a.updatedAt)

/**
 * Dựng danh sách cho cửa sổ tìm kiếm.
 * @param conversations đã lọc sẵn ở main theo `query` (FTS: tiêu đề / tên nhóm / nội dung, có trích đoạn).
 * @param artifacts mọi artifact của tài khoản — lọc ở đây (không dấu, theo tên + tên cuộc trò chuyện).
 */
export function buildPalette(input: {
  tab: PaletteTab
  query: string
  conversations: Conversation[]
  artifacts: ArtifactSummary[]
}): PaletteSection[] {
  const { tab } = input
  const searching = input.query.trim().length > 0
  const convs = input.conversations.map(conversationItem)
  const arts = filterArtifacts(input.artifacts, input.query).map(artifactItem)

  let items: PaletteItem[]
  switch (tab) {
    case 'all':
      items = [...convs, ...arts]
      break
    case 'artifacts':
      items = arts
      break
    case 'chats':
      items = convs.filter((c) => c.kind === 'conversation' && c.mode !== 'code')
      break
    case 'code':
      items = convs.filter((c) => c.kind === 'conversation' && c.mode === 'code')
      break
    default:
      items = []
  }
  items.sort(byRecent)

  if (tab === 'all' && !searching) {
    const sections: PaletteSection[] = []
    if (items.length > 0) sections.push({ key: 'recent', items: items.slice(0, RECENT_LIMIT) })
    sections.push({
      key: 'actions',
      items: [
        { kind: 'action', id: 'new-chat' },
        { kind: 'action', id: 'new-code' }
      ]
    })
    return sections
  }
  return items.length > 0 ? [{ key: 'results', items: items.slice(0, RESULT_LIMIT) }] : []
}

/** Mọi dòng chọn được theo đúng thứ tự hiển thị (↑ ↓ đi qua các mục này). */
export const flatItems = (sections: PaletteSection[]): PaletteItem[] => sections.flatMap((s) => s.items)

export const itemKey = (i: PaletteItem): string => `${i.kind}:${i.id}`

export type TimeBucket = 'today' | 'yesterday' | 'week' | 'month' | 'older'

/** Mốc thời gian bên phải mỗi dòng (Hôm nay / Hôm qua / Tuần trước / Tháng trước / ngày cụ thể). Tính theo ngày lịch máy. */
export function timeBucket(ts: number, now: number): TimeBucket {
  const startOfDay = (t: number): number => {
    const d = new Date(t)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days <= 7) return 'week'
  if (days <= 31) return 'month'
  return 'older'
}

/** ← → đổi tab (vòng tròn). */
export function nextTab(tab: PaletteTab, step: 1 | -1): PaletteTab {
  const i = PALETTE_TABS.indexOf(tab)
  return PALETTE_TABS[(i + step + PALETTE_TABS.length) % PALETTE_TABS.length]
}

/** Chữ xem trước của artifact (khung nhỏ bên phải cửa sổ tìm kiếm): bỏ ký hiệu Markdown / thẻ HTML, cắt ngắn. */
export function previewText(type: ArtifactType, content: string, max = 600): string {
  let text = content
  if (type === 'html') text = text.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  if (type === 'doc' || type === 'slides')
    text = text
      .replace(/^[ \t]*---[ \t]*$/gm, '')
      .replace(/^[ \t]{0,3}(#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, '')
      .replace(/(\*\*|__|`{1,3}|~~)/g, '')
  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}
