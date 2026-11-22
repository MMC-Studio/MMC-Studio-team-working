import type { TFunction } from 'i18next'
import type { PluginItem } from './model'

/** Tên hiển thị (Kết nối agent lấy từ i18n; còn lại là tên riêng / tên skill). */
export function pluginName(item: PluginItem, t: TFunction): string {
  return item.type === 'agents' ? t('plugins:names.agents') : item.name
}

/** Mô tả một dòng: skill dùng description của SKILL.md; kết nối dùng câu mô tả trong i18n. */
export function pluginDescription(item: PluginItem, t: TFunction): string {
  if (item.type === 'gmail' || item.type === 'telegram' || item.type === 'agents') return t(`plugins:describe.${item.type}`)
  return item.description
}

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/** Dòng phụ "loại · nguồn" như ảnh mẫu (vd "Kết nối · 2 tài khoản", "Skill · cài từ unity.zip"). */
export function pluginSubtitle(item: PluginItem, t: TFunction): string {
  const kind = item.type === 'mcp' ? t('plugins:kind.mcp') : t(`plugins:kind.${item.kind}`)
  let source = ''
  switch (item.type) {
    case 'gmail':
      source = item.meta.accounts ? t('plugins:meta.accounts', { count: item.meta.accounts }) : t('plugins:meta.noAccounts')
      break
    case 'telegram':
      source = item.meta.connected ? t('plugins:meta.telegramConnected') : t('plugins:meta.telegramDisconnected')
      break
    case 'agents':
      source = item.meta.clients ? t('plugins:meta.clients', { count: item.meta.clients }) : t('plugins:meta.noClients')
      break
    case 'mcp':
      source = item.meta.source ?? ''
      break
    case 'skill':
      source = item.meta.source ? t('plugins:meta.installedFrom', { source: basename(item.meta.source) }) : ''
      break
    case 'builtinSkill':
      source = t('plugins:meta.builtin')
      break
    case 'storeSkill':
      source = t('plugins:meta.fromStore', { source: (item.meta.source ?? '').replace(/^kho:/, '') })
      break
  }
  return source ? `${kind} · ${source}` : kind
}

/** Chữ để ô tìm so khớp (tên + mô tả + dòng phụ). */
export function pluginSearchText(item: PluginItem, t: TFunction): string {
  return `${pluginName(item, t)} ${pluginDescription(item, t)} ${pluginSubtitle(item, t)}`
}
