import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { REPO_RE, installInputSchema, pluginKeySchema, sourceInputSchema } from '@shared/pluginStore'
import type { PluginStoreService } from '../pluginStore/service'
import type { HandleFn, HandleOptions } from './register'

export type PluginStoreIpcDeps = { handle: HandleFn; service: PluginStoreService }

const tokenSchema = z.uuid()
const P: HandleOptions = { changes: 'pluginStore' }
// Cài / gỡ còn đổi MCP server của plugin (8b).
const PS: HandleOptions = { changes: ['pluginStore', 'skills', 'mcpServers'] }

/** Kho plugin online (8a): nguồn, danh mục, xem trước → cài theo SHA, cập nhật, gỡ. */
export function registerPluginStoreIpc({ handle, service }: PluginStoreIpcDeps): void {
  handle(IPC.pluginStoreSources, z.undefined(), () => service.sources())
  handle(IPC.pluginStoreAddSource, sourceInputSchema, (input) => service.addSource(input), P)
  handle(IPC.pluginStoreRemoveSource, z.string().regex(REPO_RE), (repo) => service.removeSource(repo), P)
  handle(IPC.pluginStoreCatalog, z.boolean().optional(), (force) => service.catalog(!!force))
  handle(IPC.pluginStorePreview, pluginKeySchema, (key) => service.preview(key))
  handle(IPC.pluginStoreCancelPreview, tokenSchema, (token) => service.cancelPreview(token))
  handle(IPC.pluginStoreInstall, installInputSchema, ({ token, mcp }) => service.install(token, mcp), PS)
  handle(IPC.pluginStoreUninstall, pluginKeySchema, (key) => service.uninstall(key), PS)
  handle(IPC.pluginStoreInstalled, z.undefined(), () => {
    // Mở trang Plugin → kiểm lại hash (người dùng có thể vừa sửa file ngoài app).
    service.recheck()
    return service.installed()
  })
  handle(IPC.pluginStoreCheckUpdates, z.undefined(), () => service.checkUpdates(), P)
}
