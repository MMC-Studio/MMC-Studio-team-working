import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE, appearanceSchema } from '@shared/schemas'
import { openDatabase } from '../client'
import { SettingsRepository } from '../repositories'

const migrations = join(__dirname, '..', 'migrations')

// C0.1a thêm `motion` vào giao diện. SettingsRepository.get trả mặc định cho CẢ CỤM khi dữ liệu
// đã lưu không khớp schema → nếu trường mới thiếu default, cập nhật app làm mất theme + màu nhấn.
describe('cài đặt giao diện — trường motion (Giảm chuyển động)', () => {
  let handle: ReturnType<typeof openDatabase>
  let settings: SettingsRepository

  beforeEach(() => {
    handle = openDatabase(':memory:', migrations)
    settings = new SettingsRepository(handle.db)
  })
  afterEach(() => handle.close())

  it('cài đặt lưu từ bản cũ (chưa có motion) giữ nguyên theme + màu nhấn, motion = theo Windows', () => {
    settings.set('appearance', { theme: 'dark', accent: 'violet' })
    expect(settings.get('appearance', appearanceSchema, DEFAULT_APPEARANCE)).toEqual({
      theme: 'dark',
      accent: 'violet',
      motion: 'system'
    })
  })

  it('lưu và đọc lại đúng lựa chọn', () => {
    settings.set('appearance', appearanceSchema.parse({ theme: 'light', accent: 'green', motion: 'reduce' }))
    expect(settings.get('appearance', appearanceSchema, DEFAULT_APPEARANCE).motion).toBe('reduce')
  })

  it('giá trị lạ bị từ chối ở IPC (zod)', () => {
    expect(appearanceSchema.safeParse({ theme: 'dark', accent: 'blue', motion: 'slow' }).success).toBe(false)
  })
})
