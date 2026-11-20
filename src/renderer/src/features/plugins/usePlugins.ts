import { useCallback, useMemo } from 'react'
import { useSync } from '@renderer/lib/sync'
import { useAgents } from '@renderer/features/agents/store'
import { useConnectors } from '@renderer/features/connectors/store'
import { buildPlugins, type PluginGroups } from './model'
import { useSkills } from './store'

/**
 * Các nhóm plugin từ store của từng phần (skill, Gmail / Telegram, kết nối agent, MCP). Hỏi lại main khi mở trang,
 * khi quay lại cửa sổ và khi main báo đổi — đổi ở bất kỳ đâu (vd duyệt "luôn cho phép" trong chat) đều hiện ngay.
 */
export function usePlugins(): PluginGroups & { loaded: boolean } {
  const skills = useSkills((s) => s.skills)
  const gmail = useConnectors((s) => s.gmail)
  const telegram = useConnectors((s) => s.telegram)
  const agents = useAgents((s) => s.status)
  const mcp = useAgents((s) => s.servers)

  const refresh = useCallback(async () => {
    await Promise.all([
      useSkills.getState().refresh(),
      useConnectors.getState().refresh(),
      useAgents.getState().refreshStatus(),
      useAgents.getState().refreshServers()
    ])
  }, [])
  useSync(['skills', 'gmail', 'telegram', 'agents', 'mcpServers'], refresh)

  return useMemo(
    () => ({ ...buildPlugins({ skills, gmail, telegram, agents, mcp }), loaded: !!skills && !!gmail && !!telegram && !!agents }),
    [skills, gmail, telegram, agents, mcp]
  )
}
