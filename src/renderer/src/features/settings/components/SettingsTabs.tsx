import { Check, Upload } from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import {
  ACCENTS,
  LANGUAGES,
  PERSONAS,
  THEMES,
  assistantProfileSchema,
  type AssistantProfile
} from '@shared/schemas'
import { AssistantAvatar } from '@renderer/components/AssistantAvatar'
import { Button } from '@renderer/components/ui/button'
import { Input, Label, Select, Textarea } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { usePreferences } from '@renderer/stores/preferences'
import { ExpressiveSettings } from '@renderer/features/chat/expressive/ExpressiveSettings'
import { VoiceSettings } from '@renderer/features/chat/voice/VoiceSettings'
import { SchedulesFeatureSwitch, TraySwitch } from '@renderer/features/schedules/components/ScheduleDialogs'
import { PRESET_AVATARS, imageFileToAvatar } from '../avatar'
import type { SettingsTab } from '../catalog'
import { AiConnectionRows, AutoSuggestRow, OrganizeRows } from './AiSection'
import { SettingRow, SettingsSection } from './rows'
import { StyleNotes } from './StyleNotes'
import { CommandsRow } from './CommandsRow'
import { UpdateRows } from './UpdateSection'

/** Nút "Mở" / "Quản lý" dẫn sang trang riêng của tính năng (cửa sổ Cài đặt tự đóng khi đổi trang). */
function OpenLink({ to, testId, label }: { to: string; testId?: string; label?: string }) {
  const { t } = useTranslation('settings')
  return (
    <Button variant="outline" size="sm" asChild>
      <Link to={to} data-testid={testId}>
        {label ?? t('dialog.open')}
      </Link>
    </Button>
  )
}

function AppearanceTab() {
  const { t } = useTranslation('settings')
  const appearance = usePreferences((s) => s.appearance)
  const saveAppearance = usePreferences((s) => s.saveAppearance)
  return (
    <SettingsSection>
      <SettingRow
        id="theme"
        control={
          <div className="flex gap-1 rounded-lg bg-muted p-0.5">
            {THEMES.map((theme) => (
              <button
                key={theme}
                type="button"
                aria-pressed={appearance.theme === theme}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground',
                  appearance.theme === theme && 'bg-background font-medium text-foreground shadow-sm'
                )}
                onClick={() => void saveAppearance({ ...appearance, theme })}
                data-testid={`theme-${theme}`}
              >
                {t(`appearance.themes.${theme}`)}
              </button>
            ))}
          </div>
        }
      />
      <SettingRow
        id="accent"
        control={
          <div className="flex gap-2">
            {ACCENTS.map((accent) => (
              <button
                key={accent}
                type="button"
                data-accent={accent}
                title={t(`appearance.accents.${accent}`)}
                aria-label={t(`appearance.accents.${accent}`)}
                aria-pressed={appearance.accent === accent}
                className={cn(
                  'size-6 rounded-full bg-primary ring-offset-2 ring-offset-background',
                  appearance.accent === accent && 'ring-2 ring-primary'
                )}
                onClick={() => void saveAppearance({ ...appearance, accent })}
              />
            ))}
          </div>
        }
      />
    </SettingsSection>
  )
}

