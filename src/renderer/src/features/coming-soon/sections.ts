import { Clock, FolderKanban, Plug, type LucideIcon } from 'lucide-react'

/** Các trang mở từ thanh bên chat nhưng chưa làm xong — PR sau thay bằng trang thật. */
export const SOON_SECTIONS = ['projects', 'scheduled', 'plugins'] as const
export type SoonSection = (typeof SOON_SECTIONS)[number]

export const SOON_ICON: Record<SoonSection, LucideIcon> = { projects: FolderKanban, scheduled: Clock, plugins: Plug }

export const isSoonSection = (value: string | undefined): value is SoonSection =>
  (SOON_SECTIONS as readonly string[]).includes(value ?? '')
