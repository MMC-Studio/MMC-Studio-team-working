import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { unzipSync } from 'fflate'
import { SKILL_NAME_RE } from '@shared/skills'
import type { ErrorDetail, PreviewMcpServer, PreviewSkill, PreviewWarning, SkippedFile } from '@shared/pluginStore'
import { parseSkillMd } from '../skills/format'
import { asText, LIMITS } from '../skills/package'

/** Chỉ giữ file chữ (giống skill tự cài). Script, hook, nhị phân: bỏ — app KHÔNG BAO GIỜ chạy gì kèm skill. */
const TEXT_EXT = new Set(['.md', '.txt', '.json'])
/**
 * Lock file của trình quản lý gói: không phải nội dung skill (toàn link registry → cảnh báo nhiễu, người dùng quen bỏ qua).
 * Không cài, không quét — ghi vào "Bị bỏ".
 */
export const LOCK_FILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'uv.lock',
  'poetry.lock',
  'pdm.lock',
  'pipfile.lock',
  'cargo.lock',
  'gemfile.lock',
  'composer.lock',
  'go.sum',
  'packages.lock.json',
  'pubspec.lock',
  'mix.lock',
  'flake.lock'
])
export const isLockFile = (path: string): boolean => LOCK_FILES.has(posix.basename(path).toLowerCase())
/** Tên tool của app — skill lạ nhắc tới là đáng ngờ (muốn trợ lý tự xin quyền / soạn nháp…). */
export const APP_TOOL_NAMES = [
  'request_folder_access',
  'propose_schedule',
  'propose_file_change',
  'gmail_draft',
  'gmail_read',
  'gmail_search',
  'telegram_draft',
  'telegram_read',
  'screenshot',
  'ui_tree'
]
const MAX_WARNINGS = 50

export type InspectedSkill = PreviewSkill & { contents: Map<string, Uint8Array> }

/** MCP server trong gói — chưa thử kết nối (auth do service điền), chưa so với bản đang cài (change). */
export type InspectedMcp = Omit<PreviewMcpServer, 'change'>

export type InspectedPlugin = {
  skills: InspectedSkill[]
  license: string | null
  ignored: { hooks: boolean; commands: number; agents: number; mcp: boolean; otherFiles: number }
  warnings: PreviewWarning[]
  mcp: InspectedMcp[]
}

const MAX_MCP = 20

/**
 * Lệnh khoá phiên bản → được "Thêm thủ công" (vẫn tắt sẵn). Lệnh lấy bản mới nhất (npx pkg, uvx pkg, image:latest) thì
 * mỗi lần chạy có thể là code khác → không.
 */
export function isPinnedCommand(command: string, args: string[]): boolean {
  const cmd = posix.basename(command.replace(/\\/g, '/')).toLowerCase().replace(/\.(cmd|exe|bat)$/, '')
  const firstArg = (from: number): string => args.slice(from).find((a) => !a.startsWith('-')) ?? ''
  const npmPinned = (pkg: string): boolean => /^(@[^/@\s]+\/)?[^@/\s]+@\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(pkg)
  if (['npx', 'bunx', 'pnpx'].includes(cmd)) return npmPinned(firstArg(0))
  if ((cmd === 'pnpm' && args[0] === 'dlx') || (cmd === 'bun' && args[0] === 'x') || (cmd === 'npm' && args[0] === 'exec')) return npmPinned(firstArg(1))
  if (cmd === 'uvx' || (cmd === 'uv' && args[0] === 'tool' && args[1] === 'run') || (cmd === 'pipx' && args[0] === 'run')) {
    const from = args.indexOf('--from')
    const pkg = from >= 0 ? (args[from + 1] ?? '') : firstArg(cmd === 'uvx' ? 0 : cmd === 'uv' ? 2 : 1)
    return /^[\w.-]+(\[[\w,.-]+\])?(==\d+(\.\d+)*|@\d+\.\d+(\.\d+)*)$/.test(pkg)
  }
  if (cmd === 'docker' && args[0] === 'run') return args.some((a) => /@sha256:[0-9a-f]{64}$/.test(a))
  return false
}

const quoteArg = (a: string): string => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)

