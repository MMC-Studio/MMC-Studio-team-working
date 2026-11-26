import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, net, protocol } from 'electron'
import { BUILTIN_THEMES, themeSchema, type Theme } from '@shared/artifacts'
import { IPC } from '@shared/ipc'
import {
  DEFAULT_AI_SETTINGS,
  aiSettingsSchema,
  type AiProviderId,
  chatOrganizeSettingsSchema,
  DEFAULT_CHAT_ORGANIZE_SETTINGS
} from '@shared/schemas'
import { DEFAULT_SKILLS_SETTINGS, skillsSettingsSchema } from '@shared/skills'
import type { AIProvider } from '../ai/AIProvider'
import { AnthropicApiProvider } from '../ai/AnthropicApiProvider'
import { ClaudeCliProvider } from '../ai/ClaudeCliProvider'
import { FakeChatProvider } from '../ai/FakeChatProvider'
import { loadSkill } from '../ai/skills'
import { ARTIFACT_SCHEME, handleArtifactRequest } from '../artifacts/protocol'
import { ArtifactService } from '../artifacts/service'
import { ConversationOrganizer } from '../chat/organizer'
import { probeAuth } from '../mcpClient/review'
import { MemoryService } from '../memory/memoryService'
import { GitHubClient } from '../pluginStore/github'
import { installedSchema, loadDefaultSources, PluginStoreService, userSourcesSchema } from '../pluginStore/service'
import { SkillStore } from '../skills/store'
import type { Approvals } from './approvals'
import { devOverride, resourcePath, type BootEnv, type LateRefs } from './context'
import type { Core } from './core'

