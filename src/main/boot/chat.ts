import { app } from 'electron'
import { IPC } from '@shared/ipc'
import { loadModeSkill, loadSkill } from '../ai/skills'
import { ChatService } from '../services/chatService'
import { combineToolSets } from '../tools/registry'
import { voiceSkillPrompt } from '../voice/service'
import type { Approvals } from './approvals'
import type { Commands } from './commands'
import type { Computer } from './computer'
import type { Connectors } from './connectors'
import type { Content } from './content'
import type { BootEnv, LateRefs } from './context'
import type { Core } from './core'
import type { Media } from './media'

export interface ChatDeps {
  core: Core
  approvals: Approvals
  computer: Computer
  connectors: Connectors
  media: Media
  content: Content
  commands: Commands
}

/** ChatService — lượt chat với trợ lý, nối mọi tool của app. */
export function createChat(env: BootEnv, deps: ChatDeps, late: LateRefs) {
  const { log, workspaceDir, getWindow } = env
  const { conversations, messages, sync, accountScope, projects } = deps.core
  const { mcpApprovals, mcpStore, approvals, folderAccess, approvalHub } = deps.approvals
  const { draftApprovals, gmail, telegram } = deps.connectors
  const { computer } = deps.computer
  const { expressive } = deps.media
  const { getProvider, memory, skillsDir, skillStore, organizer, artifactThemes, artifacts } = deps.content
  const { scheduleProposals, commandService, appRuns } = deps.commands

  const legacyTitles = organizer.fixLegacyTitles()
  if (legacyTitles) log.info(`Sửa ${legacyTitles} tiêu đề chat dạng lệnh tạo artifact`)
  const chat = new ChatService({
    onAutoTool: (conversationId, toolName) => mcpApprovals.recordAuto(conversationId, toolName),
    conversations,
    messages,
    getProvider,
    getAssistant: () => accountScope.getAssistant(),
    getMemoryContext: (query, conversationId) => memory.contextFor(query, conversationId),
    projectPromptFor: (conversationId) => projects.promptFor(conversationId),
    loadModeSkill: (mode) => loadModeSkill(skillsDir, mode),
    userSkillsFor: (text, opts) => skillStore.promptFor(text, opts),
    workspaceDir,
    emit: (payload) => getWindow()?.webContents.send(IPC.chatEvent, payload),
    log,
    onFirstMessage: (conversationId, text) => organizer.onFirstMessage(conversationId, text),
    onRunEnd: (conversationId) => {
      // Thứ tự (cập nhật lúc trả lời xong) trên thanh bên.
      sync.changed('conversations')
      void organizer.afterRun(conversationId).catch((e: unknown) => log.warn(`Đặt tiêu đề tự động lỗi: ${String(e)}`))
      approvals.cancelConversation(conversationId)
      mcpApprovals.cancelConversation(conversationId)
      mcpStore.endRun(conversationId)
      draftApprovals.cancelConversation(conversationId)
      folderAccess.cancelConversation(conversationId)
      scheduleProposals.cancelConversation(conversationId)
      commandService.cancelConversation(conversationId)
      appRuns.cancelConversation(conversationId)
      approvalHub.endRun(conversationId)
    },
    appToolsFor: (conversationId) =>
      combineToolSets([
        folderAccess.toolsFor(conversationId),
        computer.toolsFor(),
        gmail.toolsFor(),
        telegram.toolsFor(),
        scheduleProposals.toolsFor(),
        commandService.toolsFor(conversationId),
        appRuns.toolsFor(conversationId)
      ]),
    expressive,
    voicePrompt: async (tease) => {
      const skill = await loadSkill(skillsDir, 'voice')
      return skill ? voiceSkillPrompt(skill, tease) : ''
    },
    artifacts: {
      prompt: async () => {
        const skill = await loadSkill(skillsDir, 'artifacts')
        return skill ? `## Artifact\n${skill}\nTheme slide có sẵn: ${artifactThemes().map((t) => t.id).join(', ')}.` : ''
      },
      contextFor: (id) => artifacts.contextFor(id),
      applyReply: (id, raw) => artifacts.applyReply(id, raw)
    }
  })
  late.chat = chat
  app.on('before-quit', () => chat.abortAll())

  return { chat }
}

export type Chat = ReturnType<typeof createChat>

