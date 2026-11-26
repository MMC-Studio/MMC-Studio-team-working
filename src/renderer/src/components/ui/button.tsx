import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@renderer/lib/utils'

const buttonVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,scale] duration-(--dur-fast) ease-(--ease-out) outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-50 motion-ok:active:scale-[0.97] [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
        outline: 'border bg-background hover:bg-muted',
        ghost: 'hover:bg-muted',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-6',
        icon: 'size-9',
        'icon-sm': 'size-7',
        /** Viên thuốc (bo tròn hẳn) — nút nhỏ trên thanh công cụ / dashboard. */
        pill: 'h-8 rounded-full px-3.5 text-xs'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Đang xử lý: vòng xoay thay chữ (giữ nguyên độ rộng), tự khoá nút. Không dùng cùng `asChild`. */
    loading?: boolean
  }

export function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }: ButtonProps) {
  if (asChild) {
    return (
      <Slot.Root className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Slot.Root>
    )
  }
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          {/* Chữ vẫn chiếm chỗ (ẩn) → nút không co lại khi đang tải. */}
          <span className="invisible contents">{children}</span>
          <LoaderCircle aria-hidden className="absolute animate-spin" data-testid="button-spinner" />
        </>
      ) : (
        children
      )}
    </button>
  )
}
