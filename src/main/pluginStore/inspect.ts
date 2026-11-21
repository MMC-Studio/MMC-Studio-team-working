import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { unzipSync } from 'fflate'
import { SKILL_NAME_RE } from '@shared/skills'
import type { PreviewSkill, PreviewWarning } from '@shared/pluginStore'
import { parseSkillMd } from '../skills/format'
import { asText, LIMITS } from '../skills/package'

/** Chỉ giữ file chữ (giống skill tự cài). Script, hook, nhị phân: bỏ — app KHÔNG BAO GIỜ chạy gì kèm skill. */
const TEXT_EXT = new Set(['.md', '.txt', '.json'])
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

export type InspectedPlugin = {
  skills: InspectedSkill[]
  license: string | null
  ignored: { hooks: boolean; commands: number; agents: number; mcp: boolean; otherFiles: number }
  warnings: PreviewWarning[]
}

export class InspectError extends Error {
  constructor(readonly code: 'bad_archive' | 'too_large' | 'no_skills') {
    super(code)
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
export function inspectArchive(zip: Uint8Array, pluginPath: string, fallbackLicense: string | null): InspectedPlugin {
  const files = new Map<string, Uint8Array>()
  let top: string | null = null
  let total = 0
  let count = 0
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
        if (++count > LIMITS.files * 10) throw new InspectError('too_large')
        // File quá lớn: không giải nén, chỉ ghi tên để báo bỏ qua.
        if (f.originalSize > LIMITS.fileBytes) {
          files.set(rel, new Uint8Array(0))
          return false
        }
        total += f.originalSize
        if (total > LIMITS.totalBytes * 10) throw new InspectError('too_large')
        return true
      }
    })
  } catch (e) {
    if (e instanceof InspectError) throw e
    throw new InspectError('bad_archive')
  }
  for (const [name, bytes] of Object.entries(entries)) {
    if (bytes.byteLength > LIMITS.fileBytes) continue
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
  if (skillDirs.length === 0) throw new InspectError('no_skills')

  const warnings: PreviewWarning[] = []
  const skills: InspectedSkill[] = []
  for (const dir of skillDirs.sort()) {
    const inDir = inPlugin.filter((p) => p.startsWith(dir)).map((p) => p.slice(dir.length))
    const contents = new Map<string, Uint8Array>()
    const skipped: string[] = []
    let size = 0
    for (const p of inDir.sort()) {
      const bytes = rel(dir + p)
      const text = TEXT_EXT.has(posix.extname(p).toLowerCase()) && bytes.byteLength > 0 ? asText(bytes) : null
      if (text === null || contents.size >= LIMITS.files || size + bytes.byteLength > LIMITS.totalBytes) {
        skipped.push(p)
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
    const skippedSet = new Set(skipped)
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
  if (skills.length === 0) throw new InspectError('no_skills')

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
    warnings
  }
}
