import { AlertTriangle, Folder, FolderOpen, Mail, MessageCircle, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  HOURLY_STEPS,
  SCHEDULE_DAILY_RUNS,
  SCHEDULE_NAME_MAX,
  SCHEDULE_PROMPT_MAX,
  type Schedule,
  type ScheduleGrantChange,
  type ScheduleInput,
  type ScheduleKind
} from '@shared/schedules'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@renderer/components/ui/dialog'
import { Input, Label, Select, Textarea } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { notifyChanged } from '@renderer/lib/sync'
import { cn } from '@renderer/lib/utils'
import { useConnectors } from '@renderer/features/connectors/store'
import { useProjects } from '@renderer/features/projects/store'
import { Switch } from '@renderer/features/settings/components/rows'
import { useSchedules } from '../store'
import { emptyForm, formFromSchedule, formToInput, type ScheduleForm } from '../view'

/**
 * Bật lịch hẹn lần đầu: cảnh báo (chạy khi app mở, tốn hạn mức của chính bạn, quyền theo từng lịch, chỉ đọc) + tick
 * "Tôi hiểu"; sau đó hỏi "Ẩn xuống khay khi đóng?" (người dùng hay bấm X — không có khay thì lịch gần như không chạy).
 */
export function EnableSchedulesDialog({ open, onClose }: { open: boolean; onClose(enabled: boolean): void }) {
  // Dựng lại mỗi lần mở → bắt đầu từ bước cảnh báo, chưa tick.
  return open ? <EnableBody onClose={onClose} /> : null
}

