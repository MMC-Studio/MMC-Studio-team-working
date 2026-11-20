import {
  MEMORY_CATEGORIES,
  MEMORY_SCOPES,
  memorySuggestionsOutputSchema,
  type MemoryAction,
  type MemoryCategory,
  type MemoryScope
} from '@shared/schemas'
import type { Memory, Message } from '@shared/types'

export const MAX_TRANSCRIPT_CHARS = 20_000
const MAX_EXISTING = 100

export type ParsedSuggestion = {
  action: MemoryAction
  targetMemoryId: string | null
  content: string
  category: MemoryCategory
  /** null = trí nhớ chung. */
  projectId: string | null
}

/** Dự án của cuộc trò chuyện đang trích (null = cuộc thường). */
export type ExtractionProject = { id: string; name: string; description: string }

const line = (m: Memory): string => `- id=${m.id} [${m.category}] ${m.content}`

/**
 * Ghép đoạn hội thoại cần trích (giữ phần cuối nếu quá dài) + danh sách memory hiện có.
 * Cuộc trong dự án: kèm tên / mô tả dự án, memory chia hai nhóm "chung" và "dự án" (chỉ của dự án này)
 * và mỗi mục phải có `scope`.
 */
export function buildExtractionPrompt(
  messages: Message[],
  existing: Memory[],
  project: ExtractionProject | null = null
): string {
  let transcript = messages
    .filter((m) => m.content.trim())
    .map((m) => `${m.role === 'user' ? 'NGƯỜI DÙNG' : 'TRỢ LÝ'}: ${m.content.trim()}`)
    .join('\n\n')
  if (transcript.length > MAX_TRANSCRIPT_CHARS) transcript = `…${transcript.slice(-MAX_TRANSCRIPT_CHARS)}`

  const shown = existing.slice(0, MAX_EXISTING)
  if (!project) {
    return [
      'Đọc đoạn hội thoại dưới đây và đề xuất thông tin nên ghi nhớ về NGƯỜI DÙNG theo đúng hướng dẫn.',
      'Chỉ trả về MỘT khối JSON hợp lệ, không thêm lời giải thích.',
      '',
      '## Memory hiện có',
      shown.map(line).join('\n') || '(chưa có)',
      '',
      '## Hội thoại',
      transcript
    ].join('\n')
  }

  const general = shown.filter((m) => !m.projectId)
  const own = shown.filter((m) => m.projectId === project.id)
  return [
    'Đọc đoạn hội thoại dưới đây và đề xuất thông tin nên ghi nhớ theo đúng hướng dẫn.',
    `Cuộc trò chuyện này thuộc DỰ ÁN "${project.name}"${project.description ? ` — ${project.description}` : ''}.`,
    'Mỗi mục PHẢI có "scope": "user" (trí nhớ chung — đúng ở mọi nơi) hoặc "project" (chỉ đúng trong dự án này). Không chắc → "project".',
    'Chỉ trả về MỘT khối JSON hợp lệ, không thêm lời giải thích.',
    '',
    '## Memory chung hiện có (scope "user")',
    general.map(line).join('\n') || '(chưa có)',
    '',
    `## Memory của dự án "${project.name}" hiện có (scope "project")`,
    own.map(line).join('\n') || '(chưa có)',
    '',
    '## Hội thoại',
    transcript
  ].join('\n')
}

/** Lấy khối JSON đầu tiên trong câu trả lời (có thể nằm trong ```json … ```). */
export function extractJsonBlock(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Phạm vi của một đề xuất thêm mới. Cuộc ngoài dự án → luôn chung. Cuộc trong dự án → theo `scope`;
 * thiếu / lạ → dự án (không chắc thì xếp phạm vi hẹp, không lọt sang cuộc khác).
 */
export function resolveScope(scope: string | undefined, projectId: string | null): string | null {
  if (!projectId) return null
  const s = scope?.trim().toLowerCase()
  const known = (MEMORY_SCOPES as readonly string[]).includes(s ?? '') ? (s as MemoryScope) : 'project'
  return known === 'user' ? null : projectId
}

/**
 * Parse + làm sạch đề xuất: bỏ mục không hợp lệ, update/delete phải trỏ tới memory có thật (trong số memory
 * trợ lý được xem), add/update phải có nội dung, bỏ mục trùng memory hiện có hoặc trùng nhau.
 * `projectId` = dự án của cuộc trò chuyện (null = cuộc thường). update/delete giữ phạm vi của memory đích.
 * Trả null nếu đầu ra không đúng định dạng.
 */
export function parseSuggestions(
  text: string,
  existing: Memory[],
  projectId: string | null = null
): ParsedSuggestion[] | null {
  const parsed = memorySuggestionsOutputSchema.safeParse(extractJsonBlock(text))
  if (!parsed.success) return null

  const byId = new Map(existing.map((m) => [m.id, m]))
  const seen = new Set(existing.map((m) => normalize(m.content)))
  const result: ParsedSuggestion[] = []

  for (const item of parsed.data.items) {
    const category = (MEMORY_CATEGORIES as readonly string[]).includes(item.category ?? '')
      ? (item.category as MemoryCategory)
      : 'other'
    const content = item.content.trim()

    if (item.action === 'add') {
      if (!content || seen.has(normalize(content))) continue
      seen.add(normalize(content))
      result.push({ action: 'add', targetMemoryId: null, content, category, projectId: resolveScope(item.scope, projectId) })
      continue
    }

    const target = item.id ? byId.get(item.id) : undefined
    if (!target) continue
    if (item.action === 'update') {
      if (!content || normalize(content) === normalize(target.content)) continue
      result.push({ action: 'update', targetMemoryId: target.id, content, category, projectId: target.projectId })
    } else {
      result.push({
        action: 'delete',
        targetMemoryId: target.id,
        content: target.content,
        category: target.category,
        projectId: target.projectId
      })
    }
  }
  return result
}
