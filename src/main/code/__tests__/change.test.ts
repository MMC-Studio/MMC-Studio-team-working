import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyTool, describeChange, inspectChange, insideProject } from '../change'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tw-code-'))
  writeFileSync(join(root, 'app.ts'), 'const a = 1\nconst b = 2\nconsole.log(a + b)\n')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('insideProject', () => {
  it('chặn ../, đường dẫn tuyệt đối ngoài dự án và chính thư mục gốc', () => {
    expect(insideProject(root, 'src/x.ts')).toBe('src/x.ts')
    expect(insideProject(root, join(root, 'app.ts'))).toBe('app.ts')
    expect(insideProject(root, '../ngoai.txt')).toBeNull()
    expect(insideProject(root, join(tmpdir(), 'khac.txt'))).toBeNull()
    expect(insideProject(root, root)).toBeNull()
  })
})

describe('describeChange', () => {
  it('junction trong dự án trỏ ra ngoài → từ chối (Edit lẫn Write file mới), không đọc file bên ngoài', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'tw-outside-'))
    try {
      writeFileSync(join(outside, 'secret.txt'), 'bí mật')
      symlinkSync(outside, join(root, 'link'), 'junction')
      expect(await describeChange(root, 'Edit', { file_path: 'link/secret.txt', old_string: 'bí mật', new_string: 'x' })).toEqual({ error: 'link_outside' })
      expect(await describeChange(root, 'Write', { file_path: join(root, 'link', 'moi.txt'), content: 'x' })).toEqual({ error: 'link_outside' })
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('junction trỏ vào thư mục bảo vệ của Unity → từ chối theo đường dẫn thật', async () => {
    mkdirSync(join(root, 'Assets'))
    mkdirSync(join(root, 'ProjectSettings'))
    mkdirSync(join(root, 'Library'))
    symlinkSync(join(root, 'Library'), join(root, 'Assets', 'lib'), 'junction')
    const r = await describeChange(root, 'Write', { file_path: 'Assets/lib/x.txt', content: 'x' })
    expect(r).toMatchObject({ error: 'protected_path' })
  })

  it('Edit → diff đúng dòng thay đổi', async () => {
    const r = await describeChange(root, 'Edit', { file_path: join(root, 'app.ts'), old_string: 'const b = 2', new_string: 'const b = 3' })
    expect(r).toMatchObject({ path: 'app.ts', isNewFile: false, added: 1, removed: 1 })
    expect('patch' in r && r.patch).toContain('-const b = 2\n+const b = 3')
  })

  it('Edit replace_all thay mọi chỗ; old_string không có → lỗi', async () => {
    const r = await describeChange(root, 'Edit', { file_path: 'app.ts', old_string: 'const', new_string: 'let', replace_all: true })
    expect(r).toMatchObject({ added: 2, removed: 2 })
    expect(await describeChange(root, 'Edit', { file_path: 'app.ts', old_string: 'không có', new_string: 'x' })).toEqual({ error: 'old_string_not_found' })
  })

  it('Write file mới → isNewFile', async () => {
    const r = await describeChange(root, 'Write', { file_path: join(root, 'src', 'new.ts'), content: 'export {}\n' })
    expect(r).toMatchObject({ path: 'src/new.ts', isNewFile: true, added: 1, removed: 0 })
  })

  it('ngoài dự án / tool khác / input sai → lỗi', async () => {
    expect(await describeChange(root, 'Write', { file_path: join(tmpdir(), 'x.txt'), content: 'x' })).toEqual({ error: 'outside_project' })
    expect(await describeChange(root, 'Bash', { file_path: 'a', command: 'rm -rf /' })).toEqual({ error: 'unsupported_tool' })
    expect(await describeChange(root, 'Write', { content: 'x' })).toEqual({ error: 'invalid_input' })
  })

  // Như Edit của Claude Code CLI: so khớp sau khi đổi CRLF → LF, ghi lại theo kiểu xuống dòng của file. Trước đây app
  // so từng byte → Edit có xuống dòng trong old_string trên file CRLF bị chặn nhầm (old_string_not_found) dù CLI làm được.
  it('file CRLF: old_string / new_string dùng \\n vẫn khớp; kết quả giữ CRLF', async () => {
    writeFileSync(join(root, 'win.txt'), 'dong 1\r\nhas loaded:\r\ndong 21\r\n')
    const r = await inspectChange(root, 'Edit', {
      file_path: join(root, 'win.txt'),
      old_string: 'has loaded:\ndong 21',
      new_string: 'has loaded:\ndong 21\ndong 22'
    })
    expect(r).toMatchObject({ path: 'win.txt', added: 1, removed: 0 })
    expect('after' in r && r.after).toBe('dong 1\r\nhas loaded:\r\ndong 21\r\ndong 22\r\n')
  })

  it('applyTool: file LF giữ LF (old_string có \\r\\n vẫn khớp); replace_all trên file CRLF; không có → lỗi', () => {
    expect(applyTool('Edit', { old_string: 'a\r\nb', new_string: 'a\nx\nb' }, 'a\nb\n')).toBe('a\nx\nb\n')
    expect(applyTool('Edit', { old_string: 'x', new_string: 'y\nz', replace_all: true }, 'x\r\nx\r\n')).toBe('y\r\nz\r\ny\r\nz\r\n')
    expect(applyTool('Edit', { old_string: 'không có', new_string: 'x' }, 'a\r\n')).toEqual({ error: 'old_string_not_found' })
  })
})