function EnableBody({ onClose }: { onClose(enabled: boolean): void }) {
  const { t } = useTranslation('schedules')
  const [ack, setAck] = useState(false)
  const [step, setStep] = useState<'warn' | 'tray'>('warn')
  const [busy, setBusy] = useState(false)

  const enable = async (): Promise<void> => {
    setBusy(true)
    try {
      const status = await api.schedules.setFeature({ enabled: true, acknowledged: true })
      notifyChanged('schedules')
      if (status.settings.trayAsked) onClose(true)
      else setStep('tray')
    } finally {
      setBusy(false)
    }
  }
  const tray = async (hide: boolean): Promise<void> => {
    await api.schedules.setFeature({ trayOnClose: hide })
    notifyChanged('schedules')
    onClose(true)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(step === 'tray')}>
      <DialogContent title={step === 'warn' ? t('enable.title') : t('enable.trayTitle')} className="max-w-lg" data-testid="schedules-enable-dialog">
        {step === 'warn' ? (
          <div className="space-y-4 text-sm">
            <ul className="space-y-2" data-testid="schedules-enable-warnings">
              {(['appOpen', 'quota', 'grants', 'readOnly', 'limit'] as const).map((k) => (
                <li key={k} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-orange-600 dark:text-orange-400" />
                  <span>{t(`enable.warn.${k}`, { max: SCHEDULE_DAILY_RUNS })}</span>
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2">
              <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="schedules-ack" />
              <span>{t('enable.ack')}</span>
            </label>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="outline">{t('common:actions.cancel')}</Button>
              </DialogClose>
              <Button disabled={!ack || busy} onClick={() => void enable()} data-testid="schedules-enable-confirm">
                {t('enable.confirm')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">{t('enable.trayBody')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => void tray(false)} data-testid="schedules-tray-no">
                {t('enable.trayNo')}
              </Button>
              <Button onClick={() => void tray(true)} data-testid="schedules-tray-yes">
                {t('enable.trayYes')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

const KINDS: ScheduleKind[] = ['daily', 'weekly', 'hourly', 'once']
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

/**
 * Tạo / sửa lịch. Lưu mà có quyền MỚI (thư mục, tài khoản Gmail, Telegram) → hộp xác nhận liệt kê đúng các quyền đó;
 * bấm "Cho phép" mới lưu thật. Bỏ bớt quyền thì lưu thẳng.
 */
type EditorProps = {
  open: boolean
  schedule: Schedule | null
  /** Tạo từ trang dự án → chọn sẵn dự án. */
  projectId?: string | null
  onClose(): void
  onSaved?(s: Schedule): void
}

export function ScheduleEditorDialog(props: EditorProps) {
  // Dựng lại mỗi lần mở → ô nhập lấy lại từ lịch (hoặc trống).
  return props.open ? <EditorBody {...props} /> : null
}

function EditorBody({ schedule, projectId, onClose, onSaved }: EditorProps) {
  const { t } = useTranslation('schedules')
  const projects = useProjects((s) => s.projects)
  const gmail = useConnectors((s) => s.gmail)
  const telegram = useConnectors((s) => s.telegram)
  const [form, setForm] = useState<ScheduleForm>(() =>
    schedule ? formFromSchedule(schedule, Date.now()) : emptyForm(Date.now(), projectId ?? null)
  )
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ input: ScheduleInput; added: ScheduleGrantChange[] } | null>(null)
  const [busy, setBusy] = useState(false)
  // Danh sách tài khoản Gmail / Telegram mới nhất cho phần quyền.
  useEffect(() => {
    void useConnectors.getState().refresh()
  }, [])

  const patch = (p: Partial<ScheduleForm>): void => setForm((f) => ({ ...f, ...p }))
  const gmailAccounts = gmail?.enabled ? gmail.accounts : []
  const telegramReady = !!telegram?.enabled && telegram.connection === 'connected'

  const save = async (input: ScheduleInput, confirmed: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.schedules.save({ id: schedule?.id, input, confirmed })
      if (r.status === 'error') return setError(t(`errors.${r.error}`, { defaultValue: t('errors.generic', { code: r.error }) }))
      if (r.status === 'confirm') return setConfirm({ input, added: r.added })
      notifyChanged('schedules')
      setConfirm(null)
      onSaved?.(r.schedule)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    const input = formToInput(form)
    if ('error' in input) return setError(t(`form.errors.${input.error}`))
    void save(input, false)
  }

  const pickFolder = async (): Promise<void> => {
    const folder = await api.schedules.pickFolder()
    if (folder) patch({ grants: { ...form.grants, folder } })
  }

  return (
    <>
      <Dialog open={!confirm} onOpenChange={(o) => !o && onClose()}>
        <DialogContent title={schedule ? t('form.editTitle') : t('form.newTitle')} className="max-w-xl" data-testid="schedule-editor">
          <form onSubmit={onSubmit} className="thin-scroll max-h-[70vh] space-y-4 overflow-x-hidden overflow-y-auto pr-1 text-sm">
            <div className="space-y-1.5">
              <Label htmlFor="schedule-name">{t('form.name')}</Label>
              <Input id="schedule-name" value={form.name} maxLength={SCHEDULE_NAME_MAX} onChange={(e) => patch({ name: e.target.value })} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-prompt">{t('form.prompt')}</Label>
              <Textarea
                id="schedule-prompt"
                rows={4}
                value={form.prompt}
                maxLength={SCHEDULE_PROMPT_MAX}
                placeholder={t('form.promptPlaceholder')}
                onChange={(e) => patch({ prompt: e.target.value })}
              />
            </div>

            <fieldset className="min-w-0 space-y-2">
              <legend className="pb-1 text-sm font-medium">{t('form.when')}</legend>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('form.when')}>
                {KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={form.kind === k}
                    className={cn('rounded-md border px-2.5 py-1 text-xs hover:bg-muted', form.kind === k && 'border-primary bg-primary/10 font-medium')}
                    onClick={() => patch({ kind: k })}
                    data-testid={`schedule-kind-${k}`}
                  >
                    {t(`kinds.${k}`)}
                  </button>
                ))}
              </div>
              {form.kind === 'once' && (
                <Input type="datetime-local" aria-label={t('form.onceAt')} value={form.onceAt} onChange={(e) => patch({ onceAt: e.target.value })} data-testid="schedule-once-at" />
              )}
              {(form.kind === 'daily' || form.kind === 'weekly') && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{t('form.at')}</span>
                  <Input type="time" className="w-32" aria-label={t('form.time')} value={form.time} onChange={(e) => patch({ time: e.target.value || '08:00' })} data-testid="schedule-time" />
                </div>
              )}
              {form.kind === 'weekly' && (
                <div className="flex flex-wrap gap-1">
                  {DAY_ORDER.map((d) => {
                    const on = form.days.includes(d)
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        className={cn('min-w-9 rounded-md border px-2 py-1 text-xs hover:bg-muted', on && 'border-primary bg-primary/10 font-medium')}
                        onClick={() => patch({ days: on ? form.days.filter((x) => x !== d) : [...form.days, d] })}
                        data-testid={`schedule-day-${d}`}
                      >
                        {t(`days.short.${d}`)}
                      </button>
                    )
                  })}
                </div>
              )}
              {form.kind === 'hourly' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{t('form.every')}</span>
                  <Select className="w-24" aria-label={t('form.every')} value={form.every} onChange={(e) => patch({ every: Number(e.target.value) as ScheduleForm['every'] })} data-testid="schedule-every">
                    {HOURLY_STEPS.map((n) => (
                      <option key={n} value={n}>
                        {t('form.hours', { count: n })}
                      </option>
                    ))}
                  </Select>
                  <span className="text-muted-foreground">{t('form.from')}</span>
                  <Select className="w-24" aria-label={t('form.from')} value={form.from} onChange={(e) => patch({ from: Number(e.target.value) })}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
                    ))}
                  </Select>
                  <span className="text-muted-foreground">{t('form.to')}</span>
                  <Select className="w-24" aria-label={t('form.to')} value={form.to} onChange={(e) => patch({ to: Number(e.target.value) })}>
                    {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                      <option key={h} value={h}>{`${String(h % 24).padStart(2, '0')}:00`}</option>
                    ))}
                  </Select>
                </div>
              )}
              {form.kind !== 'hourly' && (
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={form.catchUp} onChange={(e) => patch({ catchUp: e.target.checked })} data-testid="schedule-catch-up" />
                  <span>
                    {t('form.catchUp')}
                    <span className="block text-xs text-muted-foreground">{t(`form.catchUpHint.${form.kind}`)}</span>
                  </span>
                </label>
              )}
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="schedule-project">{t('form.project')}</Label>
                <Select id="schedule-project" value={form.projectId ?? ''} onChange={(e) => patch({ projectId: e.target.value || null })} data-testid="schedule-project">
                  <option value="">{t('form.noProject')}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="schedule-model">{t('form.model')}</Label>
                <Select id="schedule-model" value={form.model} onChange={(e) => patch({ model: e.target.value as ScheduleForm['model'] })} data-testid="schedule-model">
                  <option value="default">{t('models.default')}</option>
                  <option value="cheap">{t('models.cheap')}</option>
                </Select>
              </div>
            </div>

            <fieldset className="min-w-0 space-y-2 rounded-lg border p-3" data-testid="schedule-grants">
              <legend className="px-1 text-sm font-medium">{t('form.grants')}</legend>
              <p className="text-xs text-muted-foreground">{t('form.grantsHint')}</p>
              <div className="flex items-center gap-2">
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                {form.grants.folder ? (
                  <>
                    <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 text-xs" title={form.grants.folder} data-testid="schedule-folder">
                      {form.grants.folder}
                    </code>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={t('form.removeFolder')} title={t('form.removeFolder')} onClick={() => patch({ grants: { ...form.grants, folder: null } })}>
                      <X />
                    </Button>
                  </>
                ) : (
                  <span className="flex-1 text-muted-foreground">{t('form.noFolder')}</span>
                )}
                <Button type="button" size="sm" variant="outline" onClick={() => void pickFolder()} data-testid="schedule-pick-folder">
                  <FolderOpen />
                  {t('form.pickFolder')}
                </Button>
              </div>
              {gmailAccounts.map((a) => (
                <label key={a.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.grants.gmailAccounts.includes(a.id)}
                    onChange={(e) =>
                      patch({
                        grants: {
                          ...form.grants,
                          gmailAccounts: e.target.checked ? [...form.grants.gmailAccounts, a.id] : form.grants.gmailAccounts.filter((x) => x !== a.id)
                        }
                      })
                    }
                    data-testid={`schedule-gmail-${a.id}`}
                  />
                  <Mail className="size-4 text-muted-foreground" />
                  <span>{t('form.gmail', { label: a.label, email: a.email })}</span>
                </label>
              ))}
              {telegramReady && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.grants.telegram} onChange={(e) => patch({ grants: { ...form.grants, telegram: e.target.checked } })} data-testid="schedule-telegram" />
                  <MessageCircle className="size-4 text-muted-foreground" />
                  <span>{t('form.telegram')}</span>
                </label>
              )}
            </fieldset>

            {error && (
              <p className="text-sm text-destructive" data-testid="schedule-form-error">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t('common:actions.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy} data-testid="schedule-save">
                {schedule ? t('common:actions.save') : t('form.create')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <GrantConfirmDialog
        added={confirm?.added ?? null}
        isNew={!schedule}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && void save(confirm.input, true)}
      />
    </>
  )
}

/** "Cho lịch này quyền …?" — liệt kê đúng các quyền MỚI; Huỷ → về hộp sửa, chưa lưu gì. */
export function GrantConfirmDialog({
  added,
  isNew,
  busy,
  onCancel,
  onConfirm
}: {
  added: ScheduleGrantChange[] | null
  isNew: boolean
  busy: boolean
  onCancel(): void
  onConfirm(): void
}) {
  const { t } = useTranslation('schedules')
  return (
    <Dialog open={!!added} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent title={isNew ? t('confirm.titleNew') : t('confirm.titleEdit')} description={t('confirm.description')} data-testid="schedule-grant-confirm">
        <ul className="space-y-2 text-sm" data-testid="schedule-grant-list">
          {added?.map((g) => (
            <li key={g.kind === 'gmail' ? g.accountId : g.kind} className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2">
              {g.kind === 'folder' ? <Folder className="mt-0.5 size-4 shrink-0" /> : g.kind === 'gmail' ? <Mail className="mt-0.5 size-4 shrink-0" /> : <MessageCircle className="mt-0.5 size-4 shrink-0" />}
              <span className="min-w-0 break-all">
                {g.kind === 'folder' ? t('confirm.folder', { path: g.path }) : g.kind === 'gmail' ? t('confirm.gmail', { label: g.label }) : t('confirm.telegram')}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{t('confirm.readOnly')}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            {t('common:actions.cancel')}
          </Button>
          <Button disabled={busy} onClick={onConfirm} data-testid="schedule-grant-allow">
            {t('confirm.allow')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Công tắc lịch hẹn (Cài đặt → Khả năng, trang Lịch hẹn): bật lần đầu qua hộp cảnh báo; còn lại đổi ngay (lạc quan). */
export function SchedulesFeatureSwitch() {
  const { t } = useTranslation('schedules')
  const settings = useSchedules((s) => s.status?.settings)
  const setFeature = useSchedules((s) => s.setFeature)
  const [warn, setWarn] = useState(false)
  return (
    <>
      <Switch
        checked={!!settings?.enabled}
        disabled={!settings}
        aria-label={t('settings.enable')}
        onChange={(e) => {
          if (e.target.checked && !settings?.acknowledged) return setWarn(true)
          void setFeature({ enabled: e.target.checked })
        }}
        data-testid="schedules-feature-switch"
      />
      <EnableSchedulesDialog open={warn} onClose={() => setWarn(false)} />
    </>
  )
}

/** "Ẩn xuống khay khi đóng cửa sổ". */
export function TraySwitch() {
  const { t } = useTranslation('schedules')
  const settings = useSchedules((s) => s.status?.settings)
  const setFeature = useSchedules((s) => s.setFeature)
  return (
    <Switch
      checked={!!settings?.trayOnClose}
      disabled={!settings?.enabled}
      aria-label={t('settings.tray')}
      onChange={(e) => void setFeature({ trayOnClose: e.target.checked })}
      data-testid="schedules-tray-switch"
    />
  )
}
