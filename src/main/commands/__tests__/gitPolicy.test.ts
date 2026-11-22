import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { displayGit, GitPolicyError, planGit } from '../gitPolicy'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mmc-gitpolicy-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const err = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    if (e instanceof GitPolicyError) return e.message
    throw e
  }
  throw new Error('không ném lỗi')
}

describe('planGit — cho phép', () => {
  it('cờ đọc phổ biến, chuẩn hoá cờ có giá trị, mặc định giới hạn trong thư mục ("-- .")', () => {
    expect(planGit('status', ['-sb'], [], root)).toEqual({ args: ['-s', '-b'], paths: ['.'] })
    expect(planGit('status', ['--porcelain=v2', '-uno'], [], root).args).toEqual(['--porcelain=v2', '-uno'])
    expect(planGit('diff', ['--stat', 'HEAD~3', 'HEAD'], ['src/a.ts'], root)).toEqual({ args: ['--stat', 'HEAD~3', 'HEAD'], paths: ['src/a.ts'] })
    expect(planGit('diff', ['-U5', '--cached'], [], root).args).toEqual(['-U5', '--cached'])
    expect(planGit('log', ['-n', '10', '--oneline', '--author', 'Lan Anh', '-5'], [], root).args).toEqual([
      '-n10',
      '--oneline',
      '--author=Lan Anh',
      '-5'
    ])
    expect(planGit('log', ['--format=%h %an %s', 'main..feature'], [], root).args).toEqual(['--format=%h %an %s', 'main..feature'])
    expect(planGit('show', ['--stat', 'abc1234'], [], root).args).toEqual(['--stat', 'abc1234'])
    expect(planGit('branch', ['-vv', '--sort=-committerdate'], [], root)).toEqual({ args: ['-vv', '--sort=-committerdate'], paths: [] })
  })

  it('hiển thị lệnh dễ đọc (nháy kép khi có khoảng trắng)', () => {
    expect(displayGit('log', planGit('log', ['--author', 'Lan Anh'], ['src'], root))).toBe('git log "--author=Lan Anh" -- src')
    expect(displayGit('status', planGit('status', ['--short'], [], root))).toBe('git status --short -- .')
  })
})

describe('planGit — chặn', () => {
  it.each([
    ['diff', ['--output=x.txt']],
    ['diff', ['--output', 'x.txt']],
    ['diff', ['--ext-diff']],
    ['diff', ['--textconv']],
    ['diff', ['--no-index', 'a', 'b']],
    ['log', ['--show-signature']],
    ['log', ['-O../order']],
    ['status', ['-c', 'core.fsmonitor=evil']],
    ['status', ['-C', '..']],
    ['log', ['--git-dir=../x']],
    ['log', ['--exec=sh']],
    ['diff', ['--color']]
  ] as const)('git %s %j', (sub, args) => {
    expect(() => planGit(sub, [...args], [], root)).toThrow(GitPolicyError)
  })

  it('format gọi gpg (%G) / pretty=format tự do bị chặn', () => {
    expect(err(() => planGit('log', ['--format=%h %G?'], [], root))).toContain('--format')
    expect(() => planGit('log', ['--pretty=format:%G?'], [], root)).toThrow(GitPolicyError)
  })

  it('tên commit có ":" (HEAD:../file đọc file ngoài thư mục) hoặc bắt đầu bằng "-"', () => {
    expect(err(() => planGit('show', ['HEAD:../secret.txt'], [], root))).toContain('không hợp lệ')
    expect(() => planGit('show', [':/fix'], [], root)).toThrow(GitPolicyError)
  })

  it('branch không nhận tên (git branch <tên> = TẠO nhánh), không nhận đường dẫn', () => {
    expect(err(() => planGit('branch', ['feature-x'], [], root))).toContain('không nhận tên')
    expect(err(() => planGit('branch', [], ['src'], root))).toContain('không nhận đường dẫn')
  })

  it('quá số tên commit, "--" trong args, ký tự điều khiển', () => {
    expect(() => planGit('diff', ['a', 'b', 'c'], [], root)).toThrow(GitPolicyError)
    expect(err(() => planGit('diff', ['--'], [], root))).toContain('paths')
    expect(() => planGit('log', ['--grep=a\nb'], [], root)).toThrow(GitPolicyError)
  })

  it('đường dẫn ngoài thư mục (../, tuyệt đối khác)', () => {
    expect(err(() => planGit('diff', [], ['../ngoai.txt'], root))).toContain('ngoài thư mục')
    expect(() => planGit('diff', [], [join(tmpdir(), 'khac.txt')], root)).toThrow(GitPolicyError)
    expect(planGit('diff', [], [join(root, 'src', 'a.ts')], root).paths).toEqual(['src/a.ts'])
  })
})
