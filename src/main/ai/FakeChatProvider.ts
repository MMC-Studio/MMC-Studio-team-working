import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatEvent } from '@shared/ai'
import type { AIProvider, ChatRequest } from './AIProvider'
import type { ToolResult } from '../tools/registry'
import { FAKE_ARTIFACTS } from './fakeArtifacts'
import { ORGANIZE_MARKER } from '../chat/organize'
import { REVISION_HINT_MARKER } from '@shared/approvals'
import { EXPLAIN_MARKER } from '../approvals/explain'

/** Hỏi người dùng duyệt một lần sửa file (= CodeApprovals.decide), như CLI gọi qua permission-mcp. */
export type FakeEditDecider = (conversationId: string, toolName: string, input: unknown) => Promise<{ allow: boolean; message?: string }>

export type FakeToolCaller = (name: string, input: unknown, conversationId: string) => Promise<ToolResult>

/**
 * CHỈ cho test e2e ở bản chưa đóng gói (MMC_FAKE_CHAT=1): trả lời giả lập, không gọi Claude.
 * Chèn thẻ biểu cảm để test đường đi reaction / GIF / sticker; system prompt có phần "Biểu cảm" thì mới chèn.
 */
export class FakeChatProvider implements AIProvider {
  readonly id = 'fake'
  readonly stateful = false

  /** Gọi tool của app như CLI thật (qua registry) — để e2e đi được luồng duyệt nháp Gmail / Telegram. */
  constructor(
    private readonly callTool?: FakeToolCaller,
    private readonly decideEdit?: FakeEditDecider
  ) {}

