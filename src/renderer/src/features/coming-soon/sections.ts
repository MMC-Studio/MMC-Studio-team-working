import { Clock, type LucideIcon } from 'lucide-react'

/** Các trang mở từ thanh bên chat nhưng chưa làm xong — PR sau thay bằng trang thật. */
export const SOON_SECTIONS = ['scheduled'] as const
export type SoonSection = (typeof SOON_SECTIONS)[number]

export const SOON_ICON: Record<SoonSection, LucideIcon> = { scheduled: Clock }

export const isSoonSection = (value: string | undefined): value is SoonSection =>
  (SOON_SECTIONS as readonly string[]).includes(value ?? '')
