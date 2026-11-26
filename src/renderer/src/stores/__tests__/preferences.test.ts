import { describe, expect, it } from 'vitest'
import { resolveReduceMotion } from '../preferences'

describe('resolveReduceMotion', () => {
  it('"Theo Windows" theo cài đặt hệ thống', () => {
    expect(resolveReduceMotion('system', true)).toBe(true)
    expect(resolveReduceMotion('system', false)).toBe(false)
  })

  it('"Luôn giảm" / "Không giảm" bỏ qua hệ thống', () => {
    expect(resolveReduceMotion('reduce', false)).toBe(true)
    expect(resolveReduceMotion('full', true)).toBe(false)
  })
})
