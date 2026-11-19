import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { ChatLayout, SidebarToggle } from '@renderer/features/chat/layout/ChatLayout'
import { SOON_ICON, isSoonSection } from '../sections'

/** Trang tạm "Sắp có" cho Dự án / Lịch hẹn / Plugin (cùng bố cục thanh bên chat). */
export function ComingSoonPage() {
  const { t } = useTranslation('comingSoon')
  const { section } = useParams()
  const key = isSoonSection(section) ? section : null
  const Icon = key ? SOON_ICON[key] : null
  return (
    <ChatLayout>
      <section className="flex min-w-0 flex-1 flex-col" data-testid="coming-soon" data-section={key ?? ''}>
        <header className="flex min-h-11 items-center gap-2 border-b px-4 py-1.5">
          <SidebarToggle when="hidden" />
          <h1 className="text-sm font-medium">{key ? t(`sections.${key}.title`) : t('title')}</h1>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          {Icon && <Icon className="size-10 text-muted-foreground/60" />}
          <p className="text-base font-medium">{t('title')}</p>
          <p className="max-w-md text-sm text-muted-foreground">{key ? t(`sections.${key}.description`) : t('unknown')}</p>
        </div>
      </section>
    </ChatLayout>
  )
}
