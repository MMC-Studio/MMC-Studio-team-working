import type { ComponentProps } from 'react'
import { cn } from '@renderer/lib/utils'

/**
 * Công tắc bật / tắt — vẫn là checkbox thật: Space bật tắt, `disabled` khoá, trình đọc màn hình và
 * test `check()` đều dùng được. (Chuyển từ features/settings/components/rows.tsx — đường import cũ vẫn dùng được.)
 */
export function Switch({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      role="switch"
      className={cn(
        'relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-input transition-colors duration-(--dur-fast) ease-(--ease-out) outline-none checked:bg-primary focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50',
        'before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-primary-foreground before:shadow before:transition-transform before:duration-(--dur-fast) before:ease-(--ease-out) checked:before:translate-x-4',
        className
      )}
      {...props}
    />
  )
}