/** Đọc một mục server (.mcp.json / plugin.json). `allowLocalHttp`: chỉ e2e bản chưa đóng gói (máy chủ MCP giả). */
export function parseMcpEntry(name: string, v: unknown, allowLocalHttp = false): InspectedMcp | null {
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  const base: InspectedMcp = { name: name.slice(0, 100), kind: 'unsupported', url: null, host: null, headers: [], command: null, argv: [], pinned: false, reason: null, auth: 'unknown' }
  if (typeof e.url === 'string' || e.type === 'http' || e.type === 'sse' || e.type === 'streamable-http') {
    const url = typeof e.url === 'string' ? e.url.trim().slice(0, 500) : ''
    const headers = e.headers && typeof e.headers === 'object' ? Object.entries(e.headers as Record<string, unknown>) : []
    const out: InspectedMcp = {
      ...base,
      url: url || null,
      headers: headers.filter(([k]) => /^[A-Za-z0-9-]{1,64}$/.test(k)).slice(0, 10).map(([key, t]) => ({ key, template: String(t).slice(0, 200) }))
    }
    if (out.headers.length) out.auth = 'token'
    if (e.type === 'sse') return { ...out, reason: 'sse' }
    if (url.includes('${')) return { ...out, reason: 'variables' }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ...out, reason: 'bad_url' }
    }
    const local = allowLocalHttp && parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
    if (parsed.protocol !== 'https:' && !local) return { ...out, host: parsed.host, reason: 'not_https' }
    if (parsed.username || parsed.password) return { ...out, reason: 'bad_url' }
    return { ...out, kind: 'http', host: parsed.host }
  }
  if (typeof e.command === 'string' && e.command.trim()) {
    const args = Array.isArray(e.args) ? e.args.filter((a): a is string => typeof a === 'string').slice(0, 50).map((a) => a.slice(0, 500)) : []
    const command = e.command.trim().slice(0, 300)
    return { ...base, kind: 'stdio', command: [command, ...args].map(quoteArg).join(' '), argv: [command, ...args], pinned: isPinnedCommand(command, args) }
  }
  return null
}

export class InspectError extends Error {
  constructor(
    readonly code: 'bad_archive' | 'too_large' | 'no_skills',
    readonly detail: ErrorDetail | null = null
  ) {
    super(detail?.file ? `${code}: ${detail.reason} ${detail.file}` : code)
  }
}

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const clip = (s: string, n = 120): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** Đoán license: SPDX phổ biến theo dòng đầu file LICENSE; không nhận ra → dòng đầu. */
export function licenseName(text: string): string {
  const head = text.slice(0, 2000)
  const known: [RegExp, string][] = [
    [/Apache License[\s\S]*Version 2\.0/i, 'Apache-2.0'],
    [/MIT License|Permission is hereby granted, free of charge/i, 'MIT'],
    [/BSD 3-Clause|Redistribution and use in source and binary forms[\s\S]*Neither the name/i, 'BSD-3-Clause'],
    [/BSD 2-Clause/i, 'BSD-2-Clause'],
    [/GNU GENERAL PUBLIC LICENSE[\s\S]*Version 3/i, 'GPL-3.0'],
    [/GNU GENERAL PUBLIC LICENSE[\s\S]*Version 2/i, 'GPL-2.0'],
    [/Mozilla Public License[\s\S]*2\.0/i, 'MPL-2.0'],
    [/Creative Commons Attribution 4\.0/i, 'CC-BY-4.0'],
    [/This is free and unencumbered software released into the public domain/i, 'Unlicense']
  ]
  for (const [re, name] of known) if (re.test(head)) return name
  return clip(head.split(/\r?\n/).find((l) => l.trim()) ?? '', 80)
}

