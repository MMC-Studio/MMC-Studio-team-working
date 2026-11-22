import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { insideProject, realInside, realRelative } from '../paths'

let base: string
let root: string
let outside: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mmc-paths-'))
  root = join(base, 'proj')
  outside = join(base, 'outside')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(root, 'src', 'a.ts'), 'x')
  writeFileSync(join(outside, 'secret.txt'), 'bí mật')
  // 'junction' trên Windows không cần quyền admin; trên hệ khác là symlink thư mục thường.
  symlinkSync(outside, join(root, 'link'), 'junction')
  symlinkSync(join(root, 'src'), join(root, 'alias'), 'junction')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('insideProject (theo chữ)', () => {
  it('tên bắt đầu bằng ".." là file hợp lệ, "../" thì không', () => {
    expect(insideProject(root, '..env.txt')).toBe('..env.txt')
    expect(insideProject(root, '..\\ngoai.txt')).toBeNull()
    expect(insideProject(root, '../ngoai.txt')).toBeNull()
  })
})

describe('realRelative / realInside (theo đường dẫn thật)', () => {
  it('file thường và file chưa tồn tại (kể cả thư mục chưa có) trong dự án', async () => {
    expect(await realRelative(root, join(root, 'src', 'a.ts'))).toBe('src/a.ts')
    expect(await realRelative(root, join(root, 'moi', 'sau', 'b.ts'))).toBe('moi/sau/b.ts')
    expect(await realRelative(root, root)).toBe('')
  })

  it('junction trỏ ra ngoài → null, kể cả file chưa tồn tại dưới nó', async () => {
    expect(await realRelative(root, join(root, 'link', 'secret.txt'))).toBeNull()
    expect(await realRelative(root, join(root, 'link', 'moi.txt'))).toBeNull()
    expect(await realRelative(root, join(root, 'link', 'a', 'b', 'moi.txt'))).toBeNull()
    expect(await realInside(root, join(root, 'link'))).toBe(false)
  })

  it('junction trỏ vào chỗ khác TRONG dự án → trả đường dẫn thật', async () => {
    expect(await realRelative(root, join(root, 'alias', 'a.ts'))).toBe('src/a.ts')
    expect(await realRelative(root, join(root, 'alias', 'moi.ts'))).toBe('src/moi.ts')
  })

  it('thư mục gốc không tồn tại → null', async () => {
    expect(await realRelative(join(base, 'khong-co'), join(base, 'khong-co', 'a.txt'))).toBeNull()
  })
})