/** Tên, avatar, tính cách, ngôn ngữ của trợ lý — sửa rồi bấm Lưu. */
function AssistantProfileForm() {
  const { t } = useTranslation('settings')
  const saved = usePreferences((s) => s.assistant)
  const saveAssistant = usePreferences((s) => s.saveAssistant)
  const [draft, setDraft] = useState<AssistantProfile>(saved)
  const [status, setStatus] = useState<'idle' | 'saved' | 'uploadError'>('idle')

  const update = (patch: Partial<AssistantProfile>): void => {
    setDraft((d) => ({ ...d, ...patch }))
    setStatus('idle')
  }
  const valid = assistantProfileSchema.safeParse(draft).success
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  const onUpload = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      update({ avatar: await imageFileToAvatar(file) })
    } catch {
      setStatus('uploadError')
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="assistant-name">{t('assistant.name')}</Label>
        <Input id="assistant-name" value={draft.name} maxLength={40} onChange={(e) => update({ name: e.target.value })} />
      </div>

      <div className="space-y-1.5">
        <Label>{t('assistant.avatar')}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <AssistantAvatar avatar={draft.avatar} className="size-11 text-2xl ring-2 ring-primary" />
          {PRESET_AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              aria-label={a}
              className={cn('rounded-full p-0.5 hover:bg-muted', draft.avatar === a && 'ring-2 ring-primary')}
              onClick={() => update({ avatar: a })}
            >
              <AssistantAvatar avatar={a} />
            </button>
          ))}
          <Button variant="outline" size="sm" asChild>
            <label className="cursor-pointer">
              <Upload />
              {t('assistant.upload')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                onChange={(e) => void onUpload(e.target.files?.[0])}
              />
            </label>
          </Button>
        </div>
        {status === 'uploadError' && <p className="text-sm text-destructive">{t('assistant.uploadError')}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="assistant-persona">{t('assistant.persona')}</Label>
          <Select
            id="assistant-persona"
            value={draft.persona}
            onChange={(e) => update({ persona: e.target.value as AssistantProfile['persona'] })}
          >
            {PERSONAS.map((p) => (
              <option key={p} value={p}>
                {t(`assistant.personas.${p}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assistant-language">{t('assistant.language')}</Label>
          <Select
            id="assistant-language"
            value={draft.language}
            onChange={(e) => update({ language: e.target.value as AssistantProfile['language'] })}
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {t(`assistant.languages.${l}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {draft.persona === 'custom' && (
        <div className="space-y-1.5">
          <Label htmlFor="assistant-custom">{t('assistant.customPersona')}</Label>
          <Textarea
            id="assistant-custom"
            rows={3}
            maxLength={500}
            placeholder={t('assistant.customPlaceholder')}
            value={draft.customPersona}
            onChange={(e) => update({ customPersona: e.target.value })}
          />
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        {status === 'saved' && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4" />
            {t('common:actions.saved')}
          </span>
        )}
        <Button
          disabled={!valid || !dirty}
          onClick={async () => {
            await saveAssistant(draft)
            setStatus('saved')
          }}
        >
          {t('common:actions.save')}
        </Button>
      </div>
    </div>
  )
}

function AssistantTab() {
  const { t } = useTranslation('settings')
  return (
    <>
      <SettingsSection>
        <SettingRow id="profile">
          <AssistantProfileForm />
        </SettingRow>
      </SettingsSection>
      <SettingsSection>
        <SettingRow id="myStyle">
          <StyleNotes />
        </SettingRow>
        <AutoSuggestRow />
        <SettingRow id="memory" control={<OpenLink to="/memory" label={t('dialog.manage')} testId="open-memory" />} />
      </SettingsSection>
    </>
  )
}

function AiTab() {
  return (
    <SettingsSection>
      <AiConnectionRows />
      <OrganizeRows />
    </SettingsSection>
  )
}

function CapabilitiesTab() {
  const { t: tChat } = useTranslation('chat')
  const name = usePreferences((s) => s.assistant.name)
  return (
    <SettingsSection>
      <SettingRow id="expressive" description={tChat('expressive.settings.description', { name })}>
        <ExpressiveSettings />
      </SettingRow>
      <SettingRow id="voice" description={tChat('voice.settings.description', { name })}>
        <VoiceSettings />
      </SettingRow>
      <SettingRow id="computer" control={<OpenLink to="/computer" testId="open-computer" />} />
      <CommandsRow />
      <SettingRow
        id="schedules"
        control={
          <>
            <OpenLink to="/scheduled" testId="open-schedules" />
            <SchedulesFeatureSwitch />
          </>
        }
      />
      <SettingRow id="scheduleTray" control={<TraySwitch />} />
    </SettingsSection>
  )
}

function ConnectionsTab() {
  return (
    <SettingsSection>
      {/* Skill, Gmail, Telegram, MCP server, kết nối agent: quản lý ở MỘT chỗ — trang Plugin. */}
      <SettingRow id="plugins" control={<OpenLink to="/plugins" testId="open-plugins" />} />
    </SettingsSection>
  )
}

function UpdatesTab() {
  return (
    <SettingsSection>
      <UpdateRows />
    </SettingsSection>
  )
}

function SupportTab() {
  const { t } = useTranslation('settings')
  return (
    <SettingsSection>
      <SettingRow id="reportBug" control={<OpenLink to="/ideas?kind=bug" testId="report-bug" label={t('support.reportBug')} />} />
    </SettingsSection>
  )
}

const TAB_CONTENT: Record<SettingsTab, ComponentType> = {
  appearance: AppearanceTab,
  assistant: AssistantTab,
  ai: AiTab,
  capabilities: CapabilitiesTab,
  connections: ConnectionsTab,
  updates: UpdatesTab,
  support: SupportTab
}

/** Nội dung một tab của cửa sổ Cài đặt. */
export function SettingsTabContent({ tab }: { tab: SettingsTab }) {
  const Content = TAB_CONTENT[tab]
  return <Content />
}
