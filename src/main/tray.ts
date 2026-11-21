import type { MenuItemConstructorOptions, NativeImage } from 'electron'

export type TrayState = { pausedAll: boolean; running: boolean }
export type TrayActions = { open(): void; setPausedAll(paused: boolean): void; stopRun(): void; quit(): void }

/** Menu khay: Mở · Tạm dừng / Tiếp tục mọi lịch · Dừng lần đang chạy (chỉ khi đang chạy) · Thoát. Hàm thuần (test được). */
export function trayMenuTemplate(state: TrayState, actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { id: 'open', label: 'Mở MMC studio', click: () => actions.open() },
    { type: 'separator' },
    state.pausedAll
      ? { id: 'resume', label: 'Tiếp tục mọi lịch hẹn', click: () => actions.setPausedAll(false) }
      : { id: 'pause', label: 'Tạm dừng mọi lịch hẹn', click: () => actions.setPausedAll(true) },
    ...(state.running ? [{ id: 'stop', label: 'Dừng lần đang chạy', click: () => actions.stopRun() }] : []),
    { type: 'separator' },
    { id: 'quit', label: 'Thoát', click: () => actions.quit() }
  ]
}

/** Đóng cửa sổ (bấm X) thì làm gì: ẩn xuống khay / thoát / hỏi một lần (đang có lịch hẹn, chưa từng nhắc). */
export function closeAction(s: { enabled: boolean; trayOnClose: boolean; closeHintShown: boolean }): 'hide' | 'ask' | 'quit' {
  if (s.enabled && s.trayOnClose) return 'hide'
  if (s.enabled && !s.closeHintShown) return 'ask'
  return 'quit'
}

/**
 * Biểu tượng khay 32×32 vẽ bằng mã (repo chưa có file icon): đồng hồ trắng trên nền tím. Không phụ thuộc file
 * ngoài → đóng gói không thiếu tài nguyên.
 */
export function trayIconBitmap(size = 32): Buffer {
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  const r = size / 2 - 1
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x - c
      const dy = y - c
      const d = Math.hypot(dx, dy)
      const i = (y * size + x) * 4
      if (d > r) continue
      // Kim giờ (lên trên) + kim phút (sang phải) màu trắng, viền tròn trắng.
      const hand = (Math.abs(dx) < 1.2 && dy < 0 && dy > -r * 0.6) || (Math.abs(dy) < 1.2 && dx > 0 && dx < r * 0.45)
      const ring = d > r - 2
      const white = hand || ring
      // BGRA
      buf[i] = white ? 255 : 0xd4
      buf[i + 1] = white ? 255 : 0x3a
      buf[i + 2] = white ? 255 : 0x7c
      buf[i + 3] = 255
    }
  return buf
}

export type TrayPort = {
  setToolTip(text: string): void
  setContextMenu(menu: unknown): void
  on(event: 'click' | 'double-click', listener: () => void): void
  destroy(): void
}

export type AppTrayDeps = {
  create(icon: NativeImage): TrayPort
  icon(): NativeImage
  buildMenu(template: MenuItemConstructorOptions[]): unknown
  state(): TrayState
  actions: TrayActions
}

/** Biểu tượng khay: chỉ có khi người dùng chọn "ẩn xuống khay khi đóng" và lịch hẹn đang bật. */
export class AppTray {
  private tray: TrayPort | null = null

  constructor(private readonly deps: AppTrayDeps) {}

  /** Tạo / gỡ biểu tượng theo lựa chọn hiện tại, cập nhật menu. */
  sync(show: boolean): void {
    if (!show) {
      this.tray?.destroy()
      this.tray = null
      return
    }
    if (!this.tray) {
      this.tray = this.deps.create(this.deps.icon())
      this.tray.on('click', () => this.deps.actions.open())
      this.tray.on('double-click', () => this.deps.actions.open())
    }
    const state = this.deps.state()
    this.tray.setToolTip(state.pausedAll ? 'MMC studio — lịch hẹn đang tạm dừng' : state.running ? 'MMC studio — đang chạy lịch hẹn' : 'MMC studio')
    this.tray.setContextMenu(this.deps.buildMenu(trayMenuTemplate(state, this.deps.actions)))
  }

  get visible(): boolean {
    return this.tray !== null
  }
}
