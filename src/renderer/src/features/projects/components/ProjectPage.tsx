import { AlertTriangle, Brain, ChevronRight, Clock, CodeXml, FileText, Files, MessageCircle, NotebookPen, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import type { ChatMode } from '@shared/ai'
import { PROJECT_PROMPT_CHARS, type ProjectAddFilesResult, type ProjectDetail, type ProjectFile } from '@shared/projects'
import { api } from '@renderer/lib/api'
import { optimistic, useSyncedState } from '@renderer/lib/sync'
import { cn } from '@renderer/lib/utils'
import { useCliStatus } from '@renderer/stores/cli'
import { ChatLayout, SidebarToggle } from '@renderer/features/chat/layout/ChatLayout'
import { Composer } from '@renderer/features/chat/components/Composer'
import { useChat } from '@renderer/features/chat/store'
import { newDraftKey } from '@renderer/features/chat/drafts'
import { ProjectMemoryPanel } from '@renderer/features/memory/components/ProjectMemoryPanel'
import type { MediaItem } from '@shared/expressive'
import type { MessageVoice } from '@shared/voice'
import { PROJECTS_ROUTE } from '../view'
import { InstructionsDialog } from './ProjectDialogs'
import { ProjectScheduleAdd, ProjectSchedules } from '@renderer/features/schedules/components/ProjectSchedules'
import { ProjectMenu } from './ProjectMenu'

/** Trang một dự án: tên + mô tả, ô nhập "Cuộc trò chuyện mới trong …", các cuộc của dự án, cột phải. */
export function ProjectPage({ id }: { id: string }) {
  const { t } = useTranslation('projects')
  // Thêm / gỡ file, sửa hướng dẫn (kể cả từ nơi khác) → cập nhật ngay.
  // Bọc lại để phân biệt "đang tải" (null) với "không có dự án" (project = null).
  const { data: loaded, setData } = useSyncedState(['projects'], async () => ({ project: await api.projects.get(id) }))
  const navigate = useNavigate()

  if (loaded === null) return <ChatLayout><section className="flex-1" /></ChatLayout>
  const data = loaded.project
  /** Gỡ file: biến mất ngay, lỗi thì hiện lại + báo (cơ chế đồng bộ chung). */
  const removeFile = (fileId: string): void => {
    if (!data) return
    void optimistic({
      topic: 'projects',
      apply: () => setData({ project: { ...data, files: data.files.filter((f) => f.id !== fileId) } }),
      rollback: () => setData({ project: data }),
      save: () => api.projects.removeFile(fileId)
    })
  }

  return (
    <ChatLayout>
      <section className="thin-scroll flex min-w-0 flex-1 flex-col overflow-y-auto" data-testid="project-page">
        <div className="flex min-h-11 items-center gap-1 px-4 py-1.5 text-sm text-muted-foreground">
          <SidebarToggle when="hidden" />
          <Link to={PROJECTS_ROUTE} className="hover:text-foreground" data-testid="project-breadcrumb">
            {t('detail.back')}
          </Link>
          {data && (
            <>
              <ChevronRight className="size-3.5" />
              <span className="truncate text-foreground">{data.name}</span>
              <ProjectMenu project={data} onDeleted={() => void navigate(PROJECTS_ROUTE)} className="ml-1" />
            </>
          )}
        </div>
        {!data ? (
          <p className="p-10 text-center text-sm text-muted-foreground" data-testid="project-not-found">
            {t('detail.notFound')}
          </p>
        ) : (
          <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 pt-4 pb-12 sm:px-10 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold tracking-tight" data-testid="project-name">
                {data.name}
              </h1>
              {data.description && <p className="mt-2 text-sm text-muted-foreground">{data.description}</p>}
              <div className="mt-6">
                <NewChatInProject project={data} />
              </div>
              <ProjectConversations projectId={data.id} />
            </div>
            <ProjectSidePanel project={data} onRemoveFile={removeFile} />
          </div>
        )}
      </section>
    </ChatLayout>
  )
}

/** Ô nhập như khung chat: gửi → tạo cuộc trong dự án rồi mở trang Chat. */
function NewChatInProject({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation('projects')
  const navigate = useNavigate()
  const cliOk = useCliStatus((s) => s.status?.state === 'ok')
  const [mode, setMode] = useState<ChatMode>('free')
  const start = async (send: () => Promise<boolean>): Promise<void> => {
    await useChat.getState().create(mode, project.id)
    void navigate('/')
    await send()
  }
  return (
    <div data-testid="project-composer">
      <Composer
        draftKey={newDraftKey(project.id)}
        mode={mode}
        onModeChange={setMode}
        streaming={false}
        disabled={!cliOk}
        placeholder={t('detail.composer', { name: project.name })}
        onSend={(text: string, attachmentIds: string[], voice?: MessageVoice) =>
          void start(() => useChat.getState().send(text, mode, attachmentIds, undefined, voice))
        }
        onSendMedia={(m: MediaItem) => void start(() => useChat.getState().send('', mode, [], { kind: m.kind, source: m.source, id: m.id }))}
        onStop={() => undefined}
      />
    </div>
  )
}

function ProjectConversations({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation('projects')
  const navigate = useNavigate()
  const conversations = useChat((s) => s.conversations)
  const list = useMemo(
    () => conversations.filter((c) => c.projectId === projectId).sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations, projectId]
  )
  const date = useMemo(() => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }), [i18n.language])
  if (list.length === 0)
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center text-sm text-muted-foreground" data-testid="project-no-conversations">
        <MessageCircle className="size-6" />
        <p className="max-w-sm">{t('detail.noConversations')}</p>
      </div>
    )
  return (
    <div className="mt-8">
      <h2 className="pb-2 text-xs font-medium text-muted-foreground">{t('detail.conversations')}</h2>
      <ul className="divide-y" data-testid="project-conversations">
        {list.map((c) => {
          const Icon = c.mode === 'code' ? CodeXml : MessageCircle
          return (
            <li key={c.id}>
              <button
                className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  void useChat.getState().select(c.id)
                  void navigate('/')
                }}
                data-testid="project-conversation"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{c.title || t('chat:untitled')}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{date.format(c.updatedAt)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PanelRow({
  icon: Icon,
  title,
  meta,
  action,
  children,
  testId
}: {
  icon: typeof Brain
  title: string
  meta?: ReactNode
  action?: ReactNode
  children?: ReactNode
  testId: string
}) {
  return (
    <div className="border-b py-3.5 last:border-b-0" data-testid={testId}>
      <div className="flex items-center gap-2.5 text-sm">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span>{title}</span>
        {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
        <span className="ml-auto">{action}</span>
      </div>
      {children && <div className="mt-2 pl-6.5">{children}</div>}
    </div>
  )
}

const TextAction = ({ onClick, children, testId }: { onClick(): void; children: ReactNode; testId: string }) => (
  <button className="rounded px-1.5 py-0.5 text-sm hover:bg-muted" onClick={onClick} data-testid={testId}>
    {children}
  </button>
)

function ProjectSidePanel({ project, onRemoveFile }: { project: ProjectDetail; onRemoveFile(fileId: string): void }) {
  const { t, i18n } = useTranslation('projects')
  const num = (n: number): string => n.toLocaleString(i18n.language)
  const [editing, setEditing] = useState(false)
  const [result, setResult] = useState<ProjectAddFilesResult | null>(null)
  const limited = project.files.some((f) => f.usage !== 'full')

  const addFiles = async (): Promise<void> => {
    // Danh sách file tự cập nhật qua đồng bộ 'projects'.
    const r = await api.projects.addFiles(project.id)
    setResult(r.rejected.length ? r : null)
  }

  return (
    <aside className="text-sm" data-testid="project-panel">
      <PanelRow
        icon={NotebookPen}
        title={t('panel.instructions')}
        action={<TextAction onClick={() => setEditing(true)} testId="project-edit-instructions">{t('panel.editInstructions')}</TextAction>}
        testId="panel-instructions"
      >
        <p className={cn('line-clamp-4 text-xs whitespace-pre-line', !project.instructions && 'text-muted-foreground')} data-testid="project-instructions">
          {project.instructions || t('panel.instructionsEmpty')}
        </p>
      </PanelRow>

      <PanelRow
        icon={Files}
        title={t('panel.context')}
        meta={project.files.length > 0 ? t('files', { count: project.files.length }) : undefined}
        action={<TextAction onClick={() => void addFiles()} testId="project-add-files">{t('panel.addFiles')}</TextAction>}
        testId="panel-context"
      >
        {project.files.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('panel.noFiles')}</p>
        ) : (
          <ul className="space-y-0.5" data-testid="project-files">
            {project.files.map((f) => (
              <FileRow key={f.id} file={f} onRemove={() => onRemoveFile(f.id)} />
            ))}
          </ul>
        )}
        {project.files.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground tabular-nums" data-testid="project-usage">
            {t('panel.usage', { used: num(project.promptChars), max: num(PROJECT_PROMPT_CHARS) })}
          </p>
        )}
        {limited && (
          <p className="mt-1.5 flex gap-1.5 text-xs text-muted-foreground" data-testid="project-limit-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {t('panel.limitWarning', { max: num(PROJECT_PROMPT_CHARS) })}
          </p>
        )}
        {result && (
          <div className="mt-2 rounded-md bg-muted/60 p-2 text-xs" role="alert" data-testid="project-add-rejected">
            <p className="font-medium">{t('addResult.rejected')}</p>
            <ul className="mt-0.5 space-y-0.5">
              {result.rejected.map((r, i) => (
                <li key={i}>
                  {r.name} — {t(`addResult.reasons.${r.reason}`)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </PanelRow>

      <PanelRow icon={Brain} title={t('panel.memory')} testId="panel-memory">
        <ProjectMemoryPanel projectId={project.id} />
      </PanelRow>
      <PanelRow
        icon={Clock}
        title={t('panel.scheduled')}
        action={<ProjectScheduleAdd projectId={project.id} className="rounded px-1.5 py-0.5 text-sm hover:bg-muted" />}
        testId="panel-scheduled"
      >
        <ProjectSchedules projectId={project.id} />
      </PanelRow>
      <p className="pt-4 text-xs text-muted-foreground">{t('detail.private')}</p>

      {editing && <InstructionsDialog project={project} open onClose={() => setEditing(false)} />}
    </aside>
  )
}

function FileRow({ file, onRemove }: { file: ProjectFile; onRemove(): void }) {
  const { t } = useTranslation('projects')
  return (
    <li className="group flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted" data-testid="project-file" data-usage={file.usage}>
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs" title={file.name}>
        {file.name}
      </span>
      {file.usage !== 'full' && (
        <span
          className="shrink-0 rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground group-hover:bg-background"
          title={t(`panel.${file.usage}Help`)}
          data-testid="project-file-usage"
        >
          {t(`panel.${file.usage}`)}
        </span>
      )}
      <button
        className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
        aria-label={t('panel.removeFile', { name: file.name })}
        title={t('panel.removeFile', { name: file.name })}
        onClick={onRemove}
        data-testid="project-file-remove"
      >
        <X className="size-3.5" />
      </button>
    </li>
  )
}
