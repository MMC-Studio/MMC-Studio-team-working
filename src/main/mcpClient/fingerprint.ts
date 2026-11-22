import { createHash } from 'node:crypto'

/** Tool MCP như server trả về trong `tools/list`. */
export type ToolDef = { name: string; description?: string; inputSchema?: unknown }

/** JSON với khoá sắp xếp — cùng nội dung → cùng chuỗi, không phụ thuộc thứ tự khoá server gửi. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`
}

/** Dấu một tool: tên + mô tả + tham số. Đổi bất kỳ phần nào → dấu khác → phải duyệt lại. */
export const toolHash = (t: ToolDef): string =>
  createHash('sha256')
    .update(stableStringify({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? null }))
    .digest('hex')

export const toolHashes = (tools: ToolDef[]): Record<string, string> => Object.fromEntries(tools.map((t) => [t.name, toolHash(t)]))

/** Tool mới hoặc đổi so với bản đã duyệt (tool bị bỏ thì không nguy hiểm → không tính). */
export function changedTools(tools: ToolDef[], approved: Record<string, string>): string[] {
  return tools.filter((t) => approved[t.name] !== toolHash(t)).map((t) => t.name)
}
