import { create } from 'zustand'
import type { SkillInfo } from '@shared/skills'
import { api } from '@renderer/lib/api'
import { coalesce, onSync, optimistic } from '@renderer/lib/sync'
import { useAgents } from '@renderer/features/agents/store'
import { useConnectors } from '@renderer/features/connectors/store'
import type { PluginItem } from './model'

type SkillsState = {
  skills: SkillInfo[] | null
  refresh(): Promise<void>
}

/** Danh sách skill (người dùng + có sẵn) cho trang Plugin. Tự tải lại khi main báo `skills`. */
export const useSkills = create<SkillsState>((set) => {
  const load = coalesce(async () => set({ skills: await api.skills.list() }))
  return { skills: null, refresh: () => load() }
})

export function setupPlugins(): () => void {
  return onSync('skills', () => void useSkills.getState().refresh())
}

/**
 * Bật / tắt một mục — gọi đúng IPC mà công tắc cũ gọi, hiện ngay + lỗi thì hoàn tác (`optimistic`).
 * Hộp cảnh báo trước khi bật (Gmail / Telegram / Kết nối agent) nằm ở PluginMenu; hàm này chỉ lưu.
 */
export async function setPluginEnabled(item: PluginItem, on: boolean): Promise<boolean> {
  switch (item.type) {
    case 'gmail':
      return useConnectors.getState().patchGmail((s) => ({ ...s, enabled: on }), () => api.gmail.setEnabled(on))
    case 'telegram':
      return useConnectors.getState().patchTelegram((s) => ({ ...s, enabled: on }), () => api.telegram.setEnabled(on))
    case 'agents':
      return useAgents.getState().patchStatus((s) => ({ ...s, enabled: on }), () => api.agents.setEnabled(on))
    case 'mcp': {
      const id = item.key.slice('mcp:'.length)
      return useAgents.getState().patchServers(
        (list) => list.map((x) => (x.id === id ? { ...x, enabled: on } : x)),
        () => api.mcp.setEnabled(id, on)
      )
    }
    case 'skill':
    case 'storeSkill': {
      const source = item.type === 'skill' ? 'user' : 'plugin'
      const before = useSkills.getState().skills
      const result = await optimistic({
        topic: 'skills',
        apply: () =>
          useSkills.setState({ skills: before?.map((x) => (x.source === source && x.name === item.name ? { ...x, enabled: on } : x)) ?? null }),
        rollback: () => useSkills.setState({ skills: before }),
        save: async () => (await api.skills.setEnabled(item.name, on), true)
      })
      return result !== null
    }
    default:
      return false
  }
}

/** Gỡ một mục (đã qua hộp xác nhận): skill → xoá, MCP server → xoá. */
export async function removePlugin(item: PluginItem): Promise<boolean> {
  switch (item.type) {
    case 'mcp': {
      const id = item.key.slice('mcp:'.length)
      return useAgents.getState().patchServers((list) => list.filter((x) => x.id !== id), () => api.mcp.remove(id))
    }
    case 'skill': {
      const before = useSkills.getState().skills
      const result = await optimistic({
        topic: 'skills',
        apply: () => useSkills.setState({ skills: before?.filter((x) => !(x.source === 'user' && x.name === item.name)) ?? null }),
        rollback: () => useSkills.setState({ skills: before }),
        save: async () => (await api.skills.remove(item.name), true)
      })
      return result !== null
    }
    default:
      return false
  }
}
