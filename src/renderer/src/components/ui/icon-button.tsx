import type { ReactNode } from 'react'
import { Button, type ButtonProps } from './button'
import { Tooltip } from './tooltip'

export type IconButtonProps = Omit<ButtonProps, 'children' | 'aria-label' | 'asChild' | 'size'> & {
  /** BẮT BUỘC: chữ của tooltip và `aria-label` (nút chỉ có icon thì trình đọc màn hình chỉ có chữ này). */
  label: string
  icon: ReactNode
  size?: 'icon' | 'icon-sm'
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

/** Nút chỉ có icon: luôn có tooltip + aria-label lấy từ `label`. Mặc định kiểu `ghost`. */
export function IconButton({ label, icon, size = 'icon', variant = 'ghost', tooltipSide, ...props }: IconButtonProps) {
  return (
    <Tooltip content={label} side={tooltipSide}>
      <Button aria-label={label} size={size} variant={variant} {...props}>
        {icon}
      </Button>
    </Tooltip>
  )
}
