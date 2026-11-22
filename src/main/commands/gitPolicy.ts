import { COMMAND_ARG_CHARS, COMMAND_ARGS_MAX, COMMAND_PATHS_MAX, type GitSubcommand } from '@shared/commands'
import { insideProject } from '../code/paths'

/**
 * Danh sách cho phép CẢ THAM SỐ của git (không chỉ lệnh con): chỉ các cờ đọc, không cờ nào ghi file
 * (`--output`, `-O`), chạy chương trình (`--ext-diff`, `--textconv`, `--show-signature`, `%G` trong format),
 * đổi chỗ làm việc (`-C`, `--git-dir`, `--work-tree`, `--no-index`) hay cấu hình (`-c`). Cờ lạ → từ chối, không đoán.
 * Đường dẫn đi riêng (`paths`), app tự đặt sau `--`; vị trí còn lại chỉ là tên commit / nhánh (không có `:` —
 * chặn `HEAD:../file` đọc file ngoài thư mục).
 */

type Spec = {
  /** Cờ không có giá trị. */
  flags: readonly string[]
  /** Cờ có giá trị → mẫu hợp lệ của giá trị (nhận `--x=v`, `--x v`, và `-Xv` cho cờ một chữ). */
  values: Readonly<Record<string, RegExp>>
  /** Số tên commit / nhánh tối đa. */
  revisions: number
  /** Nhận đường dẫn (giới hạn trong thư mục). */
  paths: boolean
  /** `-5` = 5 commit gần nhất (git log). */
  countShorthand?: boolean
  /** Cờ an toàn app luôn thêm ngay sau lệnh con. */
  forced: readonly string[]
}

/** Có ký tự điều khiển (xuống dòng, NUL…) không. */
const hasControl = (s: string): boolean => [...s].some((c) => c.charCodeAt(0) < 0x20)

const NUM = /^\d{1,6}$/
/** Chữ tự do một dòng (tác giả, từ khoá, ngày). */
const TEXT = new RegExp(`^[^\\x00-\\x1f]{1,${COMMAND_ARG_CHARS}}$`)
const REV = /^(?!-)[A-Za-z0-9._/@{}~^+-]{1,100}$/
const PRETTY = /^(oneline|short|medium|full|fuller|reference|raw)$/
const DATE = /^(relative|local|iso|iso8601|iso-strict|iso8601-strict|rfc|rfc2822|short|raw|human|unix|default)(-local)?$/

const DIFF_FLAGS = [
  '--stat', '--numstat', '--shortstat', '--name-only', '--name-status', '--summary', '--raw',
  '-p', '--patch', '-s', '--no-patch',
  '-w', '--ignore-all-space', '-b', '--ignore-space-change', '--ignore-blank-lines', '--ignore-space-at-eol',
  '--word-diff', '-M', '--find-renames', '--no-renames', '--minimal', '--patience', '--histogram'
] as const
const DIFF_VALUES: Record<string, RegExp> = {
  '-U': NUM,
  '--unified': NUM,
  '--word-diff': /^(plain|porcelain|none)$/,
  '--diff-filter': /^[ACDMRTUXBacdmrtuxb*]{1,10}$/
}
/** Định dạng tự do của log / show — `%G…` bắt git gọi gpg kiểm chữ ký → chặn. */
const FORMAT = { test: (v: string) => TEXT.test(v) && !/%G/.test(v) } as RegExp
const DIFF_FORCED = ['--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=all'] as const

export const GIT_SPECS: Record<GitSubcommand, Spec> = {
  status: {
    flags: ['-s', '--short', '-b', '--branch', '--porcelain', '--long', '-v', '--verbose', '-u', '--untracked-files', '--ignored',
      '--ahead-behind', '--no-ahead-behind', '--renames', '--no-renames', '--show-stash'],
    values: { '--porcelain': /^v[12]$/, '-u': /^(no|normal|all)$/, '--untracked-files': /^(no|normal|all)$/, '--ignored': /^(traditional|matching|no)$/ },
    revisions: 0,
    paths: true,
    forced: ['--ignore-submodules=all']
  },
  diff: {
    flags: [...DIFF_FLAGS, '--cached', '--staged', '--merge-base', '--check'],
    values: DIFF_VALUES,
    revisions: 2,
    paths: true,
    forced: DIFF_FORCED
  },
  log: {
    flags: [...DIFF_FLAGS, '--oneline', '--graph', '--decorate', '--no-decorate', '--all', '--branches', '--tags', '--remotes',
      '--no-merges', '--merges', '--first-parent', '--reverse', '--date-order', '--topo-order', '--author-date-order', '--follow',
      '-i', '--regexp-ignore-case', '--abbrev-commit', '--no-abbrev-commit', '--left-right'],
    values: {
      ...DIFF_VALUES,
      '-n': NUM, '--max-count': NUM, '--skip': NUM,
      '--since': TEXT, '--after': TEXT, '--until': TEXT, '--before': TEXT,
      '--author': TEXT, '--committer': TEXT, '--grep': TEXT,
      '--pretty': PRETTY, '--format': FORMAT, '--date': DATE, '--decorate': /^(short|full|auto|no)$/
    },
    revisions: 3,
    paths: true,
    countShorthand: true,
    forced: [...DIFF_FORCED, '--no-show-signature']
  },
  show: {
    flags: [...DIFF_FLAGS, '--oneline', '--abbrev-commit', '--no-abbrev-commit'],
    values: { ...DIFF_VALUES, '--pretty': PRETTY, '--format': FORMAT, '--date': DATE },
    revisions: 5,
    paths: true,
    forced: [...DIFF_FORCED, '--no-show-signature']
  },
  branch: {
    flags: ['-a', '--all', '-r', '--remotes', '-v', '-vv', '--verbose', '--list', '--show-current', '--merged', '--no-merged'],
    values: { '--contains': REV, '--no-contains': REV, '--sort': /^-?(refname|committerdate|creatordate|authordate|objectname)$/ },
    // Tên đứng một mình ở `git branch <tên>` là TẠO nhánh → không nhận.
    revisions: 0,
    paths: false,
    forced: ['--no-color']
  }
}

