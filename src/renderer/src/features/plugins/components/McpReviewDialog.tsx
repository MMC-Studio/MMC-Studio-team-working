import { Globe, KeyRound, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { McpReviewResult, McpServerInfo } from '@shared/agents'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@renderer/components/ui/dialog'
import { api } from '@renderer/lib/api'
import { notifyChanged } from '@renderer/lib/sync'
import { useAgents } from '@renderer/features/agents/store'
import { PLUGINS_ROUTE } from '../model'

/**
 * Bật MCP server cài từ kho: app kết nối, hiện danh sách công cụ + mô tả (chính là chỉ dẫn trợ lý sẽ đọc) để người dùng
 * xem rồi mới bật. Bấm Bật lưu đúng danh sách vừa xem — sau này server đổi danh sách / mô tả thì tự tắt, phải xem lại.
 */
export function McpReviewDialog({ server, onClose }: { server: McpServerInfo; onClose(): void }) {
  const { t } = useTranslation('plugins')
  const navigate = useNavigate()
  const host = server.origin?.host ?? ''
  const [result, setResult] = useState<McpReviewResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    let alive = true
    void api.mcp.review(server.id).then(
      (r) => alive && setResult(r),
      (e: unknown) => alive && setResult({ status: 'error', error: 'network', detail: String(e) })
    )
    return () => {
      alive = false
    }
  }, [server.id])

  const confirm = async (): Promise<void> => {
    if (result?.status !== 'ok') return
    setBusy(true)
    const ok = await api.mcp.approveReview(result.token).catch(() => false)
    setBusy(false)
    if (!ok) return setExpired(true)
    notifyChanged(['mcpServers'])
    void useAgents.getState().refreshServers()
    onClose()
  }

  const review = server.origin?.review
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t('mcpReview.title', { name: server.name })} className="max-w-2xl" data-testid="mcp-review">
        <div className="thin-scroll max-h-[65vh] space-y-3 overflow-y-auto pr-1 text-sm">
          <p className="flex items-center gap-2">
            <Globe className="size-5 shrink-0" />
            <span className="text-lg font-semibold break-all" data-testid="mcp-review-host">
              {host}
            </span>
          </p>
          {review && (
            <p className={review === 'first' ? 'text-xs text-muted-foreground' : 'rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs'} data-testid="mcp-review-reason" data-review={review}>
              {t(`mcpReview.${review}`)}
            </p>
          )}
          {!result ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('mcpReview.loading', { host })}
            </p>
          ) : result.status === 'error' ? (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive" data-testid="mcp-review-error" data-error={result.error}>
              {t(`mcpReview.errors.${result.error}`, { detail: result.detail ?? '' })}
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{t('mcpReview.intro', { host })}</p>
              <ul className="space-y-2">
                {result.tools.map((tool) => (
                  <li key={tool.name} className="rounded-md border p-3" data-testid="mcp-review-tool" data-name={tool.name} data-changed={tool.changed}>
                    <p className="flex flex-wrap items-center gap-2">
                      <code className="font-semibold">{tool.name}</code>
                      {tool.changed && <span className="rounded bg-orange-500/15 px-1 text-xs">{t('mcpReview.changed')}</span>}
                    </p>
                    <p className="mt-1 text-xs whitespace-pre-wrap">{tool.description || t('mcpReview.noDescription')}</p>
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">{t('mcpReview.params')}</summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          )}
          {expired && (
            <p role="alert" className="text-destructive">
              {t('mcpReview.expired')}
            </p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">{t('common:actions.cancel')}</Button>
          </DialogClose>
          {result?.status === 'error' && result.error === 'needs_secret' && (
            <Button
              variant="outline"
              onClick={() => {
                onClose()
                void navigate(`${PLUGINS_ROUTE}/mcp?id=${server.id}&token=1`)
              }}
              data-testid="mcp-review-set-token"
            >
              <KeyRound />
              {t('mcpReview.setToken')}
            </Button>
          )}
          <Button disabled={result?.status !== 'ok' || busy || expired} onClick={() => void confirm()} data-testid="mcp-review-confirm">
            {busy && <Loader2 className="animate-spin" />}
            {t('mcpReview.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