  async isAvailable(): Promise<{ ok: boolean }> {
    return { ok: true }
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    // Học phong cách: trả JSON giả để e2e kiểm tra được luồng đề xuất → duyệt.
    if (req.systemPrompt.includes('"type":"style_notes"')) {
      yield {
        type: 'text',
        delta: '{"type":"style_notes","notes":["Trả lời ngắn gọn, có gạch đầu dòng"]}'
      }
      yield { type: 'done' }
      return
    }
    // Trích ghi nhớ: tin có FAKE_MEMORIES:<n> → n đề xuất (xoay vòng loại, đề xuất thứ 2 rất dài) để e2e kiểm tra danh sách gọn.
    if (req.systemPrompt.includes('memory_suggestions')) {
      const n = Math.min(20, Number(/FAKE_MEMORIES:(\d+)/.exec(req.prompt)?.[1] ?? 0))
      const cats = ['skill', 'project', 'preference', 'goal']
      const items = Array.from({ length: n }, (_, i) => ({
        action: 'add',
        category: cats[i % cats.length],
        content:
          i === 1
            ? `Ghi nhớ dài số ${i + 1}: ` + 'đang làm đồ án game Unity nhiều màn chơi, cần nhắc deadline và cách tối ưu hiệu năng. '.repeat(5)
            : `Ghi nhớ số ${i + 1}`
      }))
      yield { type: 'text', delta: '```json\n' + JSON.stringify({ type: 'memory_suggestions', items }) + '\n```' }
      yield { type: 'done' }
      return
    }
    // Đặt tiêu đề / gợi ý nhóm (model rẻ): tiêu đề "Chủ đề: <3 từ đầu>"; FAKE_GROUP:<n> trong tin → nhóm thứ n
    // trong danh sách được gửi (dùng số để tên nhóm không lọt vào so khớp từ khoá).
    if (req.systemPrompt.startsWith(ORGANIZE_MARKER)) {
      const user = /^Người dùng: (.*)$/m.exec(req.prompt)?.[1] ?? ''
      const names = [...(/^Các nhóm hiện có: (.*)$/m.exec(req.prompt)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1])
      const index = Number(/FAKE_GROUP:(\d+)/.exec(user)?.[1] ?? NaN)
      const group = names[index - 1] ?? null
      const words = user.replace(/FAKE_\w+:\S+/g, '').trim().split(/\s+/).slice(0, 3).join(' ')
      yield { type: 'text', delta: JSON.stringify({ title: `Chủ đề: ${words}`, group }) }
      yield { type: 'done' }
      return
    }
    // "Hỏi lại" trên thẻ duyệt: trả lời giả kèm số thứ tự câu (đếm các câu đã hỏi trước trong prompt).
    if (req.systemPrompt.startsWith(EXPLAIN_MARKER)) {
      const question = /Câu hỏi mới của người dùng: ([\s\S]*)$/.exec(req.prompt)?.[1]?.trim() ?? ''
      const index = (req.prompt.match(/^Người dùng hỏi: /gm) ?? []).length + 1
      const card = /^Loại: (.*)$/m.exec(req.prompt)?.[1] ?? ''
      // Có lịch sử các bản trước → nêu số bản + yêu cầu sửa gần nhất (e2e kiểm tra prompt gửi kèm lịch sử).
      const pastVersions = (/<cac-ban-truoc>([\s\S]*?)<\/cac-ban-truoc>/.exec(req.prompt)?.[1]?.match(/^Bản \d+:$/gm) ?? []).length
      const lastRevision = [...req.prompt.matchAll(/^Người dùng yêu cầu sửa: (.*)$/gm)].at(-1)?.[1]
      const seen = pastVersions ? ` [đã thấy ${pastVersions} bản trước, yêu cầu: "${lastRevision}"]` : ''
      // Câu là yêu cầu sửa ("Đổi…", "Sửa…", "Viết lại…", "Hãy…") → thêm dấu như trợ lý thật (stream cắt nhỏ cả dấu).
      const hint = /^(đổi|sửa|viết lại|hãy)\b/iu.test(question) ? `\n${REVISION_HINT_MARKER}` : ''
      for (const part of `Giải thích (giả lập) #${index} [${card}]${seen}: ${question}${hint}`.match(/.{1,12}/gsu) ?? []) {
        if (signal.aborted) return
        yield { type: 'text', delta: part }
        await new Promise((r) => setTimeout(r, 15))
      }
      yield { type: 'done' }
      return
    }
    // FAKE_EDIT:<file>: xin sửa file trong thư mục dự án qua thẻ duyệt diff (như CLI). Từ chối kèm góp ý → đề xuất
    // lại nội dung mới có chứa góp ý (tối đa 3 lần); đồng ý → ghi file.
    const edit = /FAKE_EDIT:(\S+)/.exec(req.prompt)
    if (edit && this.decideEdit && req.approval) {
      const file = join(req.cwd, edit[1])
      let content = 'phiên bản 1\n'
      for (let attempt = 1; attempt <= 3; attempt++) {
        const input = { file_path: file, content }
        yield { type: 'tool', name: 'Write', input }
        const decision = await this.decideEdit(req.approval.conversationId, 'Write', input)
        if (signal.aborted) return
        if (decision.allow) {
          await writeFile(file, content, 'utf8')
          yield { type: 'text', delta: `Đã sửa ${edit[1]} (phiên bản ${attempt}).` }
          yield { type: 'done' }
          return
        }
        const feedback = /góp ý: "([^"]*)"/.exec(decision.message ?? '')?.[1]
        if (!feedback) break
        content = `phiên bản ${attempt + 1}: ${feedback}\n`
      }
      yield { type: 'text', delta: `Không sửa ${edit[1]}.` }
      yield { type: 'done' }
      return
    }
    const skills = [...req.systemPrompt.matchAll(/^### Skill: ([\w-]+)/gm)].map((m) => m[1])
    const first = req.prompt.split('\n').find((l) => l.trim() && !l.startsWith('(')) ?? ''
    const expressive = req.systemPrompt.includes('## Biểu cảm')
    const tags = !expressive
      ? ''
      : / sticker\b/i.test(` ${first}`)
        ? ' [[react:🥰]] [[sticker:local/vui]]'
        : ' [[react:❤️]] [[gif:happy cat]]'
    // FAKE_TOOL:<tên> <json>: gọi tool của app nếu lượt chat này được cấp tool đó, rồi in kết quả.
    const toolCall = /FAKE_TOOL:([a-z_]+)\s+(\{.*\})/.exec(req.prompt)
    if (toolCall && this.callTool && req.appTools?.names.includes(toolCall[1])) {
      const input: unknown = JSON.parse(toolCall[2])
      yield { type: 'tool', name: `mcp__mmc__${toolCall[1]}`, input }
      const result = await this.callTool(toolCall[1], input, req.appTools.conversationId)
      const text = result.content.map((c) => (c.type === 'text' ? c.text : '[ảnh]')).join('\n')
      yield { type: 'text', delta: `${result.isError ? 'LỖI TOOL: ' : 'KẾT QUẢ TOOL: '}${text}` }
      yield { type: 'done' }
      return
    }
    // FAKE_TOOLS:<n>: giả n lần đọc / tìm file (Read, Grep xen kẽ), công cụ cuối "chạy" 1,5 giây → e2e thấy dòng
    // "Đang …" rồi về dòng tóm tắt gộp.
    const fakeTools = Math.min(30, Number(/FAKE_TOOLS:(\d+)/.exec(req.prompt)?.[1] ?? 0))
    for (let i = 0; i < fakeTools; i++) {
      if (signal.aborted) return
      yield i % 2 === 0
        ? { type: 'tool', name: 'Read', input: { file_path: `C:\\du-an\\src\\file${i + 1}.ts` } }
        : { type: 'tool', name: 'Grep', input: { pattern: `tukhoa${i + 1}`, path: 'C:\\du-an\\src' } }
      await new Promise((r) => setTimeout(r, i === fakeTools - 1 ? 1500 : 50))
    }
    const artifact = FAKE_ARTIFACTS[/FAKE_ARTIFACT:([\w-]+)/.exec(req.prompt)?.[1] ?? ''] ?? ''
    const used = skills.length ? ` [skill: ${skills.join(', ')}]` : ''
    // Cuộc thuộc dự án: báo lại tên dự án, dòng đầu hướng dẫn, file đọc được → e2e kiểm phần dự án trong prompt.
    const projectName = /^## Dự án: (.+)$/m.exec(req.systemPrompt)?.[1]
    const project = projectName
      ? ` [dự án: ${projectName} | hướng dẫn: ${/### Hướng dẫn của dự án\n(.*)/.exec(req.systemPrompt)?.[1]?.slice(0, 60) ?? '-'} | file: ${
          [...req.systemPrompt.matchAll(/<file name="([^"]+)">/g)].map((m) => m[1]).join(', ') || '-'
        }]`
      : ''
    const reply = `Mizuki (giả lập) đã nhận: "${first.slice(0, 80)}"${used}${project}${tags}${artifact}`
    for (const part of reply.match(/.{1,12}/gsu) ?? []) {
      if (signal.aborted) return
      yield { type: 'text', delta: part }
      await new Promise((r) => setTimeout(r, 10))
    }
    yield { type: 'done' }
  }
}
