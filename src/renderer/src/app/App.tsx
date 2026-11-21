import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { HashRouter, Route, Routes, useNavigate } from 'react-router'
import { useChat } from '@renderer/features/chat/store'
import { useDrafts } from '@renderer/features/chat/drafts'
import { useMemory } from '@renderer/features/memory/store'
import { useProjects } from '@renderer/features/projects/store'
import type { FeatureDefinition } from '@renderer/features/types'
import { api } from '@renderer/lib/api'
import { syncAssistant } from '@renderer/stores/assistantSync'
import { useAuth } from '@renderer/stores/auth'
import { useCliStatus } from '@renderer/stores/cli'
import { usePreferences } from '@renderer/stores/preferences'
import { useTeam } from '@renderer/stores/team'
import { AppShell } from './AppShell'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } }
})

function NotFound() {
  const { t } = useTranslation()
  return <p className="p-8 text-muted-foreground">{t('errors.notFound')}</p>
}

/** Lần đầu mở app: kiểm tra Claude CLI, chưa sẵn sàng thì đưa tới màn hình hướng dẫn. */
function CliGate() {
  const navigate = useNavigate()
  const check = useCliStatus((s) => s.check)
  // `navigate` đổi tham chiếu mỗi lần đổi trang (HashRouter) — chỉ chuyển hướng một lần lúc mở app,
  // không thì người chưa cài CLI bị kéo về /claude mỗi khi bấm menu.
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    void check().then((status) => {
      if (status.state !== 'ok') void navigate('/claude')
    })
  }, [check, navigate])
  return null
}

/** Bấm thông báo Windows → main gửi route → chuyển trang. */
function NavigateFromMain() {
  const navigate = useNavigate()
  useEffect(() => api.app.onNavigate((route) => void navigate(route)), [navigate])
  return null
}

/**
 * Nháp tin nhắn của tài khoản (sau khi main đã đổi phạm vi): bỏ nháp của cuộc không còn, khôi phục khung
 * "Đang trả lời…" của từng cuộc.
 */
async function loadDrafts(uid: string | null): Promise<void> {
  const list = await api.conversations.list()
  useDrafts.getState().load(uid ?? 'local', new Set(list.map((c) => c.id)))
  const replyTo = Object.fromEntries(
    Object.entries(useDrafts.getState().drafts).flatMap(([key, d]) => (d.reply ? [[key, d.reply] as const] : []))
  )
  useChat.setState({ replyTo })
}

/** Đăng nhập/đăng xuất → tải hoặc dọn dữ liệu team. */
function useAuthLifecycle(): void {
  useEffect(() => {
    const stopAuth = useAuth.getState().init()
    // undefined = chưa báo main lần nào: lần đầu biết trạng thái đăng nhập (kể cả chưa đăng nhập / không có Supabase)
    // cũng phải báo, vì lịch hẹn chỉ chạy khi main biết chắc dữ liệu là của ai.
    let lastUid: string | null | undefined = undefined
    const apply = (s: ReturnType<typeof useAuth.getState>): void => {
      if (s.status === 'loading') return
      const uid = s.session?.user.id ?? null
      if (uid === lastUid) return
      const first = lastUid === undefined
      lastUid = uid
      if (first && uid === null) {
        // Mở app khi chưa đăng nhập: dữ liệu đã là của "trên máy" — chỉ báo main, không tải lại gì.
        void api.account.set(null).then(() => loadDrafts(null))
        return
      }
      queryClient.clear()
      if (uid) void useTeam.getState().load()
      else useTeam.getState().reset()
      // Dữ liệu cá nhân (trí nhớ, hồ sơ, chat, trợ lý) đổi theo tài khoản: main đổi phạm vi TRƯỚC rồi mới tải lại.
      void (async () => {
        await useMemory.getState().switchAccount(uid)
        await Promise.all([
          usePreferences.getState().reloadAssistant(),
          useChat.getState().switchAccount(),
          useProjects.getState().reload()
        ])
        await loadDrafts(uid)
        if (uid) await syncAssistant(uid)
      })()
    }
    const unsubscribe = useAuth.subscribe(apply)
    apply(useAuth.getState())
    return () => {
      unsubscribe()
      stopAuth()
    }
  }, [])
}

export function App({ features }: { features: FeatureDefinition[] }) {
  const loaded = usePreferences((s) => s.loaded)
  const load = usePreferences((s) => s.load)
  useAuthLifecycle()

  useEffect(() => {
    void load()
    const cleanups = features.flatMap((f) => (f.setup ? [f.setup()] : []))
    return () => cleanups.forEach((fn) => fn())
  }, [features, load])

  if (!loaded) return null

  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <CliGate />
        <NavigateFromMain />
        <Routes>
          <Route element={<AppShell features={features} />}>
            {features.map((f) => (
              <Route key={f.id} path={f.route} element={<f.component />} />
            ))}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  )
}