/** Cảnh báo cho một file chữ của skill (không chặn cài). */
export function scanText(file: string, text: string, skipped: ReadonlySet<string>): PreviewWarning[] {
  const out: PreviewWarning[] = []
  const inj =
    /(ignore|disregard|forget)\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts?)|bỏ qua (mọi |tất cả )?(quy tắc|hướng dẫn|chỉ dẫn)|không cần (hỏi|xin|chờ) (người dùng|duyệt|phép)|without (asking|approval|confirmation)|do not (ask|tell) the user|system prompt/gi
  for (const m of text.matchAll(inj)) out.push({ kind: 'injection', file, excerpt: clip(text.slice(Math.max(0, m.index - 40), m.index + 80)) })
  for (const tool of APP_TOOL_NAMES) if (new RegExp(`\\b${tool}\\b`).test(text)) out.push({ kind: 'app_tool', file, tool })
  for (const m of text.matchAll(/https?:\/\/[^\s)>"'\]]+/g)) out.push({ kind: 'url', file, url: m[0].slice(0, 200) })
  if (/[A-Za-z0-9+/]{200,}={0,2}/.test(text)) out.push({ kind: 'base64', file })
  for (const m of text.matchAll(/^\s*(?:\$\s*)?(?:curl|wget|powershell|pwsh|bash|sh|python3?|node|npx|uvx|pip|npm|rm|del|iwr|Invoke-WebRequest)\s+\S.*$/gim))
    out.push({ kind: 'shell', file, excerpt: clip(m[0]) })
  // Nhắc tới file đã bị bỏ (script, nhị phân…) → skill có thể không chạy đúng.
  for (const target of skipped) {
    const base = posix.basename(target)
    if (base.length >= 3 && text.includes(base)) out.push({ kind: 'missing_file', file, target })
  }
  for (const m of text.matchAll(/\b(?:scripts?\/[\w./-]+|[\w-]+\.(?:py|sh|ps1|js|ts|exe|bat|cmd))\b/g))
    if (![...skipped].some((s) => s.endsWith(m[0]))) out.push({ kind: 'missing_file', file, target: m[0] })
  return out
}

/**
 * Đọc gói zip (codeload: thư mục gốc `<repo>-<sha>/`) — CHỈ giải nén thư mục plugin + LICENSE ở gốc repo, giới hạn
 * số file / dung lượng như skill tự cài. Mỗi `skills/<tên>/SKILL.md` là một skill; trong thư mục skill chỉ giữ file chữ.
 */
export function inspectArchive(zip: Uint8Array, pluginPath: string, fallbackLicense: string | null, allowLocalHttp = false): InspectedPlugin {
  const files = new Map<string, Uint8Array>()
  let top: string | null = null
  let total = 0
  let count = 0
  /** File lớn nhất đã gặp — báo khi vượt tổng dung lượng (thường chính nó là thủ phạm). */
  let biggest = { name: '', size: 0 }
  const oversized = new Set<string>()
  const prefixOf = (name: string): string => name.slice(0, name.indexOf('/') + 1)
  const want = (rel: string): boolean => (pluginPath === '' ? true : rel === pluginPath || rel.startsWith(`${pluginPath}/`))
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zip, {
      filter: (f) => {
        if (f.name.endsWith('/')) return false
        top ??= prefixOf(f.name)
        if (!f.name.startsWith(top)) return false
        const rel = f.name.slice(top.length)
        const rootLicense = /^LICEN[CS]E(\.[a-z]+)?$/i.test(rel)
        if (!want(rel) && !rootLicense) return false
        if (++count > LIMITS.files * 10)
          throw new InspectError('too_large', { reason: 'too_many_files', file: pluginPath || null, code: String(LIMITS.files * 10) })
        // File quá lớn: không giải nén, chỉ ghi tên để báo bỏ qua.
        if (f.originalSize > LIMITS.fileBytes) {
          files.set(rel, new Uint8Array(0))
          oversized.add(rel)
          return false
        }
        total += f.originalSize
        if (f.originalSize > biggest.size) biggest = { name: rel, size: f.originalSize }
        if (total > LIMITS.totalBytes * 10)
          throw new InspectError('too_large', { reason: 'too_many_bytes', file: biggest.name, code: String(LIMITS.totalBytes * 10) })
        return true
      }
    })
  } catch (e) {
    if (e instanceof InspectError) throw e
    throw new InspectError('bad_archive')
  }
  for (const [name, bytes] of Object.entries(entries)) {
    if (bytes.byteLength > LIMITS.fileBytes) {
      oversized.add(top ? name.slice((top as string).length) : name)
      continue
    }
    files.set(top ? name.slice((top as string).length) : name, bytes)
  }

  const base = pluginPath === '' ? '' : `${pluginPath}/`
  const inPlugin = [...files.keys()].filter((p) => p.startsWith(base)).map((p) => p.slice(base.length))
  const rel = (p: string): Uint8Array => files.get(base + p)!

  // License: file trong thư mục plugin → ở gốc repo → mục marketplace / plugin.json.
  const licenseFile = inPlugin.find((p) => /^LICEN[CS]E(\.[a-z]+)?$/i.test(p))
  const rootLicense = [...files.keys()].find((p) => /^LICEN[CS]E(\.[a-z]+)?$/i.test(p))
  const pluginJson = inPlugin.includes('.claude-plugin/plugin.json') ? asText(rel('.claude-plugin/plugin.json')) : null
  let manifest: Record<string, unknown> = {}
  try {
    manifest = pluginJson ? (JSON.parse(pluginJson) as Record<string, unknown>) : {}
  } catch {
    manifest = {}
  }
  const licenseText = licenseFile ? asText(rel(licenseFile)) : rootLicense ? asText(files.get(rootLicense)!) : null
  const license = licenseText ? licenseName(licenseText) : typeof manifest.license === 'string' ? manifest.license.slice(0, 80) : fallbackLicense

  const skillDirs = inPlugin
    .filter((p) => /^skills\/[^/]+\/SKILL\.md$/i.test(p))
    .map((p) => p.slice(0, p.lastIndexOf('/') + 1))
  const mcp = readMcp(inPlugin, rel, manifest, allowLocalHttp)
  // Không skill, không MCP → không có gì để xem / cài.
  if (skillDirs.length === 0 && mcp.length === 0) throw new InspectError('no_skills')

  const warnings: PreviewWarning[] = []
  const skills: InspectedSkill[] = []
  for (const dir of skillDirs.sort()) {
    const inDir = inPlugin.filter((p) => p.startsWith(dir)).map((p) => p.slice(dir.length))
    const contents = new Map<string, Uint8Array>()
    const skipped: SkippedFile[] = []
    let size = 0
    for (const p of inDir.sort()) {
      const bytes = rel(dir + p)
      if (isLockFile(p)) {
        skipped.push({ path: p, reason: 'lock_file' })
        continue
      }
      if (oversized.has(base + dir + p)) {
        skipped.push({ path: p, reason: 'too_big' })
        continue
      }
      const text = TEXT_EXT.has(posix.extname(p).toLowerCase()) && bytes.byteLength > 0 ? asText(bytes) : null
      if (text === null) {
        skipped.push({ path: p, reason: 'not_text' })
        continue
      }
      if (contents.size >= LIMITS.files || size + bytes.byteLength > LIMITS.totalBytes) {
        skipped.push({ path: p, reason: 'over_limit' })
        continue
      }
      size += bytes.byteLength
      contents.set(p, bytes)
    }
    const skillMdName = [...contents.keys()].find((p) => p.toLowerCase() === 'skill.md')
    const md = skillMdName ? parseSkillMd(asText(contents.get(skillMdName)!) ?? '') : null
    if (!md || !skillMdName) continue
    const folder = dir.slice('skills/'.length, -1).toLowerCase()
    const name = SKILL_NAME_RE.test(md.name) ? md.name : SKILL_NAME_RE.test(folder) ? folder : null
    if (!name) continue
    // Lưu dưới tên chuẩn SKILL.md.
    if (skillMdName !== 'SKILL.md') {
      contents.set('SKILL.md', contents.get(skillMdName)!)
      contents.delete(skillMdName)
    }
    // "Nhắc tới file bị bỏ": chỉ script / file thật của skill — lock file không phải thứ skill cần để chạy.
    const skippedSet = new Set(skipped.filter((f) => f.reason !== 'lock_file').map((f) => f.path))
    for (const [p, bytes] of contents)
      if (warnings.length < MAX_WARNINGS) warnings.push(...scanText(`${name}/${p}`, asText(bytes) ?? '', skippedSet).slice(0, MAX_WARNINGS - warnings.length))
    skills.push({
      name,
      description: md.description,
      body: md.body,
      files: [...contents].map(([path, bytes]) => ({ path, size: bytes.byteLength, sha256: sha256(bytes) })),
      skipped,
      conflict: null,
      contents
    })
  }
  if (skills.length === 0 && mcp.length === 0) throw new InspectError('no_skills')

  const outside = inPlugin.filter((p) => !p.startsWith('skills/'))
  const hasMcpField = typeof manifest.mcpServers === 'object' && manifest.mcpServers !== null
  return {
    skills,
    license,
    ignored: {
      hooks: outside.some((p) => p.startsWith('hooks/')) || 'hooks' in manifest,
      commands: outside.filter((p) => /^commands\/.+\.md$/i.test(p)).length,
      agents: outside.filter((p) => /^agents\/.+\.md$/i.test(p)).length,
      mcp: outside.includes('.mcp.json') || hasMcpField,
      otherFiles: outside.filter((p) => !/^(hooks|commands|agents)\//i.test(p) && p !== '.mcp.json' && !p.startsWith('.claude-plugin/') && !/^LICEN[CS]E/i.test(p) && !/^README/i.test(p)).length
    },
    warnings,
    mcp
  }
}

