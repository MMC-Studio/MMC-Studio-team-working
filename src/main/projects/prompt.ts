import { PROJECT_PROMPT_CHARS, type ProjectFileUsage } from '@shared/projects'

export type ProjectPromptInput = {
  name: string
  description: string
  instructions: string
  /** Theo thứ tự thêm vào — file thêm trước được ưu tiên chỗ. */
  files: { id: string; name: string; content: string }[]
}

export type ProjectPrompt = {
  section: string
  /** File nào được đưa vào đầy đủ / bị cắt / chỉ gửi tên — hiện cho người dùng ở trang dự án. */
  usage: Record<string, ProjectFileUsage>
}

/** File còn ít chỗ hơn mức này thì chỉ gửi tên (cắt còn vài dòng thì vô ích, còn dễ làm trợ lý hiểu sai). */
export const MIN_CLIP_CHARS = 400
const CLIP_MARK = '\n…(phần còn lại đã bị cắt vì vượt giới hạn ngữ cảnh của dự án)'

/** Không cho nội dung file tự đóng thẻ <file> (vd file Markdown có ví dụ XML). */
const escapeFile = (s: string): string => s.replace(/<\/file>/gi, '<\\/file>')
const escapeAttr = (s: string): string => s.replace(/["<>\n]/g, ' ')

/**
 * Phần "Dự án" của system prompt, tối đa `budget` ký tự:
 * tên + mô tả + hướng dẫn luôn đầy đủ (hướng dẫn đã giới hạn lúc nhập), rồi file ngữ cảnh theo thứ tự thêm vào —
 * vừa thì đưa đầy đủ, thiếu chỗ thì cắt bớt, hết chỗ thì chỉ liệt kê tên.
 */
export function buildProjectPrompt(p: ProjectPromptInput, budget = PROJECT_PROMPT_CHARS): ProjectPrompt {
  const head = [
    `## Dự án: ${p.name}`,
    p.description.trim(),
    'Người dùng đang làm việc trong dự án này. Luôn làm theo hướng dẫn của dự án; dùng tài liệu ngữ cảnh khi liên quan tới câu hỏi.',
    p.instructions.trim() ? `### Hướng dẫn của dự án\n${p.instructions.trim()}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')

  const usage: Record<string, ProjectFileUsage> = {}
  if (p.files.length === 0) return { section: head, usage }

  const filesHeader = '### Tài liệu ngữ cảnh'
  const omittedLine = (names: string[]): string =>
    `(Không đưa vào vì vượt giới hạn — chỉ biết tên: ${names.join(', ')}. Nếu cần, hãy nhờ người dùng dán phần liên quan.)`
  const blocks: string[] = []
  const omitted: string[] = []
  // Chừa chỗ cho dòng liệt kê file bị bỏ (ước lượng theo mọi tên file — đủ an toàn).
  const reserve = omittedLine(p.files.map((f) => escapeAttr(f.name))).length + 2
  let used = head.length + 2 + filesHeader.length

  for (const f of p.files) {
    const open = `<file name="${escapeAttr(f.name)}">\n`
    const close = '\n</file>'
    const content = escapeFile(f.content)
    const room = budget - reserve - used - 2 - open.length - close.length
    if (content.length <= room) {
      blocks.push(open + content + close)
      used += 2 + open.length + content.length + close.length
      usage[f.id] = 'full'
    } else if (room - CLIP_MARK.length >= MIN_CLIP_CHARS) {
      const clipped = content.slice(0, room - CLIP_MARK.length) + CLIP_MARK
      blocks.push(open + clipped + close)
      used += 2 + open.length + clipped.length + close.length
      usage[f.id] = 'clipped'
    } else {
      omitted.push(escapeAttr(f.name))
      usage[f.id] = 'omitted'
    }
  }

  const section = [head, filesHeader, ...blocks, omitted.length ? omittedLine(omitted) : ''].filter(Boolean).join('\n\n')
  return { section, usage }
}
