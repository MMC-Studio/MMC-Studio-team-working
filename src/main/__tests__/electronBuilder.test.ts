import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Chặn lỗi đóng gói kiểu "bộ lọc dán nhầm" (bộ lọc của sidecar dính sang mục sticker → bộ cài không có sticker).
const ROOT = join(__dirname, '..', '..', '..')

type Entry = { from: string; to: string; filter: string[] | null }

/** Đọc mục extraResources (file giữ dạng đơn giản: `- from:` / `to:` / `filter: [...]` trên một dòng). */
function extraResources(): Entry[] {
  const lines = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8').split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith('extraResources:'))
  const out: Entry[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const from = /^\s*-\s*from:\s*(\S+)/.exec(line)
    if (from) out.push({ from: from[1], to: '', filter: null })
    const to = /^\s+to:\s*(\S+)/.exec(line)
    if (to && out.length) out[out.length - 1].to = to[1]
    const filter = /^\s+filter:\s*\[(.*)\]/.exec(line)
    if (filter && out.length) out[out.length - 1].filter = filter[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
  }
  return out
}

describe('electron-builder.yml — extraResources', () => {
  const entries = extraResources()

  it('đọc được các mục (có sidecar + stickers)', () => {
    expect(entries.map((e) => e.to)).toEqual(expect.arrayContaining(['sidecar', 'stickers']))
  })

  it('bộ lọc chỉ nhắc tới file có thật trong thư mục nguồn', () => {
    for (const e of entries) {
      if (!e.filter) continue
      const dir = join(ROOT, e.from)
      for (const p of e.filter.filter((x) => !x.startsWith('!') && !/[*?{[]/.test(x)))
        expect(existsSync(join(dir, p)), `${e.from}: bộ lọc "${p}" không có trong thư mục`).toBe(true)
    }
  })

  it('stickers: đóng gói cả thư mục (không bộ lọc), có sticker .svg', () => {
    const s = entries.find((e) => e.to === 'stickers')!
    expect(s.filter).toBeNull()
    const files = readdirSync(join(ROOT, s.from)).filter((f) => statSync(join(ROOT, s.from, f)).isFile())
    expect(files.some((f) => f.endsWith('.svg'))).toBe(true)
  })
})
