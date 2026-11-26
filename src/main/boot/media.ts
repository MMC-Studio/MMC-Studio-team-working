import { join } from 'node:path'
import { app, net, safeStorage, session } from 'electron'
import { z } from 'zod'
import {
  DEFAULT_EXPRESSIVE_SETTINGS,
  expressiveSettingsSchema,
  mediaRefSchema,
  EMPTY_RECENT,
  recentStoreSchema
} from '@shared/expressive'
import { IPC } from '@shared/ipc'
import { DEFAULT_VOICE_SETTINGS, STT_MODELS, voiceSettingsSchema } from '@shared/voice'
import { loadSkill } from '../ai/skills'
import { affinityStatsSchema } from '../expressive/affinity'
import { GiphyClient, readEnvKey } from '../expressive/giphy'
import { ExpressiveService } from '../expressive/service'
import { StickerLibrary } from '../expressive/stickers'
import { SecretStore } from '../services/secrets'
import { pythonCommand, SidecarClient } from '../sidecar/client'
import { runProcess } from '../sidecar/process'
import { VoiceInstaller } from '../voice/installer'
import { VoiceService } from '../voice/service'
import type { Computer } from './computer'
import { devOverride, resourcePath, type BootEnv } from './context'
import type { Core } from './core'

/** Chat biểu cảm (GIPHY, sticker) + giọng nói. */
export function createMedia(env: BootEnv, core: Core, computerPart: Computer) {
  const { log, userData, workspaceDir, getWindow } = env
  const { settings, accountScope } = core
  const { sidecarInstaller, killSwitch } = computerPart

  // Chat biểu cảm: GIF/sticker GIPHY (key: .env khi dev, hoặc người dùng dán — mã hoá DPAPI), sticker local, độ thân thiết trên máy.
  const giphyUserKey = new SecretStore(join(userData, 'secrets'), safeStorage, 'giphy-api-key.bin')
  // .env chỉ đọc ở bản chưa đóng gói (không có tiền tố VITE_ → không bao giờ nằm trong bộ cài).
  const giphyEnvKey = app.isPackaged
    ? null
    : 'GIPHY_API_KEY' in process.env // biến môi trường (kể cả rỗng, dùng trong test) được ưu tiên hơn file .env
      ? process.env.GIPHY_API_KEY || null
      : readEnvKey(join(app.getAppPath(), '.env'))
  const giphyKeySource = (): 'env' | 'user' | null =>
    giphyUserKey.has() ? 'user' : giphyEnvKey ? 'env' : null
  const giphy = new GiphyClient({
    getKey: () => giphyUserKey.get() ?? giphyEnvKey,
    fetch: (url) => net.fetch(url),
    baseUrl: devOverride('MMC_GIPHY_BASE')
  })
  const stickers = new StickerLibrary(
    resourcePath('stickers', 'resources/stickers'),
    join(userData, 'stickers')
  )
  stickers.ensureUserDir()
  const expressive = new ExpressiveService({
    getSettings: () =>
      settings.get('expressive', expressiveSettingsSchema, DEFAULT_EXPRESSIVE_SETTINGS),
    setSettings: (value) => settings.set('expressive', value),
    getStats: () => settings.get('expressiveStats', affinityStatsSchema.nullable(), null),
    setStats: (value) => settings.set('expressiveStats', value),
    getFavorites: () => settings.get('expressiveFavorites', z.array(mediaRefSchema), []),
    setFavorites: (list) => settings.set('expressiveFavorites', list),
    getRecent: () => settings.get('expressiveRecent', recentStoreSchema, EMPTY_RECENT),
    setRecent: (value) => settings.set('expressiveRecent', value),
    giphy,
    giphyKeySource,
    stickers,
    loadSkill: () => loadSkill(resourcePath('assistant-skills', 'assistant-skills'), 'expressive'),
    log
  })
  // Giọng nói: tiến trình Python riêng (voice_server.py) trong venv của sidecar; gói + model chỉ tải khi người dùng bấm.
  const fakeVoice = !app.isPackaged && process.env.MMC_FAKE_VOICE === '1'
  const voiceInstallerReal = new VoiceInstaller({
    modelsDir: join(userData, 'voice-models'),
    sidecar: () => ({ installed: sidecarInstaller.state.state === 'installed', paths: sidecarInstaller.paths }),
    requirements: {
      packages: resourcePath('sidecar/requirements-voice.txt', 'resources/sidecar/requirements-voice.txt'),
      cuda: resourcePath('sidecar/requirements-cuda.txt', 'resources/sidecar/requirements-cuda.txt')
    },
    fetch: (url, init) => net.fetch(url, init),
    run: runProcess,
    emit: (state) => getWindow()?.webContents.send(IPC.voicePackEvent, state),
    log
  })
  // Test e2e (bản chưa đóng gói + MMC_FAKE_VOICE): coi như đã cài, chép lời / đọc giả lập — không cần Python.
  const voiceInstaller = fakeVoice
    ? Object.assign(Object.create(voiceInstallerReal) as VoiceInstaller, {
        installed: async () => Object.fromEntries(['packages', 'piper', ...STT_MODELS].map((k) => [k, true]).concat([['cuda', false]]))
      })
    : voiceInstallerReal
  const voiceScript = resourcePath('sidecar/voice_server.py', 'resources/sidecar/voice_server.py')
  const voiceClient = new SidecarClient({
    command: () => (sidecarInstaller.state.state === 'installed' ? pythonCommand(sidecarInstaller.paths.venvPython, voiceScript) : null),
    log,
    timeoutMs: 120_000
  })
  app.on('before-quit', () => voiceClient.stop())
  // 2 giây im lặng (8 kHz, 16-bit) cho đọc giả lập — đủ dài để test thấy trạng thái "đang đọc".
  const SILENT_WAV = (() => {
    const data = 16_000 * 2
    const b = Buffer.alloc(44 + data)
    b.write('RIFF', 0)
    b.writeUInt32LE(36 + data, 4)
    b.write('WAVEfmt ', 8)
    b.writeUInt32LE(16, 16)
    b.writeUInt16LE(1, 20)
    b.writeUInt16LE(1, 22)
    b.writeUInt32LE(8_000, 24)
    b.writeUInt32LE(16_000, 28)
    b.writeUInt16LE(2, 32)
    b.writeUInt16LE(16, 34)
    b.write('data', 36)
    b.writeUInt32LE(data, 40)
    return b.toString('base64')
  })()
  const voice = new VoiceService({
    getSettings: () => settings.get('voice', voiceSettingsSchema, DEFAULT_VOICE_SETTINGS),
    setSettings: (value) => settings.set('voice', value),
    installer: voiceInstaller,
    sidecarInstalled: () => fakeVoice || sidecarInstaller.state.state === 'installed',
    call: fakeVoice
      ? (async (method: string) =>
          method === 'stt' ? { text: 'xin chào Mizuki, giọng nói giả lập' } : { audio: SILENT_WAV, mime: 'audio/wav' }) as never
      : (method, params, timeoutMs) => voiceClient.call(method, params, timeoutMs),
    stop: () => voiceClient.stop(),
    recordingsDir: join(workspaceDir, 'voice'),
    detectGpu: async () => {
      const r = await runProcess('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], {
        env: {},
        signal: new AbortController().signal,
        timeoutMs: 5_000
      }).catch(() => null)
      const [name, mb] = r?.code === 0 ? r.stdout.trim().split('\n')[0].split(',').map((s) => s.trim()) : []
      return name ? { name, vramMb: Number(mb) || 0 } : null
    },
    assistantName: () => accountScope.getAssistant().name,
    log
  })
  const pruneRecordings = (): void =>
    void voice.prune().then((n) => n && log.info(`Giọng nói: xoá ${n} ghi âm cũ hơn 7 ngày`))
  pruneRecordings()
  setInterval(pruneRecordings, 6 * 60 * 60 * 1000).unref()
  // Micro: chỉ cửa sổ chính, chỉ âm thanh (không camera). Quyền khác giữ như mặc định của Electron.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission !== 'media') return callback(true)
    const types = (details as { mediaTypes?: string[] }).mediaTypes ?? []
    callback(wc === getWindow()?.webContents && types.length > 0 && types.every((t) => t === 'audio'))
  })
  killSwitch.onStop(() => getWindow()?.webContents.send(IPC.voiceStopEvent))

  return { giphyUserKey, expressive, voiceInstaller, voiceClient, voice }
}

export type Media = ReturnType<typeof createMedia>
