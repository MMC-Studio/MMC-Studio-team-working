import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** Nhóm dòng cài đặt trong một tab (tiêu đề nhỏ đậm, như Claude). */
export function SettingsSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="pb-6">
      {title && <h3 className="pb-1 text-sm font-semibold">{title}</h3>}
      <div>{children}</div>
    </section>
  )
}

/**
 * Một dòng cài đặt: tên + mô tả xám bên trái, điều khiển (công tắc / nút / ô chọn) bên phải, đường kẻ mảnh giữa các dòng.
 * Phần cài đặt nhiều ô (giọng nói, biểu cảm, skill…) đặt trong `children` — hiện bên dưới, rộng hết dòng.
 * `id` khớp `SETTING_ITEMS` (catalog.ts): chữ lấy từ `dialog.items.<id>`, ô tìm nhảy tới đúng dòng này.
 */
export function SettingRow({
  id,
  label,
  description,
  control,
  children,
  htmlFor
}: {
  id: string
  label?: ReactNode
  description?: ReactNode
  control?: ReactNode
  children?: ReactNode
  /** Bấm vào tên → điều khiển (vd công tắc). */
  htmlFor?: string
}) {
  const { t } = useTranslation('settings')
  const Title = htmlFor ? 'label' : 'div'
  return (
    <div className="setting-row border-b py-4 last:border-b-0" data-setting-id={id}>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <Title className="block text-sm" htmlFor={htmlFor}>
            {label ?? t(`dialog.items.${id}.label`)}
          </Title>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description ?? t(`dialog.items.${id}.description`)}</p>
        </div>
        {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}

/** Công tắc dùng chung — nay ở bộ giao diện chung (C0.1); giữ export ở đây để các chỗ cũ không phải đổi import. */
export { Switch } from '@renderer/components/ui/switch'
