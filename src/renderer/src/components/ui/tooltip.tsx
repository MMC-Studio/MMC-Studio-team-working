import { Tooltip as TooltipPrimitive } from 'radix-ui'
import type { ReactElement, ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

/** Thời gian rê chuột trước khi hiện (ms). Focus bằng Tab thì hiện ngay (radix lo). */
export const TOOLTIP_DELAY_MS = 400

/**
 * Chú thích nhỏ khi rê chuột hoặc focus bằng bàn phím. `children` phải là MỘT phần tử nhận được ref
 * (vd `Button`, thẻ `<button>`). Mỗi tooltip tự có Provider nên dùng được ở bất cứ đâu, không cần bọc app.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  className
}: {
  content: ReactNode
  children: ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={TOOLTIP_DELAY_MS}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            data-testid="tooltip"
            className={cn(
              // Màu đảo theo theme (chữ sáng trên nền tối ở chế độ sáng và ngược lại) — đọc rõ trên mọi nền.
              'z-50 max-w-64 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md',
              'animate-in fade-in-0 duration-(--dur-base) ease-(--ease-out) data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
              className
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
