import type { ComponentProps, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

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

/** Công tắc bật / tắt — vẫn là checkbox thật (bàn phím, trình đọc màn hình, test `check()` đều dùng được). */
export function Switch({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      role="switch"
      className={cn(
        'relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-input transition-colors outline-none checked:bg-primary focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50',
        'before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-white before:shadow before:transition-transform checked:before:translate-x-4',
        className
      )}
      {...props}
    />
  )
}
