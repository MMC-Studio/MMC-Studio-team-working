import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'
import { segmentedKeyTarget } from './segmented-keys'

export type SegmentedItem<T extends string> = {
  value: T
  label: string
  icon?: ReactNode
  /** Mặc định `segmented-<value>`. */
  testId?: string
}


const SIZES = {
  // "Table / Cards", lựa chọn trong Cài đặt: nền chọn là thẻ sáng trên rãnh xám.
  sm: {
    track: 'rounded-lg bg-surface-2 p-0.5',
    pad: '0.125rem',
    // Nền tối: --card (0.21) tối hơn rãnh --surface-2 (0.25) → mục chọn trông lõm; dùng --input (0.32) cho nổi lên.
    indicator: 'rounded-md bg-card shadow-sm dark:bg-input',
    item: 'h-7 gap-1.5 rounded-md px-2.5 text-xs',
    active: 'text-foreground'
  },
  // Thanh tab đầu trang: mục đang chọn là viên thuốc ĐẬM (màu chữ của theme, đảo ở sáng / tối).
  lg: {
    track: 'rounded-full bg-surface-2 p-1',
    pad: '0.25rem',
    indicator: 'rounded-full bg-foreground',
    item: 'h-8 gap-2 rounded-full px-4 text-sm',
    active: 'text-background'
  }
} as const

/**
 * Nhóm lựa chọn dạng đoạn (2–6 mục). Nền "viên thuốc" TRƯỢT sang mục mới (chỉ `transform`), nên mọi mục
 * rộng bằng nhau. Bàn phím: Tab vào mục đang chọn, mũi tên / Home / End đổi mục.
 */
export function Segmented<T extends string>({
  items,
  value,
  onValueChange,
  label,
  size = 'sm',
  className,
  testId
}: {
  items: SegmentedItem<T>[]
  value: T
  onValueChange: (value: T) => void
  /** Tên của nhóm cho trình đọc màn hình (bắt buộc — nhóm không có tiêu đề nhìn thấy). */
  label: string
  size?: keyof typeof SIZES
  className?: string
  testId?: string
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const s = SIZES[size]
  const index = Math.max(
    0,
    items.findIndex((i) => i.value === value)
  )
  const selectedFound = items.some((i) => i.value === value)

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const next = segmentedKeyTarget(e.key, index, items.length)
    if (next === null) return
    e.preventDefault()
    refs.current[next]?.focus()
    if (next !== index) onValueChange(items[next].value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      className={cn('relative inline-grid auto-cols-fr grid-flow-col', s.track, className)}
    >
      {selectedFound && (
        <span
          aria-hidden
          data-testid="segmented-indicator"
          className={cn(
            'pointer-events-none absolute top-(--pad) bottom-(--pad) left-(--pad) transition-transform duration-(--dur-base) ease-(--ease-out)',
            s.indicator
          )}
          style={
            {
              '--pad': s.pad,
              width: `calc((100% - 2 * ${s.pad}) / ${items.length})`,
              // translateX theo % chính độ rộng của nền = đúng một mục (các mục rộng bằng nhau).
              transform: `translateX(${index * 100}%)`
            } as CSSProperties
          }
        />
      )}
      {items.map((item, i) => {
        const active = selectedFound && i === index
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active || (!selectedFound && i === 0) ? 0 : -1}
            data-testid={item.testId ?? `segmented-${item.value}`}
            onClick={() => onValueChange(item.value)}
            onKeyDown={onKeyDown}
            className={cn(
              // Mọi mục cùng độ đậm (chỉ đổi màu khi chọn) → độ rộng không đổi, thanh không xê dịch khi đổi mục.
              'relative z-10 inline-flex items-center justify-center font-medium whitespace-nowrap text-muted-foreground transition-colors duration-(--dur-base) outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 [&_svg]:size-4 [&_svg]:shrink-0',
              s.item,
              active && s.active,
              active && size === 'lg' && 'hover:text-background'
            )}
          >
            {item.icon}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