/** MCP server: `.mcp.json` ở gốc plugin + `mcpServers` trong plugin.json (object, đường dẫn tới file JSON, hoặc mảng). */
function readMcp(inPlugin: string[], rel: (p: string) => Uint8Array, manifest: Record<string, unknown>, allowLocalHttp: boolean): InspectedMcp[] {
  const maps: Record<string, unknown>[] = []
  const fromFile = (path: string): void => {
    const p = posix.normalize(path.replace(/^\.\//, ''))
    if (p.startsWith('..') || !inPlugin.includes(p)) return
    try {
      const j = JSON.parse(asText(rel(p)) ?? '') as Record<string, unknown>
      maps.push((j.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : j) as Record<string, unknown>)
    } catch {
      /* file hỏng → bỏ */
    }
  }
  if (inPlugin.includes('.mcp.json')) fromFile('.mcp.json')
  const field = manifest.mcpServers
  for (const item of Array.isArray(field) ? field : [field]) {
    if (typeof item === 'string') fromFile(item)
    else if (item && typeof item === 'object') maps.push(item as Record<string, unknown>)
  }
  const out: InspectedMcp[] = []
  for (const m of maps)
    for (const [name, v] of Object.entries(m)) {
      if (out.length >= MAX_MCP || out.some((x) => x.name === name)) continue
      const parsed = parseMcpEntry(name, v, allowLocalHttp)
      if (parsed) out.push(parsed)
    }
  return out
}