export type GitPlan = {
  /** Tham số người dùng thấy + app chạy (đã chuẩn hoá: cờ có giá trị luôn ở dạng `--x=v` / `-Xv`). */
  args: string[]
  /** Đường dẫn tương đối trong thư mục (đã kiểm theo chữ; app kiểm thêm đường dẫn thật trước khi chạy). */
  paths: string[]
}

export class GitPolicyError extends Error {}

const fail = (msg: string): never => {
  throw new GitPolicyError(msg)
}

function checkValue(spec: Spec, name: string, value: string): string {
  const re = spec.values[name]
  if (!re.test(value)) fail(`Giá trị không hợp lệ cho ${name}: "${value}".`)
  return name.startsWith('--') ? `${name}=${value}` : `${name}${value}`
}

/**
 * Kiểm `args` / `paths` của trợ lý cho lệnh con `sub` trong thư mục `root` → tham số đã chuẩn hoá; sai → GitPolicyError
 * (câu báo cho trợ lý, nêu đúng chỗ sai để nó sửa).
 */
export function planGit(sub: GitSubcommand, rawArgs: string[], rawPaths: string[], root: string): GitPlan {
  const spec = GIT_SPECS[sub]
  if (rawArgs.length > COMMAND_ARGS_MAX) fail(`Tối đa ${COMMAND_ARGS_MAX} tham số.`)
  if (rawPaths.length > COMMAND_PATHS_MAX) fail(`Tối đa ${COMMAND_PATHS_MAX} đường dẫn.`)
  const flags = new Set(spec.flags)
  const args: string[] = []
  let revisions = 0
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]
    if (!arg || arg.length > COMMAND_ARG_CHARS || hasControl(arg)) fail('Tham số rỗng, quá dài hoặc có ký tự điều khiển.')
    if (arg === '--') fail('Không dùng "--" trong args — đường dẫn đưa vào paths.')
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const name = eq < 0 ? arg : arg.slice(0, eq)
      const value = eq < 0 ? undefined : arg.slice(eq + 1)
      if (value === undefined && flags.has(name)) {
        args.push(name)
        continue
      }
      if (!(name in spec.values)) fail(`Cờ không được phép với git ${sub}: ${name}.`)
      if (value !== undefined) {
        args.push(checkValue(spec, name, value))
        continue
      }
      const next = rawArgs[++i]
      if (next === undefined) fail(`${name} cần giá trị.`)
      args.push(checkValue(spec, name, next))
      continue
    }
    if (arg.startsWith('-')) {
      if (flags.has(arg)) {
        args.push(arg)
        continue
      }
      if (spec.countShorthand && /^-\d{1,6}$/.test(arg)) {
        args.push(arg)
        continue
      }
      const short = arg.slice(0, 2)
      // `-n 5` / `-U5` / `-uno`.
      if (short in spec.values) {
        const attached = arg.slice(2)
        if (attached) {
          args.push(checkValue(spec, short, attached))
          continue
        }
        const next = rawArgs[++i]
        if (next === undefined) fail(`${short} cần giá trị.`)
        args.push(checkValue(spec, short, next))
        continue
      }
      // `-sb` = `-s -b` khi mọi chữ đều là cờ không giá trị được phép.
      const letters = arg.slice(1).split('')
      if (/^-[A-Za-z]{2,}$/.test(arg) && letters.every((c) => flags.has(`-${c}`))) {
        args.push(...letters.map((c) => `-${c}`))
        continue
      }
      fail(`Cờ không được phép với git ${sub}: ${arg}.`)
    }
    if (++revisions > spec.revisions)
      fail(spec.revisions === 0 ? `git ${sub} không nhận tên commit / nhánh ("${arg}").` : `git ${sub} nhận tối đa ${spec.revisions} tên commit / nhánh.`)
    if (!REV.test(arg)) fail(`Tên commit / nhánh không hợp lệ: "${arg}" (không dùng ":" hay khoảng trắng).`)
    args.push(arg)
  }
  if (!spec.paths && rawPaths.length > 0) fail(`git ${sub} không nhận đường dẫn.`)
  const paths: string[] = []
  for (const p of rawPaths) {
    if (!p || p.length > 500 || hasControl(p)) fail('Đường dẫn rỗng, quá dài hoặc có ký tự điều khiển.')
    // Thư mục gốc ("." hoặc chính nó) là hợp lệ; còn lại phải nằm trong.
    const rel = p === '.' || p === './' ? '.' : insideProject(root, p)
    if (!rel) fail(`Đường dẫn nằm ngoài thư mục đã chọn: "${p}".`)
    paths.push(rel!)
  }
  return { args, paths: spec.paths && paths.length === 0 ? ['.'] : paths }
}

/** `git status --short -- .` — dạng dễ đọc trên thẻ duyệt (đặt trong nháy kép khi có khoảng trắng / ký tự lạ). */
export function displayGit(sub: GitSubcommand, plan: GitPlan): string {
  const quote = (s: string): string => (/^[A-Za-z0-9._/@{}~^+=:,%-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`)
  const parts = ['git', sub, ...plan.args.map(quote)]
  if (plan.paths.length) parts.push('--', ...plan.paths.map(quote))
  return parts.join(' ')
}