/** Artifact, provider AI, skill, kho plugin, trí nhớ, sắp xếp cuộc trò chuyện. */
export function createContent(env: BootEnv, core: Core, approvalsPart: Approvals, late: LateRefs) {
  const { log, userData, workspaceDir, getWindow } = env
  const { db, getOwner, conversations, conversationGroups, projectRepo, messages, memories, suggestions, settings, sync, secrets } =
    core
  const {
    mcpStore,
    mcpApprovals,
    mcpFetch,
    mcpProxy,
    approvals,
    permissionScript,
    tools,
    toolBridge,
    appToolsScript
  } = approvalsPart

  // Artifact: lưu theo hội thoại; theme slide = có sẵn + file JSON người dùng thêm + theme của skill đang bật.
  const artifacts = new ArtifactService({
    db,
    ownsConversation: (id) => !!conversations.get(id),
    ownedConversations: () => conversations.list().map((c) => ({ id: c.id, title: c.title })),
    onChange: () => sync.changed('artifacts')
  })
  const themesDir = join(userData, 'artifact-themes')
  const artifactThemes = (): Theme[] => {
    const extra: Theme[] = []
    for (const f of existsSync(themesDir) ? readdirSync(themesDir) : []) {
      if (!f.endsWith('.json')) continue
      try {
        extra.push(themeSchema.parse(JSON.parse(readFileSync(join(themesDir, f), 'utf8'))))
      } catch (err) {
        log.warn(`Theme artifact ${f} không hợp lệ: ${(err as Error).message}`)
      }
    }
    // Theme từ skill người dùng đang bật (themes/*.json trong thư mục skill).
    extra.push(...skillStore.themesSync())
    return [...extra.filter((t) => !BUILTIN_THEMES.some((b) => b.id === t.id)), ...BUILTIN_THEMES]
  }
  const artifactLibDir = resourcePath('artifact-runtime', 'out/artifact-runtime')
  protocol.handle(ARTIFACT_SCHEME, (req) => handleArtifactRequest(req.url, { service: artifacts, libDir: artifactLibDir, themes: artifactThemes }))

  // Claude giả chỉ cho test e2e ở bản chưa đóng gói.
  const fakeChat =
    !app.isPackaged && process.env.MMC_FAKE_CHAT === '1' ? new FakeChatProvider(
          (name, input, conversationId) => tools.call(name, input, { conversationId }),
          (conversationId, toolName, input) => approvals.decide(conversationId, toolName, input),
          process.env.MMC_FAKE_CLI_SESSIONS === '1',
          (conversationId) => mcpStore.forCli((id) => mcpProxy.endpoint(id), conversationId)
        )
      : null

  const providers: Record<AiProviderId, AIProvider> = {
    'claude-cli': new ClaudeCliProvider(
      log,
      () => ({
        electronPath: process.execPath,
        script: permissionScript,
        url: approvals.url,
        token: approvals.token
      }),
      () => ({
        electronPath: process.execPath,
        script: appToolsScript,
        url: toolBridge.url,
        token: toolBridge.token
      }),
      (conversationId) => mcpStore.forCli((id) => mcpProxy.endpoint(id), conversationId)
    ),
    'anthropic-api': new AnthropicApiProvider(() => secrets.get())
  }
  const getProvider = (): AIProvider =>
    fakeChat ?? providers[settings.get('ai', aiSettingsSchema, DEFAULT_AI_SETTINGS).provider]
  late.getProvider = getProvider

  const skillsDir = resourcePath('assistant-skills', 'assistant-skills')
  const skillStore = new SkillStore({
    builtinDir: skillsDir,
    userDir: join(app.getPath('userData'), 'skills'),
    getSettings: () => settings.get('skills', skillsSettingsSchema, DEFAULT_SKILLS_SETTINGS),
    setSettings: (value) => settings.set('skills', value),
    log,
    pluginSkills: () => pluginStore.skillFiles()
  })
  // Kho plugin online (8a): GitHub KHÔNG token; chỉ skill bằng chữ, cài theo commit SHA. Máy chủ GitHub giả chỉ cho
  /** Gỡ / đổi URL MCP server từ kho: huỷ thẻ duyệt đang chờ của server, dừng lượt chat đang nạp server đó. */
  const stopStoreServer = (id: string, name: string): void => {
    mcpApprovals.cancelServer(name)
    for (const c of mcpStore.conversationsUsing(id)) late.chat.abortConversation(c)
  }
  // e2e ở bản chưa đóng gói (MMC_FAKE_GITHUB = địa chỉ máy chủ giả).
  const fakeGithub = devOverride('MMC_FAKE_GITHUB')
  const pluginStore = new PluginStoreService({
    github: new GitHubClient(
      (url, init) => net.fetch(url, init),
      Date.now,
      fakeGithub ? { api: `${fakeGithub}/api`, raw: `${fakeGithub}/raw`, codeload: `${fakeGithub}/codeload` } : undefined
    ),
    dir: join(userData, 'plugins'),
    defaultSources: fakeGithub && process.env.MMC_FAKE_PLUGIN_SOURCES
      ? loadDefaultSources(process.env.MMC_FAKE_PLUGIN_SOURCES)
      : loadDefaultSources(resourcePath('plugin-sources.json', 'resources/plugin-sources.json')),
    getUserSources: () => settings.get('pluginSources', userSourcesSchema, []),
    setUserSources: (list) => void settings.set('pluginSources', list),
    getInstalled: () => settings.get('pluginsInstalled', installedSchema, []),
    setInstalled: (list) => void settings.set('pluginsInstalled', list),
    takenSkillNames: () => skillStore.takenNames(),
    forgetSkills: (names) => skillStore.forget(names),
    mcp: {
      forPlugin: (key) => mcpStore.forPlugin(key),
      syncPlugin: (plugin, decls) => {
        const before = mcpStore.forPlugin(plugin.key)
        const dropped = before.filter((s) => !decls.some((d) => d.server === s.server))
        const moved = before.filter((s) => decls.some((d) => d.server === s.server && (d.url !== s.url || d.host !== s.host)))
        for (const s of [...dropped, ...moved]) stopStoreServer(s.id, s.name)
        const names = mcpStore.syncPlugin(plugin, decls)
        sync.changed('mcpServers')
        return names
      },
      removePlugin: (key) => {
        for (const s of mcpStore.forPlugin(key)) stopStoreServer(s.id, s.name)
        mcpStore.removePlugin(key)
        sync.changed('mcpServers')
      }
    },
    probe: (url) => probeAuth(mcpFetch, url),
    allowLocalHttp: devOverride('MMC_FAKE_MCP_LOCAL') === '1',
    changed: () => sync.changed('pluginStore', 'skills'),
    now: Date.now,
    log
  })
  const memory = new MemoryService({
    conversations,
    messages,
    memories,
    suggestions,
    settings,
    getProvider,
    loadSkill: (name) => loadSkill(skillsDir, name),
    workspaceDir,
    emit: (payload) => getWindow()?.webContents.send(IPC.memoryEvent, payload),
    log,
    getOwner,
    getProject: (id) => projectRepo.get(id)
  })
  // Tiêu đề ngắn + gợi ý nhóm cho cuộc trò chuyện mới (từ khoá ngay; model rẻ sau lượt trả lời đầu).
  const organizer = new ConversationOrganizer({
    conversations,
    groups: conversationGroups,
    messages,
    getProvider,
    getSettings: () => settings.get('chatOrganize', chatOrganizeSettingsSchema, DEFAULT_CHAT_ORGANIZE_SETTINGS),
    workspaceDir,
    log,
    changed: () => sync.changed('conversations')
  })

  return { artifacts, artifactThemes, fakeChat, getProvider, skillsDir, skillStore, pluginStore, memory, organizer }
}

export type Content = ReturnType<typeof createContent>
