import { Globe, KeyRound, Plus, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { McpServerInfo, McpServerType } from '@shared/agents'
import { Button } from '@renderer/components/ui/button'
import { Input, Label, Select, Textarea } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import { useSync } from '@renderer/lib/sync'
import { parsePairs, useAgents } from '../store'

const EMPTY = { name: '', type: 'stdio' as McpServerType, command: '', args: '', url: '', secrets: '' }

/** "Thêm thủ công…" từ kho plugin (lệnh khoá phiên bản): điền sẵn form, lưu ở trạng thái TẮT. */
export type McpPrefill = { name: string; argv: string[] }

const prefillForm = (p: McpPrefill): typeof EMPTY => ({
  ...EMPTY,
  name: p.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 32),
  command: p.argv[0] ?? '',
  args: p.argv.slice(1).join('\n')
})

/** MCP server người dùng thêm — Mizuki dùng như tool, mỗi lần gọi phải duyệt (trừ tool "luôn cho phép"). */
/**
 * `renderMenu`: menu ⋯ của trang Plugin cho từng server — bật / tắt và gỡ chỉ ở đó (một mục một chỗ).
 */
export function McpServersSection({
  startAdding = false,
  highlight,
  openToken = false,
  prefill,
  renderMenu
}: {
  startAdding?: boolean
  highlight?: string
  /** Mở sẵn form nhập token của server `highlight` (từ hộp "Bật" khi thiếu token). */
  openToken?: boolean
  prefill?: McpPrefill
  renderMenu?(server: McpServerInfo): ReactNode
}) {
  const { t } = useTranslation('agents')
  const { servers, refreshServers } = useAgents()
  const [form, setForm] = useState(prefill ? prefillForm(prefill) : EMPTY)
  const [adding, setAdding] = useState(startAdding || !!prefill)
  const [tokenFor, setTokenFor] = useState<string | null>(openToken && highlight ? highlight : null)
  const [error, setError] = useState<string | null>(null)

  // Danh sách đổi cả khi duyệt tool "luôn cho phép" ở trang Chat → tự hỏi lại khi main báo.
  useSync('mcpServers', refreshServers)

  const save = async (): Promise<void> => {
    setError(null)
    // Thêm thủ công từ kho → lưu TẮT (người dùng tự bật sau khi xem lại).
    const base = { name: form.name.trim(), enabled: !prefill }
    const input =
      form.type === 'stdio'
        ? { ...base, type: 'stdio' as const, command: form.command.trim(), args: form.args.split(/\r?\n/).map((a) => a.trim()).filter(Boolean), env: parsePairs(form.secrets, '='), headers: {} }
        : { ...base, type: 'http' as const, url: form.url.trim(), headers: parsePairs(form.secrets, ':'), env: {} }
    const r = await api.mcp.save(input).catch((err: Error) => ({ error: err.message }))
    if ('error' in r) return setError(r.error)
    setForm(EMPTY)
    setAdding(false)
    await refreshServers()
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-5" data-testid="mcp-servers">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t('mcp.heading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('mcp.help')}</p>
        </div>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} data-testid="mcp-add">
            <Plus />
            {t('mcp.add')}
          </Button>
        )}
      </div>

      {servers.length === 0 && !adding && <p className="text-sm text-muted-foreground">{t('mcp.empty')}</p>}
      {servers.length > 0 && (
        <ul className="divide-y rounded-md border text-sm">
          {servers.map((s) => (
            <li
              key={s.id}
              id={`mcp-${s.id}`}
              className={cn('space-y-1.5 px-3 py-2', highlight === s.id && 'setting-flash')}
              data-testid="mcp-server"
            >
              <div className="flex flex-wrap items-center gap-3">
                {/* Bật / tắt server ở menu ⋯ của trang Plugin. */}
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground" data-testid="mcp-server-state">
                  {s.enabled ? t('mcp.on') : t('mcp.off')}
                </span>
                {s.origin ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Globe className="size-3.5 shrink-0" />
                    <span className="truncate font-semibold" data-testid="mcp-store-host">
                      {s.origin.host}
                    </span>
                    <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">{t('mcp.store.badge', { plugin: s.origin.pluginName })}</span>
                  </span>
                ) : (
                  <code className="min-w-0 truncate text-xs text-muted-foreground">{s.type === 'stdio' ? [s.command, ...s.args].join(' ') : s.url}</code>
                )}
                {s.secretKeys.length > 0 && <span className="text-xs text-muted-foreground">{t('mcp.secretKeys', { keys: s.secretKeys.join(', ') })}</span>}
                <span className="ml-auto flex items-center gap-1">
                  {s.origin && s.origin.headers.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setTokenFor(tokenFor === s.id ? null : s.id)} data-testid="mcp-store-token">
                      <KeyRound />
                      {t('mcp.store.setToken')}
                    </Button>
                  )}
                  {renderMenu?.(s)}
                </span>
              </div>
              {s.origin && (
                <p className="text-xs text-muted-foreground" data-testid="mcp-store-state" data-review={s.origin.review ?? ''}>
                  {s.origin.review
                    ? <span className={s.origin.review === 'first' ? '' : 'font-medium text-orange-700 dark:text-orange-300'}>{t(`mcp.store.review.${s.origin.review}`)}</span>
                    : t('mcp.store.approved', { count: s.origin.approvedTools ?? 0 })}
                </p>
              )}
              {s.origin && tokenFor === s.id && <StoreTokenForm server={s} onDone={() => (setTokenFor(null), void refreshServers())} />}
              {s.alwaysAllow.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">{t('mcp.alwaysAllowed')}</span>
                  {s.alwaysAllow.map((tool) => (
                    <span key={tool} className="inline-flex items-center gap-1 rounded border bg-muted/60 px-1.5 py-0.5" data-testid="mcp-always-allowed">
                      {tool}
                      <button
                        type="button"
                        aria-label={t('mcp.revokeTool', { tool })}
                        onClick={async () => {
                          await api.mcp.revokeAlways(s.id, tool)
                          await refreshServers()
                        }}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="space-y-3 rounded-md border p-3" data-testid="mcp-form">
          {prefill && (
            <p className="rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs" data-testid="mcp-prefill-hint">
              {t('mcp.prefillHint')}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <Label htmlFor="mcp-name">{t('mcp.name')}</Label>
              <Input id="mcp-name" placeholder="notion" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mcp-type">{t('mcp.type')}</Label>
              <Select id="mcp-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as McpServerType })}>
                <option value="stdio">{t('mcp.types.stdio')}</option>
                <option value="http">{t('mcp.types.http')}</option>
              </Select>
            </div>
          </div>
          {form.type === 'stdio' ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="mcp-command">{t('mcp.command')}</Label>
                <Input id="mcp-command" placeholder="npx" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mcp-args">{t('mcp.args')}</Label>
                <Textarea id="mcp-args" rows={3} value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} />
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="mcp-url">URL</Label>
              <Input id="mcp-url" placeholder="https://…/mcp" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="mcp-secrets">{form.type === 'stdio' ? t('mcp.env') : t('mcp.headers')}</Label>
            <Textarea id="mcp-secrets" rows={2} value={form.secrets} placeholder={form.type === 'stdio' ? 'API_KEY=…' : 'Authorization: Bearer …'} onChange={(e) => setForm({ ...form, secrets: e.target.value })} />
            <p className="text-xs text-muted-foreground">{t('mcp.secretsHelp')}</p>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {t(`mcp.errors.${error}`, { defaultValue: error })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => (setAdding(false), setForm(EMPTY), setError(null))}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={() => void save()} disabled={!form.name.trim()} data-testid="mcp-save">
              {t('common:actions.save')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Header bí mật cho server từ kho (vd token GitHub) — chỉ các khoá plugin khai báo; app tự gắn khi gửi tới đúng tên miền,
 * trợ lý không thấy. Server GitHub: gợi ý tạo token fine-grained chỉ đọc.
 */
function StoreTokenForm({ server, onDone }: { server: McpServerInfo; onDone(): void }) {
  const { t } = useTranslation('agents')
  const origin = server.origin!
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  // Server GitHub (theo tên miền, hoặc mẫu header nhắc tới GITHUB_…) → gợi ý token fine-grained chỉ đọc.
  const github = /(^|\.)github(copilot)?\.com$/.test(origin.host.split(':')[0]) || origin.headers.some((h) => /github/i.test(h.template))
  const save = async (): Promise<void> => {
    setError(null)
    const r = await api.mcp.setStoreHeaders(server.id, values).catch((e: Error) => ({ error: e.message }))
    if ('error' in r) return setError(r.error)
    onDone()
  }
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3" data-testid="mcp-store-token-form">
      <p className="text-xs">{t('mcp.store.tokenHelp', { host: origin.host })}</p>
      {github && (
        <p className="rounded border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs" data-testid="mcp-github-hint">
          {t('mcp.store.githubHint')}
        </p>
      )}
      {origin.headers.map((h) => (
        <div key={h.key} className="space-y-1">
          <Label htmlFor={`mcp-h-${h.key}`}>{h.key}</Label>
          <Input
            id={`mcp-h-${h.key}`}
            type="password"
            autoComplete="off"
            placeholder={server.secretKeys.includes(h.key) ? '••••••' : h.template}
            value={values[h.key] ?? ''}
            onChange={(e) => setValues({ ...values, [h.key]: e.target.value })}
            data-testid="mcp-store-header"
          />
          <p className="text-xs text-muted-foreground">{t('mcp.store.template', { template: h.template })}</p>
        </div>
      ))}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {t(`mcp.errors.${error}`, { defaultValue: error })}
        </p>
      )}
      <div className="flex justify-end">
        <Button size="sm" onClick={() => void save()} data-testid="mcp-store-token-save">
          {t('common:actions.save')}
        </Button>
      </div>
    </div>
  )
}
